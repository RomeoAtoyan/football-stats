import sys
import os
import json
import numpy as np

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from calibration import CameraCalibrator

def run_verification():
    print("=== STARTING PITCHTRACK AI MATHEMATICAL VERIFICATION ===")
    
    calibrator = CameraCalibrator()
    
    # Load the points from the JSON calibration file
    calib_json_path = os.path.join(os.path.dirname(__file__), "camera_calibration.json")
    if not os.path.exists(calib_json_path):
        print(f"Error: {calib_json_path} does not exist.")
        return
        
    with open(calib_json_path, "r") as f:
        data = json.load(f)
        
    points = data.get("points", [])
    if not points:
        print("Error: No calibration points found.")
        return
        
    image_points = [p["pixel"] for p in points]
    world_points = [p["real"] for p in points]
    
    print(f"Loaded {len(image_points)} coordinate pairs from camera_calibration.json")
    
    # Compute homography
    success, rmse = calibrator.compute_homography(image_points, world_points)
    print(f"Calibration homography calculated: {success}")
    print(f"Reprojection Root Mean Square Error (RMSE): {rmse:.4f} meters")
    
    if success:
        if rmse < 0.5:
            print("Status: ✅ HIGH-PRECISION ALIGNMENT (RMSE < 0.5m)")
        elif rmse < 1.5:
            print("Status: ⚠️ MEDIUM-PRECISION ALIGNMENT (RMSE < 1.5m)")
        else:
            print("Status: ❌ CRITICAL CALIBRATION WARNING (RMSE >= 1.5m)")
            
        print("\n--- Projecting Sample Pixel Feet Coordinates ---")
        for i, (img_pt, wrld_pt) in enumerate(zip(image_points[:3], world_points[:3])):
            px, py = calibrator.project_player_feet(img_pt[0], img_pt[1])
            print(f"Point #{i+1}: Pixel [{img_pt[0]:.2f}, {img_pt[1]:.2f}] -> Projected Real [{px:.2f}m, {py:.2f}m] (Target: [{wrld_pt[0]}m, {wrld_pt[1]}m])")
            
        print("\n=== MATHEMATICAL VERIFICATION COMPLETED SUCCESSFULLY ===")
    else:
        print("Error: Math Solver failed to compute homography.")

if __name__ == "__main__":
    run_verification()
