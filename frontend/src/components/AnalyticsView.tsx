import React, { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import type { FrameDetection, PlayerSummary } from '../store/pitchtrackStore';
import { 
  Play, Pause, Download, User, Milestone, Activity, Zap, 
  TrendingUp, Volume2, Maximize, Loader2, Sparkles, AlertCircle
} from 'lucide-react';

export const AnalyticsView: React.FC = () => {
  const {
    videoMetadata,
    processingStatus,
    processingProgress,
    processingError,
    results,
    selectedPlayerId,
    currentFrame,
    isPlaying,
    playbackSpeed,
    setProcessingStatus,
    setProcessingProgress,
    setProcessingError,
    setResults,
    setSelectedPlayerId,
    setCurrentFrame,
    setPlaying,
    setPlaybackSpeed,
    setView
  } = usePitchTrackStore();

  const playerRef = useRef<ReactPlayer>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniFieldRef = useRef<HTMLCanvasElement>(null);
  
  const [playedSeconds, setPlayedSeconds] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  
  // Highlighting specific sections
  const [activeTab, setActiveTab] = useState<'stats' | 'timeline'>('stats');

  // 1. Progress Status Polling Effect
  useEffect(() => {
    let intervalId: any;
    
    if (processingStatus === 'processing') {
      intervalId = setInterval(async () => {
        try {
          const response = await fetch('http://localhost:8000/api/status');
          if (!response.ok) throw new Error('Failed to fetch processing status.');
          
          const data = await response.json();
          setProcessingStatus(data.status);
          setProcessingProgress(data.progress);
          setProcessingError(data.error);
          
          if (data.status === 'completed') {
            clearInterval(intervalId);
            // Fetch final results
            const resultsResponse = await fetch('http://localhost:8000/api/results');
            if (resultsResponse.ok) {
              const resultsData = await resultsResponse.json();
              setResults(resultsData);
            } else {
              throw new Error('Failed to retrieve tracking results.');
            }
          } else if (data.status === 'failed') {
            clearInterval(intervalId);
          }
        } catch (err: any) {
          console.error(err);
          setProcessingStatus('failed');
          setProcessingError(err.message || 'Status check failed.');
          clearInterval(intervalId);
        }
      }, 1000);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [processingStatus]);

  // 2. Dynamic Overlay Canvas Drawing (bounding boxes & labels)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !results || !videoMetadata) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get current frame's detections
    const frameKey = String(currentFrame);
    const detections: FrameDetection[] = results.frames[frameKey] || [];

    // Bounding Box aspect scaling ratio (canvas size / video size)
    const scaleX = canvas.width / videoMetadata.width;
    const scaleY = canvas.height / videoMetadata.height;

    detections.forEach((det) => {
      const [x, y, w, h] = det.bbox;
      const drawX = x * scaleX;
      const drawY = y * scaleY;
      const drawW = w * scaleX;
      const drawH = h * scaleY;
      const isSelected = det.id === selectedPlayerId;

      // Premium Styling
      const color = isSelected ? '#10b981' : '#6366f1'; // Green for selected, indigo/blue for others
      const shadowColor = isSelected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(99, 102, 241, 0.2)';

      // 1. Bounding Box
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = isSelected ? 12 : 4;
      ctx.strokeRect(drawX, drawY, drawW, drawH);
      ctx.shadowBlur = 0; // reset shadow

      // 2. Corner highlights for bounding box
      const len = Math.min(drawW, drawH) * 0.2;
      ctx.strokeStyle = isSelected ? '#ffffff' : color;
      ctx.lineWidth = 3;
      
      // Top-Left corner
      ctx.beginPath();
      ctx.moveTo(drawX + len, drawY);
      ctx.lineTo(drawX, drawY);
      ctx.lineTo(drawX, drawY + len);
      ctx.stroke();

      // Bottom-Right corner
      ctx.beginPath();
      ctx.moveTo(drawX + drawW - len, drawY + drawH);
      ctx.lineTo(drawX + drawW, drawY + drawH);
      ctx.lineTo(drawX + drawW, drawY + drawH - len);
      ctx.stroke();

      // 3. Label tag above the head
      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      const labelText = `ID: ${det.id} | ${det.speed} km/h`;
      const labelWidth = ctx.measureText(labelText).width + 12;
      
      ctx.beginPath();
      ctx.roundRect(drawX, drawY - 20, labelWidth, 16, 4);
      ctx.fill();

      ctx.fillStyle = '#000000';
      ctx.fillText(labelText, drawX + 6, drawY - 8);
      
      // 4. Trail dot on the feet
      const footX = drawX + drawW / 2;
      const footY = drawY + drawH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(footX, footY, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [currentFrame, results, selectedPlayerId, videoMetadata]);

  // 3. Bird's Eye View Mini Field Canvas Drawing
  useEffect(() => {
    const canvas = miniFieldRef.current;
    if (!canvas || !results) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Field configuration
    const fWidth = canvas.width;
    const fHeight = canvas.height;
    
    // Scale factor (from 30m x 16m real field to canvas dimensions)
    const scaleX = fWidth / 30.0;
    const scaleY = fHeight / 16.0;

    // Draw field grass/background
    ctx.fillStyle = '#081c15';
    ctx.fillRect(0, 0, fWidth, fHeight);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(64, 145, 108, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 2; x < 30; x += 2) {
      ctx.beginPath();
      ctx.moveTo(x * scaleX, 0);
      ctx.lineTo(x * scaleX, fHeight);
      ctx.stroke();
    }
    for (let y = 2; y < 16; y += 2) {
      ctx.beginPath();
      ctx.moveTo(0, y * scaleY);
      ctx.lineTo(fWidth, y * scaleY);
      ctx.stroke();
    }

    // Outer borders
    ctx.strokeStyle = '#40916c';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, fWidth, fHeight);

    // Center line
    ctx.beginPath();
    ctx.moveTo(fWidth / 2, 0);
    ctx.lineTo(fWidth / 2, fHeight);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(fWidth / 2, fHeight / 2, 3.0 * scaleY, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Center dot
    ctx.fillStyle = '#40916c';
    ctx.beginPath();
    ctx.arc(fWidth / 2, fHeight / 2, 4, 0, 2 * Math.PI);
    ctx.fill();

    // Left and Right penalty boxes (6m box)
    ctx.strokeRect(0, 3 * scaleY, 6 * scaleX, 10 * scaleY);
    ctx.strokeRect(fWidth - 6 * scaleX, 3 * scaleY, 6 * scaleX, 10 * scaleY);

    // Left and Right penalty spots
    ctx.beginPath();
    ctx.arc(6 * scaleX, fHeight / 2, 3, 0, 2 * Math.PI);
    ctx.arc(fWidth - 6 * scaleX, fHeight / 2, 3, 0, 2 * Math.PI);
    ctx.fill();

    // Left and Right Goals
    ctx.strokeStyle = '#52b788';
    ctx.lineWidth = 4;
    ctx.strokeRect(-4, 6.5 * scaleY, 4, 3.0 * scaleY);
    ctx.strokeRect(fWidth, 6.5 * scaleY, 4, 3.0 * scaleY);

    // Draw Player Trails (for all active players or selected)
    results.players.forEach((player) => {
      const isSelected = player.id === selectedPlayerId;
      if (selectedPlayerId && !isSelected) return; // if something selected, only draw selected

      const path = player.path.filter(p => p.frame <= currentFrame);
      if (path.length === 0) return;

      // Draw historical trail lines
      ctx.strokeStyle = isSelected ? '#10b981' : 'rgba(99, 102, 241, 0.4)';
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.beginPath();
      path.forEach((pt, idx) => {
        const cx = pt.x * scaleX;
        const cy = pt.y * scaleY;
        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
    });

    // Draw active dots for the current frame
    const frameKey = String(currentFrame);
    const detections = results.frames[frameKey] || [];
    
    detections.forEach((det) => {
      const [rx, ry] = det.real;
      const isSelected = det.id === selectedPlayerId;
      const color = isSelected ? '#10b981' : '#6366f1';
      
      const drawX = rx * scaleX;
      const drawY = ry * scaleY;

      // Dot ring effect for selection
      if (isSelected) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(drawX, drawY, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(drawX, drawY, 5, 0, 2 * Math.PI);
      ctx.fill();

      // Text ID tag
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(String(det.id), drawX + 7, drawY + 3);
    });

  }, [currentFrame, results, selectedPlayerId]);

  // 4. Synced Player playback tick handler
  const handleProgress = (state: { playedSeconds: number; played: number }) => {
    setPlayedSeconds(state.playedSeconds);
    if (videoMetadata) {
      // Synchronize video elapsed seconds to the corresponding frame index
      const computedFrame = Math.round(state.playedSeconds * videoMetadata.fps);
      const boundedFrame = Math.min(videoMetadata.totalFrames - 1, Math.max(0, computedFrame));
      setCurrentFrame(boundedFrame);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setPlayedSeconds(time);
    playerRef.current?.seekTo(time);
    
    if (videoMetadata) {
      const computedFrame = Math.round(time * videoMetadata.fps);
      setCurrentFrame(computedFrame);
    }
  };

  const togglePlay = () => setPlaying(!isPlaying);

  const handleExport = async () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `match_analytics_export.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Full-Screen background worker process loader layout
  if (processingStatus === 'processing' || !results) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
        <div className="glass max-w-xl w-full p-10 rounded-3xl border border-emerald-500/20 text-center space-y-6 shadow-2xl relative overflow-hidden">
          
          {/* Animated decorative gradient borders */}
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/5 via-transparent to-teal-500/5 pointer-events-none" />
          
          <div className="relative">
            <Loader2 className="w-16 h-16 text-emerald-400 animate-spin mx-auto" />
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-xs font-bold text-gray-200">
              {Math.round(processingProgress * 100)}%
            </div>
          </div>

          <div className="space-y-2 relative z-10">
            <span className="px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/20 text-xs font-semibold text-emerald-400 uppercase tracking-widest animate-pulse">
              AI Tracking Engaged
            </span>
            <h3 className="text-2xl font-black text-gray-100 mt-2">Processing Match Video</h3>
            <p className="text-sm text-gray-400 max-w-md mx-auto">
              FastAPI is currently running YOLOv8 detection and ByteTrack tracking on each video frame, smoothing pathways with Kalman Filters.
            </p>
          </div>

          {/* Progress bar */}
          <div className="space-y-2 relative z-10">
            <div className="w-full bg-gray-900 rounded-full h-3 border border-gray-800 p-0.5 overflow-hidden">
              <div 
                style={{ width: `${processingProgress * 100}%` }}
                className="bg-gradient-to-r from-emerald-500 via-green-400 to-teal-500 h-full rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
              />
            </div>
            <div className="flex justify-between text-xs font-semibold text-gray-500">
              <span>Detecting persons</span>
              <span>Calculating real meters</span>
            </div>
          </div>
          
          {processingStatus === 'failed' && (
            <div className="p-4 bg-red-950/20 border border-red-500/20 rounded-xl flex items-center gap-3 text-left">
              <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-bold text-red-300">Processing Failed</h4>
                <p className="text-xs text-red-400 mt-0.5">{processingError}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Find active player speed graph points
  const selectedPlayer = results.players.find(p => p.id === selectedPlayerId);

  return (
    <div className="flex flex-col h-[90vh] text-gray-200">
      
      {/* Top dashboard bar */}
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <span className="px-3 py-1 rounded-full bg-indigo-950/50 border border-indigo-500/20 text-xs font-extrabold text-indigo-400 tracking-wider">
            Match Analytics cockpit
          </span>
          <h2 className="text-lg font-black text-gray-200">
            {videoMetadata.filename}
          </h2>
        </div>
        
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs shadow-md transition-all active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          Export JSON
        </button>
      </div>

      {/* Cockpit layout grid */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Side: Video Player, Canvas Overlay & Mini-Field */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-[#0b0f17] p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Primary Video Canvas - Spans 2 cols */}
            <div className="lg:col-span-2 space-y-4">
              <div className="relative aspect-video rounded-2xl overflow-hidden border border-gray-800 shadow-2xl bg-black">
                {/* React Player */}
                <ReactPlayer
                  ref={playerRef}
                  url="http://localhost:8000/static/uploaded_match.mp4"
                  width="100%"
                  height="100%"
                  playing={isPlaying}
                  controls={false}
                  muted={isMuted}
                  progressInterval={30}
                  onProgress={handleProgress}
                  onDuration={(d) => setDuration(d)}
                />

                {/* Overlaid Canvas */}
                <canvas
                  ref={canvasRef}
                  width={1280}
                  height={720}
                  className="absolute inset-0 w-full h-full pointer-events-none z-10"
                />
              </div>

              {/* Player Timeline & Controls bar */}
              <div className="glass p-4 rounded-2xl border border-gray-800 flex flex-col space-y-3 shadow-lg">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.01}
                    value={playedSeconds}
                    onChange={handleSeekChange}
                    className="flex-1 accent-emerald-500 bg-gray-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-xs font-mono font-bold text-gray-400 select-none">
                    {Math.floor(playedSeconds / 60)}:
                    {String(Math.floor(playedSeconds % 60)).padStart(2, '0')} / 
                    {Math.floor(duration / 60)}:
                    {String(Math.floor(duration % 60)).padStart(2, '0')}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={togglePlay}
                      className="p-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black shadow-md transition-all active:scale-95"
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-black" /> : <Play className="w-4 h-4 fill-black" />}
                    </button>
                    <button
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-2 rounded-xl hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <Volume2 className={`w-4 h-4 ${isMuted ? 'text-gray-600' : 'text-emerald-400'}`} />
                    </button>
                  </div>

                  {/* Playback speed options */}
                  <div className="flex items-center gap-1 bg-gray-950 border border-gray-850 p-0.5 rounded-xl">
                    {[0.5, 1.0, 1.5, 2.0].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => {
                          setPlaybackSpeed(spd);
                          if (playerRef.current) {
                            // React Player doesn't directly support reactive playback speed without prop, so let's adjust it
                            (playerRef.current.getInternalPlayer() as HTMLVideoElement).playbackRate = spd;
                          }
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                          playbackSpeed === spd 
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20' 
                            : 'text-gray-500 hover:text-gray-300'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Bird's Eye View Mini Field - Spans 1 col */}
            <div className="glass p-6 rounded-2xl border border-gray-800 flex flex-col justify-between shadow-xl">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">Tactical bird's-eye</span>
                <h3 className="text-base font-bold text-gray-200 mt-1 mb-4">2D Pitch Ground Tracking</h3>
              </div>
              
              <div className="flex items-center justify-center flex-1 py-4">
                <canvas
                  ref={miniFieldRef}
                  width={300}
                  height={160}
                  className="w-full aspect-[30/16] rounded-xl border border-[#40916c]/30 shadow-inner"
                />
              </div>

              <div className="mt-4 pt-4 border-t border-gray-805 text-xs text-gray-500 leading-relaxed">
                Rendered on a scaled 16m × 30m coordinate plane. Solid lines indicate tracked trails of movement.
              </div>
            </div>
            
          </div>

          {/* Sub Panels area (Speed Graphs) */}
          {selectedPlayer && (
            <div className="glass p-6 rounded-2xl border border-gray-800 shadow-lg animate-fade-in">
              <h3 className="text-base font-bold text-gray-200 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-400" />
                Player {selectedPlayer.id} Run Velocity Graph
              </h3>
              
              {/* Dynamic simulated chart block based on coords */}
              <div className="h-44 flex items-end gap-1 px-4 border-b border-gray-800 relative">
                {selectedPlayer.path.map((pt, idx) => {
                  if (idx % 8 !== 0) return null; // reduce resolution
                  
                  const isCurrent = pt.frame <= currentFrame;
                  const barHeight = (pt.speed / 36.0) * 100;
                  const isActive = pt.frame === currentFrame;

                  return (
                    <div 
                      key={idx}
                      style={{ height: `${Math.max(4, barHeight)}%` }}
                      className={`flex-1 rounded-t-sm transition-all duration-300 ${
                        isActive
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] scale-y-115'
                          : isCurrent 
                            ? 'bg-emerald-500/70 hover:bg-emerald-400' 
                            : 'bg-indigo-950/40 hover:bg-indigo-900/40'
                      }`}
                      title={`Frame ${pt.frame}: ${pt.speed} km/h`}
                    />
                  );
                })}
                <div className="absolute left-0 bottom-2 bg-black/60 px-2 py-1 rounded text-[10px] font-semibold text-gray-400">0 km/h</div>
                <div className="absolute left-0 top-2 bg-black/60 px-2 py-1 rounded text-[10px] font-semibold text-gray-400">30 km/h</div>
              </div>
              <div className="flex justify-between mt-2 text-xs font-semibold text-gray-500">
                <span>Kickoff</span>
                <span>Match Complete</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Player List & Detailed Metrics sidebar */}
        <div className="w-96 bg-gray-900 border-l border-gray-800 flex flex-col h-full">
          
          <div className="flex border-b border-gray-850 bg-gray-950/20 p-1">
            <button
              onClick={() => setActiveTab('stats')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                activeTab === 'stats' 
                  ? 'bg-gray-850/60 text-emerald-400' 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Player Metrics
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                activeTab === 'timeline' 
                  ? 'bg-gray-850/60 text-emerald-400' 
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Match Timeline
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'stats' ? (
              <div className="space-y-3">
                {results.players.map((player) => {
                  const isSelected = player.id === selectedPlayerId;
                  
                  return (
                    <div
                      key={player.id}
                      onClick={() => setSelectedPlayerId(isSelected ? null : player.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-950/20 border-emerald-500 shadow-md shadow-emerald-950/10'
                          : 'bg-gray-850/20 border-gray-850 hover:border-gray-700 hover:bg-gray-800/20'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                            isSelected ? 'bg-emerald-500 text-black' : 'bg-gray-800 text-indigo-400'
                          }`}>
                            <User className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-black text-gray-200">PLAYER {player.id}</h4>
                            <span className="text-[10px] text-gray-500 font-semibold uppercase">Tracked Profile</span>
                          </div>
                        </div>
                        
                        {/* Summary distance */}
                        <div className="text-right">
                          <span className="text-xs font-black text-emerald-400 block">{player.distance} m</span>
                          <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold">Distance</span>
                        </div>
                      </div>

                      {/* Stat parameters sub dashboard */}
                      <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-gray-805/40 text-[11px] font-mono text-gray-400">
                        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-black/40 border border-white/5">
                          <Activity className="w-3.5 h-3.5 text-indigo-400" />
                          <div>
                            <span className="text-[9px] text-gray-500 block">AVG SPEED</span>
                            <span className="font-bold text-gray-200">{player.avgSpeed} km/h</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-black/40 border border-white/5">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <div>
                            <span className="text-[9px] text-gray-500 block">TOP SPEED</span>
                            <span className="font-bold text-gray-200">{player.topSpeed} km/h</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Match Timeline view */
              <div className="relative border-l border-gray-800 ml-4 py-2 space-y-6">
                
                {/* Milestone 1 */}
                <div className="relative pl-6">
                  <div className="absolute -left-2 top-1.5 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-emerald-950 flex items-center justify-center border border-black" />
                  <div>
                    <span className="text-[10px] font-mono font-bold text-emerald-400">00:00</span>
                    <h4 className="text-xs font-bold text-gray-200 mt-0.5">Match Kickoff</h4>
                    <p className="text-[10px] text-gray-500 leading-relaxed">Tracking engine began recording coordinates.</p>
                  </div>
                </div>

                {/* Milestone 2 (Peak speed moments) */}
                {results.players.slice(0, 3).map((player, pIdx) => (
                  <div key={player.id} className="relative pl-6">
                    <div className="absolute -left-2 top-1.5 w-4 h-4 rounded-full bg-amber-500 ring-4 ring-amber-950 flex items-center justify-center border border-black">
                      <Zap className="w-2.5 h-2.5 text-black" />
                    </div>
                    <div>
                      <span className="text-[10px] font-mono font-bold text-amber-400">
                        {String(Math.floor((player.path[Math.floor(player.path.length / 2)]?.frame || 0) / (videoMetadata.fps * 60))).padStart(2, '0')}:
                        {String(Math.floor(((player.path[Math.floor(player.path.length / 2)]?.frame || 0) / videoMetadata.fps) % 60)).padStart(2, '0')}
                      </span>
                      <h4 className="text-xs font-bold text-gray-200 mt-0.5">Peak Sprint Speed | Player {player.id}</h4>
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        Top velocity spike detected: <span className="text-amber-400 font-bold">{player.topSpeed} km/h</span>.
                      </p>
                    </div>
                  </div>
                ))}

                {/* Milestone 3 (Match complete) */}
                <div className="relative pl-6">
                  <div className="absolute -left-2 top-1.5 w-4 h-4 rounded-full bg-indigo-500 ring-4 ring-indigo-950 flex items-center justify-center border border-black" />
                  <div>
                    <span className="text-[10px] font-mono font-bold text-indigo-400">
                      {Math.floor(videoMetadata.duration / 60)}:
                      {String(Math.floor(videoMetadata.duration % 60)).padStart(2, '0')}
                    </span>
                    <h4 className="text-xs font-bold text-gray-200 mt-0.5">Match Completed</h4>
                    <p className="text-[10px] text-gray-500 leading-relaxed">AI engine finalized logs and analytics.</p>
                  </div>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
