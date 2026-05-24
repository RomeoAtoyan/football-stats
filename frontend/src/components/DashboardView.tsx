import React, { useEffect, useRef, useState } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { usePlayerThumbnails } from '../hooks/usePlayerThumbnails';
import { PlayerRosterCard } from './PlayerRosterCard';
import {
  Play,
  Download,
  User,
  Activity,
  Layers,
  RefreshCw,
  Eye,
  EyeOff,
  Grid,
  Users,
  Timer,
  Film,
} from 'lucide-react';

const pitchSegments = [
  // Outer boundary outline
  { rx1: 0, ry1: 0, rx2: 30, ry2: 0 },
  { rx1: 0, ry1: 16, rx2: 30, ry2: 16 },
  { rx1: 0, ry1: 0, rx2: 0, ry2: 16 },
  { rx1: 30, ry1: 0, rx2: 30, ry2: 16 },

  // Left Goal posts
  { rx1: 0, ry1: 6.5, rx2: 0, ry2: 9.5 },
  // Right Goal posts
  { rx1: 30, ry1: 6.5, rx2: 30, ry2: 9.5 }
];

// Helper to compute inverse of a 3x3 matrix in plain JS
const invert3x3 = (m: number[][]): number[][] | null => {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1.0 / det;
  return [
    [
      (e * i - f * h) * invDet,
      (c * h - b * i) * invDet,
      (b * f - c * e) * invDet
    ],
    [
      (f * g - d * i) * invDet,
      (a * i - c * g) * invDet,
      (c * d - a * f) * invDet
    ],
    [
      (d * h - e * g) * invDet,
      (b * g - a * h) * invDet,
      (a * e - b * d) * invDet
    ]
  ];
};

// Project point using inverse homography
const projectPoint = (rx: number, ry: number, H_inv: number[][]): [number, number] | null => {
  const x = H_inv[0][0] * rx + H_inv[0][1] * ry + H_inv[0][2];
  const y = H_inv[1][0] * rx + H_inv[1][1] * ry + H_inv[1][2];
  const w = H_inv[2][0] * rx + H_inv[2][1] * ry + H_inv[2][2];
  if (Math.abs(w) < 1e-12) return null;
  return [x / w, y / w];
};

