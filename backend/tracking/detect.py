import cv2
import os
from typing import Dict, Any, Tuple, Optional
from ultralytics import YOLO

_model: Optional[YOLO] = None

def get_yolo_model(model_name: str = "yolov8n.pt") -> YOLO:
    """
    Singleton-like loader for the YOLO model.
    """
    global _model
    if _model is None:
        # Load lightweight YOLOv8 Nano model
        _model = YOLO(model_name)
    return _model

def extract_first_frame(video_path: str, output_image_path: str) -> Tuple[int, int, float, int]:
    """
    Extracts the first frame of the video and saves it as a JPEG.
    Also returns metadata: width, height, fps, and frame_count.
    
    :param video_path: Path to the input video file.
    :param output_image_path: Target path to save the JPEG first frame.
    :return: Tuple of (width, height, fps, total_frames)
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found at {video_path}")
        
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file {video_path}")
        
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    success, frame = cap.read()
    if success:
        cv2.imwrite(output_image_path, frame)
    else:
        raise ValueError("Could not read first frame of video")
        
    cap.release()
    return width, height, fps, frame_count
