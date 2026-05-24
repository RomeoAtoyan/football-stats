import cv2
import numpy as np
import os
import json
import pickle
from typing import Callable, Tuple, Dict, Any
from loguru import logger
from ultralytics import YOLO

from tracking.homography import pixel_to_meter
from tracking.smoothing import KalmanFilter2D
from tracking.distance import PlayerStatsTracker
from tracking.team_assigner import TeamAssigner

def run_tracking_pipeline(
    video_path: str,
    output_video_path: str,
    export_json_path: str,
    homography_matrix: np.ndarray,
    progress_callback: Callable[[float, str], None] = None
) -> Tuple[Dict[str, Any], str]:
    """
    Core video processing pipeline with track caching:
    1. Checks if a pre-compiled tracking cache file exists to skip YOLO inference.
    2. Runs player detections on initial frames to fit TeamAssigner color clustering.
    3. Runs YOLOv8 + BoT-SORT tracking (if cache missed) or loads tracks from cache.
    4. Filters player foot coordinates with Kalman filters and projects to meters.
    5. Accumulates running speeds and total covered distance.
    6. Draws bounding boxes on the output frame (Purple for Team A, Aqua for Team B).
    7. Encodes the frames into output_video_path and writes analytics to export_json_path.
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")
        
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")
        
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    dt = 1.0 / fps if fps > 0 else 1.0 / 30.0
    
    logger.info(f"Loaded input video: {width}x{height} @ {fps}fps, {total_frames} frames.")
    
    # 0. Check for tracking cache
    cache_path = os.path.join(os.path.dirname(export_json_path), "tracking_cache.pkl")
    use_cache = os.path.exists(cache_path)
    cached_tracks = {}
    
    if use_cache:
        try:
            with open(cache_path, "rb") as f:
                cached_tracks = pickle.load(f)
            logger.info(f"Using cached tracking data with {len(cached_tracks)} frames from {cache_path}")
        except Exception as e:
            logger.warning(f"Failed to load tracking cache: {e}. Running fresh tracking.")
            use_cache = False
            
    model = None
    if not use_cache:
        # 1. Load YOLOv8 model
        logger.info("Initializing YOLOv8 person tracking...")
        if progress_callback:
            progress_callback(0.02, "Loading computer vision tracking models...")
            
        model_name = "yolov8m.pt" # Upgraded from yolov8n.pt (Nano) to yolov8m.pt (Medium) for much higher detection accuracy
        # Ensure model exists in backend
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        model_path = os.path.join(base_dir, model_name)
        if not os.path.exists(model_path):
            model_path = model_name # Let YOLO auto-download if not there
            
        model = YOLO(model_path)
        
    # 2. Team Color Classifier learning pass (KMeans)
    logger.info("Running initial calibration pass for team division...")
    if progress_callback:
        progress_callback(0.05, "Analyzing player jersey colors...")
        
    team_assigner = TeamAssigner()
    
    if use_cache:
        # Fine-tune team classifier using pre-extracted cached bounding boxes to save time
        max_players_frame_idx = 0
        max_players_count = 0
        max_players_detections = {}
        
        for init_frame_idx in range(min(30, total_frames)):
            if init_frame_idx in cached_tracks:
                current_players = {}
                idx = 0
                for det in cached_tracks[init_frame_idx]:
                    if det["cls"] == 0:
                        current_players[idx] = {"bbox": det["bbox"]}
                        idx += 1
                if len(current_players) > max_players_count:
                    max_players_count = len(current_players)
                    max_players_detections = current_players
                    max_players_frame_idx = init_frame_idx
                    
        cap.set(cv2.CAP_PROP_POS_FRAMES, max_players_frame_idx)
        success, max_players_frame = cap.read()
        if success and max_players_count > 0:
            logger.info(f"Fitting TeamAssigner using cache with {max_players_count} players on frame {max_players_frame_idx}.")
            team_assigner.assign_team_colors(max_players_frame, max_players_detections)
        else:
            logger.warning("Failed to load calibration frame from video. Team classifier will fallback.")
    else:
        # Read the first ~30 frames and find the frame with the most player detections to fit KMeans
        init_frame_idx = 0
        max_players_frame = None
        max_players_detections = {}
        max_players_count = 0
        
        while init_frame_idx < min(30, total_frames):
            success, frame = cap.read()
            if not success:
                break
                
            results = model.predict(source=frame, classes=[0], conf=0.40, verbose=False)
            if len(results) > 0 and results[0].boxes is not None:
                boxes = results[0].boxes
                current_players = {}
                for i in range(len(boxes)):
                    xyxy = boxes[i].xyxy[0].cpu().numpy().tolist()
                    current_players[i] = {"bbox": xyxy}
                    
                if len(current_players) > max_players_count:
                    max_players_count = len(current_players)
                    max_players_detections = current_players
                    max_players_frame = frame.copy()
                    
            init_frame_idx += 1
            
        if max_players_frame is not None and max_players_count > 0:
            logger.info(f"Fitting TeamAssigner with {max_players_count} players on initial frames.")
            team_assigner.assign_team_colors(max_players_frame, max_players_detections)
        else:
            logger.warning("No players detected in calibration pass. Team classifier will fallback.")
            
    # Reset video capture for tracking pass
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    
    # 3. Setup output video writer
    os.makedirs(os.path.dirname(output_video_path), exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v') # High compatibility MP4 writer
    writer = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))
    
    # 4. Tracking and Drawing Loop
    kalman_filters: Dict[int, KalmanFilter2D] = {}
    stat_trackers: Dict[int, PlayerStatsTracker] = {}
    frame_overlays: Dict[int, List[Dict[str, Any]]] = {}
    
    frame_idx = 0
    new_tracks_to_cache = {}
    
    while True:
        success, frame = cap.read()
        if not success:
            break
            
        annotated_frame = frame.copy()
        
        detections = []
        
        if use_cache:
            detections = cached_tracks.get(frame_idx, [])
        else:
            # Track objects: class 0 (person), class 32 (sports ball)
            tracker_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom_botsort.yaml")
            results = model.track(
                source=frame,
                persist=True,
                tracker=tracker_config_path, # Path to custom BoT-SORT settings (camera motion compensated)
                classes=[0, 32],
                conf=0.10, # Lowered to 0.10 to allow BoT-SORT's two-stage low-thresh association to resolve occlusions
                iou=0.60,
                imgsz=1280, # Temporarily lowered from 1600 for faster processing; bump back up for beast GPU runs
                verbose=False
            )
            
            if len(results) > 0 and results[0].boxes is not None:
                boxes = results[0].boxes
                for i in range(len(boxes)):
                    xyxy = boxes[i].xyxy[0].cpu().numpy().tolist()
                    cls_id = int(boxes[i].cls[0].cpu().numpy())
                    track_id = int(boxes[i].id[0].cpu().numpy()) if boxes[i].id is not None else None
                    detections.append({
                        "bbox": xyxy,
                        "cls": cls_id,
                        "id": track_id
                    })
            new_tracks_to_cache[frame_idx] = detections
            
        frame_detections = []
        ball_detections = []
        
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cls_id = det["cls"]
            track_id = det["id"]
            
            # Check for class 0 (person) and verify tracking ID is set
            if cls_id == 0 and track_id is not None:
                # Filter out only massive full-screen bounding box anomalies
                box_w = x2 - x1
                box_h = y2 - y1
                if box_w > width * 0.50 or box_h > height * 0.85:
                    continue
                    
                # 4a. Trajectory Math: Player foot position mapping
                foot_x = (x1 + x2) / 2.0
                foot_y = y2
                
                rx, ry = pixel_to_meter(foot_x, foot_y, homography_matrix)
                
                # Filter out players on neighboring fields or sidelines behind the blue advertising board fence.
                # We use a unified slanted touchline boundary equation: y = max(280.0, 0.205 * foot_x + 110.0)
                # Any player foot y2 coordinate that is smaller (higher vertically in the frame) than this
                # boundary is physically standing on the neighboring pitch or sideline and is discarded.
                y_boundary = max(280.0, 0.205 * foot_x + 110.0)
                if y2 < y_boundary:
                    continue
                
                # Smooth trajectory with Kalman filter
                if track_id not in kalman_filters:
                    kalman_filters[track_id] = KalmanFilter2D(rx, ry, dt=dt)
                    stat_trackers[track_id] = PlayerStatsTracker(track_id, dt=dt)
                    
                kf = kalman_filters[track_id]
                kf.predict()
                rx_smooth, ry_smooth = kf.update(rx, ry)
                
                # Accumulate distance and velocity metrics
                tracker = stat_trackers[track_id]
                tracker.add_position(frame_idx, rx_smooth, ry_smooth)
                
                # 4b. Team Classification
                team_id = team_assigner.get_player_team(frame, [x1, y1, x2, y2], track_id)
                team_color = team_assigner.team_colors[team_id]
                
                # 4c. Visual drawing annotations (glowing Purple and Aqua boxes)
                # Bounding Box
                cv2.rectangle(annotated_frame, (int(x1), int(y1)), (int(x2), int(y2)), team_color, 2, lineType=cv2.LINE_AA)
                
                # Player ID Header: Draw filled rectangle tag
                tag_text = f"P{track_id}"
                (tw, th), baseline = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                cv2.rectangle(
                    annotated_frame, 
                    (int(x1), int(y1) - th - 6), 
                    (int(x1) + tw + 10, int(y1)), 
                    team_color, 
                    -1
                )
                # Text inside tag
                cv2.putText(
                    annotated_frame, 
                    tag_text, 
                    (int(x1) + 5, int(y1) - 4), 
                    cv2.FONT_HERSHEY_SIMPLEX, 
                    0.5, 
                    (255, 255, 255), 
                    1, 
                    cv2.LINE_AA
                )
                
                frame_detections.append({
                    "id": track_id,
                    "team": "A" if team_id == 1 else "B",
                    "bbox": [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                    "real": [round(rx_smooth, 2), round(ry_smooth, 2)],
                    "speed": round(tracker.path[-1]["speed"], 1)
                })
                
            # Check for class 32 (sports ball)
            elif cls_id == 32:
                ball_detections.append(det["bbox"])
                
        # 4d. Highlight the ball on frame (Green glowing circle)
        for ball_box in ball_detections:
            bx1, by1, bx2, by2 = ball_box
            bcx = int((bx1 + bx2) / 2)
            bcy = int((by1 + by2) / 2)
            # Draw small circle around the ball
            cv2.circle(annotated_frame, (bcx, bcy), 8, (0, 255, 0), 2, lineType=cv2.LINE_AA)
            cv2.circle(annotated_frame, (bcx, bcy), 2, (0, 255, 0), -1, lineType=cv2.LINE_AA)
            
        # Save details for frame overlay
        frame_overlays[frame_idx] = frame_detections
        writer.write(annotated_frame)
        frame_idx += 1
        
        # Report progress
        if progress_callback and total_frames > 0:
            percentage = 0.10 + 0.90 * (frame_idx / total_frames)
            progress_callback(percentage, f"Processing match tracking: frame {frame_idx}/{total_frames} ({int((frame_idx/total_frames)*100)}%)")
            
    cap.release()
    writer.release()
    
    # Save cache if we did a fresh run
    if not use_cache and len(new_tracks_to_cache) > 0:
        try:
            with open(cache_path, "wb") as f:
                pickle.dump(new_tracks_to_cache, f)
            logger.info(f"Saved tracking cache with {len(new_tracks_to_cache)} frames to {cache_path}")
        except Exception as e:
            logger.warning(f"Failed to save tracking cache: {e}")
    
    # 5. Finalize Statistics and Export JSON
    logger.info("Finalizing player metrics summaries...")
    players_summary = []
    for tracker in stat_trackers.values():
        summary = tracker.get_summary()
        # Retrieve player team ID
        p_id = summary["id"]
        team_id = team_assigner.player_team_dict.get(p_id, 1)
        summary["team"] = "A" if team_id == 1 else "B"
        
        # Filter out short transient detections (less than 1.0 second active)
        if len(summary["path"]) >= int(fps * 1.0):
            players_summary.append(summary)
            
    # Format matches JSON
    output_data = {
        "metadata": {
            "width": width,
            "height": height,
            "fps": round(fps, 2),
            "duration": round(total_frames / fps, 2) if fps > 0 else 0,
            "totalFrames": total_frames
        },
        "players": players_summary,
        "frames": frame_overlays
    }
    
    os.makedirs(os.path.dirname(export_json_path), exist_ok=True)
    with open(export_json_path, "w") as f:
        json.dump(output_data, f, indent=2)
        
    logger.info(f"Finished pipeline. Saved player metrics JSON to {export_json_path}")
    return output_data, output_video_path
