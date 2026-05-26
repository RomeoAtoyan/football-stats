import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Target, Camera, CheckCircle, AlertTriangle, Trash2, Settings, ZoomIn, ZoomOut, Maximize2, Minimize2, Move } from 'lucide-react';

const FIFA_PITCH_LINES = [
  // Outer boundary line (30m x 16m)
  [[0, 0], [30, 0], [30, 16], [0, 16], [0, 0]],
  // Halfway line
  [[15, 0], [15, 16]],
  // Left Penalty Area (6m deep, 10m wide)
  [[0, 3.0], [6.0, 3.0], [6.0, 13.0], [0, 13.0]],
  // Right Penalty Area (6m deep, 10m wide)
  [[30, 3.0], [24.0, 3.0], [24.0, 13.0], [30, 13.0]],
];

// Curated landmarks for the 30m x 16m pitch, including all four outer corners
const LANDMARKS = [
  { id: 'top_left_corner', name: 'Top-Left Corner', x: 0.0, y: 0.0, color: '#ec4899' },
  { id: 'bottom_left_corner', name: 'Bottom-Left Corner', x: 0.0, y: 16.0, color: '#ec4899' },
  { id: 'left_goal_top', name: 'Left Goal Top Post', x: 0.0, y: 6.5, color: '#f43f5e' },
  { id: 'left_goal_bottom', name: 'Left Goal Bottom Post', x: 0.0, y: 9.5, color: '#f43f5e' },
  { id: 'left_penalty_spot', name: 'Left Penalty Spot', x: 6.0, y: 8.0, color: '#3b82f6' },
  { id: 'center_spot', name: 'Center Spot (Center Mark)', x: 15.0, y: 8.0, color: '#eab308' },
  { id: 'halfway_line_top', name: 'Halfway Line Top Touchline', x: 15.0, y: 0.0, color: '#a855f7' },
  { id: 'halfway_line_bottom', name: 'Halfway Line Bottom Touchline', x: 15.0, y: 16.0, color: '#a855f7' },
  { id: 'right_penalty_spot', name: 'Right Penalty Spot', x: 24.0, y: 8.0, color: '#3b82f6' },
  { id: 'right_goal_top', name: 'Right Goal Top Post', x: 30.0, y: 6.5, color: '#f43f5e' },
  { id: 'right_goal_bottom', name: 'Right Goal Bottom Post', x: 30.0, y: 9.5, color: '#f43f5e' },
  { id: 'top_right_corner', name: 'Top-Right Corner', x: 30.0, y: 0.0, color: '#ec4899' },
  { id: 'bottom_right_corner', name: 'Bottom-Right Corner', x: 30.0, y: 16.0, color: '#ec4899' }
];

interface CalibrationPanelProps {
  onCalibrationSuccess: (homography: number[][], points: any[], rmse: number) => void;
  savedCalibration: any;
  videoStatus: string;
  simModeActive: boolean;
  totalFrames: number;
}

