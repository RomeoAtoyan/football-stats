import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Target, Camera, CheckCircle, AlertTriangle, Trash2, Settings, ZoomIn, ZoomOut, Maximize2, Minimize2, Hand, X, Grid } from 'lucide-react';

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

// Curated landmarks for the 30m x 16m pitch
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

  // Manual mapping coordinates dictionary: Key is landmark ID, Value is [pixelX, pixelY]
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
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const [showGridOverlay, setShowGridOverlay] = useState<boolean>(true);

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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialLoadDone = useRef(false);

  const effectiveTool = spacePressed ? 'pan' : activeTool;

  // Keyboard Spacebar / Shift pan toggle shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Sync coordinates arrays whenever mappedPixels dictionary changes
  useEffect(() => {
    const imgPts: [number, number][] = [];
    const wrldPts: [number, number][] = [];
    
    LANDMARKS.forEach(lm => {
      const pt = mappedPixels[lm.id];
      if (pt) {
        imgPts.push(pt);
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

  // Reset image load failure states when frame or video context changes
  useEffect(() => {
    setImgLoadFailed(false);
  }, [currentFrameIdx, videoStatus]);

  // Zoom center on mouse cursor scroll handler
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click only
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (effectiveTool === 'pan' || e.button === 1 || e.shiftKey) {
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
    } else if (draggingPinId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const xOrig = (clickX - panX) / zoom;
      const yOrig = (clickY - panY) / zoom;

      const finalX = Math.max(0, Math.min(videoWidth, (xOrig / rect.width) * videoWidth));
      const finalY = Math.max(0, Math.min(videoHeight, (yOrig / rect.height) * videoHeight));

      setMappedPixels(prev => ({
        ...prev,
        [draggingPinId]: [finalX, finalY]
      }));
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      return;
    }

    if (draggingPinId) {
      setDraggingPinId(null);
      return;
    }

    const dx = Math.abs(e.clientX - clickStart.x);
    const dy = Math.abs(e.clientY - clickStart.y);
    if (dx < 4 && dy < 4 && effectiveTool === 'map') {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const xOrig = (clickX - panX) / zoom;
      const yOrig = (clickY - panY) / zoom;

      // Convert back to 1920x1080 pixel coordinates relative to original 1080p footprint
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
    setDraggingPinId(null);
  };

  const handlePinMouseDown = (e: React.MouseEvent, landmarkId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPinId(landmarkId);
    setActiveLandmarkId(landmarkId);
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

  const recalculateLiveHomography = async () => {
    if (imagePoints.length < 4) return;
    
    try {
      const calibRes = await fetch("http://localhost:8000/api/calibrate/homography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_points: imagePoints, world_points: worldPoints })
      });
      
      if (calibRes.ok) {
        const result = await calibRes.json();
        setRmse(result.rmse);
        await triggerGridWarping();
        return result;
      }
    } catch (err) {
      console.error("Failed to recalculate live homography in background:", err);
    }
  };

  const applyAndSaveCalibration = async () => {
    if (imagePoints.length < 4) {
      alert("Please map at least 4 landmarks before applying calibration.");
      return;
    }
    
    try {
      const calibRes = await fetch("http://localhost:8000/api/calibrate/homography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_points: imagePoints, world_points: worldPoints })
      });
      
      if (calibRes.ok) {
        const result = await calibRes.json();
        setRmse(result.rmse);
        onCalibrationSuccess(result.homography, result.points || [], result.rmse);
        setIsStudioOpen(false);
      } else {
        alert("Calibration computation failed. Verify your keypoints and try again.");
      }
    } catch (err) {
      console.error("Calibration apply failed:", err);
      alert("Failed to connect to backend server for calibration.");
    }
  };

  const updateLensOnBackend = async () => {
    try {
      await fetch("http://localhost:8000/api/calibrate/lens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lens)
      });
      if (imagePoints.length >= 4) {
        recalculateLiveHomography();
      }
    } catch (err) {
      console.error("Lens parameters update failed:", err);
    }
  };

  const handleSliderChange = (param: string, val: number) => {
    setLens(prev => ({ ...prev, [param]: val }));
  };

  // Reset grid and RMSE if mapped points drop below 4
  useEffect(() => {
    if (imagePoints.length < 4) {
      setProjectedGrid([]);
      setRmse(null);
    }
  }, [imagePoints]);

  // Generates declarative SVG mock stadium fallback view matching the 30m x 16m bounds
  const renderSimulatedStadiumSVG = () => {
    const project = (wx: number, wy: number) => {
      const px = 200 + wx * 18.0 + (wy - 8.0) * (wx - 15.0) * 0.22;
      const py = 150 + wy * 13.5 + wx * 2.5;
      return [px * 2, py * 2];
    };

    const lines: [number, number][][] = [];
    FIFA_PITCH_LINES.forEach(line => {
      const projectedLine = line.map(pt => project(pt[0], pt[1]) as [number, number]);
      lines.push(projectedLine);
    });

    const centerCirclePoints: [number, number][] = [];
    for (let theta = 0; theta <= Math.PI * 2; theta += 0.1) {
      const cx = 15.0 + 3.0 * Math.sin(theta);
      const cy = 8.0 + 3.0 * Math.cos(theta);
      centerCirclePoints.push(project(cx, cy) as [number, number]);
    }

    const leftGoalTop = project(0, 6.5);
    const leftGoalBottom = project(0, 9.5);
    const rightGoalTop = project(30, 6.5);
    const rightGoalBottom = project(30, 9.5);

    const leftPenaltySpot = project(6.0, 8.0);
    const rightPenaltySpot = project(24.0, 8.0);

    return (
      <svg viewBox="0 0 1920 1080" className="w-full h-full object-cover select-none bg-[#081c15]" draggable={false}>
        {/* Draw lawn stripes */}
        {Array.from({ length: 12 }).map((_, i) => {
          const wx1 = i * 2.5;
          const wx2 = (i + 1) * 2.5;
          const p1 = project(wx1, 0);
          const p2 = project(wx2, 0);
          const p3 = project(wx2, 16);
          const p4 = project(wx1, 16);
          const fill = i % 2 === 0 ? '#1b4332' : '#2d6a4f';
          return (
            <polygon
              key={i}
              points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]} ${p4[0]},${p4[1]}`}
              fill={fill}
              opacity="0.95"
            />
          );
        })}

        {/* Outer boundaries and lines */}
        {lines.map((line, idx) => (
          <polyline
            key={idx}
            points={line.map(p => `${p[0]},${p[1]}`).join(' ')}
            fill="none"
            stroke="rgba(255, 255, 255, 0.65)"
            strokeWidth="5"
          />
        ))}

        {/* Center circle */}
        <polyline
          points={centerCirclePoints.map(p => `${p[0]},${p[1]}`).join(' ')}
          fill="none"
          stroke="rgba(255, 255, 255, 0.65)"
          strokeWidth="5"
        />

        {/* Penalty spots */}
        <circle cx={leftPenaltySpot[0]} cy={leftPenaltySpot[1]} r="7" fill="rgba(255, 255, 255, 0.95)" />
        <circle cx={rightPenaltySpot[0]} cy={rightPenaltySpot[1]} r="7" fill="rgba(255, 255, 255, 0.95)" />

        {/* Goal lines */}
        <line x1={leftGoalTop[0]} y1={leftGoalTop[1]} x2={leftGoalBottom[0]} y2={leftGoalBottom[1]} stroke="#ffffff" strokeWidth="8" />
        <line x1={rightGoalTop[0]} y1={rightGoalTop[1]} x2={rightGoalBottom[0]} y2={rightGoalBottom[1]} stroke="#ffffff" strokeWidth="8" />

        {/* Header Ribbon overlay */}
        <rect x="0" y="240" width="1920" height="60" fill="#0f172a" stroke="#334155" strokeWidth="2" />
        <text x="960" y="278" fill="#f8fafc" fontSize="20" fontWeight="bold" fontFamily="monospace" textAnchor="middle">
          • PITCHTRACK AI 30x16m CAMERA FEED (1920x1080) •
        </text>
      </svg>
    );
  };

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
                effectiveTool === 'map' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
              title="Place targets on the video"
            >
              <Target className="w-4 h-4" />
              <span className="hidden sm:inline">Map</span>
            </button>
            <button
              onClick={() => setActiveTool('pan')}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition cursor-pointer ${
                effectiveTool === 'pan' ? 'bg-amber-600 text-white shadow-md shadow-amber-900/20' : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
              title="Click and drag to pan field"
            >
              <Hand className="w-4 h-4" />
              <span className="hidden sm:inline">Pan</span>
            </button>

            <div className="h-4 w-[1px] bg-slate-800" />

            <button
              onClick={() => adjustZoom(0.5)}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => adjustZoom(-0.5)}
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

          {/* Interactive Workspace Area */}
          <div 
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onWheel={handleWheel}
            className={`relative border border-slate-800/80 rounded-xl overflow-hidden bg-black w-full aspect-video group shadow-inner select-none ${
              effectiveTool === 'pan' 
                ? isDragging ? 'cursor-grabbing' : 'cursor-grab' 
                : draggingPinId ? 'cursor-grabbing' : 'cursor-crosshair'
            }`}
          >
            {/* Viewport Scaled and Panned via CSS transforms (V4 style: pins placed inside automatically scale together) */}
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
                  className="w-full h-full object-fill select-none pointer-events-none"
                  draggable={false}
                />
              ) : (
                renderSimulatedStadiumSVG()
              )}

              {/* SVG grid lines overlay */}
              <svg 
                className="absolute inset-0 w-full h-full pointer-events-none z-10 select-none" 
                viewBox={`0 0 ${videoWidth} ${videoHeight}`}
              >
                {/* Warped Distorted Calibration grid */}
                {showGridOverlay && projectedGrid.map((line, i) => (
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
              </svg>

              {/* Pin overlays placed relatively inside the zoomed wrapper to preserve mapping position */}
              {LANDMARKS.map((lm, idx) => {
                const pt = mappedPixels[lm.id];
                if (!pt) return null;
                const isSelected = activeLandmarkId === lm.id;
                const screenX = (pt[0] / videoWidth) * 100;
                const screenY = (pt[1] / videoHeight) * 100;

                return (
                  <div
                    key={lm.id}
                    onMouseDown={(e) => handlePinMouseDown(e, lm.id)}
                    className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-white shadow-xl border-[2.5px] border-white transition-all z-20 hover:scale-115 select-none ${
                      isSelected 
                        ? 'bg-amber-600 shadow-[0_0_15px_#d97706] scale-110 cursor-grabbing' 
                        : 'bg-emerald-600 shadow-[0_0_12px_#059669] cursor-grab active:cursor-grabbing'
                    }`}
                    style={{
                      left: `${screenX}%`,
                      top: `${screenY}%`,
                      transform: 'translate(-50%, -50%)',
                      fontFamily: 'monospace'
                    }}
                    title={`Drag to reposition ${lm.name}`}
                  >
                    {idx + 1}
                  </div>
                );
              })}
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
              <span>Use scroll wheel to zoom (centers on cursor). Select Pan tool, hold Space, or hold Shift to drag. Click in Map mode to seed points. Drag existing pins to reposition.</span>
            </span>
            <span className="font-mono">Scale: {(zoom*100).toFixed(0)}%</span>
          </div>

        </div>

        {/* Right Sidebar: VISUAL 2D TOP VIEW SOCCER FIELD LANDMARK SELECTOR */}
        <div className="flex flex-col gap-4 bg-slate-950/20 p-4 rounded-xl border border-slate-800 overflow-y-auto pr-1 scrollbar-thin">
          
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
                  
                  {/* Center circle (3.0m radius futsal standard) */}
                  <circle cx="150" cy="100" r="27" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  
                  {/* Left Penalty Area */}
                  <rect x="15" y="47" width="54" height="106" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />
                  
                  {/* Right Penalty Area */}
                  <rect x="231" y="47" width="54" height="106" fill="none" stroke="#ffffff" strokeWidth="1.5" opacity="0.6" />

                  {/* Left goal */}
                  <line x1="15" y1="84" x2="10" y2="84" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="15" y1="116" x2="10" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="10" y1="84" x2="10" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />

                  {/* Right goal */}
                  <line x1="285" y1="84" x2="290" y2="84" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="285" y1="116" x2="290" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
                  <line x1="290" y1="84" x2="290" y2="116" stroke="#ffffff" strokeWidth="2" opacity="0.8" />

                  {/* Interactive keypoint targets overlays */}
                  {LANDMARKS.map((lm, idx) => {
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
                          r={isSelected ? "7" : "5.5"} 
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
                  <span className="text-gray-405 font-medium">Mapping:</span>
                  <span className={`font-bold ${activePixel ? 'text-emerald-405' : 'text-amber-500 animate-pulse'}`}>
                    {activePixel ? `[${activePixel[0].toFixed(0)}px, ${activePixel[1].toFixed(0)}px]` : '⚠️ [Click Video to Assign]'}
                  </span>
                </div>
              </div>
            )}

          </div>

          {/* Quick list details tracker for all mapped points */}
          <div className="bg-slate-900/10 p-3 rounded-lg border border-slate-800/60 text-[10px] text-gray-400 flex flex-col gap-1.5">
            <span className="font-bold text-slate-350 uppercase tracking-wider text-[9px]">Mappings Mapped: ({Object.keys(mappedPixels).length}/13)</span>
            <div className="flex flex-col gap-1 max-h-[140px] overflow-y-auto pr-1 scrollbar-thin">
              {LANDMARKS.map((lm, idx) => {
                const px = mappedPixels[lm.id];
                return (
                  <div key={lm.id} className="flex justify-between text-slate-505 font-mono text-[9px]">
                    <span className={px ? 'text-slate-305 hover:text-white cursor-pointer' : 'text-slate-600'} onClick={() => setActiveLandmarkId(lm.id)}>{idx + 1}. {lm.name}:</span>
                    <span className={px ? 'text-emerald-404 font-bold' : 'text-slate-600'}>
                      {px ? `[${px[0].toFixed(0)}, ${px[1].toFixed(0)}]` : 'Unmapped'}
                    </span>
                  </div>
                );
              })}
            </div>
            
            {/* Compute/Calibrate button */}
            {imagePoints.length >= 4 && (
              <button
                type="button"
                onClick={recalculateLiveHomography}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/20 active:scale-[0.98] cursor-pointer mt-2"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Compute Calibration</span>
              </button>
            )}
          </div>

          {/* Lens distortion settings inside the studio sidebar */}
          <div className="bg-slate-900/30 p-3 rounded-xl border border-slate-850 flex flex-col gap-3 mt-4 text-[11px] text-slate-400">
            <span className="font-bold text-slate-350 uppercase tracking-wider text-[9px] flex items-center gap-1">
              <Settings className="w-3.5 h-3.5 text-emerald-400" />
              <span>Lens Distortion (Brown-Conrady)</span>
            </span>

            <div className="flex flex-col gap-1.5">
              <span className="text-slate-400 flex justify-between font-semibold">
                <span>Focal Length</span>
                <span className="text-emerald-404 font-mono text-[10px]">{lens.fx} px</span>
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

            <div className="flex flex-col gap-1.5">
              <span className="text-slate-400 flex justify-between font-semibold">
                <span>Principal Point (cx / cy)</span>
                <span className="text-emerald-404 font-mono text-[10px]">{lens.cx}px, {lens.cy}px</span>
              </span>
              <div className="flex gap-1.5">
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

            <div className="flex flex-col gap-1.5">
              <span className="text-slate-400 flex justify-between font-semibold">
                <span>Radial Distortion (k1 / k2)</span>
                <span className="text-emerald-404 font-mono text-[10px]">{lens.k1.toFixed(3)}, {lens.k2.toFixed(3)}</span>
              </span>
              <div className="flex gap-1.5">
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
      </div>
    );
  };

  const adjustZoom = (amount: number) => {
    setZoom(prev => {
      const next = Math.max(1.0, Math.min(8.0, prev + amount));
      if (next === 1.0) {
        setPanX(0);
        setPanY(0);
      }
      return next;
    });
  };

  return (
    <>
      {/* Standard embedded panel mode - minimalist dashboard summary card only */}
      {!isStudioOpen && (
        <div className="flex flex-col gap-6 p-6 glass rounded-2xl shadow-2xl relative overflow-hidden border border-[#ffffff08]">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight text-white">Camera & Pitch Calibration</h3>
                <p className="text-xs text-gray-400">Map pitch landmarks on the video feed to project player coordinates</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {rmse !== null ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Calibrated (RMSE: {rmse.toFixed(3)}m)</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg text-xs font-semibold border border-amber-500/25">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Not Calibrated</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-950/20 p-4 rounded-xl border border-slate-800">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-300">
                {Object.keys(mappedPixels).length === 0 
                  ? "No landmarks have been mapped yet." 
                  : `${Object.keys(mappedPixels).length} landmark(s) mapped on raw video.`
                }
              </span>
              <span className="text-[10px] text-gray-500">
                Requires at least 4 matched keypoints (corners/lines) to calculate the perspective homography.
              </span>
            </div>

            <button
              onClick={() => {
                setIsStudioOpen(true);
                resetViewTransform();
              }}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white rounded-xl text-xs font-extrabold uppercase tracking-wider transition shadow-lg shadow-amber-950/20 cursor-pointer active:scale-95 shrink-0"
            >
              <Maximize2 className="w-4 h-4" />
              <span>Open Calibration Studio</span>
            </button>
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
                <p className="text-xs text-gray-400">Zoom in up to 800% and pan around the frame to place corners or markings with pixel-perfect precision</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Cancel / Exit button */}
              <button
                onClick={() => setIsStudioOpen(false)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-350 border border-slate-800 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                <X className="w-4 h-4" />
                <span>Cancel & Close</span>
              </button>

              {/* Live grid overlay toggle */}
              {imagePoints.length >= 4 && (
                <button
                  onClick={() => setShowGridOverlay(!showGridOverlay)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    showGridOverlay 
                      ? 'bg-emerald-600/15 border-emerald-500/40 text-emerald-400' 
                      : 'bg-slate-900 border-[#ffffff0a] text-slate-400 hover:text-white'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                  <span>Grid Overlay</span>
                </button>
              )}

              {/* Precision Badge */}
              {rmse !== null && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 rounded-lg text-xs font-semibold">
                  <CheckCircle className="w-4 h-4" />
                  <span>RMSE: {rmse.toFixed(3)}m</span>
                </div>
              )}

              {/* Save & Exit Button */}
              <button
                onClick={applyAndSaveCalibration}
                disabled={imagePoints.length < 4}
                className={`flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-bold transition shadow-lg ${
                  imagePoints.length >= 4
                    ? 'bg-gradient-to-r from-emerald-600 to-[#2d6a4f] hover:from-emerald-500 hover:to-[#40916c] text-white cursor-pointer shadow-emerald-950/20 shadow-lg'
                    : 'bg-slate-900 border border-[#ffffff05] text-slate-500 cursor-not-allowed'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                <span>Save & Exit</span>
              </button>
            </div>
          </div>

          {/* Subframe instructions */}
          {imagePoints.length < 4 && (
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