export const DashboardView: React.FC = () => {
  const { results, selectedPlayerId, setSelectedPlayerId, resetAll } = usePitchTrackStore();
  const { thumbnails, loading: thumbsLoading } = usePlayerThumbnails(results);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showTeamA, setShowTeamA] = useState(true);
  const [showTeamB, setShowTeamB] = useState(true);

  // Overlays states
  const [showGridOverlay, setShowGridOverlay] = useState(false);
  const [showPlayerBoxes, setShowPlayerBoxes] = useState(true);
  const [currentHomography, setCurrentHomography] = useState<number[][] | null>(null);

  // High-Performance 60fps requestAnimationFrame player sync refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationFrameId = useRef<number | null>(null);

  // Fetch active homography on mount
  useEffect(() => {
    const fetchCalibration = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/calibration');
        if (response.ok) {
          const data = await response.json();
          if (data.homography) {
            setCurrentHomography(data.homography);
          }
        }
      } catch (err) {
        console.error('Failed to fetch calibration for dashboard grid overlay:', err);
      }
    };
    fetchCalibration();
  }, []);

  const startPlaybackLoop = () => {
    if (!results) return;
    const fps = results.metadata.fps;
    const loop = () => {
      if (!videoRef.current) return;
      const video = videoRef.current;
      const frame = Math.round(video.currentTime * fps);
      setCurrentFrame(frame);

      if (!video.paused && !video.ended) {
        animationFrameId.current = requestAnimationFrame(loop);
      }
    };
    animationFrameId.current = requestAnimationFrame(loop);
  };

  const stopPlaybackLoop = () => {
    if (animationFrameId.current !== null) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
  };

  // Cleanup loop on unmount
  useEffect(() => {
    return () => stopPlaybackLoop();
  }, []);
  
  if (!results) return null;

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    // Backup sync for seek actions
    const video = e.currentTarget;
    const frame = Math.round(video.currentTime * results.metadata.fps);
    setCurrentFrame(frame);
  };

  // Segment players into Team A (Purple) and Team B (Aqua)
  const teamAPlayers = results.players.filter(p => p.team === 'A');
  const teamBPlayers = results.players.filter(p => p.team === 'B');

  const selectedPlayer = results.players.find(p => p.id === selectedPlayerId);
  const H_inv = currentHomography ? invert3x3(currentHomography) : null;

  // Manually approximate curved D-penalty areas for the warped vector overlay
  const getLeftPenaltyAreaPoints = (H_matrix: number[][]) => {
    if (!results) return '';
    const points: [number, number][] = [];
    const r = 5.0; // 5.0m arc radius
    // Top quarter-arc centered at top post (0, 6.5)
    for (let i = 0; i <= 12; i++) {
      const theta = -Math.PI / 2 + (i / 12) * (Math.PI / 2);
      const rx = r * Math.cos(theta);
      const ry = 6.5 + r * Math.sin(theta);
      const projected = projectPoint(rx, ry, H_matrix);
      if (projected) {
        points.push([
          (projected[0] / results.metadata.width) * 100,
          (projected[1] / results.metadata.height) * 100
        ]);
      }
    }
    // Bottom quarter-arc centered at bottom post (0, 9.5)
    for (let i = 0; i <= 12; i++) {
      const theta = (i / 12) * (Math.PI / 2);
      const rx = r * Math.cos(theta);
      const ry = 9.5 + r * Math.sin(theta);
      const projected = projectPoint(rx, ry, H_matrix);
      if (projected) {
        points.push([
          (projected[0] / results.metadata.width) * 100,
          (projected[1] / results.metadata.height) * 100
        ]);
      }
    }
    return points.map(pt => `${pt[0]},${pt[1]}`).join(' ');
  };

  const getRightPenaltyAreaPoints = (H_matrix: number[][]) => {
    if (!results) return '';
    const points: [number, number][] = [];
    const r = 5.0; // 5.0m arc radius
    // Top quarter-arc centered at (30, 6.5)
    for (let i = 0; i <= 12; i++) {
      const theta = -Math.PI / 2 - (i / 12) * (Math.PI / 2);
      const rx = 30.0 + r * Math.cos(theta);
      const ry = 6.5 + r * Math.sin(theta);
      const projected = projectPoint(rx, ry, H_matrix);
      if (projected) {
        points.push([
          (projected[0] / results.metadata.width) * 100,
          (projected[1] / results.metadata.height) * 100
        ]);
      }
    }
    // Bottom quarter-arc centered at (30, 9.5)
    for (let i = 0; i <= 12; i++) {
      const theta = Math.PI - (i / 12) * (Math.PI / 2);
      const rx = 30.0 + r * Math.cos(theta);
      const ry = 9.5 + r * Math.sin(theta);
      const projected = projectPoint(rx, ry, H_matrix);
      if (projected) {
        points.push([
          (projected[0] / results.metadata.width) * 100,
          (projected[1] / results.metadata.height) * 100
        ]);
      }
    }
    return points.map(pt => `${pt[0]},${pt[1]}`).join(' ');
  };

  // Render the miniature tactical pitch canvas overlay showing player trajectory
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pad = 15;
    const cw = canvas.width - pad * 2;
    const ch = canvas.height - pad * 2;

    // Pitch aspect ratio mapping: 30m length by 16m width
    const pmw = 30.0;
    const pmh = 16.0;

    const scaleX = (x: number) => pad + (x / pmw) * cw;
    const scaleY = (y: number) => pad + (y / pmh) * ch;

    // Draw green pitch background
    ctx.fillStyle = '#081c15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw outer boundary lines
    ctx.strokeStyle = '#2d6a4f';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, cw, ch);



    // Kickoff spot
    ctx.fillStyle = '#40916c';
    ctx.beginPath();
    ctx.arc(pad + cw / 2, pad + ch / 2, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Left Penalty Box (Curved Futsal D-Arc)
    ctx.beginPath();
    // Top quarter-arc centered at top post (0, 6.5)
    for (let i = 0; i <= 12; i++) {
      const theta = -Math.PI / 2 + (i / 12) * (Math.PI / 2);
      const rx = 5.0 * Math.cos(theta);
      const ry = 6.5 + 5.0 * Math.sin(theta);
      if (i === 0) {
        ctx.moveTo(scaleX(rx), scaleY(ry));
      } else {
        ctx.lineTo(scaleX(rx), scaleY(ry));
      }
    }
    // Bottom quarter-arc centered at bottom post (0, 9.5)
    for (let i = 0; i <= 12; i++) {
      const theta = (i / 12) * (Math.PI / 2);
      const rx = 5.0 * Math.cos(theta);
      const ry = 9.5 + 5.0 * Math.sin(theta);
      ctx.lineTo(scaleX(rx), scaleY(ry));
    }
    ctx.stroke();

    // Left Penalty Dot outside arc at (6, 8)
    ctx.fillStyle = '#2d6a4f';
    ctx.beginPath();
    ctx.arc(scaleX(6.0), scaleY(8.0), 3, 0, 2 * Math.PI);
    ctx.fill();

    // Right Penalty Box (Curved Futsal D-Arc)
    ctx.beginPath();
    // Top quarter-arc centered at (30, 6.5)
    for (let i = 0; i <= 12; i++) {
      const theta = -Math.PI / 2 - (i / 12) * (Math.PI / 2);
      const rx = 30.0 + 5.0 * Math.cos(theta);
      const ry = 6.5 + 5.0 * Math.sin(theta);
      if (i === 0) {
        ctx.moveTo(scaleX(rx), scaleY(ry));
      } else {
        ctx.lineTo(scaleX(rx), scaleY(ry));
      }
    }
    // Bottom quarter-arc centered at (30, 9.5)
    for (let i = 0; i <= 12; i++) {
      const theta = Math.PI - (i / 12) * (Math.PI / 2);
      const rx = 30.0 + 5.0 * Math.cos(theta);
      const ry = 9.5 + 5.0 * Math.sin(theta);
      ctx.lineTo(scaleX(rx), scaleY(ry));
    }
    ctx.stroke();

    // Right Penalty Dot outside arc at (24, 8)
    ctx.fillStyle = '#2d6a4f';
    ctx.beginPath();
    ctx.arc(scaleX(24.0), scaleY(8.0), 3, 0, 2 * Math.PI);
    ctx.fill();

    // 1. Plot Selected Player Trajectory Growing Trail
    if (selectedPlayer && selectedPlayer.path && selectedPlayer.path.length > 0) {
      // Filter path up to the current frame playing in the video
      const livePath = selectedPlayer.path.filter(pt => pt.frame <= currentFrame);
      
      if (livePath.length > 0) {
        const isTeamA = selectedPlayer.team === 'A';
        const pathColor = isTeamA ? '#a855f7' : '#06b6d4';
        
        ctx.strokeStyle = pathColor;
        ctx.lineWidth = 3;
        ctx.shadowColor = pathColor;
        ctx.shadowBlur = 8;

        ctx.beginPath();
        const firstPt = livePath[0];
        ctx.moveTo(scaleX(firstPt.x), scaleY(firstPt.y));

        for (let i = 1; i < livePath.length; i++) {
          const pt = livePath[i];
          ctx.lineTo(scaleX(pt.x), scaleY(pt.y));
        }
        ctx.stroke();

        // Draw start coordinate (Green circle)
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(scaleX(firstPt.x), scaleY(firstPt.y), 5, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // 2. Draw ALL active players at the current frame in 2D top view
    const activeDetections = results.frames[String(currentFrame)] || results.frames[currentFrame] || [];
    activeDetections.forEach((det) => {
      const isTeamA = det.team === 'A';
      if (isTeamA && !showTeamA) return;
      if (!isTeamA && !showTeamB) return;

      const [rx, ry] = det.real;
      // Clamp coordinates to pitch bounds to prevent out-of-bounds drawing due to calibration offsets
      const cx = Math.max(0, Math.min(pmw, rx));
      const cy = Math.max(0, Math.min(pmh, ry));

      const px = scaleX(cx);
      const py = scaleY(cy);
      const color = isTeamA ? '#a855f7' : '#06b6d4';
      const isSelected = det.id === selectedPlayerId;

      // Draw player circle/dot
      ctx.shadowBlur = isSelected ? 12 : 0;
      ctx.shadowColor = color;
      ctx.strokeStyle = isSelected ? '#ffffff' : color;
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.fillStyle = isTeamA ? 'rgba(168, 85, 247, 0.9)' : 'rgba(6, 182, 212, 0.9)';
      
      ctx.beginPath();
      ctx.arc(px, py, isSelected ? 7 : 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();

      // Label player ID inside/above circle
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (isSelected) {
        ctx.fillText(String(det.id), px, py);
      } else {
        ctx.fillText(`P${det.id}`, px, py - 9);
      }
    });

  }, [selectedPlayerId, currentFrame, showTeamA, showTeamB, results, selectedPlayer]);

  return (
    <div className="flex flex-col h-[calc(100vh-76px)] overflow-hidden bg-[#080c14]">
      {/* Match summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/5 bg-gray-950/50">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs text-gray-400">Team A</span>
            <strong className="text-sm text-purple-300 tabular-nums">{teamAPlayers.length}</strong>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs text-gray-400">Team B</span>
            <strong className="text-sm text-cyan-300 tabular-nums">{teamBPlayers.length}</strong>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/10">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-400">Tracked</span>
            <strong className="text-sm text-gray-200 tabular-nums">{results.players.length}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/5">
            <Film className="w-3 h-3" />
            {results.metadata.fps} fps
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/5">
            {results.metadata.totalFrames} frames
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/5">
            <Timer className="w-3 h-3" />
            {results.metadata.duration}s
          </span>
        </div>
      </div>

      {/* Main Double Grid Dashboard Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Stream Video Annotated Player Bounding Boxes */}
        <div className="flex-1 flex flex-col justify-center items-center p-4 lg:p-6 min-w-0 overflow-y-auto">
          <div className="relative w-full max-w-5xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50 bg-black">
            <video 
              ref={videoRef}
              src="http://localhost:8000/uploads/uploaded_match.mp4" 
              controls 
              autoPlay 
              loop
              onPlay={startPlaybackLoop}
              onPause={stopPlaybackLoop}
              onTimeUpdate={handleTimeUpdate}
              className="w-full h-auto block object-fill"
            />
            
            {/* Interactive Player Bounding Boxes Overlay */}
            {showPlayerBoxes && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {(results.frames[String(currentFrame)] || results.frames[currentFrame] || []).map((det) => {
                  const isTeamA = det.team === 'A';
                  if (isTeamA && !showTeamA) return null;
                  if (!isTeamA && !showTeamB) return null;
                  
                  const [bx, by, bw, bh] = det.bbox;
                  const left = (bx / results.metadata.width) * 100;
                  const top = (by / results.metadata.height) * 100;
                  const width = (bw / results.metadata.width) * 100;
                  const height = (bh / results.metadata.height) * 100;
                  const color = isTeamA ? '#a855f7' : '#06b6d4';
                  const isSelected = det.id === selectedPlayerId;
                  
                  return (
                    <div
                      key={det.id}
                      style={{
                        position: 'absolute',
                        left: `${left}%`,
                        top: `${top}%`,
                        width: `${width}%`,
                        height: `${height}%`,
                        border: `2px solid ${color}`,
                        boxShadow: isSelected ? `0 0 15px ${color}` : `0 0 8px ${color}80`,
                        borderRadius: '6px',
                        // Set to none to eliminate coordinates interpolation lag
                        transition: 'none'
                      }}
                    >
                      {/* Interactive Player Tag Clickable */}
                      <button
                        onClick={() => setSelectedPlayerId(isSelected ? null : det.id)}
                        style={{
                          position: 'absolute',
                          top: '-20px',
                          left: '-2px',
                          backgroundColor: color,
                          color: isTeamA ? '#ffffff' : '#000000',
                          fontSize: '9px',
                          fontWeight: 'black',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          whiteSpace: 'nowrap',
                          pointerEvents: 'auto',
                          cursor: 'pointer',
                          border: 'none',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                          textTransform: 'uppercase'
                        }}
                      >
                        P{det.id}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Projected Warped Calibration Grid Overlay (Draws inside video container, in RED) */}
            {showGridOverlay && H_inv && (
              <svg 
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {/* Warped Pitch Lines */}
                {pitchSegments.map((seg, sIdx) => {
                  const pt1 = projectPoint(seg.rx1, seg.ry1, H_inv);
                  const pt2 = projectPoint(seg.rx2, seg.ry2, H_inv);
                  if (!pt1 || !pt2) return null;
                  
                  const x1 = (pt1[0] / results.metadata.width) * 100;
                  const y1 = (pt1[1] / results.metadata.height) * 100;
                  const x2 = (pt2[0] / results.metadata.width) * 100;
                  const y2 = (pt2[1] / results.metadata.height) * 100;

                  return (
                    <line
                      key={sIdx}
                      x1={`${x1}%`}
                      y1={`${y1}%`}
                      x2={`${x2}%`}
                      y2={`${y2}%`}
                      stroke="#ef4444"
                      strokeWidth="0.45"
                      strokeDasharray="1.2,1.2"
                      className="opacity-90"
                    />
                  );
                })}

                {/* Warped Curved Futsal Left Penalty D-Arc */}
                {(() => {
                  const pointsStr = getLeftPenaltyAreaPoints(H_inv);
                  if (!pointsStr) return null;
                  return (
                    <polygon
                      points={pointsStr}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="0.45"
                      strokeDasharray="1.2,1.2"
                      className="opacity-90"
                    />
                  );
                })()}

                {/* Warped Curved Futsal Right Penalty D-Arc */}
                {(() => {
                  const pointsStr = getRightPenaltyAreaPoints(H_inv);
                  if (!pointsStr) return null;
                  return (
                    <polygon
                      points={pointsStr}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth="0.45"
                      strokeDasharray="1.2,1.2"
                      className="opacity-90"
                    />
                  );
                })()}

                {/* Warped Center Dot projected at (15.0, 8.0) */}
                {(() => {
                  const projected = projectPoint(15.0, 8.0, H_inv);
                  if (!projected) return null;
                  const sx = (projected[0] / results.metadata.width) * 100;
                  const sy = (projected[1] / results.metadata.height) * 100;
                  return (
                    <circle
                      cx={`${sx}%`}
                      cy={`${sy}%`}
                      r="0.5"
                      fill="#ef4444"
                      className="opacity-90 animate-pulse"
                    />
                  );
                })()}

                {/* Left Penalty Dot outside arc at (6, 8) */}
                {(() => {
                  const projected = projectPoint(6.0, 8.0, H_inv);
                  if (!projected) return null;
                  const sx = (projected[0] / results.metadata.width) * 100;
                  const sy = (projected[1] / results.metadata.height) * 100;
                  return (
                    <circle
                      cx={`${sx}%`}
                      cy={`${sy}%`}
                      r="0.5"
                      fill="#ef4444"
                      className="opacity-90 animate-pulse"
                    />
                  );
                })()}

                {/* Right Penalty Dot outside arc at (24, 8) */}
                {(() => {
                  const projected = projectPoint(24.0, 8.0, H_inv);
                  if (!projected) return null;
                  const sx = (projected[0] / results.metadata.width) * 100;
                  const sy = (projected[1] / results.metadata.height) * 100;
                  return (
                    <circle
                      cx={`${sx}%`}
                      cy={`${sy}%`}
                      r="0.5"
                      fill="#ef4444"
                      className="opacity-90 animate-pulse"
                    />
                  );
                })()}
              </svg>
            )}

            {/* Corner glowing tag */}
            <div className="absolute top-4 left-4 pointer-events-none flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/5 backdrop-blur-md">
              <Play className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span className="text-[10px] font-black tracking-widest text-gray-200 uppercase font-mono">
                ANNOTATED MATCH STREAM
              </span>
            </div>

            {/* Float Overlay Actions Toolbar (Top-Right Floating Corner) */}
            <div className="absolute top-4 right-4 flex items-center gap-2 pointer-events-auto">
              {/* Player Boxes Toggle Button */}
              <button
                onClick={() => setShowPlayerBoxes(!showPlayerBoxes)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-[10.5px] cursor-pointer transition-all shadow-lg select-none ${
                  showPlayerBoxes
                    ? 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-white shadow-[0_0_12px_rgba(168,85,247,0.35)]'
                    : 'bg-black/65 hover:bg-black/85 border-white/5 text-gray-300 hover:text-white'
                }`}
                title="Toggle Player Bounding Box Overlays"
              >
                {showPlayerBoxes ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                Boxes: {showPlayerBoxes ? 'SHOW' : 'HIDE'}
              </button>

              {/* Grid Overlay Toggle Button (RED active grid overlay) */}
              {currentHomography && (
                <button
                  onClick={() => setShowGridOverlay(!showGridOverlay)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-[10.5px] cursor-pointer transition-all shadow-lg select-none ${
                    showGridOverlay
                      ? 'bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-[0_0_12px_rgba(239,68,68,0.35)]'
                      : 'bg-black/65 hover:bg-black/85 border-white/5 text-gray-300 hover:text-white'
                  }`}
                  title="Toggle Warped Perspective Field Grid Overlay"
                >
                  <Grid className="w-3.5 h-3.5" />
                  Grid: {showGridOverlay ? 'SHOW' : 'HIDE'}
                </button>
              )}
            </div>

            {/* Download Output video button */}
            <a
              href="http://localhost:8000/static/output_video.mp4"
              download="annotated_match.mp4"
              className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all shadow-lg text-xs cursor-pointer pointer-events-auto"
            >
              <Download className="w-3.5 h-3.5" />
              Export AVI/MP4
            </a>
          </div>
        </div>

        {/* Right panel: squad roster + tactical map + player detail */}
        <div className="w-[min(100%,420px)] xl:w-[440px] shrink-0 bg-gray-950/60 border-l border-white/5 flex flex-col h-full overflow-hidden">
          <div className="px-4 py-3.5 border-b border-white/5 bg-gradient-to-r from-gray-950 to-gray-900/80">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">Squad roster</p>
            <h3 className="text-base font-semibold text-gray-100 mt-0.5">Player profiles</h3>
            {thumbsLoading && (
              <p className="text-[10px] text-gray-500 mt-1 flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full border border-gray-600 border-t-purple-400 animate-spin" />
                Generating thumbnails from match video…
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5 dashboard-scroll">
            {/* Team A roster */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                  <h4 className="text-xs font-semibold text-purple-300">Team A · Purple</h4>
                  <span className="text-[10px] text-gray-600 tabular-nums">({teamAPlayers.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTeamA(!showTeamA)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-purple-300 hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors cursor-pointer"
                  title={showTeamA ? 'Hide Team A on video' : 'Show Team A on video'}
                >
                  {showTeamA ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
              {teamAPlayers.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {teamAPlayers.map((player) => (
                    <PlayerRosterCard
                      key={player.id}
                      player={player}
                      thumbnailUrl={thumbnails[player.id]}
                      isLoadingThumb={thumbsLoading && !thumbnails[player.id]}
                      isSelected={player.id === selectedPlayerId}
                      onSelect={() =>
                        setSelectedPlayerId(player.id === selectedPlayerId ? null : player.id)
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600 py-3 text-center rounded-lg border border-dashed border-white/10">
                  No Team A players detected
                </p>
              )}
            </section>

            {/* Team B roster */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.5)]" />
                  <h4 className="text-xs font-semibold text-cyan-300">Team B · Aqua</h4>
                  <span className="text-[10px] text-gray-600 tabular-nums">({teamBPlayers.length})</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTeamB(!showTeamB)}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-cyan-300 hover:bg-white/5 border border-transparent hover:border-white/10 transition-colors cursor-pointer"
                  title={showTeamB ? 'Hide Team B on video' : 'Show Team B on video'}
                >
                  {showTeamB ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
              {teamBPlayers.length > 0 ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {teamBPlayers.map((player) => (
                    <PlayerRosterCard
                      key={player.id}
                      player={player}
                      thumbnailUrl={thumbnails[player.id]}
                      isLoadingThumb={thumbsLoading && !thumbnails[player.id]}
                      isSelected={player.id === selectedPlayerId}
                      onSelect={() =>
                        setSelectedPlayerId(player.id === selectedPlayerId ? null : player.id)
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-600 py-3 text-center rounded-lg border border-dashed border-white/10">
                  No Team B players detected
                </p>
              )}
            </section>

            {/* Tactical mini-map */}
            <section className="space-y-2 pt-1">
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
                Live tactical map
              </p>
              <div className="relative rounded-xl overflow-hidden border border-white/10 aspect-[30/16] w-full bg-[#081c15]">
                <canvas ref={canvasRef} width={300} height={160} className="w-full h-full" />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 border border-white/10 text-[9px] font-medium text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </div>
              </div>
            </section>

            {/* Selected player detail */}
            {selectedPlayer ? (
              <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden animate-fade-in">
                <div className="flex gap-0">
                  <div className="w-28 shrink-0 bg-gray-950">
                    {thumbnails[selectedPlayer.id] ? (
                      <img
                        src={thumbnails[selectedPlayer.id]}
                        alt={`Player ${selectedPlayer.id}`}
                        className="h-full w-full object-cover object-top min-h-[112px]"
                      />
                    ) : (
                      <div
                        className={`flex min-h-[112px] h-full items-center justify-center ${
                          selectedPlayer.team === 'A'
                            ? 'bg-purple-950/30'
                            : 'bg-cyan-950/30'
                        }`}
                      >
                        <User
                          className={`w-10 h-10 ${
                            selectedPlayer.team === 'A' ? 'text-purple-500/50' : 'text-cyan-500/50'
                          }`}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 p-3 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Selected</p>
                    <h4 className="text-lg font-bold text-gray-100 tabular-nums">P{selectedPlayer.id}</h4>
                    <p
                      className={`text-xs font-medium ${
                        selectedPlayer.team === 'A' ? 'text-purple-400' : 'text-cyan-400'
                      }`}
                    >
                      Team {selectedPlayer.team}
                      {selectedPlayer.team === 'A' ? ' · Purple vest' : ' · Aqua'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-px bg-white/5 border-t border-white/5">
                  <div className="p-2.5 bg-gray-950/40 text-center">
                    <p className="text-[9px] text-gray-500 uppercase">Distance</p>
                    <p className="text-sm font-semibold text-gray-100 tabular-nums">
                      {selectedPlayer.distance} m
                    </p>
                  </div>
                  <div className="p-2.5 bg-gray-950/40 text-center">
                    <p className="text-[9px] text-gray-500 uppercase">Avg</p>
                    <p className="text-sm font-semibold text-gray-100 tabular-nums">
                      {selectedPlayer.avgSpeed}
                    </p>
                    <p className="text-[9px] text-gray-600">km/h</p>
                  </div>
                  <div className="p-2.5 bg-gray-950/40 text-center">
                    <p className="text-[9px] text-gray-500 uppercase">Top</p>
                    <p className="text-sm font-semibold text-amber-400 tabular-nums">
                      {selectedPlayer.topSpeed}
                    </p>
                    <p className="text-[9px] text-gray-600">km/h</p>
                  </div>
                </div>
              </section>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center space-y-2">
                <Activity className="w-7 h-7 mx-auto text-gray-600" />
                <p className="text-xs font-medium text-gray-400">Select a player</p>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  Tap a profile card to highlight their trail on the pitch map and bounding box on
                  the video.
                </p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-white/5 bg-gray-950/80">
            <button
              type="button"
              onClick={resetAll}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-sm font-medium transition-colors border border-white/10 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-purple-400" />
              Process new match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
