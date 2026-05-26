import os
import numpy as np
import time

try:
    import torch
    import cv2
    from sam3.model_builder import build_sam3_video_predictor
    SAM3_AVAILABLE = True
except ImportError:
    SAM3_AVAILABLE = False

class KalmanFilter2D:
    def __init__(self, dt=0.1, process_noise=0.05, measurement_noise=0.4):
        self.dt = dt
        # State: [x, y, vx, vy]^T
        self.F = np.array([
            [1.0, 0.0, dt,  0.0],
            [0.0, 1.0, 0.0, dt],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ], dtype=np.float32)
        
        # Measurement matrix H
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0]
        ], dtype=np.float32)
        
        # Process and Measurement noise
        self.Q = np.eye(4, dtype=np.float32) * process_noise
        self.R = np.eye(2, dtype=np.float32) * measurement_noise
        self.P = np.eye(4, dtype=np.float32) * 1.0
        self.s = np.zeros((4, 1), dtype=np.float32)
        self.initialized = False

    def initialize(self, x, y):
        self.s = np.array([[x], [y], [0.0], [0.0]], dtype=np.float32)
        self.P = np.eye(4, dtype=np.float32) * 1.0
        self.initialized = True

    def predict(self):
        self.s = np.dot(self.F, self.s)
        self.P = np.dot(np.dot(self.F, self.P), self.F.T) + self.Q

    def update(self, z_x, z_y):
        if not self.initialized:
            self.initialize(z_x, z_y)
            return z_x, z_y
            
        # Velocity Anomaly Rejection
        # Discard measurement if physical displacement implies speed > 12.0 m/s
        dx = z_x - self.s[0, 0]
        dy = z_y - self.s[1, 0]
        dist = np.sqrt(dx*dx + dy*dy)
        speed = dist / self.dt
        
        if speed > 12.0:
            # Reject measurement: use predicted position only
            return float(self.s[0, 0]), float(self.s[1, 0])
            
        z = np.array([[z_x], [z_y]], dtype=np.float32)
        y = z - np.dot(self.H, self.s)
        S = np.dot(np.dot(self.H, self.P), self.H.T) + self.R
        K = np.dot(np.dot(self.P, self.H.T), np.linalg.inv(S))
        
        self.s = self.s + np.dot(K, y)
        self.P = self.P - np.dot(np.dot(K, self.H), self.P)
        return float(self.s[0, 0]), float(self.s[1, 0])


class SoccerSimulation:
    def __init__(self):
        # Initial positions of 5 players in metric coords (X, Y)
        # Pitch size is 30 x 16. Center is at (15.0, 8.0)
        self.player_bases = [
            {"id": 1, "team": "A", "role": "Winger", "x": 3.0, "y": 2.0},
            {"id": 2, "team": "A", "role": "Striker", "x": 8.0, "y": 8.0},
            {"id": 3, "team": "A", "role": "Midfielder", "x": 15.0, "y": 8.0},
            {"id": 4, "team": "B", "role": "Defender", "x": 22.0, "y": 8.0},
            {"id": 5, "team": "B", "role": "Winger", "x": 27.0, "y": 14.0}
        ]
        self.t = 0.0

    def step(self, calibrator):
        """
        Calculates player trajectories, applies the inverse projection and distortion model
        to yield realistic distorted video pixel coordinates, then applies the projection and
        Kalman filters to test the entire geometry.
        """
        self.t += 0.05  # time increment
        sim_records = []
        
        for p in self.player_bases:
            # Generate continuous curved movements on the pitch
            if p["id"] == 1:
                # runs along top flank (Y=2.0)
                x = 3.0 + 10.0 * (0.5 + 0.5 * np.sin(self.t * 0.4))
                y = 2.0 + 1.0 * np.cos(self.t * 0.8)
            elif p["id"] == 2:
                # runs diagonally inside left half
                x = 6.0 + 4.0 * np.sin(self.t * 0.5)
                y = 8.0 + 3.0 * np.cos(self.t * 0.5)
            elif p["id"] == 3:
                # cycles around center spot (15, 8)
                x = 15.0 + 2.5 * np.sin(self.t * 0.6)
                y = 8.0 + 2.5 * np.cos(self.t * 0.6)
            elif p["id"] == 4:
                # defender patrols right half
                x = 22.0 + 1.0 * np.sin(self.t * 0.3)
                y = 8.0 + 4.0 * np.sin(self.t * 0.4)
            else:
                # runs along bottom flank
                x = 27.0 - 12.0 * (0.5 + 0.5 * np.cos(self.t * 0.3))
                y = 14.0 + 1.0 * np.sin(self.t * 0.7)

            # --- Apply Inverse Homography to map to undistorted pixels (u_lin, v_lin) ---
            pt = np.array([[[x, y]]], dtype=np.float32)
            pt_img = cv2.perspectiveTransform(pt, calibrator.H_inv)
            u_lin, v_lin = pt_img[0][0][0], pt_img[0][0][1]

            # --- Apply Lens Distortion Model to map to distorted pixels (u_d, v_d) ---
            fx = calibrator.K[0, 0]
            fy = calibrator.K[1, 1]
            cx = calibrator.K[0, 2]
            cy = calibrator.K[1, 2]
            
            x_lin = (u_lin - cx) / fx
            y_lin = (v_lin - cy) / fy
            r2 = x_lin*x_lin + y_lin*y_lin
            
            k1, k2, p1, p2 = calibrator.D[0], calibrator.D[1], calibrator.D[2], calibrator.D[3]
            radial = 1.0 + k1*r2 + k2*r2*r2
            
            x_d = x_lin * radial + 2.0*p1*x_lin*y_lin + p2*(r2 + 2.0*x_lin*x_lin)
            y_d = y_lin * radial + p1*(r2 + 2.0*y_lin*y_lin) + 2.0*p2*x_lin*y_lin
            
            u_dist = float(x_d * fx + cx)
            v_dist = float(y_d * fy + cy)
            
            # Add some minor synthetic pixel jitter to demonstrate Kalman filtering
            jitter_u = u_dist + np.random.normal(0, 1.2)
            jitter_v = v_dist + np.random.normal(0, 1.2)

            sim_records.append({
                "id": p["id"],
                "team": p["team"],
                "role": p["role"],
                "pixel_x": jitter_u,
                "pixel_y": jitter_v,
                "true_x": x,
                "true_y": y
            })
            
        return sim_records