export default function CalibrationPanel({ 
  onCalibrationSuccess, 
  savedCalibration,
  videoStatus,
  simModeActive,
  totalFrames
}: CalibrationPanelProps) {
  const videoWidth = 1920;
  const videoHeight = 1080;

  // Manual mapping coordinates dictionary
  const [mappedPixels, setMappedPixels] = useState<Record<string, [number, number]>>({});
  const [activeLandmarkId, setActiveLandmarkId] = useState<string>(LANDMARKS[5].id); // Default to Center Spot
  
  const [imagePoints, setImagePoints] = useState<[number, number][]>([]);
  const [worldPoints, setWorldPoints] = useState<[number, number][]>([]);
  const [projectedGrid, setProjectedGrid] = useState<[number, number][][]>([]);
  const [rmse, setRmse] = useState<number | null>(null);
  const [currentFrameIdx, setCurrentFrameIdx] = useState<number>(0);
  const [imgLoadFailed, setImgLoadFailed] = useState<boolean>(false);
  
  // Immersive Studio states
  const [isStudioOpen, setIsStudioOpen] = useState<boolean>(false);
  
  // Viewport Zoom & Pan states
  const [zoom, setZoom] = useState<number>(1.0);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [activeTool, setActiveTool] = useState<'map' | 'pan'>('map');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [clickStart, setClickStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Lens distortion parameters
  const [lens, setLens] = useState({
    fx: 1500,
    fy: 1500,
    cx: 960,
    cy: 540,
    k1: -0.1,
    k2: 0.01,
    p1: 0.0,
    p2: 0.0
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialLoadDone = useRef(false);

  // Sync coordinates arrays whenever mappedPixels dictionary changes
  useEffect(() => {
    const imgPts: [number, number][] = [];
    const wrldPts: [number, number][] = [];
    
    LANDMARKS.forEach(lm => {
      if (mappedPixels[lm.id]) {
        imgPts.push(mappedPixels[lm.id]);
        wrldPts.push([lm.x, lm.y]);
      }
    });
    
    setImagePoints(imgPts);
    setWorldPoints(wrldPts);
  }, [mappedPixels]);

  // Restore saved calibration points ONCE on startup
  useEffect(() => {
    if (savedCalibration && savedCalibration.points && !initialLoadDone.current) {
      const newMapped: Record<string, [number, number]> = {};
      savedCalibration.points.forEach((p: any) => {
        const lm = LANDMARKS.find(
          l => Math.abs(l.x - p.real[0]) < 0.15 && Math.abs(l.y - p.real[1]) < 0.15
        );
        if (lm) {
          newMapped[lm.id] = p.pixel as [number, number];
        }
      });
      setMappedPixels(newMapped);
      setRmse(savedCalibration.rmse || null);
      initialLoadDone.current = true;
      triggerGridWarping();
    }
  }, [savedCalibration]);

  // Visual simulated stadium fallback view matching the 30m x 16m bounds
  const drawSimulatedStadium = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.fillStyle = '#081c15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < canvas.width; i += 80) {
      ctx.fillStyle = i % 160 === 0 ? '#1b4332' : '#2d6a4f';
      ctx.beginPath();
      ctx.moveTo(i, 150);
      ctx.lineTo(i + 80, 150);
      ctx.lineTo(i * 1.3 + 200, canvas.height);
      ctx.lineTo((i - 80) * 1.3 + 200, canvas.height);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(64, 145, 108, 0.15)';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, -100, 300, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 120, canvas.width, 30);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 120, canvas.width, 30);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText("• PITCHTRACK AI 30x16m CAMERA FEED (1920x1080) •", canvas.width / 2, 140);

    // Adjusted perspective transforms for futsal 30x16m scale
    const project = (wx: number, wy: number) => {
      const px = 200 + wx * 18.0 + (wy - 8.0) * (wx - 15.0) * 0.22;
      const py = 150 + wy * 13.5 + wx * 2.5;
      return [px, py];
    };

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2.5;

    // Draw white markings
    FIFA_PITCH_LINES.forEach(line => {
      ctx.beginPath();
      line.forEach((pt, idx) => {
        const [px, py] = project(pt[0], pt[1]);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    });

    // Center circle
    ctx.beginPath();
    for (let theta = 0; theta <= Math.PI * 2; theta += 0.1) {
      const cx = 15.0 + 3.0 * Math.sin(theta);
      const cy = 8.0 + 3.0 * Math.cos(theta);
      const [px, py] = project(cx, cy);
      if (theta === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const [lpx, lpy] = project(6.0, 8.0);
    ctx.beginPath(); ctx.arc(lpx, lpy, 4, 0, Math.PI * 2); ctx.fill();
    const [rpx, rpy] = project(24.0, 8.0);
    ctx.beginPath(); ctx.arc(rpx, rpy, 4, 0, Math.PI * 2); ctx.fill();

    // Goals (Centered on Y=8.0, 3m wide)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    const [lgtx, lgty] = project(0, 6.5);
    const [lgbx, lgby] = project(0, 9.5);
    ctx.beginPath(); ctx.moveTo(lgtx, lgty); ctx.lineTo(lgbx, lgby); ctx.stroke();
    const [rgtx, rgty] = project(30, 6.5);
    const [rgbx, rgby] = project(30, 9.5);
    ctx.beginPath(); ctx.moveTo(rgtx, rgty); ctx.lineTo(rgbx, rgby); ctx.stroke();

    ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
    ctx.fillRect(20, 20, 360, 48);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(20, 20, 360, 48);
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText("1. Click a landmark target on the 2D Pitch Sidebar map", 35, 36);
    ctx.fillText("2. Click on the camera field below to assign coordinates", 35, 52);
  };

  const drawPitchMarkingsOverlay = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.fillStyle = 'rgba(11, 15, 25, 0.85)';
    ctx.fillRect(20, 20, 380, 48);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(20, 20, 380, 48);
    
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`• ACTIVE WORKSPACE FRAME: #${currentFrameIdx}`, 32, 36);
    
    const activeLM = LANDMARKS.find(l => l.id === activeLandmarkId);
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.fillText(`Targeting landmark: ${activeLM?.name || ''} (Click to assign)`, 32, 52);
  };

  // Reset image load failure states when frame or video context changes
  useEffect(() => {
    setImgLoadFailed(false);
  }, [currentFrameIdx, videoStatus]);

  // Draw simulated stadium on canvas for fallback/simulator mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSimulatedStadium(ctx, canvas);
  }, [videoStatus, simModeActive, imgLoadFailed, isStudioOpen]);

  // Imperative wheel zoom listener on container for passive: false prevention
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const zoomFactor = 1.15;
      const isZoomIn = e.deltaY < 0;

      setZoom(prevZoom => {
        const nextZoom = isZoomIn 
          ? Math.min(8.0, prevZoom * zoomFactor) 
          : Math.max(1.0, prevZoom / zoomFactor);

        if (nextZoom === 1.0) {
          setPanX(0);
          setPanY(0);
        } else {
          setPanX(prevPanX => cursorX - (nextZoom / prevZoom) * (cursorX - prevPanX));
          setPanY(prevPanY => cursorY - (nextZoom / prevZoom) * (cursorY - prevPanY));
        }
        return nextZoom;
      });
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click only
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (activeTool === 'pan' || e.button === 1 || e.shiftKey) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
      e.preventDefault();
    } else {
      setClickStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setPanX(e.clientX - dragStart.x);
      setPanY(e.clientY - dragStart.y);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      return;
    }

    const dx = Math.abs(e.clientX - clickStart.x);
    const dy = Math.abs(e.clientY - clickStart.y);
    if (dx < 4 && dy < 4 && activeTool === 'map') {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const xOrig = (clickX - panX) / zoom;
      const yOrig = (clickY - panY) / zoom;

      // Convert back to 1920x1080 pixel coordinates relative to original 1080p foot print
      const finalX = (xOrig / rect.width) * videoWidth;
      const finalY = (yOrig / rect.height) * videoHeight;

      // Ensure coordinate lands on original image physical footprint
      if (finalX >= 0 && finalX <= videoWidth && finalY >= 0 && finalY <= videoHeight) {
        setMappedPixels(prev => ({
          ...prev,
          [activeLandmarkId]: [finalX, finalY]
        }));
      }
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const removeLandmarkMapping = (landmarkId: string) => {
    setMappedPixels(prev => {
      const updated = { ...prev };
      delete updated[landmarkId];
      return updated;
    });
    if (Object.keys(mappedPixels).length <= 4) {
      setProjectedGrid([]);
      setRmse(null);
    }
  };

  const clearAllPoints = () => {
    setMappedPixels({});
    setProjectedGrid([]);
    setRmse(null);
    initialLoadDone.current = false;
  };

  const resetViewTransform = () => {
    setZoom(1.0);
    setPanX(0);
    setPanY(0);
  };

  const triggerGridWarping = async () => {
    try {
      const gridRes = await fetch("http://localhost:8000/api/calibrate/grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: FIFA_PITCH_LINES })
      });
      const data = await gridRes.json();
      if (data.status === "success" && data.projected_lines) {
        setProjectedGrid(data.projected_lines);
      }
    } catch (err) {
      console.error("Failed to warp grid:", err);
    }
  };

  const submitCalibration = async () => {
    const imgPts = Object.values(mappedPixels);
    const wrldPts: [number, number][] = [];
    
    LANDMARKS.forEach(lm => {
      if (mappedPixels[lm.id]) {
        wrldPts.push([lm.x, lm.y]);
      }
    });

    if (imgPts.length < 4) return;
    
    try {
      const calibRes = await fetch("http://localhost:8000/api/calibrate/homography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_points: imgPts, world_points: wrldPts })
      });
      
      if (calibRes.ok) {
        const result = await calibRes.json();
        setRmse(result.rmse);
        
        await triggerGridWarping();
        onCalibrationSuccess(result.homography, result.points || [], result.rmse);
      }
    } catch (err) {
      console.error("Calibration failed:", err);
    }
  };

  const updateLensOnBackend = async () => {
    try {
      await fetch("http://localhost:8000/api/calibrate/lens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lens)
      });
      if (Object.keys(mappedPixels).length >= 4) {
        submitCalibration();
      }
    } catch (err) {
      console.error("Lens parameters update failed:", err);
    }
  };

  const handleSliderChange = (param: string, val: number) => {
    setLens(prev => ({ ...prev, [param]: val }));
  };

  // Re-run calibration when coordinates map changes
  useEffect(() => {
    if (Object.keys(mappedPixels).length >= 4) {
      submitCalibration();
    }
  }, [mappedPixels]);

  // Main UI components layout (renders standard embedded panel or massive fullscreen precision overlay studio)
  const renderWorkspaceLayout = () => {
    const activeLM = LANDMARKS.find(l => l.id === activeLandmarkId);
    const activePixel = mappedPixels[activeLandmarkId];

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 relative flex-1 min-h-0">
        
        {/* Left: Raw video workspace with Canvas, SVG zoom translations and float settings */}
        <div className="lg:col-span-2 flex flex-col gap-4 relative min-h-0">
          
          {/* Zoom/Pan floating controller bar */}
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-[#ffffff0a] backdrop-blur-md shadow-lg">
            <button
              onClick={() => setActiveTool('map')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                activeTool === 'map' ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
              title="Place targets on the video"
            >
              <Target className="w-4 h-4" />
              <span className="hidden sm:inline">Map</span>
            </button>
            <button
              onClick={() => setActiveTool('pan')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                activeTool === 'pan' ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
              title="Click and drag to pan field"
            >
              <Move className="w-4 h-4" />
              <span className="hidden sm:inline">Pan</span>
            </button>

            <div className="h-4 w-[1px] bg-slate-800" />

            <button
              onClick={() => setZoom(prev => Math.min(prev + 0.25, 4.0))}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom(prev => Math.max(prev - 0.25, 1.0))}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            
            <button
              onClick={resetViewTransform}
              className="p-1 text-[10px] bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white font-mono rounded px-1.5 transition cursor-pointer"
              title="Reset Zoom"
            >
              {(zoom * 100).toFixed(0)}%
            </button>
          </div>

          {/* Interactive Workspace Area (Translated & Scaled via React state transform) */}
          <div 
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            className={`relative border border-slate-800/80 rounded-xl overflow-hidden bg-black aspect-video group shadow-inner flex-1 min-h-[420px] select-none ${
              activeTool === 'pan' 
                ? isDragging ? 'cursor-grabbing' : 'cursor-grab' 
                : 'cursor-crosshair'
            }`}
          >
            <div 
              style={{ 
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, 
                transformOrigin: 'top left',
                width: '100%',
                height: '100%',
                position: 'relative'
              }}
              className="transition-transform duration-75 ease-out"
            >
              {videoStatus === "ready" && !simModeActive && !imgLoadFailed ? (
                <img
                  src={`http://localhost:8000/api/video/frame/${currentFrameIdx}?t=${currentFrameIdx}`}
                  alt="Video Frame"
                  onError={() => setImgLoadFailed(true)}
                  className="w-full h-full object-cover select-none pointer-events-none"
                  draggable={false}
                />
              ) : (
                <canvas
                  ref={canvasRef}
                  width={960}
                  height={540}
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}

              {/* SVG overlay wrapper */}
              <svg 
                className="absolute inset-0 w-full h-full pointer-events-none z-10 select-none" 
                viewBox={`0 0 ${videoWidth} ${videoHeight}`}
              >
                {/* Warped Distorted Calibration lines */}
                {projectedGrid.map((line, i) => (
                  <polyline
                    key={i}
                    points={line.map(pt => `${pt[0]},${pt[1]}`).join(' ')}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.8"
                    strokeDasharray="4 8"
                  />
                ))}

                {/* Circle control marks */}
                {LANDMARKS.map((lm) => {
                  const pt = mappedPixels[lm.id];
                  if (!pt) return null;
                  const isSelected = activeLandmarkId === lm.id;
                  return (
                    <g key={lm.id}>
                      <circle 
                        cx={pt[0]} 
                        cy={pt[1]} 
                        r={isSelected ? "22" : "12"} 
                        fill={lm.color} 
                        opacity="0.25"
                      />
                      <circle 
                        cx={pt[0]} 
                        cy={pt[1]} 
                        r="6" 
                        fill={lm.color} 
                        stroke="#ffffff"
                        strokeWidth="2.5"
                      />
                      <text
                        x={pt[0]}
                        y={pt[1] - 16}
                        fill={lm.color}
                        fontSize="14"
                        fontWeight="bold"
                        textAnchor="middle"
                        style={{ textShadow: '0px 0px 4px rgba(0,0,0,0.9)' }}
                      >
                        {lm.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Premium Glassmorphic Frame Selector (Choose from first 10 frames) */}
          {videoStatus === "ready" && !simModeActive && (
            <div className="flex items-center gap-3 bg-slate-900/40 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="font-bold text-slate-400 uppercase tracking-wider min-w-[130px] flex-shrink-0">Choose Active Frame:</span>
              <div className="flex gap-1.5 overflow-x-auto py-1 scrollbar-none">
                {Array.from({ length: Math.min(10, totalFrames) }).map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setCurrentFrameIdx(idx)}
                    className={`px-3 py-1.5 rounded-lg font-mono font-bold transition cursor-pointer shrink-0 ${
                      currentFrameIdx === idx
                        ? 'bg-amber-600 text-white shadow-lg shadow-amber-950/20'
                        : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 hover:bg-slate-850 border border-[#ffffff05]'
                    }`}
                  >
                    F#{idx}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center bg-slate-900/30 p-2.5 rounded-lg border border-[#ffffff05] text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
              <span>Use mouse wheel to zoom (centered on cursor). Select Pan tool, hold Space, or hold Shift to drag & move the viewport. Click in Map mode to seed points.</span>
            </span>
            <span className="font-mono">Scale: {(zoom*100).toFixed(0)}%</span>
          </div>

        </div>

        {/* Right Sidebar: VISUAL 2D TOP VIEW SOCCER FIELD LANDMARK SELECTOR */}
        <div className="flex flex-col gap-4 bg-slate-950/20 p-4 rounded-xl border border-slate-800 justify-between">
          
          <div className="flex flex-col gap-4">
            
            {/* Visual selector field diagram (configured to 30x16m proportions) */}
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-bold text-slate-300 flex justify-between items-center">
                <span>Step 1: Choose 2D Pitch Landmark</span>
                {Object.keys(mappedPixels).length > 0 && (
                  <button 
                    onClick={clearAllPoints}
                    className="text-rose-400 hover:text-rose-300 transition text-[10px] cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </span>
              
              <div className="flex justify-center p-2.5 bg-[#0b251a]/40 rounded-xl border border-[#2d6a4f]/25 shadow-inner">
                <svg width="270" height="180" viewBox="0 0 300 200" className="w-full max-w-[270px] select-none">
                  {/* Grass Base */}
                  <rect x="0" y="0" width="300" height="200" fill="#1b4332" rx="8" />
                  
                  {/* Grass cut patterns stripes */}
                  {Array.from({ length: 10 }).map((_, i) => (
                    i % 2 === 0 && (
                      <rect key={i} x={15 + i * 27} y="15" width="27" height="170" fill="#2d6a4f" opacity="0.35" />
                    )
                  ))}

                  {/* Pitch outlines lines (30m x 16m) */}
                  <rect x="15" y="15" width="270" height="170" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  <line x1="150" y1="15" x2="150" y2="185" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  
                  {/* Center circle (3.0m radius futsal standard: X=15m, Y=8m) */}
                  <circle cx="150" cy="100" r="27" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  
                  {/* Left Penalty Area (6m deep, 10m wide) */}
                  <rect x="15" y="47" width="54" height="106" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  
                  {/* Right Penalty Area (6m deep, 10m wide) */}
                  <rect x="231" y="47" width="54" height="106" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />

                  {/* Left goal (3m wide) */}
                  <line x1="15" y1="84" x2="10" y2="84" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="15" y1="116" x2="10" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="10" y1="84" x2="10" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />

                  {/* Right goal (3m wide) */}
                  <line x1="285" y1="84" x2="290" y2="84" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="285" y1="116" x2="290" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="290" y1="84" x2="290" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />

                  {/* Interactive keypoint targets overlays */}
                  {LANDMARKS.map((lm) => {
                    const pixel = mappedPixels[lm.id];
                    const isSelected = activeLandmarkId === lm.id;
                    
                    let cx = 150;
                    let cy = 100;
                    if (lm.id === 'top_left_corner') { cx = 15; cy = 15; }
                    else if (lm.id === 'bottom_left_corner') { cx = 15; cy = 185; }
                    else if (lm.id === 'left_goal_top') { cx = 15; cy = 84; }
                    else if (lm.id === 'left_goal_bottom') { cx = 15; cy = 116; }
                    else if (lm.id === 'left_penalty_spot') { cx = 69; cy = 100; }
                    else if (lm.id === 'center_spot') { cx = 150; cy = 100; }
                    else if (lm.id === 'halfway_line_top') { cx = 150; cy = 15; }
                    else if (lm.id === 'halfway_line_bottom') { cx = 150; cy = 185; }
                    else if (lm.id === 'right_penalty_spot') { cx = 231; cy = 100; }
                    else if (lm.id === 'right_goal_top') { cx = 285; cy = 84; }
                    else if (lm.id === 'right_goal_bottom') { cx = 285; cy = 116; }
                    else if (lm.id === 'top_right_corner') { cx = 285; cy = 15; }
                    else if (lm.id === 'bottom_right_corner') { cx = 285; cy = 185; }

                    return (
                      <g key={lm.id} className="cursor-pointer" onClick={() => setActiveLandmarkId(lm.id)}>
                        {isSelected && (
                          <circle cx={cx} cy={cy} r="12" fill="#eab308" opacity="0.45" className="animate-ping" />
                        )}
                        <circle 
                          cx={cx} 
                          cy={cy} 
                          r={isSelected ? "6" : "5"} 
                          fill={pixel ? "#10b981" : "#ef4444"} 
                          stroke="#ffffff"
                          strokeWidth="1.5"
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex justify-between items-center text-[9px] text-gray-500 border-b border-[#ffffff05] pb-2 font-mono">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#ef4444] rounded-full" /> Unmapped</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#10b981] rounded-full" /> Mapped</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#eab308] rounded-full" /> Selected Target</span>
              </div>
            </div>

            {/* Landmark active status inspector card */}
            {activeLM && (
              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 text-xs flex flex-col gap-2.5">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-extrabold text-white text-sm flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeLM.color }} />
                      {activeLM.name}
                    </span>
                    <span className="text-[10px] text-gray-500">Real Metric: ({activeLM.x}m, {activeLM.y}m)</span>
                  </div>
                  {activePixel && (
                    <button
                      onClick={() => removeLandmarkMapping(activeLM.id)}
                      className="text-gray-500 hover:text-rose-400 p-1.5 hover:bg-slate-800 rounded-lg transition cursor-pointer"
                      title="Clear this mapping"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex justify-between items-center py-1 px-2.5 bg-slate-950/40 rounded-lg border border-[#ffffff03] font-mono text-[10px]">
                  <span className="text-gray-400">Mapping State:</span>
                  <span className={`font-bold ${activePixel ? 'text-emerald-400' : 'text-amber-500 animate-pulse'}`}>
                    {activePixel ? `[${activePixel[0].toFixed(0)}px, ${activePixel[1].toFixed(0)}px]` : '⚠️ [Click Video to Assign]'}
                  </span>
                </div>
              </div>
            )}

          </div>

          {/* Quick list details tracker for all mapped points */}
          <div className="bg-slate-900/10 p-3 rounded-lg border border-slate-800/60 text-[10px] text-gray-400 flex flex-col gap-1.5">
            <span className="font-bold text-slate-300 uppercase tracking-wider text-[9px]">Mappings Mapped: ({Object.keys(mappedPixels).length}/13)</span>
            <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto pr-1 scrollbar-thin">
              {LANDMARKS.map((lm, idx) => {
                const px = mappedPixels[lm.id];
                return (
                  <div key={lm.id} className="flex justify-between text-slate-500 font-mono text-[9px]">
                    <span className={px ? 'text-slate-300' : 'text-slate-600'}>{idx + 1}. {lm.name}:</span>
                    <span className={px ? 'text-emerald-400 font-bold' : 'text-slate-600'}>
                      {px ? `[${px[0].toFixed(0)}, ${px[1].toFixed(0)}]` : 'Unmapped'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    );
  };

  return (
    <>
      {/* Standard embedded panel mode */}
      {!isStudioOpen && (
        <div className="flex flex-col gap-6 p-6 glass rounded-2xl shadow-2xl relative overflow-hidden border border-[#ffffff08]">
          
          {/* Calibration Header */}
          <div className="flex justify-between items-center border-b border-[#ffffff10] pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white">Manual Field Calibration (30m x 16m)</h3>
                <p className="text-xs text-gray-400">Visually choose corners or markings on the 2D Pitch Sidebar, then click on the video feed to map</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Fullscreen Studio Trigger */}
              <button
                onClick={() => {
                  setIsStudioOpen(true);
                  resetViewTransform();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 border border-amber-500/25 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Enter Fullscreen Studio</span>
              </button>

              {/* RMSE Badge */}
              {rmse !== null ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>RMSE: {rmse.toFixed(3)}m</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/50 text-slate-400 rounded-lg text-xs font-semibold border border-slate-700/20">
                  <Target className="w-3.5 h-3.5" />
                  <span>Map ≥ 4 points</span>
                </div>
              )}
            </div>
          </div>

          {/* Render standard layout view inline */}
          {renderWorkspaceLayout()}

          {/* Intrinsic parameters sliders */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-950/20 p-4 rounded-xl border border-slate-800">
            <div className="flex flex-col gap-1 md:col-span-3 pb-2 border-b border-[#ffffff08]">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-300">
                <Settings className="w-4 h-4 text-emerald-400" />
                <span>Focal Length & Distortion Coefficients (Brown-Conrady Lens Undistortion)</span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
                <span>Focal Length (fx / fy)</span>
                <span className="text-emerald-400 font-mono text-[10px]">{lens.fx} px</span>
              </span>
              <input
                type="range"
                min="800"
                max="2500"
                step="10"
                value={lens.fx}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setLens(p => ({ ...p, fx: val, fy: val }));
                }}
                onMouseUp={updateLensOnBackend}
                onTouchEnd={updateLensOnBackend}
                className="w-full accent-emerald-500 bg-slate-800 h-1 rounded-lg cursor-pointer"
              />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
                <span>Principal Point Offset (cx / cy)</span>
                <span className="text-emerald-400 font-mono text-[10px]">{lens.cx}px, {lens.cy}px</span>
              </span>
              <div className="flex gap-2">
                <input
                  type="range"
                  min="0"
                  max={videoWidth}
                  step="5"
                  value={lens.cx}
                  onChange={(e) => handleSliderChange('cx', parseInt(e.target.value))}
                  onMouseUp={updateLensOnBackend}
                  onTouchEnd={updateLensOnBackend}
                  className="w-1/2 accent-emerald-500 bg-slate-800 h-1 rounded-lg cursor-pointer"
                />
                <input
                  type="range"
                  min="0"
                  max={videoHeight}
                  step="5"
                  value={lens.cy}
                  onChange={(e) => handleSliderChange('cy', parseInt(e.target.value))}
                  onMouseUp={updateLensOnBackend}
                  onTouchEnd={updateLensOnBackend}
                  className="w-1/2 accent-emerald-500 bg-slate-800 h-1 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-400 flex items-center justify-between">
                <span>Radial Distortions (k1 / k2)</span>
                <span className="text-emerald-400 font-mono text-[10px]">{lens.k1.toFixed(3)}, {lens.k2.toFixed(3)}</span>
              </span>
              <div className="flex gap-2">
                <input
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.005"
                  value={lens.k1}
                  onChange={(e) => handleSliderChange('k1', parseFloat(e.target.value))}
                  onMouseUp={updateLensOnBackend}
                  onTouchEnd={updateLensOnBackend}
                  className="w-1/2 accent-emerald-500 bg-slate-800 h-1 rounded-lg cursor-pointer"
                />
                <input
                  type="range"
                  min="-0.1"
                  max="0.1"
                  step="0.001"
                  value={lens.k2}
                  onChange={(e) => handleSliderChange('k2', parseFloat(e.target.value))}
                  onMouseUp={updateLensOnBackend}
                  onTouchEnd={updateLensOnBackend}
                  className="w-1/2 accent-emerald-500 bg-slate-800 h-1 rounded-lg cursor-pointer"
                />
              </div>
            </div>
          </div>

        </div>
      )}

      {/* IMMERSIVE FULL-SCREEN / PRECISION OVERLAY STUDIO VIEW */}
      {isStudioOpen && (
        <div className="fixed inset-0 z-50 bg-[#070b13] flex flex-col p-6 overflow-hidden animate-fadeIn">
          
          {/* Fullscreen Studio Header */}
          <div className="flex justify-between items-center border-b border-[#ffffff10] pb-4 mb-6 relative z-30">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
                <Maximize2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                  Precision Calibration Studio (30m x 16m Pitch)
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] rounded border border-emerald-500/20 font-mono font-bold">Zoom & Pan Active</span>
                </h3>
                <p className="text-xs text-gray-400">Zoom in up to 600% and pan around the frame to place corners or markings with pixel-perfect precision</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Precision Badge */}
              {rmse !== null && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-lg text-xs font-semibold">
                  <CheckCircle className="w-4 h-4" />
                  <span>Reprojection RMSE: {rmse.toFixed(3)}m (High Accuracy)</span>
                </div>
              )}

              {/* Save & Exit Button */}
              <button
                onClick={() => setIsStudioOpen(false)}
                disabled={Object.keys(mappedPixels).length < 4}
                className={`flex items-center gap-1.5 px-5 py-3 rounded-xl font-bold transition shadow-lg ${
                  Object.keys(mappedPixels).length >= 4
                    ? 'bg-gradient-to-r from-emerald-600 to-[#2d6a4f] hover:from-emerald-500 hover:to-[#40916c] text-white cursor-pointer shadow-emerald-950/20 shadow-lg'
                    : 'bg-slate-900 border border-[#ffffff05] text-slate-500 cursor-not-allowed'
                }`}
              >
                <Minimize2 className="w-4 h-4" />
                <span>Apply Calibration & Exit Studio</span>
              </button>
            </div>
          </div>

          {/* Subframe instructions */}
          {Object.keys(mappedPixels).length < 4 && (
            <div className="mb-4 p-3 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl text-xs flex items-center gap-2 relative z-30 font-semibold animate-pulse">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Map at least 4 point correspondences to enable calibration matrix homography output before exiting.</span>
            </div>
          )}

          {/* Main workspace (takes full available remaining height) */}
          <div className="flex-1 min-h-0 relative z-20 flex flex-col gap-6">
            {renderWorkspaceLayout()}
          </div>
        </div>
      )}
    </>
  );
}
