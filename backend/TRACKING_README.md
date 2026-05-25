# PitchTrack Player Tracking Pipeline

This document explains how the Python backend tracks players, rejects bad detections,
keeps IDs stable, calculates movement metrics, and exports data for the dashboard.

The main entry point is:

```text
backend/tracking/pipeline.py
```

It is called from:

```text
backend/main.py -> background_tracking_task() -> run_tracking_pipeline()
```

## High-Level Goal

For a 5v5 match, the system tries to:

1. Detect people and the ball in every frame.
2. Keep one stable ID per real player across the whole video.
3. Assign each player to Team A or Team B.
4. Convert player positions from pixels to pitch meters.
5. Calculate distance, speed, average speed, and top speed.
6. Export an annotated video plus `match.json` for the dashboard.

The hardest part is ID consistency. YOLO can detect a person in a frame, but it does
not know that the same person in frame 500 is the same person from frame 200. That job
is handled by BoT-SORT tracking, ReID appearance matching, and an offline tracklet
stitching pass.

## Important Files

```text
backend/tracking/pipeline.py          Main detection/tracking/export pipeline
backend/tracking/custom_botsort.yaml  BoT-SORT tracker settings
backend/tracking/track_merger.py      Offline ID stitching / fragment merging
backend/tracking/team_assigner.py     Team A / Team B classification
backend/tracking/distance.py          Distance and speed metrics
backend/tracking/smoothing.py         Kalman smoothing for pitch coordinates
backend/tracking/homography.py        Pixel-to-meter coordinate transform
backend/camera_calibration.json       Saved camera calibration / homography
backend/exports/tracking_cache.pkl    Cached YOLO + tracker detections
backend/exports/match.json            Final dashboard analytics
backend/static/output_video.mp4       Annotated video output
```

## Current Tracking Settings

The current pipeline uses:

```text
Detector model: yolov8m.pt
Tracker: BoT-SORT
ReID: enabled
Tracker image size: 1280px
YOLO confidence threshold: 0.20
Cache version: 6
```

The tracker config lives in `backend/tracking/custom_botsort.yaml`:

```yaml
tracker_type: botsort
track_high_thresh: 0.35
track_low_thresh: 0.08
new_track_thresh: 0.55
track_buffer: 600
match_thresh: 0.90
fuse_score: True

gmc_method: sparseOptFlow

with_reid: True
model: auto
proximity_thresh: 0.35
appearance_thresh: 0.20
```

What those mean:

- `track_high_thresh`: confidence needed for strong first-stage matches.
- `track_low_thresh`: lower threshold used to recover weak or occluded detections.
- `new_track_thresh`: confidence needed before BoT-SORT creates a brand new ID.
- `track_buffer`: how long a lost track is kept alive. `600` frames is about 20 seconds at 30fps.
- `match_thresh`: association tolerance. Higher is more forgiving before creating a new ID.
- `gmc_method`: global motion compensation, important when the camera moves.
- `with_reid`: enables appearance matching, so a player can recover their old ID after occlusion.
- `model: auto`: uses Ultralytics' built-in ReID feature extraction path.

## Pipeline Overview

The backend does two passes over the video.

### Pass 1: Track and collect raw data

For every frame:

1. Run YOLO + BoT-SORT.
2. Keep people (`class 0`) and ball (`class 32`).
3. Reject obvious false player boxes.
4. Convert the player's foot point from pixels to meters.
5. Smooth the meter coordinate with a Kalman filter.
6. Add the position to that raw track's stats.
7. Classify the team.
8. Save a small visual appearance signature for that raw track.
9. Store raw frame detections.

No annotated video is written during this pass. The reason is important: raw tracker
IDs are not the final player IDs yet. We first need to run the offline stitcher.

### Offline ID stitching

After pass 1, `track_merger.py` receives all raw tracks. It tries to merge short
track fragments that likely belong to the same real player.

Example:

```text
Raw ID 2: frames 0-260
Raw ID 4: frames 310-700

If they are same team, physically reachable, and visually similar:
Raw ID 2 + Raw ID 4 -> Canonical Player P2
```

This is how we try to solve the common problem:

```text
Player runs as P2, disappears for a few seconds, then comes back as raw ID 4.
Dashboard should still show one player, not two duplicated thumbnails.
```

### Pass 2: Render final output

After stitching, the video is read again. This time the pipeline draws the canonical
player IDs, not the raw BoT-SORT IDs.

It writes:

```text
backend/static/output_video.mp4
backend/exports/match.json
```

The dashboard uses `match.json` for player cards, thumbnails, pitch map, and metrics.

## Detection and Tracking Details

### YOLO detection

The detector is loaded in `pipeline.py`:

```python
model = YOLO("yolov8m.pt")
```

The tracking call is:

```python
model.track(
    source=frame,
    persist=True,
    tracker=custom_botsort.yaml,
    classes=[0, 32],
    conf=0.20,
    iou=0.60,
    imgsz=1280,
)
```

Class IDs:

```text
0  = person
32 = sports ball
```

Right now, because this is the default COCO model, every player, referee, coach, or
sideline person can appear as `person`. The backend then filters and classifies them.

For a future soccer-specific model, this could become:

```text
player
goalkeeper
referee
ball
```

That would make filtering cleaner.

### Why `persist=True` matters

`persist=True` tells Ultralytics that each call is the next frame in the same video.
Without this, the tracker would reset every frame and stable IDs would be impossible.

## False Detection Filtering

After YOLO returns tracked boxes, the pipeline applies several filters before a person
becomes a player in our analytics.

### 1. Bad box dimensions

```python
if box_w <= 0 or box_h <= 0:
    continue
```

Rejects invalid boxes.

### 2. Huge full-screen boxes

```python
if box_w > width * 0.50 or box_h > height * 0.85:
    continue
```

Rejects strange detections where YOLO thinks half the screen is one person.

### 3. Tiny detections

```python
if box_w < 8 or box_h < 20:
    continue
```

Rejects tiny distant dots that are usually noise.

### 4. Aspect ratio sanity

```python
if (box_h / box_w) < 1.1:
    continue
```

A standing/running player should usually be taller than wide. Horizontal boxes often
come from partial bodies, shadows, or non-player noise.

### 5. Pitch boundary filter

```python
y_boundary = max(280.0, 0.205 * foot_x + 110.0)
if y2 < y_boundary:
    continue
```

This removes people above a slanted boundary line, usually from neighboring fields,
sidelines, or background areas.

This filter is camera-specific. If valid players are being dropped, this is one of
the first places to inspect.

## Foot Point and Homography

For each accepted player box:

```python
foot_x = (x1 + x2) / 2.0
foot_y = y2
```

We use the bottom-center of the bounding box as the player's foot position.

Then:

```python
rx, ry = pixel_to_meter(foot_x, foot_y, homography_matrix)
```

The homography matrix maps video pixels into pitch coordinates in meters. This is why
the dashboard can show:

```text
real: [x_meters, y_meters]
distance: meters covered
speed: km/h
```

The homography comes from:

```text
backend/camera_calibration.json
```

If no custom calibration is found, `main.py` falls back to `DEFAULT_HOMOGRAPHY`.

## Kalman Smoothing

Raw detections jump around frame-to-frame. The pipeline smooths each player's pitch
position with `KalmanFilter2D`.

The filter state is:

```text
[x, y, vx, vy]
```

Each frame:

```python
kf.predict()
rx_smooth, ry_smooth = kf.update(rx, ry)
```

The smoothed coordinate is used for path, distance, and speed.

## Team Assignment

The current team logic is in `team_assigner.py`.

It assumes:

```text
Team A = fluorescent yellow/green vest
Team B = everyone else
```

The code crops the player's upper body:

```python
shirt_crop = player_crop[0:top_half_height, left_pad:right_pad]
```

