import { useEffect, useState } from 'react';
import type { MatchResults } from '../store/pitchtrackStore';
import {
  buildSnapshotMap,
  capturePlayerThumbnail,
  type PlayerSnapshot,
} from '../utils/playerThumbnail';

const VIDEO_SRC = 'http://localhost:8000/uploads/uploaded_match.mp4';

/**
 * Lazily generates JPEG thumbnails for each tracked player by cropping
 * their largest bbox appearance from the source match video.
 */
export function usePlayerThumbnails(results: MatchResults | null) {
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!results || results.players.length === 0) {
      setThumbnails({});
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const snapshots = buildSnapshotMap(results.players, results.frames);

    const generate = async () => {
      setLoading(true);
      setError(null);

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = VIDEO_SRC;

      try {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error('Could not load match video for thumbnails'));
        });

        const next: Record<number, string> = {};
        const ordered = [...results.players].sort((a, b) => a.id - b.id);

        for (const player of ordered) {
          if (cancelled) break;
          const snap: PlayerSnapshot | undefined = snapshots.get(player.id);
          if (!snap) continue;
          try {
            next[player.id] = await capturePlayerThumbnail(
              video,
              snap,
              results.metadata.fps
            );
            if (!cancelled) {
              setThumbnails((prev) => ({ ...prev, [player.id]: next[player.id] }));
            }
          } catch {
            // Skip players we can't crop (rare edge bbox)
          }
        }

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Thumbnail generation failed');
          setLoading(false);
        }
      } finally {
        video.removeAttribute('src');
        video.load();
      }
    };

    generate();

    return () => {
      cancelled = true;
    };
  }, [results]);

  return { thumbnails, loading, error };
}
