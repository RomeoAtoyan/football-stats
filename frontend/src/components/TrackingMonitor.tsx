import React, { useRef, useState, useEffect } from 'react';
import { Eye, ShieldAlert, Users, Target, Activity } from 'lucide-react';

interface TrackingPoint {
  id: number;
  pixel_x: number;
  pixel_y: number;
  field_x: number;
  field_y: number;
  team?: string;
  role?: string;
  bbox?: [number, number, number, number]; // [x, y, w, h]
}

interface TrackingMonitorProps {
  trackingData: TrackingPoint[];
  wsActive: boolean;
  frameIdx: number;
  simModeActive: boolean;
}

export default function TrackingMonitor({ 
  trackingData = [], 
  wsActive, 
  frameIdx,
  simModeActive
}: TrackingMonitorProps) {
  const videoWidth = 1920;
  const videoHeight = 1080;
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Store trails of player coordinates in screen percentage for glowing path lines
  const [playerTrails, setPlayerTrails] = useState<Record<number, [number, number][]>>({});

  useEffect(() => {
    if (!wsActive) {
      setPlayerTrails({});
      return;
    }

    setPlayerTrails(prev => {
      const updated = { ...prev };
      trackingData.forEach(p => {
        const xPercent = (p.pixel_x / videoWidth) * 100;
        const yPercent = (p.pixel_y / videoHeight) * 100;
        if (!updated[p.id]) {
          updated[p.id] = [];
        }
        updated[p.id] = [...updated[p.id], [xPercent, yPercent]].slice(-25); // Limit trail length to 25
      });
      return updated;
    });
  }, [trackingData, wsActive]);

  // Fallback simulated layout matching pitch SVG boundaries
  const renderSimulatedVideoFrame = () => {
    // Top camera view simulated stadium with a glowing pitch grid to match actual context
    return (
      <div className="w-full h-full bg-[#051610] relative flex items-center justify-center overflow-hidden">
        {/* Lawn cut patterns */}
        <div className="absolute inset-0 opacity-20 bg-[linear-gradient(90deg,#0a2e20_50%,#0e3e2b_50%)] bg-[length:160px_100%]" />
        
        {/* HUD Pitch lines fallback */}
        <svg viewBox="0 0 1920 1080" className="absolute inset-0 w-full h-full stroke-emerald-600/30 fill-none stroke-[3]" draggable={false}>
          {/* Main Pitch Border */}
          <rect x="160" y="90" width="1600" height="900" />
          {/* Halfway line */}
          <line x1="960" y1="90" x2="960" y2="990" />
          {/* Center Circle */}
          <circle cx="960" cy="540" r="180" />
          {/* Left Area */}
          <rect x="160" y="270" width="320" height="540" />
          {/* Right Area */}
          <rect x="1440" y="270" width="320" height="540" />
        </svg>

        <div className="flex flex-col items-center gap-3 relative z-10 text-center">
          <Activity className="w-10 h-10 text-emerald-400 animate-pulse" />
          <span className="text-sm font-bold text-slate-300 font-mono tracking-wider">
            • TACTICAL SIMULATOR CAMERA CORRELATION FEED •
          </span>
          <span className="text-xs text-gray-500 max-w-sm leading-relaxed">
            Streaming real-time synthetic camera frames using Brown-Conrady geometry mapping.
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-6 glass rounded-2xl border border-[#ffffff08] shadow-2xl relative overflow-hidden">
      
      {/* Title Header */}
      <div className="flex justify-between items-center border-b border-[#ffffff10] pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <Eye className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Live AI Player Vision Monitor
              {wsActive && (
                <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 text-[10px] rounded border border-rose-500/20 font-mono font-bold animate-pulse">
                  LIVE STREAMING
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-400">Real-time overlay tracker presenting SAM 3.1 segmentation boundaries & HUD parameters</p>
          </div>
        </div>
      </div>

      {/* Main Video Monitor viewport */}
      <div 
        ref={containerRef}
        className="relative border border-slate-800/80 rounded-xl overflow-hidden bg-black w-full aspect-video shadow-inner select-none"
      >
        {/* Background Image / Simulator SVG */}
        {wsActive && !simModeActive ? (
          <img
            src={`http://localhost:8000/api/video/frame/${frameIdx % 10}?t=${frameIdx}`}
            alt="Live Tracking Feed"
            className="w-full h-full object-fill select-none pointer-events-none"
            draggable={false}
          />
        ) : (
          renderSimulatedVideoFrame()
        )}

        {/* Visual SVGs layer for overlays, trails and bounding boxes */}
        <svg 
          className="absolute inset-0 w-full h-full pointer-events-none z-10 select-none"
          viewBox={`0 0 ${videoWidth} ${videoHeight}`}
        >
          {/* Render Player Trail histories directly on the coordinate system */}
          {wsActive && Object.entries(playerTrails).map(([idStr, trail]) => {
            if (trail.length < 2) return null;
            const pid = parseInt(idStr);
            const activePlayer = trackingData.find(p => p.id === pid);
            const isTeamA = activePlayer ? activePlayer.team === 'A' : pid % 2 === 0;
            const color = isTeamA ? '#3b82f6' : '#ef4444';

            return (
              <polyline
                key={`trail-${pid}`}
                points={trail.map(pt => `${(pt[0] / 100) * videoWidth}, ${(pt[1] / 100) * videoHeight}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.35"
              />
            );
          })}
        </svg>

        {/* Declarative Bounding Boxes and HUD nodes positioned dynamically */}
        {wsActive && trackingData.map((player) => {
          const pid = player.id;
          const isTeamA = player.team ? player.team === 'A' : pid % 2 === 0;
          const colorClass = isTeamA ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]';
          const textClass = isTeamA ? 'bg-blue-600' : 'bg-rose-600';

          // Bounding Box calculations in pixel coordinates mapped to percentages
          const bbox = player.bbox || [player.pixel_x - 30, player.pixel_y - 85, 60, 90];
          const [bx, by, bw, bh] = bbox;
          const leftPercent = (bx / videoWidth) * 100;
          const topPercent = (by / videoHeight) * 100;
          const widthPercent = (bw / videoWidth) * 100;
          const heightPercent = (bh / videoHeight) * 100;

          // Target marker dot underneath the player's feet
          const feetLeft = (player.pixel_x / videoWidth) * 100;
          const feetTop = (player.pixel_y / videoHeight) * 100;

          return (
            <React.Fragment key={`hud-${pid}`}>
              
              {/* Bounding box wrapper */}
              <div 
                className={`absolute border-[2px] rounded-lg transition-all duration-75 flex flex-col justify-between ${colorClass}`}
                style={{
                  left: `${leftPercent}%`,
                  top: `${topPercent}%`,
                  width: `${widthPercent}%`,
                  height: `${heightPercent}%`,
                }}
              >
                {/* HUD Label tag containing ID and Role */}
                <div className="absolute -top-6 left-0 flex items-center gap-1 text-[9px] font-black font-mono text-white rounded px-1.5 py-0.5 shadow-md" style={{ backgroundColor: isTeamA ? '#2563eb' : '#e11d48' }}>
                  <span>P#{pid}</span>
                  <span className="opacity-75 uppercase tracking-wide">| {player.role || 'Active'}</span>
                </div>

                {/* Cyberpunk corner bracket styling for high-tech HUD visual */}
                <div className="absolute -top-[2px] -left-[2px] w-2.5 h-2.5 border-t-2 border-l-2 border-white rounded-tl" />
                <div className="absolute -top-[2px] -right-[2px] w-2.5 h-2.5 border-t-2 border-r-2 border-white rounded-tr" />
                <div className="absolute -bottom-[2px] -left-[2px] w-2.5 h-2.5 border-b-2 border-l-2 border-white rounded-bl" />
                <div className="absolute -bottom-[2px] -right-[2px] w-2.5 h-2.5 border-b-2 border-r-2 border-white rounded-br" />
              </div>

              {/* Glowing Target Ring directly at player feet coordinates */}
              <div 
                className="absolute w-6 h-2 rounded-full border border-white/50 flex items-center justify-center transition-all duration-75"
                style={{
                  left: `${feetLeft}%`,
                  top: `${feetTop}%`,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: isTeamA ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)',
                  boxShadow: isTeamA ? '0 0 10px #3b82f6' : '0 0 10px #ef4444'
                }}
              >
                <div className={`w-1.5 h-1.5 rounded-full ${isTeamA ? 'bg-blue-400' : 'bg-rose-400'}`} />
              </div>

            </React.Fragment>
          );
        })}
      </div>

      {/* Telemetry info card */}
      <div className="flex justify-between items-center bg-slate-900/30 p-3 rounded-lg border border-[#ffffff05] text-[10px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${wsActive ? 'bg-emerald-500 animate-ping' : 'bg-slate-700'}`} />
          <span>
            {wsActive 
              ? `Tracking active frame index F#${frameIdx % 10}. Overlaying custom high-fidelity boundary models.` 
              : "Awaiting coordinate telemetry. Click 'Start Tracking Engine' above to initialize SAM 3.1 session."
            }
          </span>
        </span>
        <span className="font-mono text-gray-400">SAM 3.1 Vision Model</span>
      </div>

    </div>
  );
}
