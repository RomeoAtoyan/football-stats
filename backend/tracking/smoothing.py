import numpy as np
from typing import Tuple

class KalmanFilter2D:
    """
    A self-contained 2D Kalman Filter for smoothing player trajectories (position and velocity).
    Tracks state vector: [x, y, vx, vy]^T
    """
    def __init__(self, init_x: float, init_y: float, dt: float = 1.0/30.0, process_noise: float = 0.1, measurement_noise: float = 0.5):
        self.dt = dt
        self.x = np.array([init_x, init_y, 0.0, 0.0], dtype=np.float32)
        
        self.F = np.array([
            [1.0, 0.0,  dt, 0.0],
            [0.0, 1.0, 0.0,  dt],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ], dtype=np.float32)
        
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0]
        ], dtype=np.float32)
        
        self.P = np.eye(4, dtype=np.float32) * 1.0
        
        self.Q = np.array([
            [0.25*dt**4, 0.0,        0.5*dt**3,  0.0],
            [0.0,        0.25*dt**4, 0.0,        0.5*dt**3],
            [0.5*dt**3,  0.0,        dt**2,      0.0],
            [0.0,        0.5*dt**3,  0.0,        dt**2]
        ], dtype=np.float32) * process_noise
        
        self.R = np.eye(2, dtype=np.float32) * measurement_noise

    def predict(self) -> Tuple[float, float]:
        self.x = np.dot(self.F, self.x)
        self.P = np.dot(np.dot(self.F, self.P), self.F.T) + self.Q
        return float(self.x[0]), float(self.x[1])

    def update(self, z_x: float, z_y: float) -> Tuple[float, float]:
        z = np.array([z_x, z_y], dtype=np.float32)
        y = z - np.dot(self.H, self.x)
        S = np.dot(np.dot(self.H, self.P), self.H.T) + self.R
        K = np.dot(np.dot(self.P, self.H.T), np.linalg.inv(S))
        
        self.x = self.x + np.dot(K, y)
        I = np.eye(4, dtype=np.float32)
        self.P = np.dot(I - np.dot(K, self.H), self.P)
        
        return float(self.x[0]), float(self.x[1])

    def get_position(self) -> Tuple[float, float]:
        return float(self.x[0]), float(self.x[1])

    def get_velocity(self) -> Tuple[float, float]:
        return float(self.x[2]), float(self.x[3])
