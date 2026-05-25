import cv2
import numpy as np
import os
import json
import pickle
from typing import Callable, Tuple, Dict, Any, List
from collections import defaultdict
from loguru import logger
from ultralytics import YOLO

from tracking.homography import pixel_to_meter
from tracking.smoothing import KalmanFilter2D
from tracking.distance import PlayerStatsTracker
from tracking.team_assigner import TeamAssigner
from tracking.track_merger import stitch_fragments
from tracking.sam3_tracker import SAM3TrackerWrapper

# Bump this whenever the detector/tracker config materially changes, so stale
# pickle caches written by an older version are auto-invalidated instead of
# silently producing inconsistent IDs.
# v7: SAM3VideoPredictor is now the SOLE tracking engine (no BoT-SORT).
TRACKING_CACHE_VERSION = 7

TRACKER_IMGSZ = 1280

# SAM 3 model path — override via SAM3_MODEL_PATH env var or place sam3.pt in backend dir.
# HF_TOKEN env var is used for automatic weight download from HuggingFace.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAM3_MODEL_PATH = os.environ.get(
    "SAM3_MODEL_PATH",
    os.path.join(_BACKEND_DIR, "sam3.pt")
)
SAM3_DEVICE = os.environ.get("SAM3_DEVICE", "cuda")

# Auto-fallback to CPU if CUDA is requested but not supported/available in PyTorch
if SAM3_DEVICE == "cuda":
    try:
        import torch
        if not torch.cuda.is_available():
            logger.warning("CUDA was requested (SAM3_DEVICE='cuda') but torch.cuda.is_available() is False. Falling back to 'cpu'.")
            SAM3_DEVICE = "cpu"
    except ImportError:
        logger.warning("torch not importable. Falling back to 'cpu' just in case.")
        SAM3_DEVICE = "cpu"


def _extract_player_appearance(frame: np.ndarray, bbox: List[float]) -> np.ndarray | None:
    """
    Compact HSV color signature for offline tracklet stitching.
    Cheap alternative to a Re-ID model — gives the stitcher an extra signal
    when SAM 3 assigns a new object id after a long occlusion.
    """
    x1, y1, x2, y2 = map(int, bbox)
    h_img, w_img = frame.shape[:2]
    x1 = max(0, min(w_img - 1, x1))
    x2 = max(0, min(w_img, x2))
    y1 = max(0, min(h_img - 1, y1))
    y2 = max(0, min(h_img, y2))

    if x2 <= x1 or y2 <= y1:
        return None

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0 or crop.shape[0] < 16 or crop.shape[1] < 8:
        return None

    ch, cw = crop.shape[:2]
    body = crop[: max(1, int(ch * 0.75)), int(cw * 0.15) : max(int(cw * 0.85), int(cw * 0.15) + 1)]
    if body.size == 0:
        return None

    hsv = cv2.cvtColor(body, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 4], [0, 180, 0, 256, 0, 256])
    feature = hist.flatten().astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm <= 1e-6:
        return None
    return feature / norm


def _yolo_detect_players(model: YOLO, frame: np.ndarray, imgsz: int) -> List[List[float]]:
    """
    Run YOLOv8 person detection (class 0) on a single frame.
    Results are used as box prompts for SAM 3 on seed frames.
    """
    results = model.predict(
        source=frame,
        classes=[0],
        conf=0.30,
        iou=0.60,
        imgsz=imgsz,
        verbose=False,
    )
    boxes: List[List[float]] = []
    if results and results[0].boxes is not None:
        for box in results[0].boxes:
            boxes.append(box.xyxy[0].cpu().numpy().tolist())
    return boxes


def _yolo_detect_ball(model: YOLO, frame: np.ndarray, imgsz: int) -> List[List[float]]:
    """Detect the ball (COCO class 32 — sports ball) on a single frame."""
    results = model.predict(
        source=frame,
        classes=[32],
        conf=0.20,
        imgsz=imgsz,
        verbose=False,
    )
    boxes: List[List[float]] = []
    if results and results[0].boxes is not None:
        for box in results[0].boxes:
            boxes.append(box.xyxy[0].cpu().numpy().tolist())
    return boxes


