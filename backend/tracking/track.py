import cv2
import numpy as np
import os
import json
from typing import Dict, List, Tuple, Any, Callable
from loguru import logger

from tracking.detect import get_yolo_model
from tracking.homography import pixel_to_meter
from tracking.smoothing import KalmanFilter2D
from tracking.distance import PlayerStatsTracker

def run_tracking_pipeline(
    video_path: str,
    homography_matrix: np.ndarray,
    progress_callback: Callable[[float], None] = None
) -> Tuple[Dict[str, Any], str]:
    """
    Runs the full computer vision tracking pipeline on a video file.
    
    1. Reads video frames.
    2. Runs YOLOv8 person tracking using ByteTrack.
    3. Transforms player foot position (bottom-center of bbox) to real-world meters.
    4. Filters and smooths trajectories using Kalman Filter.
    5. Computes total distance and speeds.
    6. Returns complete analytics data and path to exported JSON.
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
    
    logger.info(f"Starting tracking pipeline: {width}x{height} @ {fps}fps, {total_frames} frames.")
    
    # Initialize YOLOv8 Model
    model = get_yolo_model()
    
    # State tracking: mapping of tracker_id to Kalman Filter
    kalman_filters: Dict[int, KalmanFilter2D] = {}
    # State tracking: mapping of tracker_id to PlayerStatsTracker
    stat_trackers: Dict[int, PlayerStatsTracker] = {}
    
    # Frame-by-frame overlays mapping
    frame_overlays: Dict[int, List[Dict[str, Any]]] = {}
    
    frame_idx = 0
    while True:
        success, frame = cap.read()
        if not success:
            break
            
        # Run tracking using ByteTrack
        # We specify persist=True to keep tracks across frames, classes=[0] to track persons only
        results = model.track(
            source=frame,
            tracker="bytetrack.yaml",
            persist=True,
            classes=[0],
            verbose=False
        )
        
        frame_detections = []
        
        # Check if we have tracking boxes in the results
        if len(results) > 0 and results[0].boxes is not None:
            boxes = results[0].boxes
            for i in range(len(boxes)):
                # Bounding box xyxy format
                xyxy = boxes[i].xyxy[0].cpu().numpy().tolist()
                x1, y1, x2, y2 = xyxy
                
                # Check if we have tracking ID
                if boxes[i].id is not None:
                    track_id = int(boxes[i].id[0].cpu().numpy())
                    confidence = float(boxes[i].conf[0].cpu().numpy())
                    
                    # Calculate ground point (bottom center of bounding box)
                    foot_x = (x1 + x2) / 2.0
                    foot_y = y2
                    
                    # Convert to meters using Homography
                    rx, ry = pixel_to_meter(foot_x, foot_y, homography_matrix)
                    
                    # Apply Kalman Filter smoothing
                    if track_id not in kalman_filters:
                        kalman_filters[track_id] = KalmanFilter2D(rx, ry, dt=dt)
                        stat_trackers[track_id] = PlayerStatsTracker(track_id, dt=dt)
                        
                    kf = kalman_filters[track_id]
                    kf.predict()
                    rx_smooth, ry_smooth = kf.update(rx, ry)
                    
                    # Accumulate distance and speed
                    tracker = stat_trackers[track_id]
                    tracker.add_position(frame_idx, rx_smooth, ry_smooth)
                    
                    # Fetch current speed
                    current_speed = tracker.path[-1]["speed"]
                    
                    # Save details for frame overlay
                    frame_detections.append({
                        "id": track_id,
                        "bbox": [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],  # [x, y, w, h] format for canvas/SVG overlay
                        "real": [round(rx_smooth, 2), round(ry_smooth, 2)],
                        "speed": current_speed
                    })
        
        frame_overlays[frame_idx] = frame_detections
        frame_idx += 1
        
        # Call progress callback if set
        if progress_callback and total_frames > 0:
            progress_callback(frame_idx / total_frames)
            
    cap.release()
    
    # Finalize statistics per player
    players_summary = [tracker.get_summary() for tracker in stat_trackers.values()]
    
    # Filter out empty paths or players tracked for less than 1 second to clean up short transient detections
    min_active_frames = int(fps * 1.0)
    players_summary = [p for p in players_summary if len(p["path"]) >= min_active_frames]
    
    # Create output directories
    export_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "exports")
    os.makedirs(export_dir, exist_ok=True)
    
    # Format and save JSON
    output_data = {
        "metadata": {
            "width": width,
            "height": height,
            "fps": fps,
            "duration": round(total_frames / fps, 2) if fps > 0 else 0,
            "totalFrames": total_frames
        },
        "players": players_summary,
        "frames": frame_overlays
    }
    
    export_path = os.path.join(export_dir, "match.json")
    with open(export_path, "w") as f:
        json.dump(output_data, f, indent=2)
        
    logger.info(f"Successfully finished tracking. Exported {len(players_summary)} players to {export_path}")
    return output_data, export_path
