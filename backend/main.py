from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
import shutil
import cv2
import numpy as np
import json
from typing import List, Dict, Any, Optional
from loguru import logger

from tracking.pipeline import run_tracking_pipeline

app = FastAPI(title="PitchTrack AI Backend API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
EXPORT_DIR = os.path.join(BASE_DIR, "exports")

os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(EXPORT_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Global processing state (automatically restored from disk if existing)
_init_video = os.path.join(UPLOAD_DIR, "uploaded_match.mp4")
_video_exists = os.path.exists(_init_video)
_results_ready = os.path.exists(os.path.join(EXPORT_DIR, "match.json"))

processing_status = {
    "status": "completed" if _results_ready else ("idle" if _video_exists else "idle"),
    "progress": 1.0 if _results_ready else 0.0,
    "message": "Tracking results loaded from previous run." if _results_ready else ("Match video uploaded." if _video_exists else "Ready"),
    "error": None,
    "video_path": _init_video if _video_exists else None,
    "results_ready": _results_ready
}


DEFAULT_HOMOGRAPHY = np.array([
    [-0.10359927204181629, -0.4322571627908756,  100.96038284708395],
    [ 0.030487578806259366, -0.23964388583428395, 25.341280359311828],
    [-0.0019478183087309972, -0.013376008639803063, 1.0]
], dtype=np.float32)

class CalibrationPoint(BaseModel):
    pixel: List[float] # [x, y]
    real: List[float]  # [rx, ry]

class CalibrationRequest(BaseModel):
    points: List[CalibrationPoint]

def extract_first_frame(video_path: str, output_image_path: str) -> tuple:
    """
    Extracts the first frame of the video and returns its specs: width, height, fps, total_frames.
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

@app.get("/")
def read_root():
    return {"status": "running", "name": "PitchTrack AI Backend"}

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "PitchTrack AI backend is fully active"}

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    Uploads a match video and extracts details for calibration and tracking.
    """
    logger.info(f"Received video upload request: {file.filename}")
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
        raise HTTPException(status_code=400, detail="Invalid format. Please upload MP4, AVI, MOV, or MKV.")
        
    video_path = os.path.join(UPLOAD_DIR, "uploaded_match.mp4")
    
    # Save the file
    try:
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to write uploaded video file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save video: {e}")
        
    # Extract first frame thumbnail
    first_frame_path = os.path.join(STATIC_DIR, "first_frame.jpg")
    try:
        w, h, fps, count = extract_first_frame(video_path, first_frame_path)
    except Exception as e:
        logger.error(f"Failed to extract video thumbnail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse video specs: {e}")
        
    # Clear previous tracking cache for the new video
    cache_file = os.path.join(EXPORT_DIR, "tracking_cache.pkl")
    if os.path.exists(cache_file):
        try:
            os.remove(cache_file)
            logger.info("Cleared previous tracking cache for the new video upload.")
        except Exception as e:
            logger.warning(f"Failed to remove previous tracking cache: {e}")
            
    global processing_status
    processing_status = {
        "status": "idle",
        "progress": 0.0,
        "message": "Match video uploaded.",
        "error": None,
        "video_path": video_path,
        "results_ready": False
    }
    
    return {
        "filename": file.filename,
        "width": w,
        "height": h,
        "fps": round(fps, 2),
        "totalFrames": count,
        "duration": round(count / fps, 2) if fps > 0 else 0.0,
        "firstFrameUrl": "/static/first_frame.jpg"
    }

def background_tracking_task(video_path: str, H: np.ndarray):
    """
    Spawns the computer vision pipeline inside a background worker thread.
    """
    global processing_status
    processing_status["status"] = "processing"
    processing_status["progress"] = 0.0
    processing_status["message"] = "Initializing tracking pipeline..."
    processing_status["error"] = None
    
    def on_progress(p: float, msg: str):
        processing_status["progress"] = round(p, 3)
        processing_status["message"] = msg
        
    output_video_path = os.path.join(STATIC_DIR, "output_video.mp4")
    export_json_path = os.path.join(EXPORT_DIR, "match.json")
    
    try:
        run_tracking_pipeline(
            video_path=video_path,
            output_video_path=output_video_path,
            export_json_path=export_json_path,
            homography_matrix=H,
            progress_callback=on_progress
        )
        processing_status["status"] = "completed"
        processing_status["progress"] = 1.0
        processing_status["message"] = "Tracking process completed successfully!"
        processing_status["results_ready"] = True
    except Exception as e:
        logger.exception("Tracking pipeline execution encountered an error")
        processing_status["status"] = "failed"
        processing_status["message"] = "Tracking pipeline execution failed."
        processing_status["error"] = str(e)

@app.post("/api/process")
def start_processing(background_tasks: BackgroundTasks):
    """
    Triggers player tracking and team division in a background thread.
    """
    global processing_status
    video_path = processing_status.get("video_path")
    
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=400, detail="No video file uploaded. Please upload a match video first.")
        
    # Read custom calibration if exists, else use hardcoded fallback
    calibration_file = os.path.join(BASE_DIR, "camera_calibration.json")
    H = DEFAULT_HOMOGRAPHY
    
    if os.path.exists(calibration_file):
        try:
            with open(calibration_file, "r") as f:
                calib = json.load(f)
                H = np.array(calib["homography"], dtype=np.float32)
                logger.info("Loaded custom camera homography matrix.")
        except Exception as e:
            logger.warning(f"Failed to read custom camera calibration, falling back to default: {e}")
            
    background_tasks.add_task(background_tracking_task, video_path, H)
    return {"status": "started", "message": "Tracking pipeline successfully dispatched."}

@app.get("/api/status")
def get_status():
    """
    Returns the real-time processing status of the tracking pipeline.
    """
    return {
        "status": processing_status["status"],
        "progress": processing_status["progress"],
        "message": processing_status["message"],
        "error": processing_status["error"],
        "resultsReady": processing_status["results_ready"]
    }

@app.get("/api/results")
def get_results():
    """
    Retrieves the final coordinate tracking metrics JSON.
    """
    match_json = os.path.join(EXPORT_DIR, "match.json")
    if not os.path.exists(match_json):
        raise HTTPException(status_code=404, detail="Metrics results not found. Please run the tracking pipeline first.")
        
    try:
        with open(match_json, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read exported match JSON: {e}")
        raise HTTPException(status_code=500, detail="Failed to read metrics results data.")
