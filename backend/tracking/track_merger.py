"""
Offline tracklet stitching / fragment merger.

Inspired by GTA-Link (STC-2025 Soccer MOT) and the DBSCAN-based tracklet
association annealer literature, adapted for the constrained 5v5 small-sided
football case where we have strong physical priors:

  - Two teams with KNOWN visual signatures (purple-fluo vs aqua).
  - Maximum ~5 players per team active at any moment.
  - Players obey a hard speed bound: nobody runs faster than ~10 m/s sustained.

The online BoT-SORT tracker (even with ReID) inevitably fragments a single
real player into multiple tracklets across long occlusions, camera pans away
from the action, and bench/sideline crossings. This module runs AFTER the
online pass and stitches those fragments back into one stable ID per player
using three signals only — temporal disjointness, spatial reachability, and
team consensus — no extra ReID model required.

Output: a dict mapping raw_track_id -> canonical_player_id (1..N).
"""
from __future__ import annotations

import math
from typing import Dict, List, Tuple, Any
from collections import defaultdict
import numpy as np
from loguru import logger


# ----- Physical bounds for a small-sided football player -----------------
MAX_SUSTAINED_SPEED_MPS = 10.0   # 36 km/h — generous bound on max human sprint speed
MIN_TRACK_DURATION_S = 0.7       # Tracks shorter than this are treated as noise candidates
MAX_TIME_OVERLAP_FRAMES = 5      # Allow tiny overlap (~0.17s @ 30fps) to be robust to flicker

# Greedy merge limits
MAX_FRAGMENTS_PER_PLAYER = 25    # Safety cap — if a cluster grows beyond this, refuse to extend
MAX_TIME_GAP_S = 15.0            # Short camera pans/occlusions can easily exceed 8 seconds.
APPEARANCE_MERGE_SIM = 0.78      # HSV histogram cosine similarity for same-person candidates.
APPEARANCE_STRONG_SIM = 0.88     # Strong visual match can tolerate rougher homography motion.


class _Fragment:
    """A single raw track summarized by the stats it gives us for merging."""
    __slots__ = ("raw_id", "team", "first_frame", "last_frame", "first_xy", "last_xy",
                 "last_vel", "duration_frames", "num_observations", "appearance")

    def __init__(self, raw_id: int, team: int, path: List[Dict[str, Any]],
                 appearance: np.ndarray | None = None):
        self.raw_id = raw_id
        self.team = team
        self.appearance = appearance
        self.num_observations = len(path)
        self.first_frame = path[0]["frame"]
        self.last_frame = path[-1]["frame"]
        self.duration_frames = self.last_frame - self.first_frame + 1
        self.first_xy = (float(path[0]["x"]), float(path[0]["y"]))
        self.last_xy = (float(path[-1]["x"]), float(path[-1]["y"]))

        # Approximate exit velocity from last 5 samples (m/s in pitch space)
        tail = path[-min(5, len(path)) :]
        if len(tail) >= 2:
            dx = float(tail[-1]["x"]) - float(tail[0]["x"])
            dy = float(tail[-1]["y"]) - float(tail[0]["y"])
            frames_span = max(1, tail[-1]["frame"] - tail[0]["frame"])
            self.last_vel = (dx / frames_span, dy / frames_span)  # meters per frame
        else:
            self.last_vel = (0.0, 0.0)


def _appearance_mean(samples: List[np.ndarray]) -> np.ndarray | None:
    if not samples:
        return None
    feature = np.mean(np.stack(samples, axis=0), axis=0).astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm <= 1e-6:
        return None
    return feature / norm


def _appearance_similarity(a: _Fragment, b: _Fragment) -> float | None:
    if a.appearance is None or b.appearance is None:
        return None
    return float(np.dot(a.appearance, b.appearance))


def _build_fragments(stat_trackers: Dict[int, Any], team_dict: Dict[int, int],
                     fps: float,
                     appearance_samples: Dict[int, List[np.ndarray]] | None = None) -> List[_Fragment]:
    """Build the list of fragments from raw stat trackers, dropping ultra-short noise."""
    min_frames = max(1, int(MIN_TRACK_DURATION_S * fps))
    fragments: List[_Fragment] = []
    for raw_id, tracker in stat_trackers.items():
        path = tracker.path
        if not path or len(path) < min_frames:
            continue
        team = team_dict.get(raw_id, 2)
        appearance = _appearance_mean(appearance_samples.get(raw_id, [])) if appearance_samples else None
        fragments.append(_Fragment(raw_id, team, path, appearance))
    return fragments


