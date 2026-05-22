import numpy as np
from typing import Tuple

class KalmanFilter2D:
    """
    A self-contained 2D Kalman Filter for smoothing player trajectories (position and velocity).
    Tracks state vector: [x, y, vx, vy]^T
    """
    def __init__(self, init_x: float, init_y: float, dt: float = 1.0/30.0, process_noise: float = 0.1, measurement_noise: float = 0.5):
        self.dt = dt
        
        # State vector: [x, y, vx, vy]^T
        self.x = np.array([init_x, init_y, 0.0, 0.0], dtype=np.float32)
        
        # State transition matrix
        self.F = np.array([
            [1.0, 0.0,  dt, 0.0],
            [0.0, 1.0, 0.0,  dt],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0]
        ], dtype=np.float32)
        
        # Measurement matrix (we only measure position x, y)
        self.H = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0]
        ], dtype=np.float32)
        
        # State covariance matrix (initial uncertainty)
        self.P = np.eye(4, dtype=np.float32) * 1.0
        
        # Process noise covariance
        self.Q = np.array([
            [0.25*dt**4, 0.0,        0.5*dt**3,  0.0],
            [0.0,        0.25*dt**4, 0.0,        0.5*dt**3],
            [0.5*dt**3,  0.0,        dt**2,      0.0],
            [0.0,        0.5*dt**3,  0.0,        dt**2]
        ], dtype=np.float32) * process_noise
        
        # Measurement noise covariance
        self.R = np.eye(2, dtype=np.float32) * measurement_noise

    def predict(self) -> Tuple[float, float]:
        """
        Predicts the next state.
        :return: (predicted_x, predicted_y)
        """
        self.x = np.dot(self.F, self.x)
        self.P = np.dot(np.dot(self.F, self.P), self.F.T) + self.Q
        return float(self.x[0]), float(self.x[1])

    def update(self, z_x: float, z_y: float) -> Tuple[float, float]:
        """
        Updates the state with a new position measurement.
        :param z_x: Measured X coordinate.
        :param z_y: Measured Y coordinate.
        :return: (smoothed_x, smoothed_y)
        """
        z = np.array([z_x, z_y], dtype=np.float32)
        
        # Innovation
        y = z - np.dot(self.H, self.x)
        
        # Innovation covariance
        S = np.dot(np.dot(self.H, self.P), self.H.T) + self.R
        
        # Kalman gain
        K = np.dot(np.dot(self.P, self.H.T), np.linalg.inv(S))
        
        # Updated state
        self.x = self.x + np.dot(K, y)
        
        # Updated covariance
        I = np.eye(4, dtype=np.float32)
        self.P = np.dot(I - np.dot(K, self.H), self.P)
        
        return float(self.x[0]), float(self.x[1])

    def get_position(self) -> Tuple[float, float]:
        """Returns the current filtered position (x, y)"""
        return float(self.x[0]), float(self.x[1])

    def get_velocity(self) -> Tuple[float, float]:
        """Returns the current filtered velocity (vx, vy) in m/s"""
        return float(self.x[2]), float(self.x[3])
