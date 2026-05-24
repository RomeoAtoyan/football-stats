import numpy as np
import cv2
from loguru import logger

class TeamAssigner:
    def __init__(self):
        # Team 1 (A) = Purple (BGR: 247, 85, 168) -> Fluorescent vest team
        # Team 2 (B) = Aqua   (BGR: 212, 182, 6)   -> Non-fluorescent team
        self.team_colors = {
            1: (247, 85, 168), # Team A - Purple
            2: (212, 182, 6)   # Team B - Aqua
        }
        self.player_team_dict = {}
        self.player_votes = {} # player_id -> list of predictions [1, 2, 1, 1...]

    def is_wearing_fluo_vest(self, frame: np.ndarray, bbox: list) -> bool:
        """
        Determines if the player is wearing a fluorescent yellow-green vest.
        Excludes green turf and dark jerseys by enforcing:
        1. BGR Ratios: Yellow-green is Red+Green. Turf is pure Green.
           So we require Red > Blue * 1.60 and Green > Blue * 1.80.
        2. HSV Bands: Bright yellow-green is Hue 25-45, Saturation >= 80, Value >= 120.
        """
        x1, y1, x2, y2 = map(int, bbox)
        
        # Crop player image
        player_crop = frame[y1:y2, x1:x2]
        if player_crop.size == 0:
            return False
            
        # Get top-center crop of shirt (exclude sides to ignore background turf)
        h, w, _ = player_crop.shape
        top_half_height = max(1, int(h * 0.45))
        left_pad = max(0, int(w * 0.20))
        right_pad = max(0, int(w * 0.80))
        
        shirt_crop = player_crop[0:top_half_height, left_pad:right_pad]
        if shirt_crop.size == 0:
            return False
            
        # 1. High-precision BGR relative channel analysis
        b = shirt_crop[:, :, 0].astype(np.float32)
        g = shirt_crop[:, :, 1].astype(np.float32)
        r = shirt_crop[:, :, 2].astype(np.float32)
        
        # Fluo Yellow-Green has high Green and Red compared to Blue (unlike green turf which has low Red)
        # We enforce strict ratios:
        bgr_fluo = (g > b * 1.80) & (r > b * 1.60) & (g > 50)
        
        # 2. HSV color band thresholding
        hsv_crop = cv2.cvtColor(shirt_crop, cv2.COLOR_BGR2HSV)
        h = hsv_crop[:, :, 0]
        s = hsv_crop[:, :, 1]
        v = hsv_crop[:, :, 2]
        
        # Hue: 25-45 (yellow-green), Saturation >= 80, Value >= 120 (bright)
        hsv_fluo = (h >= 25) & (h <= 45) & (s >= 80) & (v >= 120)
        
        # Combine both filters (OR operator)
        fluo_pixels = bgr_fluo | hsv_fluo
        
        # Calculate ratio of high-vis pixels
        fluo_ratio = np.sum(fluo_pixels) / (shirt_crop.shape[0] * shirt_crop.shape[1])
        
        # If at least 5% of the center shirt crop matches, they are wearing a high-vis vest!
        return bool(fluo_ratio >= 0.05)

    def assign_team_colors(self, frame: np.ndarray, player_detections: dict):
        pass

    def get_player_team(self, frame: np.ndarray, player_bbox: list, player_id: int) -> int:
        """
        Classifies player into Team 1 (Purple - Fluo Vest) or Team 2 (Aqua - Others).
        Accumulates classifications over frames for a robust temporal voting consensus.
        """
        wearing_vest = self.is_wearing_fluo_vest(frame, player_bbox)
        pred = 1 if wearing_vest else 2
        
        if player_id not in self.player_votes:
            self.player_votes[player_id] = []
        self.player_votes[player_id].append(pred)
        
        # Determine team based on majority vote of all frames tracked so far
        votes = self.player_votes[player_id]
        team_idx = max(set(votes), key=votes.count)
        
        self.player_team_dict[player_id] = team_idx
        return team_idx
