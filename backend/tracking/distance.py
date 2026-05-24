import numpy as np
from typing import Dict, List, Tuple, Any


# Anything beyond this implied per-step velocity (m/s) is treated as an
# occlusion bridge — we update the last-known position but DO NOT add
# the gap to the player's total distance covered, because the player
# was unobserved during that span (not actually teleporting).
MAX_PLAUSIBLE_STEP_SPEED_MPS = 10.0  # 36 km/h — generous upper bound on human sprint

# If the frame gap between two consecutive observations is wider than this
# many frames, also treat it as an occlusion bridge (extra safety on top
# of the speed check above).
MAX_CONTIGUOUS_FRAME_GAP = 6  # ~0.2s at 30fps


class PlayerStatsTracker:
    """
    Tracks trajectory, distance covered, speed, average speed, and top speed
    for a specific player. Gap-aware: handles non-contiguous frame observations
    (post-stitching across occlusion bridges) without inflating metrics.
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
        self.last_frame: int = None
        self.active_frames = 0                # Counts observed frames (used for avg speed denominator)
        
        self.speed_buffer: List[float] = []
        self.buffer_size = 5

    def add_position(self, frame_idx: int, x: float, y: float):
        speed_kmh = 0.0
        
        if self.last_position is not None and self.last_frame is not None:
            last_x, last_y = self.last_position
            dx = x - last_x
            dy = y - last_y
            step_distance = float(np.sqrt(dx**2 + dy**2))
            
            frame_gap = max(1, frame_idx - self.last_frame)
            actual_dt = frame_gap * self.dt
            
            # Compute implied speed using REAL elapsed time (not fixed self.dt) so
            # the stat is correct even after the stitcher bridges across occlusions.
            implied_speed_mps = step_distance / actual_dt if actual_dt > 0 else 0.0
            
            is_occlusion_bridge = (
                frame_gap > MAX_CONTIGUOUS_FRAME_GAP
                or implied_speed_mps > MAX_PLAUSIBLE_STEP_SPEED_MPS
            )
            
            if is_occlusion_bridge:
                # Player was unobserved across this span — skip distance accumulation,
                # just reset the speed buffer so we don't carry stale velocity.
                self.speed_buffer = [0.0]
                speed_kmh = 0.0
            elif step_distance >= self.jitter_threshold:
                self.total_distance += step_distance
                raw_speed_kmh = implied_speed_mps * 3.6
                
                self.speed_buffer.append(raw_speed_kmh)
                if len(self.speed_buffer) > self.buffer_size:
                    self.speed_buffer.pop(0)
                speed_kmh = float(np.mean(self.speed_buffer))
                
                if speed_kmh > self.top_speed and speed_kmh < 36.0:
                    self.top_speed = speed_kmh
            else:
                self.speed_buffer.append(0.0)
                if len(self.speed_buffer) > self.buffer_size:
                    self.speed_buffer.pop(0)
                speed_kmh = float(np.mean(self.speed_buffer))
            
            self.active_frames += frame_gap if not is_occlusion_bridge else 1
        else:
            self.active_frames = 1
            
        self.last_position = (x, y)
        self.last_frame = frame_idx
        self.path.append({
            "frame": frame_idx,
            "x": round(x, 2),
            "y": round(y, 2),
            "speed": round(speed_kmh, 1)
        })
        
        if self.active_frames > 0:
            total_active_time = self.active_frames * self.dt
            if total_active_time > 0:
                self.avg_speed = (self.total_distance / total_active_time) * 3.6

    def get_summary(self) -> Dict[str, Any]:
        return {
            "id": self.player_id,
            "distance": round(self.total_distance, 1),
            "avgSpeed": round(self.avg_speed, 1),
            "topSpeed": round(self.top_speed, 1),
            "path": self.path
        }