class SAM3Tracker:
    def __init__(self):
        self.session_id = None
        self.frame_names = []
        self.kalman_filters = {}
        
        if SAM3_AVAILABLE:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.gpus_to_use = range(torch.cuda.device_count()) if self.device == "cuda" else []
            try:
                self.predictor = build_sam3_video_predictor(gpus_to_use=self.gpus_to_use)
            except Exception as e:
                print(f"Failed to build SAM 3.1 predictor: {e}. Falling back to simulation.")
                self.predictor = None
        else:
            self.predictor = None

    def start_video_session(self, video_frames_dir):
        if not os.path.exists(video_frames_dir):
            return "sim_session"
            
        self.frame_names = sorted([
            f for f in os.listdir(video_frames_dir)
            if f.lower().endswith(('.jpg', '.jpeg'))
        ])
        
        if self.predictor:
            response = self.predictor.handle_request(
                request=dict(
                    type="start_session",
                    resource_path=video_frames_dir,
                )
            )
            self.session_id = response["session_id"]
            return self.session_id
        return "sim_session"

    def initialize_players_concept(self, prompt="soccer player"):
        if self.predictor and self.session_id and self.session_id != "sim_session":
            response = self.predictor.handle_request(
                request=dict(
                    type="add_prompt",
                    session_id=self.session_id,
                    frame_index=0,
                    text=prompt,
                )
            )
            return response.get("outputs", {})
        return {"status": "simulator_mode"}

    def extract_feet_coordinates(self, binary_mask):
        coords = np.argwhere(binary_mask)
        if len(coords) == 0:
            return None
        # Parallax compensation: map the lowest pixel boundary median
        v_f = np.max(coords[:, 0])
        matching_columns = coords[coords[:, 0] == v_f][:, 1]
        u_f = int(np.median(matching_columns))
        return float(u_f), float(v_f)

    def run_tracking_stream(self, calibrator_instance):
        """
        Runs the stream propagation of tracking coordinates.
        Uses Kalman filtering to smooth final coordinate mappings on-the-fly.
        """
        if self.predictor and self.session_id and self.session_id != "sim_session":
            # Real SAM 3.1 Tracking Mode
            for response in self.predictor.handle_stream_request(
                request=dict(
                    type="propagate_in_video",
                    session_id=self.session_id,
                )
            ):
                frame_idx = response["frame_index"]
                outputs = response["outputs"]
                
                frame_records = []
                if "out_binary_masks" in outputs:
                    masks = outputs["out_binary_masks"]
                    tracker_ids = outputs["tracker_ids"]
                    
                    if isinstance(masks, torch.Tensor):
                        masks = masks.cpu().numpy()
                    
                    for idx, track_id in enumerate(tracker_ids):
                        mask = masks[idx] > 0.5
                        feet_pixels = self.extract_feet_coordinates(mask)
                        if feet_pixels:
                            u, v = feet_pixels
                            
                            # Standard OpenCV lens undistortion & homography projection
                            x_field_raw, y_field_raw = calibrator_instance.project_player_feet(u, v)
                            
                            # Initialize or fetch Kalman Filter
                            tid = int(track_id)
                            if tid not in self.kalman_filters:
                                self.kalman_filters[tid] = KalmanFilter2D()
                            
                            # Smooth trajectories
                            kf = self.kalman_filters[tid]
                            kf.predict()
                            x_field, y_field = kf.update(x_field_raw, y_field_raw)
                            
                            frame_records.append({
                                "id": tid,
                                "pixel_x": u,
                                "pixel_y": v,
                                "field_x": x_field,
                                "field_y": y_field
                            })
                yield {"frame_index": frame_idx, "detections": frame_records}
        else:
            # Fallback High-Fidelity Tactical Simulator Mode
            sim = SoccerSimulation()
            frame_idx = 0
            while frame_idx < 300: # Stream 300 simulated frames
                frame_records = []
                sim_data = sim.step(calibrator_instance)
                
                for item in sim_data:
                    tid = item["id"]
                    u, v = item["pixel_x"], item["pixel_y"]
                    
                    # Project and undistort simulated pixel coordinates
                    x_proj_raw, y_proj_raw = calibrator_instance.project_player_feet(u, v)
                    
                    if tid not in self.kalman_filters:
                        self.kalman_filters[tid] = KalmanFilter2D()
                    
                    kf = self.kalman_filters[tid]
                    kf.predict()
                    x_field, y_field = kf.update(x_proj_raw, y_proj_raw)
                    
                    frame_records.append({
                        "id": tid,
                        "team": item["team"],
                        "role": item["role"],
                        "pixel_x": u,
                        "pixel_y": v,
                        "field_x": x_field,
                        "field_y": y_field
                    })
                
                time.sleep(0.05)  # Simulate ~20 FPS frame latency
                yield {"frame_index": frame_idx, "detections": frame_records}
                frame_idx += 1
