import os
import json
import shutil
import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict

from calibration import CameraCalibrator
from tracker import SAM3Tracker

app = FastAPI(title="PitchTrack AI Calibration & Tracking API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

calibrator = CameraCalibrator()
tracker = SAM3Tracker()
TEMP_FRAMES_DIR = "./temp_video_frames"

# Attempt to pre-load existing calibration details if available
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SAVED_CALIB_PATH = os.path.join(CURRENT_DIR, "camera_calibration.json")

def load_default_calibration():
    if os.path.exists(SAVED_CALIB_PATH):
        try:
            with open(SAVED_CALIB_PATH, "r") as f:
                data = json.load(f)
                if "homography" in data:
                    calibrator.H = np.array(data["homography"], dtype=np.float32)
                    calibrator.H_inv = np.linalg.inv(calibrator.H).astype(np.float32)
                    print(f"Successfully loaded default homography matrix from {SAVED_CALIB_PATH}")
                # Also load points if we want to restore them on the UI
                return data
        except Exception as e:
            print(f"Could not load pre-existing camera_calibration.json: {e}")
    return None

initial_calibration_data = load_default_calibration()

class CalibrationPointsPayload(BaseModel):
    image_points: List[List[float]]
    world_points: List[List[float]]

class LensParamsPayload(BaseModel):
    fx: float
    fy: float
    cx: float
    cy: float
    k1: float
    k2: float
    p1: float
    p2: float

@app.get("/api/calibrate/saved")
def get_saved_calibration():
    """Returns pre-loaded calibration points and homography for the frontend to initialize quickly."""
    if initial_calibration_data:
        return {"status": "success", "data": initial_calibration_data}
    return {"status": "none"}

@app.post("/api/calibrate/lens")
def update_lens_parameters(params: LensParamsPayload):
    calibrator.set_lens_params(
        params.fx, params.fy, params.cx, params.cy,
        params.k1, params.k2, params.p1, params.p2
    )
    return {"status": "success", "message": "Lens intrinsic parameters updated."}

@app.post("/api/calibrate/homography")
def update_homography(payload: CalibrationPointsPayload):
    if len(payload.image_points) < 4 or len(payload.world_points) < 4:
        raise HTTPException(status_code=400, detail="Minimum of 4 point correspondences required.")
    
    success, rmse = calibrator.compute_homography(payload.image_points, payload.world_points)
    if not success:
        raise HTTPException(status_code=500, detail="Homography computation failed.")
    
    # Save the calibration locally to persist it
    try:
        calib_dict = {
            "homography": calibrator.H.tolist(),
            "points": [
                {"pixel": img, "real": wrld}
                for img, wrld in zip(payload.image_points, payload.world_points)
            ],
            "rmse": rmse,
            "calibration_frame_idx": 0
        }
        with open(SAVED_CALIB_PATH, "w") as f:
            json.dump(calib_dict, f, indent=2)
    except Exception as e:
        print(f"Failed to persist calibration: {e}")
        
    return {
        "status": "success", 
        "message": "Homography calculated successfully.",
        "rmse": rmse,
        "homography": calibrator.H.tolist()
    }

@app.post("/api/calibrate/grid")
def get_verification_grid(payload: Dict[str, List[List[List[float]]]]):
    lines = payload.get("lines", [])
    projected_lines = calibrator.get_verification_grid(lines)
    return {"status": "success", "projected_lines": projected_lines}

@app.post("/api/video/upload")
async def upload_video(file: UploadFile = File(...)):
    if os.path.exists(TEMP_FRAMES_DIR):
        shutil.rmtree(TEMP_FRAMES_DIR)
    os.makedirs(TEMP_FRAMES_DIR, exist_ok=True)
    
    video_path = f"./temp_{file.filename}"
    with open(video_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    cap = cv2.VideoCapture(video_path)
    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        # Save every frame or sample them to avoid over-indexing disk space
        frame_name = os.path.join(TEMP_FRAMES_DIR, f"{count:05d}.jpg")
        cv2.imwrite(frame_name, frame)
        count += 1
    cap.release()
    if os.path.exists(video_path):
        os.remove(video_path)
    
    tracker.start_video_session(TEMP_FRAMES_DIR)
    return {"status": "success", "total_frames": count}

@app.get("/api/video/frame/{frame_idx}")
def get_video_frame(frame_idx: int):
    frame_name = os.path.join(TEMP_FRAMES_DIR, f"{frame_idx:05d}.jpg")
    if os.path.exists(frame_name):
        return FileResponse(frame_name, media_type="image/jpeg")
    raise HTTPException(status_code=404, detail=f"Frame {frame_idx} not found")

@app.websocket("/ws/tracking")
async def websocket_tracking_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        tracker.initialize_players_concept()
        # Stream computed frame positions to client
        for frame_data in tracker.run_tracking_stream(calibrator):
            await websocket.send_json(frame_data)
    except WebSocketDisconnect:
        print("WebSocket tracking stream disconnected.")
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