Then it checks two color rules:

1. BGR channel ratios: high green and red compared to blue.
2. HSV range: hue 25-45, saturation >= 80, value >= 120.

If at least 5 percent of the shirt crop matches, the player is considered Team A.

The team is not decided from one frame only. Every raw track gets votes:

```python
self.player_votes[player_id].append(pred)
```

The current team is the majority vote for that raw ID.

After offline stitching, team assignment is re-aggregated at the canonical player ID
level.

## Appearance Signatures for ID Stitching

BoT-SORT already has ReID, but we also save a cheap appearance signature per raw track.

In `pipeline.py`, for each accepted player crop:

1. Crop the player box.
2. Focus on the central upper body.
3. Convert to HSV.
4. Build a normalized HSV histogram.
5. Store up to 48 samples per raw track.

This function does it:

```python
_extract_player_appearance(frame, bbox)
```

The stitcher uses the mean appearance signature for each raw track. If two tracklets
are physically plausible and visually similar, they are more likely to merge into one
canonical player.

This helps with:

```text
Raw P2 disappears.
Same real player returns as raw P4.
Stitcher sees similar shirt/shorts colors and merges them.
```

## Offline Tracklet Stitching

The online tracker can fragment one real player into multiple raw IDs. This happens
when:

- Players overlap.
- A player leaves and re-enters the frame.
- The camera pans.
- The detector misses a person for several frames.
- BoT-SORT decides the old track is too uncertain.

`track_merger.py` tries to repair this after the full video is processed.

For each raw track, it builds a fragment with:

```text
raw_id
team
first_frame / last_frame
first_xy / last_xy
approximate velocity
number of observations
appearance vector
```

Two fragments can merge if:

1. They are on the same team.
2. They do not overlap in time beyond a tiny tolerance.
3. The later fragment starts close enough to where the earlier player could physically be.
4. The implied speed is realistic.
5. If appearance is available, the appearance similarity is high enough.

The key constants are:

```python
MAX_SUSTAINED_SPEED_MPS = 10.0
MIN_TRACK_DURATION_S = 0.7
MAX_TIME_OVERLAP_FRAMES = 5
MAX_TIME_GAP_S = 15.0
APPEARANCE_MERGE_SIM = 0.78
APPEARANCE_STRONG_SIM = 0.88
```

The stitcher outputs:

```text
raw_id_to_canonical
canonical_to_team
```

Example:

```text
Raw IDs:     2, 4, 9, 12
Canonical:  2 -> P1
            4 -> P1
            9 -> P2
            12 -> P3
```

The dashboard only sees canonical IDs.

## Distance and Speed Calculation

`PlayerStatsTracker` stores a path:

```json
{
  "frame": 123,
  "x": 12.34,
  "y": 5.67,
  "speed": 8.9
}
```

For each new smoothed coordinate:

1. Calculate distance from previous coordinate.
2. Ignore tiny jitter below `0.05m`.
3. Convert movement to speed in km/h.
4. Smooth speed using a small buffer.
5. Update total distance, average speed, and top speed.

The tracker is gap-aware. If a player is unobserved for a while and then reappears,
that bridge is treated as an occlusion, not as real movement.

Important constants:

```python
MAX_PLAUSIBLE_STEP_SPEED_MPS = 10.0
MAX_CONTIGUOUS_FRAME_GAP = 6
```

This prevents distance from exploding when a stitched track jumps across an occlusion.

## Cache

Tracking is expensive, so detections are cached at:

```text
backend/exports/tracking_cache.pkl
```

The cache contains:

```python
{
    "version": TRACKING_CACHE_VERSION,
    "tracks": new_tracks_to_cache
}
```

Current version:

```python
TRACKING_CACHE_VERSION = 6
```

When major tracking behavior changes, bump the cache version. Otherwise the backend
may reuse old tracker output and you will not see your new logic.

To manually clear the cache:

