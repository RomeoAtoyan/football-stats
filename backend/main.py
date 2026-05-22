import os
import json
import shutil
from typing import List, Dict, Tuple, Any
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger
import numpy as np

# Absolute pathing for robustness
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")
EXPORT_DIR = os.path.join(BASE_DIR, "exports")

# Ensure directories exist
for folder in [UPLOAD_DIR, STATIC_DIR, EXPORT_DIR]:
    os.makedirs(folder, exist_ok=True)

from tracking.detect import extract_first_frame
from tracking.homography import compute_homography, draw_grid_overlay
from tracking.track import run_tracking_pipeline

app = FastAPI(title="PitchTrack AI Backend API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local MVP development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files for frames and overlays
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Global tracking process state (for status checking)
processing_status = {
    "status": "idle",       # idle, processing, completed, failed
    "progress": 0.0,        # 0.0 to 1.0
    "error": None,
    "video_path": None,
    "calibration_path": None,
    "results_ready": False
}

# Homography caching
calibration_file = os.path.join(BASE_DIR, "camera_calibration.json")

class CalibrationPoint(BaseModel):
    pixel: List[float] # [x, y]
    real: List[float]  # [rx, ry]

class CalibrationRequest(BaseModel):
    points: List[CalibrationPoint]

@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "PitchTrack AI is up and running"}

@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """
    Uploads a video, saves it locally, extracts the metadata and the first frame.
    """
    logger.info(f"Received video upload: {file.filename}")
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
        raise HTTPException(status_code=400, detail="Unsupported video format. Please upload MP4, AVI, MOV, or MKV.")
        
    video_path = os.path.join(UPLOAD_DIR, "uploaded_match.mp4")
    
    # Save video file
    try:
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"Failed to save uploaded video: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save video: {str(e)}")
        
    # Extract first frame
    first_frame_path = os.path.join(STATIC_DIR, "first_frame.jpg")
    try:
        width, height, fps, total_frames = extract_first_frame(video_path, first_frame_path)
    except Exception as e:
        logger.error(f"Failed to extract first frame: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to analyze video frame: {str(e)}")
        
    duration = total_frames / fps if fps > 0 else 0.0
    
    # Reset tracking status for the new video
    global processing_status
    processing_status = {
        "status": "idle",
        "progress": 0.0,
        "error": None,
        "video_path": video_path,
        "calibration_path": None,
        "results_ready": False
    }
    
    return {
        "filename": file.filename,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "totalFrames": total_frames,
        "duration": round(duration, 2),
        "firstFrameUrl": "/static/first_frame.jpg"
    }

@app.post("/api/calibrate")
def calibrate_camera(request: CalibrationRequest):
    """
    Takes calibration points, computes the homography, saves calibration JSON,
    and draws the projected pitch grid overlay on the first frame.
    """
    logger.info(f"Received calibration request with {len(request.points)} points.")
    
    if len(request.points) < 4:
        raise HTTPException(status_code=400, detail="At least 4 calibration points are required.")
        
    pixel_pts = [tuple(pt.pixel) for pt in request.points]
    real_pts = [tuple(pt.real) for pt in request.points]
    
    # Compute homography
    H = compute_homography(pixel_pts, real_pts)
    if H is None:
        raise HTTPException(status_code=400, detail="Homography matrix computation failed. Please ensure points are distinct and accurate.")
        
    # Save homography matrix locally
    calib_data = {
        "homography": H.tolist(),
        "points": [{"pixel": pt.pixel, "real": pt.real} for pt in request.points]
    }
    
    with open(calibration_file, "w") as f:
        json.dump(calib_data, f, indent=2)
        
    # Draw visual grid overlay
    first_frame_path = os.path.join(STATIC_DIR, "first_frame.jpg")
    overlay_path = os.path.join(STATIC_DIR, "grid_overlay.jpg")
    
    if not os.path.exists(first_frame_path):
        raise HTTPException(status_code=400, detail="Please upload a video before calibrating.")
        
    try:
        frame = cv2.imread(first_frame_path)
        overlay_frame = draw_grid_overlay(frame, H)
        cv2.imwrite(overlay_path, overlay_frame)
    except Exception as e:
        logger.error(f"Failed to generate grid overlay: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Grid rendering failed: {str(e)}")
        
    return {
        "status": "success",
        "homography": H.tolist(),
        "gridOverlayUrl": "/static/grid_overlay.jpg"
    }

def background_tracking_task(video_path: str, H: np.ndarray):
    """
    Background worker that runs the computer vision tracking pipeline and updates process state.
    """
    global processing_status
    processing_status["status"] = "processing"
    processing_status["progress"] = 0.0
    processing_status["error"] = None
    
    def on_progress(p: float):
        processing_status["progress"] = round(p, 3)

    try:
        run_tracking_pipeline(video_path, H, progress_callback=on_progress)
        processing_status["status"] = "completed"
        processing_status["progress"] = 1.0
        processing_status["results_ready"] = True
    except Exception as e:
        logger.exception("Tracking pipeline execution failed")
        processing_status["status"] = "failed"
        processing_status["error"] = str(e)

@app.post("/api/process")
def start_processing(background_tasks: BackgroundTasks):
    """
    Triggers the video tracking pipeline in a background thread.
    """
    global processing_status
    
    video_path = processing_status.get("video_path")
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=400, detail="No video file uploaded yet. Please upload a video first.")
        
    if not os.path.exists(calibration_file):
        raise HTTPException(status_code=400, detail="No calibration data found. Please calibrate the camera first.")
        
    try:
        with open(calibration_file, "r") as f:
            calib_data = json.load(f)
            H = np.array(calib_data["homography"], dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read calibration data: {str(e)}")
        
    # Dispatch tracking task to run in the background
    background_tasks.add_task(background_tracking_task, video_path, H)
    
    return {"status": "started", "message": "Tracking pipeline successfully dispatched."}

@app.get("/api/status")
def get_status():
    """
    Returns the current state of the backend tracking process.
    """
    return {
        "status": processing_status["status"],
        "progress": processing_status["progress"],
        "error": processing_status["error"],
        "resultsReady": processing_status["results_ready"]
    }

@app.get("/api/results")
def get_results():
    """
    Loads and returns the generated match tracking analysis dataset.
    """
    match_json = os.path.join(EXPORT_DIR, "match.json")
    if not os.path.exists(match_json):
        raise HTTPException(status_code=404, detail="No tracking results found. Please run the tracking pipeline first.")
        
    try:
        with open(match_json, "r") as f:
            results_data = json.load(f)
        return results_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read tracking results: {str(e)}")

@app.get("/api/export")
def export_results():
    """
    Returns the absolute export path of the match.json for downloading or direct filesystem utilization.
    """
    match_json = os.path.join(EXPORT_DIR, "match.json")
    if not os.path.exists(match_json):
        raise HTTPException(status_code=404, detail="No exported results available.")
    return {"exportPath": match_json}
