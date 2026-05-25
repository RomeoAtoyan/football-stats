import cv2
import numpy as np
import os
import json
import pickle
from typing import Callable, Tuple, Dict, Any, List
from collections import defaultdict
from loguru import logger
from ultralytics import YOLO

from tracking.homography import pixel_to_meter
from tracking.smoothing import KalmanFilter2D
from tracking.distance import PlayerStatsTracker
from tracking.team_assigner import TeamAssigner
from tracking.track_merger import stitch_fragments

# Bump this whenever the detector/tracker config materially changes, so stale
# pickle caches written by an older version are auto-invalidated instead of
# silently producing inconsistent IDs.
TRACKING_CACHE_VERSION = 6


TRACKER_IMGSZ = 1280


def _extract_player_appearance(frame: np.ndarray, bbox: List[float]) -> np.ndarray | None:
    """
    Compact color signature for offline tracklet stitching.

    This is deliberately cheap: no extra model, just HSV histograms over the player crop.
    It gives the stitcher another signal when BoT-SORT assigns a new raw ID to the same
    person after a short occlusion or camera pan.
    """
    x1, y1, x2, y2 = map(int, bbox)
    h_img, w_img = frame.shape[:2]
    x1 = max(0, min(w_img - 1, x1))
    x2 = max(0, min(w_img, x2))
    y1 = max(0, min(h_img - 1, y1))
    y2 = max(0, min(h_img, y2))

    if x2 <= x1 or y2 <= y1:
        return None

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0 or crop.shape[0] < 16 or crop.shape[1] < 8:
        return None

    # Focus on central body pixels to reduce turf/background in wide boxes.
    ch, cw = crop.shape[:2]
    body = crop[: max(1, int(ch * 0.75)), int(cw * 0.15) : max(int(cw * 0.85), int(cw * 0.15) + 1)]
    if body.size == 0:
        return None

    hsv = cv2.cvtColor(body, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 4], [0, 180, 0, 256, 0, 256])
    feature = hist.flatten().astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm <= 1e-6:
        return None
    return feature / norm

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
    3. Runs YOLOv8 + BoT-SORT(+ReID) tracking (if cache missed) or loads tracks from cache.
    4. Filters player foot coordinates with Kalman filters and projects to meters.
    5. Accumulates running speeds and total covered distance.
    6. Runs an offline tracklet stitcher to consolidate fragmented IDs into stable player IDs.
    7. Re-draws the annotated video using the consolidated IDs.
    8. Writes the final analytics JSON.
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
    tracker_imgsz = TRACKER_IMGSZ
    
    logger.info(
        f"Loaded input video: {width}x{height} @ {fps}fps, {total_frames} frames. "
        f"Tracker inference size: {tracker_imgsz}px."
    )
    
    # 0. Check for tracking cache (version-gated)
    cache_path = os.path.join(os.path.dirname(export_json_path), "tracking_cache.pkl")
    use_cache = False
    cached_tracks: Dict[int, List[Dict[str, Any]]] = {}
    
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as f:
                cache_blob = pickle.load(f)
            if isinstance(cache_blob, dict) and cache_blob.get("version") == TRACKING_CACHE_VERSION:
                cached_tracks = cache_blob["tracks"]
                use_cache = True
                logger.info(f"Using cached tracking data with {len(cached_tracks)} frames from {cache_path} (v{TRACKING_CACHE_VERSION})")
            else:
                logger.info(f"Tracking cache is stale (got version {cache_blob.get('version') if isinstance(cache_blob, dict) else 'legacy'}, expected v{TRACKING_CACHE_VERSION}). Re-running tracker.")
        except Exception as e:
            logger.warning(f"Failed to load tracking cache: {e}. Running fresh tracking.")
            
    model = None
    if not use_cache:
        # 1. Load YOLOv8 model
        logger.info("Initializing YOLOv8 person tracking...")
        if progress_callback:
            progress_callback(0.02, "Loading computer vision tracking models...")
            
        model_name = "yolov8m.pt" # YOLOv8m (Medium) — solid balance of accuracy/speed for sports detection
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        model_path = os.path.join(base_dir, model_name)
        if not os.path.exists(model_path):
            model_path = model_name # Let YOLO auto-download if not there
            
        model = YOLO(model_path)
        
    # 2. Team Color Classifier learning pass (rule-based fluo vest detector)
    logger.info("Running initial calibration pass for team division...")
    if progress_callback:
        progress_callback(0.05, "Analyzing player jersey colors...")
        
    team_assigner = TeamAssigner()
    
    if use_cache:
        # Fine-tune team classifier using pre-extracted cached bounding boxes
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
        # Read the first ~30 frames and find the frame with the most player detections to fit the classifier
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
    
    # 4. Tracking + per-frame stats accumulation pass (DOES NOT WRITE THE VIDEO YET)
    # We need to first collect all raw tracks, run the offline tracklet stitcher to
    # consolidate fragmented IDs, then rewind and re-render the video using the
    # consolidated IDs so the on-screen tags match the JSON.
    kalman_filters: Dict[int, KalmanFilter2D] = {}
    stat_trackers: Dict[int, PlayerStatsTracker] = {}
    raw_frame_detections: Dict[int, List[Dict[str, Any]]] = {}
    raw_ball_detections: Dict[int, List[List[float]]] = {}
    track_appearance_samples: Dict[int, List[np.ndarray]] = defaultdict(list)
    
    frame_idx = 0
    new_tracks_to_cache: Dict[int, List[Dict[str, Any]]] = {}
    
    while True:
        success, frame = cap.read()
        if not success:
            break
            
        detections: List[Dict[str, Any]] = []
        
        if use_cache:
            detections = cached_tracks.get(frame_idx, [])
        else:
            tracker_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom_botsort.yaml")
            results = model.track(
                source=frame,
                persist=True,
                tracker=tracker_config_path, # BoT-SORT + ReID + sparse-optical-flow GMC
                classes=[0, 32],
                conf=0.20, # Keep weaker player detections alive; tracker config controls new ID creation.
                iou=0.60,
                imgsz=tracker_imgsz,
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
            
        frame_player_detections: List[Dict[str, Any]] = []
        frame_ball_detections: List[List[float]] = []
        
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cls_id = det["cls"]
            track_id = det["id"]
            
            if cls_id == 0 and track_id is not None:
                # ---- Bounding-box sanity filters (kill ghost detections that fragment IDs) ----
                box_w = x2 - x1
                box_h = y2 - y1
                if box_w <= 0 or box_h <= 0:
                    continue
                # 1) Reject impossibly huge full-screen anomalies
                if box_w > width * 0.50 or box_h > height * 0.85:
                    continue
                # 2) Reject tiny dot detections (almost always background noise far from cam)
                if box_w < 8 or box_h < 20:
                    continue
                # 3) Reject horizontal-leaning boxes — a standing/running player is always taller than wide.
                #    aspect_ratio (h/w) below 1.1 is almost certainly half a player or a non-person.
                if (box_h / box_w) < 1.1:
                    continue
                
                # 4a. Trajectory math: foot position -> pitch meters
                foot_x = (x1 + x2) / 2.0
                foot_y = y2
                
                rx, ry = pixel_to_meter(foot_x, foot_y, homography_matrix)
                
                # Filter out players on neighboring fields or sidelines (slanted touchline boundary)
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
                
                tracker = stat_trackers[track_id]
                tracker.add_position(frame_idx, rx_smooth, ry_smooth)
                
                # 4b. Team Classification (per raw track ID — gets re-aggregated after stitching)
                team_id = team_assigner.get_player_team(frame, [x1, y1, x2, y2], track_id)
                appearance = _extract_player_appearance(frame, [x1, y1, x2, y2])
                if appearance is not None and len(track_appearance_samples[track_id]) < 48:
                    track_appearance_samples[track_id].append(appearance)
                
                frame_player_detections.append({
                    "raw_id": track_id,
                    "team": team_id,
                    "bbox": [x1, y1, x2, y2],
                    "real": (rx_smooth, ry_smooth),
                    "speed": tracker.path[-1]["speed"]
                })
                
            elif cls_id == 32:
                frame_ball_detections.append(det["bbox"])
                
        raw_frame_detections[frame_idx] = frame_player_detections
        raw_ball_detections[frame_idx] = frame_ball_detections
        frame_idx += 1
        
        if progress_callback and total_frames > 0:
            # First pass takes ~60% of the work — render pass takes the next ~30%
            percentage = 0.10 + 0.60 * (frame_idx / total_frames)
            progress_callback(percentage, f"Tracking pass: frame {frame_idx}/{total_frames} ({int((frame_idx/total_frames)*100)}%)")
            
    cap.release()
    
    # Save cache if we did a fresh run (versioned envelope so stale caches auto-expire)
    if not use_cache and len(new_tracks_to_cache) > 0:
        try:
            with open(cache_path, "wb") as f:
                pickle.dump({"version": TRACKING_CACHE_VERSION, "tracks": new_tracks_to_cache}, f)
            logger.info(f"Saved tracking cache (v{TRACKING_CACHE_VERSION}) with {len(new_tracks_to_cache)} frames to {cache_path}")
        except Exception as e:
            logger.warning(f"Failed to save tracking cache: {e}")
    
    # 5. ===== OFFLINE TRACKLET STITCHING =====
    # The single most impactful fix for "5 players turned into 36 IDs": consolidate
    # fragmented tracks back into the smallest set of consistent canonical players.
    if progress_callback:
        progress_callback(0.71, "Stitching fragmented player IDs into stable identities...")
    raw_id_to_canonical, canonical_to_team = stitch_fragments(
        stat_trackers=stat_trackers,
        team_dict=team_assigner.player_team_dict,
        appearance_samples=track_appearance_samples,
        fps=fps,
    )
    
    # Build canonical stat trackers by merging raw stat trackers belonging to the same canonical ID
    canonical_to_raw_ids: Dict[int, List[int]] = defaultdict(list)
    for raw_id, canonical in raw_id_to_canonical.items():
        canonical_to_raw_ids[canonical].append(raw_id)
        
    canonical_stat_trackers: Dict[int, PlayerStatsTracker] = {}
    for canonical, raw_ids in canonical_to_raw_ids.items():
        merged = PlayerStatsTracker(canonical, dt=dt)
        # Concatenate paths in chronological order across all fragments in the cluster
        combined_path: List[Tuple[int, float, float]] = []
        for raw_id in raw_ids:
            for sample in stat_trackers[raw_id].path:
                combined_path.append((sample["frame"], sample["x"], sample["y"]))
        combined_path.sort(key=lambda t: t[0])
        for f, x, y in combined_path:
            merged.add_position(f, x, y)
        canonical_stat_trackers[canonical] = merged
    
    # 6. ===== ANNOTATION RENDER PASS (using canonical IDs so on-screen tags match JSON) =====
    if progress_callback:
        progress_callback(0.72, "Rendering annotated match video with stable player IDs...")
        
    os.makedirs(os.path.dirname(output_video_path), exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))
    
    cap = cv2.VideoCapture(video_path)
    frame_overlays: Dict[int, List[Dict[str, Any]]] = {}
    
    render_frame_idx = 0
    while True:
        success, frame = cap.read()
        if not success:
            break
            
        annotated_frame = frame.copy()
        frame_record: List[Dict[str, Any]] = []
        
        for player in raw_frame_detections.get(render_frame_idx, []):
            raw_id = player["raw_id"]
            canonical_id = raw_id_to_canonical.get(raw_id)
            if canonical_id is None:
                continue  # Filtered out by the stitcher as noise
            
            x1, y1, x2, y2 = player["bbox"]
            team_id = canonical_to_team.get(canonical_id, player["team"])
            team_color = team_assigner.team_colors[team_id]
            rx_smooth, ry_smooth = player["real"]
            speed = player["speed"]
            
            cv2.rectangle(annotated_frame, (int(x1), int(y1)), (int(x2), int(y2)),
                          team_color, 2, lineType=cv2.LINE_AA)
            
            tag_text = f"P{canonical_id}"
            (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(
                annotated_frame,
                (int(x1), int(y1) - th - 6),
                (int(x1) + tw + 10, int(y1)),
                team_color,
                -1
            )
            cv2.putText(
                annotated_frame, tag_text,
                (int(x1) + 5, int(y1) - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA
            )
            
            frame_record.append({
                "id": canonical_id,
                "team": "A" if team_id == 1 else "B",
                "bbox": [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                "real": [round(rx_smooth, 2), round(ry_smooth, 2)],
                "speed": round(speed, 1)
            })
        
        # Draw the ball
        for ball_box in raw_ball_detections.get(render_frame_idx, []):
            bx1, by1, bx2, by2 = ball_box
            bcx = int((bx1 + bx2) / 2)
            bcy = int((by1 + by2) / 2)
            cv2.circle(annotated_frame, (bcx, bcy), 8, (0, 255, 0), 2, lineType=cv2.LINE_AA)
            cv2.circle(annotated_frame, (bcx, bcy), 2, (0, 255, 0), -1, lineType=cv2.LINE_AA)
        
        frame_overlays[render_frame_idx] = frame_record
        writer.write(annotated_frame)
        render_frame_idx += 1
        
        if progress_callback and total_frames > 0:
            percentage = 0.72 + 0.28 * (render_frame_idx / total_frames)
            progress_callback(percentage, f"Rendering: frame {render_frame_idx}/{total_frames}")
            
    cap.release()
    writer.release()
    
    # 7. Finalize Statistics and Export JSON
    logger.info("Finalizing player metrics summaries...")
    players_summary = []
    for canonical_id, tracker in canonical_stat_trackers.items():
        summary = tracker.get_summary()
        team_id = canonical_to_team.get(canonical_id, 2)
        summary["team"] = "A" if team_id == 1 else "B"
        # Filter out short transient detections (less than 1.0 second active total)
        if len(summary["path"]) >= int(fps * 1.0):
            players_summary.append(summary)
            
    # Sort players: by team, then by canonical ID
    players_summary.sort(key=lambda p: (p["team"], p["id"]))
    
    team_a_final = sum(1 for p in players_summary if p["team"] == "A")
    team_b_final = sum(1 for p in players_summary if p["team"] == "B")
    logger.info(f"FINAL stable player count: Team A={team_a_final}, Team B={team_b_final} "
                f"(target 5v5 = 10 total).")
    
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
