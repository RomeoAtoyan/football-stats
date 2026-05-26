import cv2
import numpy as np

class CameraCalibrator:
    def __init__(self, width=1920, height=1080):
        self.width = width
        self.height = height
        # Camera intrinsic matrix K
        self.K = np.array([
            [1500.0, 0.0, width / 2.0],
            [0.0, 1500.0, height / 2.0],
            [0.0, 0.0, 1.0]
        ], dtype=np.float32)
        # Radial & Tangential lens distortion coefficients [k1, k2, p1, p2, k3]
        self.D = np.array([-0.1, 0.01, 0.0, 0.0, 0.0], dtype=np.float32)
        self.H = np.eye(3, dtype=np.float32)
        self.H_inv = np.eye(3, dtype=np.float32)
        self.last_rmse = 0.0

    def set_lens_params(self, fx, fy, cx, cy, k1, k2, p1, p2):
        self.K[0, 0] = fx
        self.K[1, 1] = fy
        self.K[0, 2] = cx
        self.K[1, 2] = cy
        self.D = np.array([k1, k2, p1, p2, 0.0], dtype=np.float32)

    def compute_homography(self, image_points, world_points):
        """
        Computes planar homography from image coordinates to real-world metric coordinates.
        Before solving, the points are undistorted according to the lens model.
        Returns:
            bool: success status
            float: Reprojection RMSE in meters
        """
        if len(image_points) < 4 or len(world_points) < 4:
            return False, 0.0

        src_pts = np.array(image_points, dtype=np.float32).reshape(-1, 1, 2)
        dst_pts = np.array(world_points, dtype=np.float32).reshape(-1, 1, 2)
        
        # Undistort point features before homography calculation
        undistorted = cv2.undistortPoints(src_pts, self.K, self.D, P=self.K)
        
        H, mask = cv2.findHomography(undistorted, dst_pts, cv2.RANSAC, 5.0)
        if H is not None:
            self.H = H.astype(np.float32)
            self.H_inv = np.linalg.inv(self.H).astype(np.float32)
            
            # Compute reprojection RMSE
            projected = cv2.perspectiveTransform(undistorted, self.H)
            sq_diffs = np.sum((projected.squeeze(1) - dst_pts.squeeze(1)) ** 2, axis=1)
            self.last_rmse = float(np.sqrt(np.mean(sq_diffs)))
            return True, self.last_rmse
        return False, 0.0

    def project_player_feet(self, u, v):
        pt = np.array([[[u, v]]], dtype=np.float32)
        undistorted_pt = cv2.undistortPoints(pt, self.K, self.D, P=self.K)
        projected = cv2.perspectiveTransform(undistorted_pt, self.H)
        return float(projected[0][0][0]), float(projected[0][0][1])

    def get_verification_grid(self, field_template_lines):
        """
        Projects real-world pitch lines back into raw (distorted) video pixel coordinates.
        This allows direct alignment checking on top of the original video feed.
        """
        warped_grid = []
        for line in field_template_lines:
            metric_pts = np.array(line, dtype=np.float32).reshape(-1, 1, 2)
            # Map metric coordinates to undistorted image coordinates
            linear_pts = cv2.perspectiveTransform(metric_pts, self.H_inv)
            
            # Apply distortion model to projected points to align with raw video
            distorted_pts = []
            for pt in linear_pts:
                u_lin, v_lin = pt[0][0], pt[0][1]
                x = (u_lin - self.K[0, 2]) / self.K[0, 0]
                y = (v_lin - self.K[1, 2]) / self.K[1, 1]
                r2 = x*x + y*y
                
                # Radial distortion (Brown-Conrady)
                k1, k2, p1, p2 = self.D[0], self.D[1], self.D[2], self.D[3]
                k3 = self.D[4] if len(self.D) > 4 else 0.0
                radial = 1.0 + k1*r2 + k2*r2*r2 + k3*r2*r2*r2
                
                # Tangential distortion
                x_d = x * radial + 2.0*p1*x*y + p2*(r2 + 2.0*x*x)
                y_d = y * radial + p1*(r2 + 2.0*y*y) + 2.0*p2*x*y
                
                u_dist = x_d * self.K[0, 0] + self.K[0, 2]
                v_dist = y_d * self.K[1, 1] + self.K[1, 2]
                distorted_pts.append([float(u_dist), float(v_dist)])
            warped_grid.append(distorted_pts)
        return warped_grid
