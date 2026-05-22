import numpy as np
from typing import Dict, List, Tuple, Any

class PlayerStatsTracker:
    """
    Tracks trajectory, distance covered, speed, average speed, and top speed for a specific player.
    """
    def __init__(self, player_id: int, dt: float = 1.0/30.0, jitter_threshold: float = 0.05):
        self.player_id = player_id
        self.dt = dt
        self.jitter_threshold = jitter_threshold
        
        self.path: List[Dict[str, Any]] = []  # list of {"frame": f, "x": x, "y": y, "speed": s}
        self.total_distance = 0.0             # meters
        self.top_speed = 0.0                  # km/h
        self.avg_speed = 0.0                  # km/h
        
        self.last_position: Tuple[float, float] = None
        self.active_frames = 0
        
        # Buffer for recent speed values to perform moving average smoothing on speed
        self.speed_buffer: List[float] = []
        self.buffer_size = 5

    def add_position(self, frame_idx: int, x: float, y: float):
        """
        Adds a new filtered position for the player and calculates metrics.
        """
        speed_kmh = 0.0
        
        if self.last_position is not None:
            last_x, last_y = self.last_position
            # Euclidean distance in meters
            dx = x - last_x
            dy = y - last_y
            step_distance = np.sqrt(dx**2 + dy**2)
            
            # Filter out camera or coordinate estimation jitter
            if step_distance >= self.jitter_threshold:
                # Accumulate distance
                self.total_distance += step_distance
                
                # Calculate raw speed: m/s -> km/h (multiply by 3.6)
                raw_speed_mps = step_distance / self.dt
                raw_speed_kmh = raw_speed_mps * 3.6
                
                # Speed smoothing using moving average to avoid spike anomalies
                self.speed_buffer.append(raw_speed_kmh)
                if len(self.speed_buffer) > self.buffer_size:
                    self.speed_buffer.pop(0)
                speed_kmh = float(np.mean(self.speed_buffer))
                
                # Update top speed (ignoring extreme anomalies, cap at 36 km/h for realism)
                if speed_kmh > self.top_speed and speed_kmh < 36.0:
                    self.top_speed = speed_kmh
                    
                self.active_frames += 1
            else:
                # Player is virtually static, speed is close to 0
                self.speed_buffer.append(0.0)
                if len(self.speed_buffer) > self.buffer_size:
                    self.speed_buffer.pop(0)
                speed_kmh = float(np.mean(self.speed_buffer))
        else:
            self.active_frames = 1
            
        self.last_position = (x, y)
        self.path.append({
            "frame": frame_idx,
            "x": round(x, 2),
            "y": round(y, 2),
            "speed": round(speed_kmh, 1)
        })
        
        # Recalculate average speed: total distance / total active time
        # active time in seconds = active_frames * dt
        if self.active_frames > 0:
            total_active_time = self.active_frames * self.dt
            if total_active_time > 0:
                self.avg_speed = (self.total_distance / total_active_time) * 3.6

    def get_summary(self) -> Dict[str, Any]:
        """
        Returns a dictionary summarizing the player's performance.
        """
        return {
            "id": self.player_id,
            "distance": round(self.total_distance, 1),
            "avgSpeed": round(self.avg_speed, 1),
            "topSpeed": round(self.top_speed, 1),
            "path": self.path
        }
