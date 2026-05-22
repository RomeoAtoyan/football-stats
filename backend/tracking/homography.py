import cv2
import numpy as np
from typing import List, Tuple, Dict, Any, Optional

def compute_homography(pixel_pts: List[Tuple[float, float]], real_pts: List[Tuple[float, float]]) -> Optional[np.ndarray]:
    """
    Computes the 3x3 homography matrix that maps pixel coordinates to real-world coordinates.
    Requires at least 4 point correspondences.
    
    :param pixel_pts: List of (x, y) coordinates in pixels.
    :param real_pts: List of (x, y) coordinates in real-world meters.
    :return: 3x3 numpy array (homography matrix) or None if computation fails.
    """
    if len(pixel_pts) < 4 or len(real_pts) < 4:
        return None
        
    src_pts = np.array(pixel_pts, dtype=np.float32)
    dst_pts = np.array(real_pts, dtype=np.float32)
    
    # We use RANSAC to be robust to outlier clicks
    H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    return H

def pixel_to_meter(px: float, py: float, H: np.ndarray) -> Tuple[float, float]:
    """
    Transforms a single pixel coordinate (px, py) to real-world coordinates (rx, ry) in meters
    using the homography matrix H.
    
    :param px: Pixel X coordinate.
    :param py: Pixel Y coordinate.
    :param H: 3x3 homography matrix.
    :return: (rx, ry) in real-world meters.
    """
    pt = np.array([px, py, 1.0], dtype=np.float32)
    transformed = np.dot(H, pt)
    
    # Normalize by the homogeneous coordinate (z)
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
    
    :param rx: Real X coordinate (meters).
    :param ry: Real Y coordinate (meters).
    :param H_inv: 3x3 inverse homography matrix.
    :return: (px, py) in pixels as integer.
    """
    pt = np.array([rx, ry, 1.0], dtype=np.float32)
    transformed = np.dot(H_inv, pt)
    
    if transformed[2] != 0:
        px = transformed[0] / transformed[2]
        py = transformed[1] / transformed[2]
    else:
        px, py = 0, 0
        
    return int(round(px)), int(round(py))

def draw_grid_overlay(
    image: np.ndarray, 
    H: np.ndarray, 
    width_m: float = 30.0, 
    height_m: float = 16.0, 
    grid_step_m: float = 2.0
) -> np.ndarray:
    """
    Draws a visual representation of the 30x16m pitch (outer borders, penalty boxes, kickoff spot,
    and a coordinate grid) overlaid on the perspective frame by inverting the homography.
    
    :param image: Input OpenCV image (first frame).
    :param H: 3x3 homography matrix (pixel -> meter).
    :param width_m: Field length in meters (default 30m).
    :param height_m: Field width in meters (default 16m).
    :param grid_step_m: Distance between grid lines in meters.
    :return: Annotated image with grid drawn.
    """
    annotated = image.copy()
    try:
        H_inv = np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return annotated

    # Define overlay colors (BGR)
    color_border = (0, 255, 0)       # Bright Green for boundaries
    color_grid = (200, 200, 200)     # Light Gray for grid lines
    color_key_elements = (0, 255, 255) # Yellow for goals & penalty spots
    
    # 1. Draw Grid Lines
    # Vertical grid lines (along X axis)
    for x in np.arange(0, width_m + 0.1, grid_step_m):
        pts = []
        for y in np.linspace(0, height_m, 20):
            px, py = meter_to_pixel(x, y, H_inv)
            pts.append([px, py])
        pts = np.array(pts, dtype=np.int32)
        cv2.polylines(annotated, [pts], isClosed=False, color=color_grid, thickness=1, lineType=cv2.LINE_AA)
        
    # Horizontal grid lines (along Y axis)
    for y in np.arange(0, height_m + 0.1, grid_step_m):
        pts = []
        for x in np.linspace(0, width_m, 30):
            px, py = meter_to_pixel(x, y, H_inv)
            pts.append([px, py])
        pts = np.array(pts, dtype=np.int32)
        cv2.polylines(annotated, [pts], isClosed=False, color=color_grid, thickness=1, lineType=cv2.LINE_AA)

    # 2. Draw Field Outer Boundary
    boundary_pts = np.array([
        meter_to_pixel(0, 0, H_inv),
        meter_to_pixel(width_m, 0, H_inv),
        meter_to_pixel(width_m, height_m, H_inv),
        meter_to_pixel(0, height_m, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [boundary_pts], isClosed=True, color=color_border, thickness=3, lineType=cv2.LINE_AA)

    # 3. Draw Center Line and Center Circle
    cx, cy = width_m / 2, height_m / 2
    # Center Line
    center_line_pts = np.array([
        meter_to_pixel(cx, 0, H_inv),
        meter_to_pixel(cx, height_m, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [center_line_pts], isClosed=False, color=color_border, thickness=2, lineType=cv2.LINE_AA)
    
    # Center circle (approximate with points)
    circle_pts = []
    r_circle = 3.0 # 3 meters center circle
    for theta in np.linspace(0, 2 * np.pi, 36):
        rx = cx + r_circle * np.cos(theta)
        ry = cy + r_circle * np.sin(theta)
        circle_pts.append(meter_to_pixel(rx, ry, H_inv))
    circle_pts = np.array(circle_pts, dtype=np.int32)
    cv2.polylines(annotated, [circle_pts], isClosed=True, color=color_border, thickness=2, lineType=cv2.LINE_AA)
    
    # Center Kickoff Spot
    px_c, py_c = meter_to_pixel(cx, cy, H_inv)
    cv2.circle(annotated, (px_c, py_c), 5, color_key_elements, -1, lineType=cv2.LINE_AA)

    # 4. Draw Left and Right Penalty Boxes (futsal-style: 6m box or arc)
    # Let's draw it as a 6m rectangular box centered on the goal line for simplicity and clear alignment
    # Left Penalty Box (length = 6m, width centered, from y=3 to y=13)
    left_box_pts = np.array([
        meter_to_pixel(0, 3, H_inv),
        meter_to_pixel(6, 3, H_inv),
        meter_to_pixel(6, 13, H_inv),
        meter_to_pixel(0, 13, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [left_box_pts], isClosed=False, color=color_border, thickness=2, lineType=cv2.LINE_AA)
    
    # Left Penalty Spot
    px_ps_l, py_ps_l = meter_to_pixel(6, cy, H_inv)
    cv2.circle(annotated, (px_ps_l, py_ps_l), 4, color_key_elements, -1, lineType=cv2.LINE_AA)

    # Right Penalty Box (length = 6m, width centered, from y=3 to y=13)
    right_box_pts = np.array([
        meter_to_pixel(width_m, 3, H_inv),
        meter_to_pixel(width_m - 6, 3, H_inv),
        meter_to_pixel(width_m - 6, 13, H_inv),
        meter_to_pixel(width_m, 13, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [right_box_pts], isClosed=False, color=color_border, thickness=2, lineType=cv2.LINE_AA)
    
    # Right Penalty Spot
    px_ps_r, py_ps_r = meter_to_pixel(width_m - 6, cy, H_inv)
    cv2.circle(annotated, (px_ps_r, py_ps_r), 4, color_key_elements, -1, lineType=cv2.LINE_AA)

    # 5. Draw Left and Right Goals
    # Left Goal: centered on x=0, width from y=6.5 to 9.5
    left_goal_pts = np.array([
        meter_to_pixel(0, 6.5, H_inv),
        meter_to_pixel(-1.0, 6.5, H_inv),  # 1m depth inside
        meter_to_pixel(-1.0, 9.5, H_inv),
        meter_to_pixel(0, 9.5, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [left_goal_pts], isClosed=False, color=color_key_elements, thickness=3, lineType=cv2.LINE_AA)
    
    # Right Goal: centered on x=width_m, width from y=6.5 to 9.5
    right_goal_pts = np.array([
        meter_to_pixel(width_m, 6.5, H_inv),
        meter_to_pixel(width_m + 1.0, 6.5, H_inv),  # 1m depth inside
        meter_to_pixel(width_m + 1.0, 9.5, H_inv),
        meter_to_pixel(width_m, 9.5, H_inv)
    ], dtype=np.int32)
    cv2.polylines(annotated, [right_goal_pts], isClosed=False, color=color_key_elements, thickness=3, lineType=cv2.LINE_AA)

    return annotated
