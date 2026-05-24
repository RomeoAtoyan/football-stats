import cv2
import numpy as np
from typing import List, Tuple, Optional

def compute_homography(pixel_pts: List[Tuple[float, float]], real_pts: List[Tuple[float, float]]) -> Optional[np.ndarray]:
    """
    Computes the 3x3 homography matrix that maps pixel coordinates to real-world coordinates.
    Requires at least 4 point correspondences.
    """
    if len(pixel_pts) < 4 or len(real_pts) < 4:
        return None
        
    src_pts = np.array(pixel_pts, dtype=np.float32)
    dst_pts = np.array(real_pts, dtype=np.float32)
    
    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    return H

def pixel_to_meter(px: float, py: float, H: np.ndarray) -> Tuple[float, float]:
    """
    Transforms a single pixel coordinate (px, py) to real-world coordinates (rx, ry) in meters
    using the homography matrix H.
    """
    pt = np.array([px, py, 1.0], dtype=np.float32)
    transformed = np.dot(H, pt)
    
    if transformed[2] != 0:
        rx = transformed[0] / transformed[2]
        ry = transformed[1] / transformed[2]
    else:
        rx, ry = 0.0, 0.0
        
    return float(rx), float(ry)

def meter_to_pixel(rx: float, ry: float, H_inv: np.ndarray) -> Tuple[int, int]:
    """
    Transforms a real-world coordinate (rx, ry) to pixel coordinate (px, py)
    using the inverse homography matrix H_inv.
    """
    pt = np.array([rx, ry, 1.0], dtype=np.float32)
    transformed = np.dot(H_inv, pt)
    
    if transformed[2] != 0:
        px = transformed[0] / transformed[2]
        py = transformed[1] / transformed[2]
    else:
        px, py = 0, 0
        
    return int(round(px)), int(round(py))
