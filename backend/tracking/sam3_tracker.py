"""
SAM 3 Tracking Wrapper for PitchTrack AI.

Architecture:
  - YOLOv8 (fast person detector)  →  bounding-box prompts every RESEED_INTERVAL frames
  - SAM3VideoPredictor              →  pixel-accurate masks + stable ID propagation

SAM 3's memory bank propagates segmentation masks across frames once objects
are registered via box prompts on the first frame (and periodic re-seed frames).
This gives us inherently stable track IDs without any Re-ID model.

Auto-download:
  If sam3.pt is not found at model_path, the wrapper will attempt to download
  it from Hugging Face using the HF_TOKEN environment variable.

Usage inside the pipeline:
    tracker = SAM3TrackerWrapper(model_path=sam3_path, device=device)
    tracker.reset_session()
    for frame_idx, frame in enumerate(video):
        yolo_boxes = yolo_detect(frame)           # [[x1,y1,x2,y2], ...]
        sam_results = tracker.process_frame(frame_idx, frame, yolo_boxes)
        for r in sam_results:
            r["id"]         # stable SAM3 object id (1-based)
            r["bbox"]       # [x1, y1, x2, y2]
            r["mask"]       # np.ndarray bool H×W (or None)
            r["mask_area"]  # int — pixel count of mask
"""

from __future__ import annotations

import os
from typing import List, Dict, Any, Optional

import cv2
import numpy as np
from loguru import logger

# ---------------------------------------------------------------------------
# SAM 3 import — hard requirement. Will raise at import-time if the
# ultralytics package is too old, giving a clear error message.
# ---------------------------------------------------------------------------
try:
    from ultralytics.models.sam import SAM3VideoPredictor  # ultralytics ≥ 8.3.237
    _SAM3_IMPORTABLE = True
except ImportError:
    _SAM3_IMPORTABLE = False

# ---------------------------------------------------------------------------
# Hugging Face auto-download support
# ---------------------------------------------------------------------------
_HF_REPO_ID   = "facebook/sam3"
_HF_FILENAME  = "sam3.pt"

def _ensure_sam3_weights(model_path: str) -> bool:
    """
    Ensure sam3.pt exists at model_path.
    If missing, attempt to download from Hugging Face using HF_TOKEN env var.
    Returns True if weights are available (pre-existing or freshly downloaded).
    """
    if os.path.exists(model_path):
        return True

    hf_token = os.environ.get("HF_TOKEN", "").strip()
    if not hf_token:
        logger.error(
            f"SAM 3 weights not found at '{model_path}' and HF_TOKEN env var is not set. "
            "Set HF_TOKEN to your Hugging Face token to enable auto-download."
        )
        return False

    try:
        from huggingface_hub import hf_hub_download
        logger.info(
            f"SAM 3 weights not found — downloading from HuggingFace "
            f"({_HF_REPO_ID}/{_HF_FILENAME}) ..."
        )
        downloaded = hf_hub_download(
            repo_id=_HF_REPO_ID,
            filename=_HF_FILENAME,
            token=hf_token,
            local_dir=os.path.dirname(model_path) or ".",
        )
        # Rename/move to the expected model_path if needed
        if os.path.abspath(downloaded) != os.path.abspath(model_path):
            import shutil
            shutil.move(downloaded, model_path)
        logger.info(f"SAM 3 weights downloaded successfully → {model_path}")
        return True
    except Exception as exc:
        logger.error(f"Failed to download SAM 3 weights: {exc}")
        return False


# ---------------------------------------------------------------------------
# Tuning constants
# ---------------------------------------------------------------------------

# How often to re-seed SAM 3 with fresh YOLO boxes so the memory bank
# can recover from drift or new players entering frame.
SAM3_RESEED_INTERVAL = 30   # frames  (~1 s @ 30 fps)


