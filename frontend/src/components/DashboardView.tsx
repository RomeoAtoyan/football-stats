import React, { useEffect, useRef, useState } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { Play, Download, User, Activity, Layers, RefreshCw, Eye, EyeOff } from 'lucide-react';

export const DashboardView: React.FC = () => {
  const { results, selectedPlayerId, setSelectedPlayerId, resetAll } = usePitchTrackStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showTeamA, setShowTeamA] = useState(true);
  const [showTeamB, setShowTeamB] = useState(true);
  
  if (!results) return null;

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const frame = Math.round(video.currentTime * results.metadata.fps);
    setCurrentFrame(frame);
  };

  // Segment players into Team A (Purple) and Team B (Aqua)
  const teamAPlayers = results.players.filter(p => p.team === 'A');
  const teamBPlayers = results.players.filter(p => p.team === 'B');

  const selectedPlayer = results.players.find(p => p.id === selectedPlayerId);

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

    // Center Line
    ctx.beginPath();
    ctx.moveTo(pad + cw / 2, pad);
    ctx.lineTo(pad + cw / 2, pad + ch);
    ctx.stroke();

    // Center Circle
    ctx.beginPath();
    ctx.arc(pad + cw / 2, pad + ch / 2, ch * 0.2, 0, 2 * Math.PI);
    ctx.stroke();

    // Kickoff spot
    ctx.fillStyle = '#40916c';
    ctx.beginPath();
    ctx.arc(pad + cw / 2, pad + ch / 2, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Left Penalty Box
    ctx.strokeRect(pad, pad + ch * 0.2, cw * 0.15, ch * 0.6);
    // Right Penalty Box
    ctx.strokeRect(pad + cw - cw * 0.15, pad + ch * 0.2, cw * 0.15, ch * 0.6);

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
    <div className="flex flex-col h-[calc(100vh-76px)] overflow-hidden">
      {/* Upper bar with quick details */}
      <div className="flex justify-between items-center px-6 py-3 border-b border-gray-900 bg-gray-950/20 text-xs text-gray-400 font-mono">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            Team A Size: <strong className="text-purple-300 font-bold">{teamAPlayers.length}</strong>
          </span>
          <span className="text-gray-700">|</span>
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            Team B Size: <strong className="text-cyan-300 font-bold">{teamBPlayers.length}</strong>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>FPS: <strong className="text-gray-200">{results.metadata.fps}</strong></span>
          <span>Frames: <strong className="text-gray-200">{results.metadata.totalFrames}</strong></span>
          <span>Duration: <strong className="text-gray-200">{results.metadata.duration}s</strong></span>
        </div>
      </div>

      {/* Main Double Grid Dashboard Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel: Stream Video Annotated Player Bounding Boxes */}
        <div className="flex-1 flex flex-col justify-center items-center p-6 bg-gray-950/20 overflow-y-auto">
          <div className="relative w-full max-w-4xl rounded-3xl overflow-hidden border border-gray-805 shadow-2xl bg-black">
            <video 
              src="http://localhost:8000/uploads/uploaded_match.mp4" 
              controls 
              autoPlay 
              loop
              onTimeUpdate={handleTimeUpdate}
              className="w-full h-auto block object-fill"
            />
            {/* Interactive Player Bounding Boxes Overlay */}
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
                      transition: 'all 0.15s ease-out'
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
            {/* Corner glowing tag */}
            <div className="absolute top-4 left-4 pointer-events-none flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 border border-white/5 backdrop-blur-md">
              <Play className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span className="text-[10px] font-black tracking-widest text-gray-200 uppercase font-mono">
                ANNOTATED MATCH STREAM
              </span>
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

        {/* Right Sidebar: Squad list & Player details tracker */}
        <div className="w-96 bg-gray-900/40 border-l border-gray-900 flex flex-col h-full overflow-hidden">
          {/* Header tabs */}
          <div className="p-4 border-b border-gray-900 bg-gray-950/25">
            <span className="text-[10px] text-gray-500 font-black tracking-widest block uppercase font-mono">
              Visual Metric Core
            </span>
            <h3 className="text-sm font-black text-gray-200 uppercase mt-0.5">Tactical Squad Breakdown</h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Squad Colors grids split */}
            <div className="space-y-4">
              {/* Team A Grid - Purple Bounding Boxes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] font-black tracking-wider uppercase font-mono">
                  <div className="flex items-center gap-1.5 text-purple-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
                    Team A (Purple Boxes)
                  </div>
                  <button 
                    onClick={() => setShowTeamA(!showTeamA)}
                    className="p-1 rounded bg-gray-950/20 hover:bg-gray-800 text-gray-500 hover:text-purple-400 transition-all cursor-pointer border border-white/5 active:scale-90"
                    title={showTeamA ? "Hide Purple Boxes" : "Show Purple Boxes"}
                  >
                    {showTeamA ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {teamAPlayers.map(player => {
                    const isSelected = player.id === selectedPlayerId;
                    return (
                      <button
                        key={player.id}
                        onClick={() => setSelectedPlayerId(isSelected ? null : player.id)}
                        className={`py-2 rounded-xl border font-bold text-xs uppercase transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-purple-950/30 border-purple-500 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                            : 'bg-purple-950/5 border-purple-950/40 text-purple-400 hover:border-purple-500/40 hover:bg-purple-950/10'
                        }`}
                      >
                        P{player.id}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Team B Grid - Aqua Bounding Boxes */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-[10px] font-black tracking-wider uppercase font-mono">
                  <div className="flex items-center gap-1.5 text-cyan-400">
                    <div className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)]" />
                    Team B (Aqua Boxes)
                  </div>
                  <button 
                    onClick={() => setShowTeamB(!showTeamB)}
                    className="p-1 rounded bg-gray-950/20 hover:bg-gray-800 text-gray-500 hover:text-cyan-400 transition-all cursor-pointer border border-white/5 active:scale-90"
                    title={showTeamB ? "Hide Aqua Boxes" : "Show Aqua Boxes"}
                  >
                    {showTeamB ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {teamBPlayers.map(player => {
                    const isSelected = player.id === selectedPlayerId;
                    return (
                      <button
                        key={player.id}
                        onClick={() => setSelectedPlayerId(isSelected ? null : player.id)}
                        className={`py-2 rounded-xl border font-bold text-xs uppercase transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-cyan-950/30 border-cyan-500 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                            : 'bg-cyan-950/5 border-cyan-950/40 text-cyan-400 hover:border-cyan-500/40 hover:bg-cyan-950/10'
                        }`}
                      >
                        P{player.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Persistent 2D Pitch Top-down Live Map */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[9px] text-gray-500 font-black tracking-widest uppercase block font-mono">
                2D Pitch Top-down Live Map
              </span>
              <div className="relative rounded-2xl overflow-hidden border border-gray-850 aspect-[30/16] w-full shadow-inner bg-black">
                <canvas 
                  ref={canvasRef} 
                  width={300} 
                  height={160}
                  className="w-full h-full"
                />
                <div className="absolute top-2 left-2 flex items-center gap-1 pointer-events-none px-1.5 py-0.5 rounded bg-black/70 border border-white/5 text-[8px] font-bold text-emerald-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                  Live Tactical view
                </div>
              </div>
              <div className="flex justify-between text-[8px] font-bold text-gray-500 uppercase tracking-widest px-1 font-mono">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Start (t=0)</span>
                <span className="flex items-center gap-1">End (t=end) <span className="w-1.5 h-1.5 rounded-full bg-red-500" /></span>
              </div>
            </div>

            {/* Selected Player Metric Overlay */}
            {selectedPlayer ? (
              <div className="space-y-4 border-t border-gray-850/50 pt-4 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center font-black text-xs ${
                      selectedPlayer.team === 'A' ? 'bg-purple-600 text-white' : 'bg-cyan-500 text-black'
                    }`}>
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-gray-200 uppercase font-mono">PLAYER {selectedPlayer.id}</h4>
                      <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider block -mt-0.5">
                        Team {selectedPlayer.team === 'A' ? 'A (Purple)' : 'B (Aqua)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dashboard Stats */}
                <div className="grid grid-cols-3 gap-2 text-[11px] font-mono text-gray-400">
                  <div className="p-2.5 rounded-xl bg-gray-950/20 border border-gray-850">
                    <span className="text-[8px] text-gray-500 block uppercase tracking-wider font-bold">DISTANCE</span>
                    <span className="font-black text-xs text-gray-200">{selectedPlayer.distance} m</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-gray-950/20 border border-gray-850">
                    <span className="text-[8px] text-gray-500 block uppercase tracking-wider font-bold">AVG SPEED</span>
                    <span className="font-black text-xs text-gray-200">{selectedPlayer.avgSpeed} km/h</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-gray-950/20 border border-gray-850">
                    <span className="text-[8px] text-gray-500 block uppercase tracking-wider font-bold">TOP SPEED</span>
                    <span className="font-black text-xs text-amber-400">{selectedPlayer.topSpeed} km/h</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Idle Sidebar selection prompt */
              <div className="p-8 text-center border border-dashed border-gray-850 rounded-2xl bg-gray-950/10 text-gray-500 space-y-2">
                <Activity className="w-8 h-8 mx-auto text-gray-600 animate-pulse" />
                <h4 className="text-xs font-black uppercase text-gray-400 tracking-wider">Select a Player Profile</h4>
                <p className="text-[10px] leading-relaxed max-w-xs mx-auto">
                  Click on any player coordinate tag above to plot their running metrics and 2D tactical field tracking trails!
                </p>
              </div>
            )}
          </div>

          {/* Reset button at bottom */}
          <div className="p-4 border-t border-gray-900 bg-gray-950/25">
            <button
              onClick={resetAll}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gray-800 hover:bg-gray-750 text-gray-300 hover:text-white font-bold text-xs uppercase tracking-wider transition-all border border-gray-750 active:scale-[0.98] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" style={{ animationDuration: '6s' }} />
              Process New Match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