def _merge_cost(a: _Fragment, b: _Fragment, fps: float) -> float:
    """
    Return the cost of stitching fragment a -> b (a must end before/around when b starts).

    Returns +inf for any merge that violates physics, team, or time constraints.
    """
    # Teams must agree (purple+fluo cannot turn into aqua mid-game)
    if a.team != b.team:
        return math.inf

    # Order: a must end before b begins (allow tiny overlap from flicker)
    time_gap_frames = b.first_frame - a.last_frame
    if time_gap_frames < -MAX_TIME_OVERLAP_FRAMES:
        return math.inf
    if time_gap_frames > MAX_TIME_GAP_S * fps:
        return math.inf

    # Time gap in seconds, clamped to at least 1 frame to avoid divide-by-zero
    time_gap_s = max(time_gap_frames, 1) / fps

    # Predict where a's player would be at b's start using its exit velocity
    bridge_frames = max(1, time_gap_frames)
    predicted_x = a.last_xy[0] + a.last_vel[0] * bridge_frames
    predicted_y = a.last_xy[1] + a.last_vel[1] * bridge_frames

    actual_x, actual_y = b.first_xy
    predicted_error = math.hypot(predicted_x - actual_x, predicted_y - actual_y)
    raw_gap_distance = math.hypot(actual_x - a.last_xy[0], actual_y - a.last_xy[1])
    appearance_sim = _appearance_similarity(a, b)

    # Implied average speed if a and b were the same player
    implied_speed = raw_gap_distance / time_gap_s
    max_speed = MAX_SUSTAINED_SPEED_MPS * (1.35 if appearance_sim and appearance_sim >= APPEARANCE_STRONG_SIM else 1.0)
    if implied_speed > max_speed:
        return math.inf

    # Cost: weighted sum favoring small motion-predicted error and short gaps.
    # 1 m position error ~= 1 second gap ~= 1 m/s implied speed in units.
    cost = predicted_error + 0.5 * time_gap_s + 0.3 * implied_speed
    if appearance_sim is not None:
        if appearance_sim < APPEARANCE_MERGE_SIM:
            return math.inf
        # Same-looking tracklets should be preferred, but still need plausible motion.
        cost -= 5.0 * (appearance_sim - APPEARANCE_MERGE_SIM)
    return cost


def _cluster_is_valid(fragments: List[_Fragment], fps: float) -> bool:
    """
    A cluster of fragments is valid as 'the same player' only if:
      1. No two fragments overlap in time (beyond the tiny flicker allowance).
      2. Every consecutive temporal bridge respects the max sustained speed bound.

    This is the critical guard that prevents the greedy union-find from collapsing
    DISTINCT players into the same cluster just because individual pairs of
    fragments happen to look compatible.
    """
    if len(fragments) <= 1:
        return True
    ordered = sorted(fragments, key=lambda f: f.first_frame)
    for i in range(len(ordered) - 1):
        f_prev, f_next = ordered[i], ordered[i + 1]
        # 1) Temporal disjointness
        if f_prev.last_frame > f_next.first_frame + MAX_TIME_OVERLAP_FRAMES:
            return False
        # 2) Physical reachability of the bridge
        time_gap_frames = max(f_next.first_frame - f_prev.last_frame, 1)
        time_gap_s = time_gap_frames / fps
        gap_distance = math.hypot(
            f_next.first_xy[0] - f_prev.last_xy[0],
            f_next.first_xy[1] - f_prev.last_xy[1],
        )
        if gap_distance / time_gap_s > MAX_SUSTAINED_SPEED_MPS:
            return False
    return True


class _UnionFind:
    def __init__(self, items):
        self.parent = {x: x for x in items}
        self.size = {x: 1 for x in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]
        return True