class SAM3TrackerWrapper:
    """
    Wraps SAM3VideoPredictor with a clean per-frame interface.

    SAM 3 is the ONLY tracking engine — no BoT-SORT fallback.
    If the model cannot be loaded or downloaded, a RuntimeError is raised
    so the failure is explicit rather than silent.

    Call flow:
        1. reset_session()          — once per new video
        2. process_frame(...)       — once per frame (returns [] on SAM3 errors,
                                      but does NOT fall back to BoT-SORT)
        3. (repeat step 2)
    """

    def __init__(
        self,
        model_path: str = "sam3.pt",
        device: str = "cuda",
        reseed_interval: int = SAM3_RESEED_INTERVAL,
    ):
        if not _SAM3_IMPORTABLE:
            raise RuntimeError(
                "SAM3VideoPredictor could not be imported. "
                "Run: pip install -U 'ultralytics>=8.3.237'"
            )

        self.model_path      = model_path
        self.device          = device
        if self.device == "cuda":
            try:
                import torch
                if not torch.cuda.is_available():
                    logger.warning("SAM3TrackerWrapper: CUDA requested but torch.cuda.is_available() is False. Overriding device to 'cpu'.")
                    self.device = "cpu"
            except ImportError:
                self.device = "cpu"
        self.reseed_interval = reseed_interval

        # Auto-download weights if needed
        if not _ensure_sam3_weights(model_path):
            raise RuntimeError(
                f"SAM 3 model weights unavailable at '{model_path}'. "
                "Set HF_TOKEN env var to enable automatic download, "
                "or manually place sam3.pt in the backend directory."
            )

        self._predictor: Optional[Any] = None
        self._next_object_id: int = 1
        # Maps SAM3 internal object-id → our stable track id
        self._sam_id_to_track_id: Dict[int, int] = {}
        # track_id → last known bbox (for diagnostics)
        self._track_id_to_bbox: Dict[int, List[float]] = {}
        self._frame_idx: int = 0

        logger.info(
            f"SAM3TrackerWrapper ready — model: {model_path}, device: {device}, "
            f"reseed every {reseed_interval} frames."
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset_session(self) -> None:
        """Call once at the start of processing a new video."""
        self._predictor = None
        self._next_object_id = 1
        self._sam_id_to_track_id = {}
        self._track_id_to_bbox = {}
        self._frame_idx = 0

        try:
            overrides = dict(
                conf=0.25,
                task="segment",
                mode="predict",
                model=self.model_path,
                device=self.device,
                verbose=False,
                half=(self.device != "cpu"),   # FP16 on GPU only
            )
            self._predictor = SAM3VideoPredictor(overrides=overrides)
            logger.info("SAM3VideoPredictor session started.")
        except Exception as exc:
            raise RuntimeError(f"Failed to initialise SAM3VideoPredictor: {exc}") from exc

    def process_frame(
        self,
        frame_idx: int,
        frame_bgr: np.ndarray,
        yolo_boxes: List[List[float]],   # [[x1,y1,x2,y2], ...]
    ) -> List[Dict[str, Any]]:
        """
        Process one video frame through SAM 3.

        Args:
            frame_idx:  0-based frame index
            frame_bgr:  OpenCV BGR frame (H×W×3 uint8)
            yolo_boxes: Player bounding boxes from YOLO, each [x1,y1,x2,y2].
                        Used as prompts on seed frames.

        Returns:
            List of dicts, one per tracked player:
                {
                    "id":        int    — stable SAM3 track id (1-based)
                    "bbox":      [x1, y1, x2, y2]
                    "mask":      np.ndarray bool H×W | None
                    "mask_area": int
                }
        """
        self._frame_idx = frame_idx

        if self._predictor is None:
            logger.error("SAM3 predictor not initialised — call reset_session() first.")
            return []

        try:
            is_seed = (frame_idx == 0) or (frame_idx % self.reseed_interval == 0)
            if is_seed and yolo_boxes:
                return self._seed_and_propagate(frame_bgr, yolo_boxes)
            else:
                return self._propagate_only(frame_bgr)
        except Exception as exc:
            logger.warning(f"SAM3 process_frame error on frame {frame_idx}: {exc}")
            return []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _seed_and_propagate(
        self,
        frame_bgr: np.ndarray,
        yolo_boxes: List[List[float]],
    ) -> List[Dict[str, Any]]:
        """Register YOLO boxes as SAM 3 prompts, then segment and return results."""
        h, w = frame_bgr.shape[:2]
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        boxes_np  = np.array(yolo_boxes, dtype=np.float32)   # N×4

        sam_out = self._predictor(
            source=frame_rgb,
            bboxes=boxes_np,
            verbose=False,
        )
        return self._parse_sam_results(sam_out, yolo_boxes, h, w)

    def _propagate_only(self, frame_bgr: np.ndarray) -> List[Dict[str, Any]]:
        """Propagate masks from the memory bank — no new box prompts."""
        h, w = frame_bgr.shape[:2]
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

        sam_out = self._predictor(
            source=frame_rgb,
            verbose=False,
        )
        return self._parse_sam_results(sam_out, [], h, w)

    def _parse_sam_results(
        self,
        sam_results: Any,
        yolo_boxes: List[List[float]],
        h: int,
        w: int,
    ) -> List[Dict[str, Any]]:
        """Convert ultralytics SAM result objects → our standard detection dicts."""
        output: List[Dict[str, Any]] = []
        if sam_results is None:
            return output

        result_list = sam_results if isinstance(sam_results, list) else [sam_results]

        for result in result_list:
            if result is None:
                continue

            masks_data = result.masks
            boxes_data = result.boxes

            if masks_data is None and boxes_data is None:
                continue

            n_objects = 0
            if masks_data is not None and masks_data.data is not None:
                n_objects = len(masks_data.data)
            elif boxes_data is not None and boxes_data.xyxy is not None:
                n_objects = len(boxes_data.xyxy)

            for i in range(n_objects):
                # ---- Bounding box ----
                bbox: List[float] = []
                if boxes_data is not None and boxes_data.xyxy is not None and i < len(boxes_data.xyxy):
                    bbox = boxes_data.xyxy[i].cpu().numpy().tolist()
                elif yolo_boxes and i < len(yolo_boxes):
                    bbox = yolo_boxes[i]
                else:
                    continue
                if len(bbox) < 4:
                    continue
                x1, y1, x2, y2 = bbox
                if x2 <= x1 or y2 <= y1:
                    continue

                # ---- Mask ----
                mask: Optional[np.ndarray] = None
                mask_area: int = 0
                if masks_data is not None and masks_data.data is not None and i < len(masks_data.data):
                    raw_mask = masks_data.data[i].cpu().numpy()
                    if raw_mask.dtype != bool:
                        raw_mask = raw_mask > 0.5
                    if raw_mask.shape != (h, w):
                        raw_mask = cv2.resize(
                            raw_mask.astype(np.uint8), (w, h),
                            interpolation=cv2.INTER_NEAREST
                        ).astype(bool)
                    mask = raw_mask
                    mask_area = int(np.sum(mask))

                # ---- Stable track ID ----
                sam_obj_id: int = i   # positional default
                if hasattr(result, "track_id") and result.track_id is not None:
                    track_ids = result.track_id
                    if hasattr(track_ids, "__len__") and i < len(track_ids):
                        sam_obj_id = int(track_ids[i])
                    elif isinstance(track_ids, int):
                        sam_obj_id = track_ids

                if sam_obj_id not in self._sam_id_to_track_id:
                    self._sam_id_to_track_id[sam_obj_id] = self._next_object_id
                    self._next_object_id += 1

                track_id = self._sam_id_to_track_id[sam_obj_id]
                self._track_id_to_bbox[track_id] = bbox

                output.append({
                    "id":        track_id,
                    "bbox":      [x1, y1, x2, y2],
                    "mask":      mask,
                    "mask_area": mask_area,
                })

        return output

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def draw_masks(
        self,
        frame_bgr: np.ndarray,
        results: List[Dict[str, Any]],
        alpha: float = 0.35,
    ) -> np.ndarray:
        """
        Overlay translucent SAM 3 segmentation masks onto the frame.
        Each player gets a unique colour derived from their track ID.
        """
        overlay = frame_bgr.copy()
        for r in results:
            mask = r.get("mask")
            if mask is None:
                continue
            tid = r["id"]
            hue = int((tid * 47) % 180)
            color_hsv = np.array([[[hue, 220, 220]]], dtype=np.uint8)
            color_bgr = cv2.cvtColor(color_hsv, cv2.COLOR_HSV2BGR)[0][0].tolist()
            overlay[mask] = color_bgr
        return cv2.addWeighted(overlay, alpha, frame_bgr, 1 - alpha, 0)