def run_tracking_pipeline(
    video_path: str,
    output_video_path: str,
    export_json_path: str,
    homography_matrix: np.ndarray,
    progress_callback: Callable[[float, str], None] = None
) -> Tuple[Dict[str, Any], str]:
    """
    Core video processing pipeline — SAM 3 edition (sole tracking engine):

    1.  Check for pre-compiled tracking cache (version-gated).
    2.  Run YOLO detection on initial frames to fit TeamAssigner color clustering.
    3.  Per-frame tracking loop:
          a. YOLO detects players + ball every frame.
          b. SAM3VideoPredictor receives player boxes as prompts on seed frames
             and propagates pixel-accurate segmentation masks on all other frames.
          c. Foot coordinates → Kalman-smoothed → pitch meters via homography.
    4.  Offline tracklet stitching consolidates fragmented SAM3 IDs.
    5.  Render annotated video with team-coloured SAM3 mask overlays + player tags.
    6.  Write final analytics JSON (includes mask_area per detection).
    """
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {video_path}")

    width        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps          = float(cap.get(cv2.CAP_PROP_FPS))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    dt           = 1.0 / fps if fps > 0 else 1.0 / 30.0

    logger.info(
        f"Loaded input video: {width}x{height} @ {fps}fps, {total_frames} frames."
    )

    # ------------------------------------------------------------------
    # 0. Tracking cache check (version-gated)
    # ------------------------------------------------------------------
    cache_path = os.path.join(os.path.dirname(export_json_path), "tracking_cache.pkl")
    use_cache  = False
    cached_tracks: Dict[int, List[Dict[str, Any]]] = {}

    if os.path.exists(cache_path):
        try:
            with open(cache_path, "rb") as f:
                blob = pickle.load(f)
            if isinstance(blob, dict) and blob.get("version") == TRACKING_CACHE_VERSION:
                cached_tracks = blob["tracks"]
                use_cache = True
                logger.info(
                    f"Using cached tracking data — {len(cached_tracks)} frames "
                    f"(v{TRACKING_CACHE_VERSION})"
                )
            else:
                logger.info(
                    f"Tracking cache stale (got v{blob.get('version') if isinstance(blob, dict) else 'legacy'}, "
                    f"need v{TRACKING_CACHE_VERSION}). Re-running."
                )
        except Exception as e:
            logger.warning(f"Failed to load tracking cache: {e}. Running fresh.")

    # ------------------------------------------------------------------
    # 1. Load models
    # ------------------------------------------------------------------
    model: YOLO | None = None
    sam3_tracker: SAM3TrackerWrapper | None = None

    if not use_cache:
        if progress_callback:
            progress_callback(0.02, "Loading YOLOv8 and SAM 3 models...")

        # YOLOv8 — used for person detection (box prompts) + ball detection
        model_name       = "yolov8m.pt"
        model_path_local = os.path.join(_BACKEND_DIR, model_name)
        if not os.path.exists(model_path_local):
            model_path_local = model_name
        model = YOLO(model_path_local)
        logger.info("YOLOv8m loaded.")

        # SAM 3 — SOLE tracking engine. RuntimeError if unavailable.
        if progress_callback:
            progress_callback(0.04, "Initialising SAM 3 tracking session...")
        sam3_tracker = SAM3TrackerWrapper(
            model_path=SAM3_MODEL_PATH,
            device=SAM3_DEVICE,
        )
        sam3_tracker.reset_session()
        logger.info("SAM 3 tracking session ready.")

    # ------------------------------------------------------------------
    # 2. Team colour calibration pass
    # ------------------------------------------------------------------
    logger.info("Running calibration pass for team division...")
    if progress_callback:
        progress_callback(0.05, "Analysing player jersey colours...")

    team_assigner = TeamAssigner()

    if use_cache:
        # Fit from cached bboxes
        max_players_frame_idx = 0
        max_players_count     = 0
        max_players_dets: Dict[int, Any] = {}

        for init_idx in range(min(30, total_frames)):
            if init_idx in cached_tracks:
                current_players: Dict[int, Any] = {}
                k = 0
                for det in cached_tracks[init_idx]:
                    if det["cls"] == 0:
                        current_players[k] = {"bbox": det["bbox"]}
                        k += 1
                if len(current_players) > max_players_count:
                    max_players_count     = len(current_players)
                    max_players_dets      = current_players
                    max_players_frame_idx = init_idx

        cap.set(cv2.CAP_PROP_POS_FRAMES, max_players_frame_idx)
        ok, calib_frame = cap.read()
        if ok and max_players_count > 0:
            logger.info(
                f"Fitting TeamAssigner from cache: {max_players_count} players "
                f"on frame {max_players_frame_idx}."
            )
            team_assigner.assign_team_colors(calib_frame, max_players_dets)
    else:
        # Read first ~30 frames using YOLO to find the best calibration frame
        init_idx           = 0
        max_players_frame  = None
        max_players_dets   = {}
        max_players_count  = 0

        while init_idx < min(30, total_frames):
            ok, frame = cap.read()
            if not ok:
                break
            results = model.predict(source=frame, classes=[0], conf=0.40, verbose=False)
            if results and results[0].boxes is not None:
                current_players = {
                    i: {"bbox": results[0].boxes[i].xyxy[0].cpu().numpy().tolist()}
                    for i in range(len(results[0].boxes))
                }
                if len(current_players) > max_players_count:
                    max_players_count = len(current_players)
                    max_players_dets  = current_players
                    max_players_frame = frame.copy()
            init_idx += 1

        if max_players_frame is not None and max_players_count > 0:
            logger.info(f"Fitting TeamAssigner with {max_players_count} players.")
            team_assigner.assign_team_colors(max_players_frame, max_players_dets)
        else:
            logger.warning("No players found in calibration pass — team classification fallback.")

    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # ------------------------------------------------------------------
    # 3. Main SAM 3 tracking pass
    # ------------------------------------------------------------------
    kalman_filters:         Dict[int, KalmanFilter2D]       = {}
    stat_trackers:          Dict[int, PlayerStatsTracker]   = {}
    raw_frame_detections:   Dict[int, List[Dict[str, Any]]] = {}
    raw_ball_detections:    Dict[int, List[List[float]]]    = {}
    track_appearance_samples: Dict[int, List[np.ndarray]]  = defaultdict(list)
    frame_masks:            Dict[int, Dict[int, np.ndarray]] = {}  # frame → {track_id → mask}

    frame_idx = 0
    new_tracks_to_cache: Dict[int, List[Dict[str, Any]]] = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        detections: List[Dict[str, Any]] = []

        if use_cache:
            detections = cached_tracks.get(frame_idx, [])
        else:
            # ── SAM 3 tracking path ──────────────────────────────────────
            # Step A: YOLO detects players and ball
            player_boxes = _yolo_detect_players(model, frame, TRACKER_IMGSZ)
            ball_boxes   = _yolo_detect_ball(model, frame, TRACKER_IMGSZ)

            # Step B: SAM 3 segments players (seeds on frame 0 + every reseed interval,
            #         propagates masks on all other frames)
            sam_results = sam3_tracker.process_frame(frame_idx, frame, player_boxes)

            # Step C: Pack into standard detection dicts
            for sr in sam_results:
                detections.append({
                    "bbox":      sr["bbox"],
                    "cls":       0,
                    "id":        sr["id"],
                    "mask_area": sr.get("mask_area", 0),
                })
                # Persist mask for the render pass
                if sr.get("mask") is not None:
                    frame_masks.setdefault(frame_idx, {})[sr["id"]] = sr["mask"]

            for bb in ball_boxes:
                detections.append({"bbox": bb, "cls": 32, "id": None, "mask_area": 0})

            new_tracks_to_cache[frame_idx] = detections

        # ── Per-detection stats accumulation ────────────────────────────
        frame_player_dets: List[Dict[str, Any]] = []
        frame_ball_dets:   List[List[float]]     = []

        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cls_id   = det["cls"]
            track_id = det["id"]

            if cls_id == 0 and track_id is not None:
                box_w = x2 - x1
                box_h = y2 - y1
                if box_w <= 0 or box_h <= 0:
                    continue
                if box_w > width * 0.50 or box_h > height * 0.85:
                    continue
                if box_w < 8 or box_h < 20:
                    continue
                if (box_h / box_w) < 1.1:
                    continue

                foot_x = (x1 + x2) / 2.0
                foot_y = y2
                rx, ry = pixel_to_meter(foot_x, foot_y, homography_matrix)

                y_boundary = max(280.0, 0.205 * foot_x + 110.0)
                if y2 < y_boundary:
                    continue

                if track_id not in kalman_filters:
                    kalman_filters[track_id] = KalmanFilter2D(rx, ry, dt=dt)
                    stat_trackers[track_id]  = PlayerStatsTracker(track_id, dt=dt)

                kf = kalman_filters[track_id]
                kf.predict()
                rx_s, ry_s = kf.update(rx, ry)

                stat_trackers[track_id].add_position(frame_idx, rx_s, ry_s)

                team_id = team_assigner.get_player_team(frame, [x1, y1, x2, y2], track_id)
                appearance = _extract_player_appearance(frame, [x1, y1, x2, y2])
                if appearance is not None and len(track_appearance_samples[track_id]) < 48:
                    track_appearance_samples[track_id].append(appearance)

                frame_player_dets.append({
                    "raw_id":    track_id,
                    "team":      team_id,
                    "bbox":      [x1, y1, x2, y2],
                    "real":      (rx_s, ry_s),
                    "speed":     stat_trackers[track_id].path[-1]["speed"],
                    "mask_area": det.get("mask_area", 0),
                })

            elif cls_id == 32:
                frame_ball_dets.append(det["bbox"])

        raw_frame_detections[frame_idx] = frame_player_dets
        raw_ball_detections[frame_idx]  = frame_ball_dets
        frame_idx += 1

        if progress_callback and total_frames > 0:
            pct = 0.10 + 0.60 * (frame_idx / total_frames)
            progress_callback(
                pct,
                f"SAM 3 tracking: frame {frame_idx}/{total_frames} "
                f"({int((frame_idx / total_frames) * 100)}%)"
            )

    cap.release()

    # Save versioned cache
    if not use_cache and new_tracks_to_cache:
        try:
            with open(cache_path, "wb") as f:
                pickle.dump({"version": TRACKING_CACHE_VERSION, "tracks": new_tracks_to_cache}, f)
            logger.info(
                f"Saved tracking cache (v{TRACKING_CACHE_VERSION}) — "
                f"{len(new_tracks_to_cache)} frames → {cache_path}"
            )
        except Exception as e:
            logger.warning(f"Failed to save tracking cache: {e}")

    # ------------------------------------------------------------------
    # 4. Offline tracklet stitching
    # ------------------------------------------------------------------
    if progress_callback:
        progress_callback(0.71, "Stitching fragmented player IDs into stable identities...")

    raw_id_to_canonical, canonical_to_team = stitch_fragments(
        stat_trackers=stat_trackers,
        team_dict=team_assigner.player_team_dict,
        appearance_samples=track_appearance_samples,
        fps=fps,
    )

    canonical_to_raw_ids: Dict[int, List[int]] = defaultdict(list)
    for raw_id, canonical in raw_id_to_canonical.items():
        canonical_to_raw_ids[canonical].append(raw_id)

    canonical_stat_trackers: Dict[int, PlayerStatsTracker] = {}
    for canonical, raw_ids in canonical_to_raw_ids.items():
        merged = PlayerStatsTracker(canonical, dt=dt)
        combined: List[Tuple[int, float, float]] = []
        for raw_id in raw_ids:
            for s in stat_trackers[raw_id].path:
                combined.append((s["frame"], s["x"], s["y"]))
        combined.sort(key=lambda t: t[0])
        for f, x, y in combined:
            merged.add_position(f, x, y)
        canonical_stat_trackers[canonical] = merged

    # ------------------------------------------------------------------
    # 5. Render annotated video (canonical IDs + SAM 3 mask overlays)
    # ------------------------------------------------------------------
    if progress_callback:
        progress_callback(0.72, "Rendering annotated video with SAM 3 overlays...")

    os.makedirs(os.path.dirname(output_video_path), exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_video_path, fourcc, fps, (width, height))

    cap = cv2.VideoCapture(video_path)
    frame_overlays: Dict[int, List[Dict[str, Any]]] = {}
    render_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        annotated = frame.copy()
        frame_record: List[Dict[str, Any]] = []

        for player in raw_frame_detections.get(render_idx, []):
            raw_id       = player["raw_id"]
            canonical_id = raw_id_to_canonical.get(raw_id)
            if canonical_id is None:
                continue

            x1, y1, x2, y2 = player["bbox"]
            team_id         = canonical_to_team.get(canonical_id, player["team"])
            team_color      = team_assigner.team_colors[team_id]
            rx_s, ry_s      = player["real"]
            speed           = player["speed"]
            mask_area       = player.get("mask_area", 0)

            # ── SAM 3 mask overlay — demo-quality render ─────────────────
            # Matches Meta's SAM 3 demo aesthetic:
            #   1. Translucent tinted fill over the player silhouette
            #   2. Bright glowing outline traced along the exact mask contour
            mask = frame_masks.get(render_idx, {}).get(raw_id)
            if mask is not None:
                b, g, r = team_color

                # 1) Translucent silhouette fill (30% opacity — lets background show)
                color_layer = annotated.copy()
                color_layer[mask] = (b, g, r)
                annotated = cv2.addWeighted(color_layer, 0.30, annotated, 0.70, 0)

                # 2) Glowing border — draw contours of the mask in bright near-white team colour
                mask_u8 = mask.astype(np.uint8) * 255
                contours, _ = cv2.findContours(
                    mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
                )
                if contours:
                    # Bright glow pass (wider, semi-transparent)
                    glow_color = (
                        min(255, int(b * 0.6 + 255 * 0.4)),
                        min(255, int(g * 0.6 + 255 * 0.4)),
                        min(255, int(r * 0.6 + 255 * 0.4)),
                    )
                    cv2.drawContours(annotated, contours, -1, glow_color, 5, lineType=cv2.LINE_AA)
                    # Crisp inner outline (exact silhouette edge)
                    cv2.drawContours(annotated, contours, -1, (255, 255, 255), 2, lineType=cv2.LINE_AA)

            # Bounding box (thin, no fill — mask is the main visual)
            cv2.rectangle(
                annotated,
                (int(x1), int(y1)), (int(x2), int(y2)),
                team_color, 1, lineType=cv2.LINE_AA
            )

            # Player ID tag
            tag  = f"P{canonical_id}"
            (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
            tag_x, tag_y = int(x1), int(y1) - th - 8
            # Drop-shadow for readability
            cv2.rectangle(
                annotated,
                (tag_x, tag_y),
                (tag_x + tw + 12, int(y1)),
                (0, 0, 0), -1
            )
            cv2.rectangle(
                annotated,
                (tag_x, tag_y),
                (tag_x + tw + 12, int(y1)),
                team_color, 1
            )
            cv2.putText(
                annotated, tag,
                (tag_x + 6, int(y1) - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA
            )

            frame_record.append({
                "id":        canonical_id,
                "team":      "A" if team_id == 1 else "B",
                "bbox":      [round(x1, 1), round(y1, 1), round(x2 - x1, 1), round(y2 - y1, 1)],
                "real":      [round(rx_s, 2), round(ry_s, 2)],
                "speed":     round(speed, 1),
                "mask_area": mask_area,
            })

        # Ball
        for ball_box in raw_ball_detections.get(render_idx, []):
            bx1, by1, bx2, by2 = ball_box
            bcx = int((bx1 + bx2) / 2)
            bcy = int((by1 + by2) / 2)
            cv2.circle(annotated, (bcx, bcy), 8,  (0, 255, 0), 2, lineType=cv2.LINE_AA)
            cv2.circle(annotated, (bcx, bcy), 2,  (0, 255, 0), -1, lineType=cv2.LINE_AA)

        frame_overlays[render_idx] = frame_record
        writer.write(annotated)
        render_idx += 1

        if progress_callback and total_frames > 0:
            pct = 0.72 + 0.28 * (render_idx / total_frames)
            progress_callback(pct, f"Rendering: frame {render_idx}/{total_frames}")

    cap.release()
    writer.release()

    # ------------------------------------------------------------------
    # 6. Finalise stats + write JSON
    # ------------------------------------------------------------------
    logger.info("Finalising player metrics...")
    players_summary = []
    for canonical_id, tracker in canonical_stat_trackers.items():
        summary = tracker.get_summary()
        team_id = canonical_to_team.get(canonical_id, 2)
        summary["team"] = "A" if team_id == 1 else "B"
        if len(summary["path"]) >= int(fps * 1.0):
            players_summary.append(summary)

    players_summary.sort(key=lambda p: (p["team"], p["id"]))

    team_a = sum(1 for p in players_summary if p["team"] == "A")
    team_b = sum(1 for p in players_summary if p["team"] == "B")
    logger.info(f"FINAL player count: Team A={team_a}, Team B={team_b}.")

    output_data = {
        "metadata": {
            "width":         width,
            "height":        height,
            "fps":           round(fps, 2),
            "duration":      round(total_frames / fps, 2) if fps > 0 else 0,
            "totalFrames":   total_frames,
            "trackingEngine": "sam3",
        },
        "players": players_summary,
        "frames":  frame_overlays,
    }

    os.makedirs(os.path.dirname(export_json_path), exist_ok=True)
    with open(export_json_path, "w") as f:
        json.dump(output_data, f, indent=2)

    logger.info(f"Pipeline complete. JSON → {export_json_path}")
    return output_data, output_video_path