def stitch_fragments(stat_trackers: Dict[int, Any], team_dict: Dict[int, int],
                     fps: float,
                     appearance_samples: Dict[int, List[np.ndarray]] | None = None) -> Tuple[Dict[int, int], Dict[int, int]]:
    """
    Run greedy lowest-cost union-find stitching across fragments.

    Args:
        stat_trackers: raw_track_id -> PlayerStatsTracker
        team_dict: raw_track_id -> team_id (1=A purple, 2=B aqua)
        fps: video framerate

    Returns:
        (raw_id_to_canonical, canonical_to_team)
        canonical IDs are assigned 1..N, ordered by total active frames descending.
    """
    fragments = _build_fragments(stat_trackers, team_dict, fps, appearance_samples)
    if not fragments:
        return {}, {}

    logger.info(f"Tracklet stitcher: {len(fragments)} fragments survive the noise filter "
                f"(Team A={sum(1 for f in fragments if f.team == 1)}, "
                f"Team B={sum(1 for f in fragments if f.team == 2)}).")

    # Enumerate all candidate merge pairs with finite cost, sorted ascending
    candidate_pairs: List[Tuple[float, int, int]] = []
    for i, frag_a in enumerate(fragments):
        for j, frag_b in enumerate(fragments):
            if i == j:
                continue
            # Only forward in time: a ends, then b begins
            if frag_a.last_frame > frag_b.first_frame + MAX_TIME_OVERLAP_FRAMES:
                continue
            cost = _merge_cost(frag_a, frag_b, fps)
            if math.isfinite(cost):
                candidate_pairs.append((cost, frag_a.raw_id, frag_b.raw_id))
    candidate_pairs.sort(key=lambda t: t[0])

    # Greedy union-find merging, with CLUSTER-LEVEL validity checks
    uf = _UnionFind([f.raw_id for f in fragments])
    fragments_by_id: Dict[int, _Fragment] = {f.raw_id: f for f in fragments}
    cluster_members: Dict[int, List[int]] = {f.raw_id: [f.raw_id] for f in fragments}
    cluster_total_observations: Dict[int, int] = {f.raw_id: f.num_observations for f in fragments}

    merges_applied = 0
    for cost, raw_a, raw_b in candidate_pairs:
        root_a = uf.find(raw_a)
        root_b = uf.find(raw_b)
        if root_a == root_b:
            continue
        combined_member_ids = cluster_members[root_a] + cluster_members[root_b]
        if len(combined_member_ids) > MAX_FRAGMENTS_PER_PLAYER:
            continue
        # CRITICAL: verify the COMBINED cluster is physically consistent
        # (no time overlap among any two members, no implausible spatial bridges).
        # This is what prevents two distinct real players from being collapsed
        # together just because individual pairwise costs looked plausible.
        combined_fragments = [fragments_by_id[mid] for mid in combined_member_ids]
        if not _cluster_is_valid(combined_fragments, fps):
            continue
        if uf.union(raw_a, raw_b):
            root_merged = uf.find(raw_a)
            cluster_members[root_merged] = combined_member_ids
            cluster_total_observations[root_merged] = (
                cluster_total_observations[root_a] + cluster_total_observations[root_b]
            )
            merges_applied += 1

    # Build canonical numbering — sort clusters by total observations DESC so that
    # the most prolific (likely the real players) get the lowest canonical IDs
    cluster_roots = list({uf.find(f.raw_id) for f in fragments})
    cluster_roots.sort(key=lambda root: -cluster_total_observations[root])

    canonical_id_for_root: Dict[int, int] = {root: idx + 1 for idx, root in enumerate(cluster_roots)}

    # Re-vote team using all fragments in the cluster (proportional to fragment size)
    cluster_team_votes: Dict[int, Dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for frag in fragments:
        root = uf.find(frag.raw_id)
        cluster_team_votes[root][frag.team] += frag.num_observations

    canonical_to_team: Dict[int, int] = {}
    raw_id_to_canonical: Dict[int, int] = {}

    for frag in fragments:
        root = uf.find(frag.raw_id)
        canonical = canonical_id_for_root[root]
        raw_id_to_canonical[frag.raw_id] = canonical

    for root, canonical in canonical_id_for_root.items():
        team_votes = cluster_team_votes[root]
        # Majority team weighted by observation count
        canonical_to_team[canonical] = max(team_votes.items(), key=lambda kv: kv[1])[0]

    team_a_canonical = sum(1 for t in canonical_to_team.values() if t == 1)
    team_b_canonical = sum(1 for t in canonical_to_team.values() if t == 2)
    logger.info(f"Tracklet stitcher: {merges_applied} merges -> "
                f"{len(canonical_id_for_root)} canonical player IDs "
                f"(Team A={team_a_canonical}, Team B={team_b_canonical}).")

    return raw_id_to_canonical, canonical_to_team