```powershell
Remove-Item .\backend\exports\tracking_cache.pkl -ErrorAction SilentlyContinue
```

## Output JSON

The final result is written to:

```text
backend/exports/match.json
```

Shape:

```json
{
  "metadata": {
    "width": 1920,
    "height": 1080,
    "fps": 30.0,
    "duration": 60.0,
    "totalFrames": 1800
  },
  "players": [
    {
      "id": 1,
      "team": "A",
      "distance": 123.4,
      "avgSpeed": 5.6,
      "topSpeed": 18.2,
      "path": []
    }
  ],
  "frames": {
    "0": [
      {
        "id": 1,
        "team": "A",
        "bbox": [x, y, w, h],
        "real": [rx, ry],
        "speed": 4.2
      }
    ]
  }
}
```

The frontend uses:

- `players` for the roster, thumbnails, and summary stats.
- `frames` for live bounding boxes and frame-by-frame pitch map positions.
- `metadata` to sync video time to frame number.

## Annotated Video

The final annotated video is written to:

```text
backend/static/output_video.mp4
```

The backend draws:

- Team-colored bounding boxes.
- `P{id}` labels.
- Ball marker.

The UI can also overlay its own interactive bounding boxes from `match.json`.

## Known Limitations

### 1. Generic COCO person detector

`yolov8m.pt` only knows `person`, not:

```text
player
goalkeeper
referee
coach
spectator
```

That means the backend must guess who is an actual player using geometry and color.
A football-specific model would improve this.

### 2. Similar uniforms

If two players wear very similar colors, appearance-based stitching can confuse them.
This is why the stitcher still requires team and physical motion checks.

### 3. Camera-specific pitch boundary

The slanted boundary filter is tuned for the current camera. A new camera angle may
need a new boundary or a polygon-based pitch mask.

### 4. Occlusions

When players fully overlap, any tracker can switch or lose IDs. ReID, track buffer,
appearance stitching, and smoothing reduce the problem, but do not make it impossible.

### 5. No hard 10-player cap

The system does not force exactly 10 players. It prefers to keep real long-lived tracks
instead of silently deleting possible players. If refs or sidelines appear as players,
the better fix is a soccer-specific detector or a pitch-zone filter.

## Tuning Checklist

If too many players are missing:

1. Lower `conf` in `pipeline.py`.
2. Lower `new_track_thresh` in `custom_botsort.yaml`.
3. Check the pitch boundary filter.
4. Check aspect ratio filter.
5. Try a soccer-specific detector.

If too many duplicate IDs appear:

1. Increase `track_buffer`.
2. Increase `match_thresh`.
3. Make ReID more tolerant with `proximity_thresh` / `appearance_thresh`.
4. Improve appearance stitching thresholds in `track_merger.py`.
5. Fine-tune a soccer detector so the tracker gets cleaner boxes.

If distance or speed looks wrong:

1. Verify camera calibration.
2. Check `camera_calibration.json`.
3. Confirm frame rate is read correctly.
4. Check if many occlusion bridges are being stitched.

## Running the Backend

From the backend folder:

```powershell
cd C:\Users\atoya\Desktop\pitchtrack\backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```text
http://localhost:8000/api/health
```

API docs:

```text
http://localhost:8000/docs
```

## Processing Flow from the UI

1. Upload video through the frontend.
2. Backend saves it as:

   ```text
   backend/uploads/uploaded_match.mp4
   ```

3. Calibrate camera or use existing calibration.
4. Click process.
5. Backend runs `run_tracking_pipeline()`.
6. Results are saved to `match.json` and `output_video.mp4`.
7. Frontend loads `/api/results` and shows the dashboard.

## Best Future Upgrade

The biggest future improvement is replacing COCO `person` detection with a football
model trained on:

```text
player
goalkeeper
referee
ball
```

That would reduce false players, improve ball tracking, and make team/stat logic
cleaner. The current pipeline is designed so this can be added later without throwing
away homography, stats, cache, or dashboard code.
