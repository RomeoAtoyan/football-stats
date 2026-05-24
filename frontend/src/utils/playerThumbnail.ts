import type { MatchResults, PlayerSummary } from '../store/pitchtrackStore';

export interface PlayerSnapshot {
  frame: number;
  bbox: [number, number, number, number];
}

/** Pick the frame where this player has the largest on-screen bbox (clearest thumbnail). */
export function findBestPlayerSnapshot(
  playerId: number,
  frames: MatchResults['frames']
): PlayerSnapshot | null {
  let best: PlayerSnapshot | null = null;
  let bestArea = 0;

  for (const [frameKey, detections] of Object.entries(frames)) {
    const det = detections.find((d) => d.id === playerId);
    if (!det) continue;

    const [, , w, h] = det.bbox;
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { frame: Number(frameKey), bbox: det.bbox };
    }
  }

  return best;
}

function waitForVideoSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video seek timed out'));
    }, 8000);

    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Video seek failed'));
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
  });
}

/** Crop a player patch from the match video at a specific frame. */
export async function capturePlayerThumbnail(
  video: HTMLVideoElement,
  snapshot: PlayerSnapshot,
  fps: number,
  outWidth = 112,
  outHeight = 140
): Promise<string> {
  const targetTime = Math.max(0, snapshot.frame / fps);
  if (Math.abs(video.currentTime - targetTime) > 0.02) {
    video.currentTime = targetTime;
    await waitForVideoSeek(video);
  }

  const [bx, by, bw, bh] = snapshot.bbox;
  const padX = bw * 0.12;
  const padY = bh * 0.08;

  let sx = Math.max(0, bx - padX);
  let sy = Math.max(0, by - padY);
  let sw = Math.min(video.videoWidth - sx, bw + padX * 2);
  let sh = Math.min(video.videoHeight - sy, bh + padY * 2);

  if (sw < 8 || sh < 12) {
    throw new Error('Bbox too small for thumbnail');
  }

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

  return canvas.toDataURL('image/jpeg', 0.88);
}

export function buildSnapshotMap(
  players: PlayerSummary[],
  frames: MatchResults['frames']
): Map<number, PlayerSnapshot> {
  const map = new Map<number, PlayerSnapshot>();
  for (const player of players) {
    const snap = findBestPlayerSnapshot(player.id, frames);
    if (snap) map.set(player.id, snap);
  }
  return map;
}
