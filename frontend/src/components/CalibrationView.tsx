import React, { useState, useRef, useEffect } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { 
  ArrowLeft, Check, RefreshCw, ZoomIn, ZoomOut, Move, Undo2, 
  MapPin, Play, Loader2, Sparkles
} from 'lucide-react';

export const CalibrationView: React.FC = () => {
  const {
    videoMetadata,
    markers,
    activeMarkerId,
    gridOverlayUrl,
    isCalibrating,
    setMarkerPixel,
    setActiveMarkerId,
    resetCalibration,
    setGridOverlayUrl,
    setCalibrating,
    setView,
    setProcessingStatus,
    setProcessingProgress,
    setProcessingError,
  } = usePitchTrackStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Zoom and Pan state
  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isOverlayToggled, setIsOverlayToggled] = useState<boolean>(false);
  const [calibrationSuccess, setCalibrationSuccess] = useState<boolean>(false);

  // Drag threshold and Touch refs
  const startX = useRef<number>(0);
  const startY = useRef<number>(0);
  const hasDragged = useRef<boolean>(false);
  const lastTouchDistance = useRef<number | null>(null);

  // Synchronized refs for smooth event listener updates without closures
  const scaleRef = useRef<number>(1);
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { isPanningRef.current = isPanning; }, [isPanning]);
  useEffect(() => { panStartRef.current = panStart; }, [panStart]);

  // Active marker
  const activeMarker = markers.find(m => m.id === activeMarkerId);
  const clickedMarkersCount = markers.filter(m => m.pixel !== null).length;
  
  // Track window resizing or layout changes to keep marker placement aligned
  const [imgSize, setImgSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const handleImageLoad = () => {
    if (imgRef.current) {
      setImgSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight
      });
    }
  };

  useEffect(() => {
    window.addEventListener('resize', handleImageLoad);
    return () => window.removeEventListener('resize', handleImageLoad);
  }, []);

  // Native mousewheel zoom to cursor & pinch-to-zoom setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Mouse Wheel Zoom to Cursor
    const nativeWheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      
      const zoomFactor = 0.15;
      const direction = e.deltaY < 0 ? 1 : -1;
      
      setScale(prev => {
        const nextScale = prev + direction * zoomFactor;
        const clampedScale = Math.max(1, Math.min(8, nextScale)); // Zoom up to 8x for high accuracy
        
        if (clampedScale === 1) {
          setPan({ x: 0, y: 0 });
        } else {
          // Adjust pan dynamically so the zoom focuses precisely on the mouse cursor
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left - rect.width / 2;
          const mouseY = e.clientY - rect.top - rect.height / 2;
          
          setPan(prevPan => ({
            x: prevPan.x - mouseX * (direction * zoomFactor) / clampedScale,
            y: prevPan.y - mouseY * (direction * zoomFactor) / clampedScale
          }));
        }
        return clampedScale;
      });
    };

    // 2. Touch Gestures (Drag-to-pan & Pinch-to-zoom)
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isPanningRef.current = true;
        setIsPanning(true);
        const touch = e.touches[0];
        
        const nextPanStart = { 
          x: touch.clientX - panRef.current.x, 
          y: touch.clientY - panRef.current.y 
        };
        panStartRef.current = nextPanStart;
        setPanStart(nextPanStart);
        
        startX.current = touch.clientX;
        startY.current = touch.clientY;
        hasDragged.current = false;
      } else if (e.touches.length === 2) {
        isPanningRef.current = false;
        setIsPanning(false);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        lastTouchDistance.current = dist;
      }
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isPanningRef.current) {
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - startX.current);
        const dy = Math.abs(touch.clientY - startY.current);
        if (dx > 5 || dy > 5) {
          hasDragged.current = true;
        }
        
        const nextPan = {
          x: touch.clientX - panStartRef.current.x,
          y: touch.clientY - panStartRef.current.y
        };
        setPan(nextPan);
      } else if (e.touches.length === 2 && lastTouchDistance.current !== null) {
        e.preventDefault(); // prevent native page scrolling/zooming
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        
        const factor = dist / lastTouchDistance.current;
        lastTouchDistance.current = dist;
        
        setScale(prev => {
          const nextScale = prev * factor;
          const clampedScale = Math.max(1, Math.min(8, nextScale));
          if (clampedScale === 1) setPan({ x: 0, y: 0 });
          return clampedScale;
        });
      }
    };
    
    const handleTouchEnd = () => {
      isPanningRef.current = false;
      setIsPanning(false);
      lastTouchDistance.current = null;
    };

    container.addEventListener('wheel', nativeWheelHandler, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    return () => {
      container.removeEventListener('wheel', nativeWheelHandler);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  if (!videoMetadata) return null;

  // Handle Image Click (Plot points, completely ignores click if user was drag panning)
  const handleImageClick = (e: React.MouseEvent) => {
    if (isOverlayToggled) return; // Grid overlay is active, no editing
    if (hasDragged.current) return; // Ignore clicks that were part of a drag pan movement

    if (imgRef.current && activeMarker) {
      const rect = imgRef.current.getBoundingClientRect();
      
      // Calculate coordinates relative to the image itself (0 to 1 scale)
      const xNorm = (e.clientX - rect.left) / rect.width;
      const yNorm = (e.clientY - rect.top) / rect.height;
      
      // Map to real video resolution dimensions
      const pixelX = xNorm * videoMetadata.width;
      const pixelY = yNorm * videoMetadata.height;
      
      setMarkerPixel(activeMarker.id, [pixelX, pixelY]);
      
      // Clear overlay if adjustment happens
      if (gridOverlayUrl) {
        setGridOverlayUrl(null);
        setCalibrationSuccess(false);
      }
    }
  };

  // Zoom helper (Sidebar buttons)
  const handleZoom = (direction: 'in' | 'out') => {
    setScale(prev => {
      const next = direction === 'in' ? prev + 0.5 : prev - 0.5;
      const clamped = Math.max(1, Math.min(8, next));
      if (clamped === 1) setPan({ x: 0, y: 0 }); // reset panning when zoomed out
      return clamped;
    });
  };

  // Mouse Pan dragging controls
  const handleMouseDown = (e: React.MouseEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    hasDragged.current = false;
    
    // Support left-drag panning when zoomed in, shift-drag panning at any zoom level, or middle-button drag
    if (e.button === 1 || e.shiftKey || scale > 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = Math.abs(e.clientX - startX.current);
      const dy = Math.abs(e.clientY - startY.current);
      if (dx > 5 || dy > 5) {
        hasDragged.current = true;
      }
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  // Compute Homography API call
  const handleComputeHomography = async () => {
    const activePoints = markers
      .filter(m => m.pixel !== null)
      .map(m => ({
        pixel: m.pixel,
        real: m.real
      }));

    if (activePoints.length < 4) {
      alert('You need to click at least 4 markers to calibrate the camera.');
      return;
    }

    setCalibrating(true);
    try {
      const response = await fetch('http://localhost:8000/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: activePoints }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to compute calibration.');
      }

      const data = await response.json();
      setGridOverlayUrl(`http://localhost:8000${data.gridOverlayUrl}`);
      setIsOverlayToggled(true);
      setCalibrationSuccess(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error occurred during camera calibration.');
    } finally {
      setCalibrating(false);
    }
  };

  // Starts the backend player tracking engine
  const handleStartTracking = async () => {
    setProcessingStatus('processing');
    setProcessingProgress(0.0);
    setProcessingError(null);
    setView('analytics'); // Redirect to dashboard immediately

    try {
      const response = await fetch('http://localhost:8000/api/process', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to launch player tracking background process.');
      }
    } catch (err: any) {
      setProcessingStatus('failed');
      setProcessingError(err.message);
      alert(err.message);
    }
  };

  return (
    <div className="flex flex-col h-[90vh] text-gray-200">
      {/* Top Header */}
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setView('upload')}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
              Perspective Homography Calibration
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </h2>
            <p className="text-xs text-gray-400">
              Select key landmarks on the field to map pixel coordinates to real-world meters.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={resetCalibration}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gray-800 hover:bg-red-950/20 hover:text-red-400 hover:border-red-900 border border-transparent transition-all text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reset Points
          </button>
          
          {calibrationSuccess ? (
            <button
              onClick={handleStartTracking}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-all shadow-[0_4px_12px_rgba(16,185,129,0.3)]"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              Confirm & Start AI Tracking
            </button>
          ) : (
            <button
              onClick={handleComputeHomography}
              disabled={clickedMarkersCount < 4 || isCalibrating}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg font-bold text-xs transition-all ${
                clickedMarkersCount >= 4 
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black cursor-pointer shadow-[0_4px_12px_rgba(16,185,129,0.2)]'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
              }`}
            >
              {isCalibrating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Calibrating...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Compute Calibration ({clickedMarkersCount}/4+ points)
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: Interactive Viewport */}
        <div className="flex-1 flex flex-col bg-[#0b0f17] relative">
          
          {/* Action Toolbar overlay */}
          <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 p-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl">
            <button
              onClick={() => handleZoom('in')}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-300 hover:text-white transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleZoom('out')}
              className="p-2 rounded-lg hover:bg-gray-800 text-gray-300 hover:text-white transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-gray-800 mx-1" />
            <div className="flex items-center gap-1 px-2 text-[10px] text-gray-400">
              <Move className="w-3 h-3" />
              <span>Shift + Drag to Pan (Zoom: {scale}x)</span>
            </div>
          </div>

          {/* Grid Overlay Toggle */}
          {gridOverlayUrl && (
            <div className="absolute top-4 right-4 z-10 flex items-center p-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl">
              <button
                onClick={() => setIsOverlayToggled(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isOverlayToggled ? 'bg-emerald-500 text-black' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Original Frame
              </button>
              <button
                onClick={() => setIsOverlayToggled(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isOverlayToggled ? 'bg-emerald-500 text-black' : 'text-gray-300 hover:bg-gray-800'}`}
              >
                Calibration Grid
              </button>
            </div>
          )}

          {/* Interactive Workspace Area */}
          <div 
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`flex-1 overflow-hidden flex items-center justify-center p-6 ${
              isPanning ? 'cursor-grabbing' : (scale > 1 ? 'cursor-grab' : 'cursor-crosshair')
            }`}
          >
            <div 
              style={{
                transform: `scale(${scale}) translate(${pan.x / scale}px, ${pan.y / scale}px)`,
                transition: isPanning ? 'none' : 'transform 0.15s ease-out',
              }}
              className="relative p-12 sm:p-20 md:p-28 bg-[#090d16] rounded-3xl border-2 border-gray-800/60 shadow-3xl select-none flex items-center justify-center cursor-crosshair overflow-visible group"
              onClick={handleImageClick}
            >
              {/* Out-of-bounds Canvas subtle helper text/grid indicator */}
              <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-25 rounded-3xl pointer-events-none" />
              
              {/* Visual guidance label for out-of-bounds plotting */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold text-gray-500 tracking-widest uppercase pointer-events-none select-none opacity-60 group-hover:opacity-100 transition-opacity">
                Extended Calibration Space (Out of Bounds Zone)
              </div>

              <div 
                style={{
                  aspectRatio: `${videoMetadata.width} / ${videoMetadata.height}`,
                }}
                className="relative max-w-full max-h-[64vh] select-none overflow-visible"
              >
                <img
                  ref={imgRef}
                  src={isOverlayToggled && gridOverlayUrl ? gridOverlayUrl : videoMetadata.firstFrameUrl}
                  alt="Calibration View"
                  onLoad={handleImageLoad}
                  draggable={false}
                  className="w-full h-full object-cover rounded-xl border border-gray-850 shadow-2xl pointer-events-auto"
                />

                {/* Render Plotted Point Circles over the image */}
                {!isOverlayToggled && imgRef.current && markers.map((m) => {
                  if (!m.pixel) return null;
                  
                  // Convert resolution-dependent coordinates to CSS client dimensions
                  const percentX = (m.pixel[0] / videoMetadata.width) * 100;
                  const percentY = (m.pixel[1] / videoMetadata.height) * 100;
                  const isActive = m.id === activeMarkerId;
                  
                  return (
                    <div
                      key={m.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMarkerId(m.id);
                      }}
                      style={{
                        left: `${percentX}%`,
                        top: `${percentY}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      className={`absolute w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold cursor-pointer border shadow-lg transition-transform ${
                        isActive 
                          ? 'bg-emerald-400 border-white text-black scale-125 ring-4 ring-emerald-500/30' 
                          : 'bg-black/80 border-emerald-400 text-emerald-400 hover:scale-110 hover:bg-emerald-950'
                      }`}
                      title={`${m.label} (${m.real[0]}m, ${m.real[1]}m)`}
                    >
                      {markers.indexOf(m) + 1}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          {/* Quick Helper Banner */}
          {!gridOverlayUrl && activeMarker && (
            <div className="bg-emerald-950/20 border-t border-emerald-500/20 py-3.5 px-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs text-emerald-300 font-semibold uppercase tracking-wider">Active Marker</span>
                <span className="text-sm font-bold text-gray-200">
                  {activeMarker.label} (Real Target: X={activeMarker.real[0]}m, Y={activeMarker.real[1]}m)
                </span>
              </div>
              <span className="text-xs text-gray-400 italic">Click on the image on the left to map this spot.</span>
            </div>
          )}
        </div>

        {/* Right Side: Calibration Instructions & Point Checklist */}
        <div className="w-96 bg-gray-900 border-l border-gray-800 flex flex-col h-full">
          
          {/* Top Panel summary */}
          <div className="p-4 border-b border-gray-800 bg-gray-900/60">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Calibration Panel</h3>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              Pair any <span className="text-emerald-400 font-semibold">4 or more landmarks</span> from the 2D pitch map below with your camera video frame on the left. You do not need to do them all!
            </p>
          </div>

          {/* SVG Pitch Map Section */}
          <div className="p-4 border-b border-gray-800 bg-gray-950/40">
            <span className="text-xs font-semibold text-gray-400 block mb-2">1. Select Landmark on 2D Pitch:</span>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-gray-800 shadow-inner relative flex justify-center items-center">
              <svg viewBox="-15 -15 330 190" className="w-full h-auto select-none">
                {/* Outer boundaries */}
                <rect x="0" y="0" width="300" height="160" fill="#141c2c" stroke="#374151" strokeWidth="2" rx="4" />
                
                {/* Center Line */}
                <line x1="150" y1="0" x2="150" y2="160" stroke="#374151" strokeWidth="1.5" />
                
                {/* Center Circle */}
                <circle cx="150" cy="80" r="30" fill="none" stroke="#374151" strokeWidth="1.5" />
                
                {/* Center Spot */}
                <circle cx="150" cy="80" r="2.5" fill="#4b5563" />
                
                {/* Penalty Spots */}
                <circle cx="60" cy="80" r="2" fill="#4b5563" />
                <circle cx="240" cy="80" r="2" fill="#4b5563" />
                
                {/* Penalty Curved D-Arcs */}
                <path d="M 0 20 A 60 60 0 0 1 0 140" fill="none" stroke="#374151" strokeWidth="1.5" />
                <path d="M 300 140 A 60 60 0 0 1 300 20" fill="none" stroke="#374151" strokeWidth="1.5" />
                
                {/* Goals */}
                <rect x="-8" y="65" width="8" height="30" fill="none" stroke="#eab308" strokeWidth="1.5" rx="1" />
                <rect x="300" y="65" width="8" height="30" fill="none" stroke="#eab308" strokeWidth="1.5" rx="1" />
                
                {/* Plotted Interactive Nodes */}
                {markers.map((m) => {
                  const isClicked = m.pixel !== null;
                  const isActive = m.id === activeMarkerId;
                  const cx = m.real[0] * 10;
                  const cy = m.real[1] * 10;
                  
                  return (
                    <g key={m.id}>
                      {isActive && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r="10"
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="2"
                          className="animate-ping opacity-75"
                        />
                      )}
                      {/* Transparent hit target for easy mobile/desktop tapping */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r="14"
                        fill="transparent"
                        className="cursor-pointer"
                        onClick={() => {
                          if (!isOverlayToggled) setActiveMarkerId(m.id);
                        }}
                      />
                      {/* Styled visual dot */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isActive ? "6" : "4.5"}
                        fill={isClicked ? "#10b981" : (isActive ? "#34d399" : "#4b5563")}
                        stroke={isActive ? "#ffffff" : (isClicked ? "#047857" : "#1f2937")}
                        strokeWidth={isActive ? "2" : "1"}
                        className="transition-all duration-200 pointer-events-none"
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Active Landmark details */}
          <div className="p-4 border-b border-gray-800 bg-gray-900/40">
            <span className="text-xs font-semibold text-gray-400 block mb-1.5">2. Map on Video Frame:</span>
            {activeMarker ? (
              <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl animate-pulse-subtle">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-extrabold text-emerald-400 uppercase tracking-wider">
                    {activeMarker.label}
                  </span>
                </div>
                <p className="text-[11px] text-gray-300 mt-1 leading-normal">
                  {activeMarker.description}
                </p>
                <div className="mt-2 text-[10px] font-mono text-gray-400 flex justify-between items-center bg-black/40 px-2 py-1 rounded border border-white/5">
                  <span>Real Coord: ({activeMarker.real[0]}m, {activeMarker.real[1]}m)</span>
                  {activeMarker.pixel ? (
                    <span className="text-emerald-400 font-bold">Plotted</span>
                  ) : (
                    <span className="text-amber-400 font-bold animate-pulse">Click frame...</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-gray-950/50 border border-gray-800 rounded-xl text-center text-xs text-gray-500">
                Click a landmark dot on the 2D Pitch Map above first.
              </div>
            )}
          </div>

          {/* Plotted checklist */}
          <div className="flex-1 flex flex-col min-h-0 bg-gray-950/20">
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Plotted Landmarks</span>
              <span className="text-xs font-extrabold text-emerald-400 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                {clickedMarkersCount} Placed
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {clickedMarkersCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-gray-500 space-y-3">
                  <div className="p-3 bg-gray-900 border border-gray-850 rounded-2xl text-gray-600">
                    <MapPin className="w-6 h-6 stroke-[1.5]" />
                  </div>
                  <div className="max-w-[200px]">
                    <p className="text-xs font-semibold text-gray-400">No landmarks plotted yet</p>
                    <p className="text-[10px] text-gray-500 mt-1">Select a dot on the 2D map and click the video frame to place your first calibration point.</p>
                  </div>
                </div>
              ) : (
                markers
                  .filter(m => m.pixel !== null)
                  .map((m) => {
                    const isActive = m.id === activeMarkerId;
                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          if (!isOverlayToggled) setActiveMarkerId(m.id);
                        }}
                        className={`p-2.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between ${
                          isActive
                            ? 'bg-emerald-950/20 border-emerald-500/60 text-gray-200'
                            : 'bg-gray-800/40 border-gray-800/80 text-gray-300 hover:border-gray-700/60 hover:bg-gray-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                          <span className="font-bold truncate text-gray-200 text-[11px]">{m.label}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-gray-400 bg-black/40 px-1.5 py-0.5 rounded border border-white/5">
                            ({m.real[0]}m, {m.real[1]}m)
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMarkerPixel(m.id, null);
                              if (gridOverlayUrl) {
                                setGridOverlayUrl(null);
                                setCalibrationSuccess(false);
                              }
                            }}
                            className="text-red-500 hover:text-red-400 font-bold text-[10px] hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
