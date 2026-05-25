import React, { useRef, useState, useEffect } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { 
  Upload, Film, ArrowRight, Loader2, Check, RotateCcw, 
  Crosshair, Settings, ZoomIn, ZoomOut, Move, Hand, Info, Trash2, X, Grid
} from 'lucide-react';

interface CalibrationPointData {
  screenX: number; // Percentage coordinate for overlay drawing
  screenY: number; // Percentage coordinate for overlay drawing
  pixel: [number, number]; // Actual video resolution coordinates
  real: [number, number]; // Real-world meter coordinates [rx, ry]
}

const landmarks = [
  { id: 'left_top_corner', name: 'Left-Top Corner (0m, 0m)', real: [0.0, 0.0] as [number, number] },
  { id: 'left_bottom_corner', name: 'Left-Bottom Corner (0m, 16m)', real: [0.0, 16.0] as [number, number] },
  { id: 'left_goal_left_post', name: 'Left Goal, Left Post (0m, 6.5m)', real: [0.0, 6.5] as [number, number] },
  { id: 'left_goal_right_post', name: 'Left Goal, Right Post (0m, 9.5m)', real: [0.0, 9.5] as [number, number] },
  { id: 'left_goal_penalty_dot', name: 'Left Goal Penalty Dot (6m, 8m)', real: [6.0, 8.0] as [number, number] },
  { id: 'center_spot', name: 'Center Spot / Dot (15m, 8m)', real: [15.0, 8.0] as [number, number] },
  { id: 'right_goal_left_post', name: 'Right Goal, Left Post (30m, 6.5m)', real: [30.0, 6.5] as [number, number] },
  { id: 'right_goal_right_post', name: 'Right Goal, Right Post (30m, 9.5m)', real: [30.0, 9.5] as [number, number] },
  { id: 'right_goal_penalty_dot', name: 'Right Goal Penalty Dot (24m, 8m)', real: [24.0, 8.0] as [number, number] },
  { id: 'right_top_corner', name: 'Right-Top Corner (30m, 0m)', real: [30.0, 0.0] as [number, number] },
  { id: 'right_bottom_corner', name: 'Right-Bottom Corner (30m, 16m)', real: [30.0, 16.0] as [number, number] }
];

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

export const UploadView: React.FC = () => {
  const { 
    setVideoMetadata, 
    videoMetadata, 
    isUploading, 
    setUploading, 
    setView, 
    setProcessingStatus,
    setProcessingProgress,
    setProcessingMessage 
  } = usePitchTrackStore();

  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calibration States
  const [isCalibratingMode, setIsCalibratingMode] = useState(false);
  const [selectedLandmarkId, setSelectedLandmarkId] = useState(landmarks[0].id);
  const [calibrationPoints, setCalibrationPoints] = useState<Record<string, CalibrationPointData>>({});
  const [isCalibrated, setCalibrated] = useState(false);
  const [isCalibratingSaving, setIsCalibratingSaving] = useState(false);

  // Zoom & Pan States
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [clickStart, setClickStart] = useState({ x: 0, y: 0 });

  // Tool Controls & Warped Grid Overlay
  const [activeTool, setActiveTool] = useState<'crosshair' | 'hand'>('crosshair');
  const [spacePressed, setSpacePressed] = useState(false);
  const [draggingPinId, setDraggingPinId] = useState<string | null>(null);
  const [showGridOverlay, setShowGridOverlay] = useState(false);
  const [currentHomography, setCurrentHomography] = useState<number[][] | null>(null);

  const activeLandmark = landmarks.find(l => l.id === selectedLandmarkId) || landmarks[0];
  const effectiveTool = spacePressed ? 'hand' : activeTool;

  // Load existing calibration from backend
  useEffect(() => {
    if (!videoMetadata) return;

    const fetchCalibration = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/calibration');
        if (response.ok) {
          const data = await response.json();
          if (data.homography) {
            setCurrentHomography(data.homography);
            setCalibrated(data.status === 'custom');
            
            // Map existing points to the calibration state if custom calibration is present
            if (data.status === 'custom' && data.points) {
              const loadedPoints: Record<string, CalibrationPointData> = {};
              data.points.forEach((pt: any) => {
                const landmark = landmarks.find(l => l.real[0] === pt.real[0] && l.real[1] === pt.real[1]);
                if (landmark) {
                  const screenX = (pt.pixel[0] / videoMetadata.width) * 100;
                  const screenY = (pt.pixel[1] / videoMetadata.height) * 100;
                  loadedPoints[landmark.id] = {
                    screenX,
                    screenY,
                    pixel: pt.pixel,
                    real: pt.real
                  };
                }
              });
              setCalibrationPoints(loadedPoints);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load existing camera calibration:', err);
      }
    };

    fetchCalibration();
  }, [videoMetadata]);

  // Keyboard Spacebar Pan Hold Shortcut
  useEffect(() => {
    if (!isCalibratingMode) return;
    
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
  }, [isCalibratingMode]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setCalibrated(false);
    setIsCalibratingMode(false);
    setCalibrationPoints({});
    setShowGridOverlay(false);
    setCurrentHomography(null);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Upload failed');
      }

      const data = await response.json();
      setVideoMetadata({
        filename: file.name,
        width: data.width,
        height: data.height,
        fps: data.fps,
        totalFrames: data.totalFrames,
        duration: data.duration,
        firstFrameUrl: `http://localhost:8000${data.firstFrameUrl}`,
      });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to upload video to local backend API.');
    } finally {
      setUploading(false);
    }
  };

  // Zoom controls
  const adjustZoom = (amount: number) => {
    setZoom(prev => {
      const newZoom = Math.max(1, Math.min(8, prev + amount));
      if (newZoom === 1) {
        setPanX(0);
        setPanY(0);
      }
      return newZoom;
    });
  };

  // Cursor-Centric Scroll Wheel Zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isCalibratingMode) return;
    e.preventDefault();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const zoomFactor = 1.15;
    const isZoomIn = e.deltaY < 0;

    setZoom(prevZoom => {
      const nextZoom = isZoomIn 
        ? Math.min(8, prevZoom * zoomFactor) 
        : Math.max(1, prevZoom / zoomFactor);

      if (nextZoom === 1) {
        setPanX(0);
        setPanY(0);
      } else {
        setPanX(prevPanX => cursorX - (nextZoom / prevZoom) * (cursorX - prevPanX));
        setPanY(prevPanY => cursorY - (nextZoom / prevZoom) * (cursorY - prevPanY));
      }
      return nextZoom;
    });
  };

  // Pin drag selector handler
  const handlePinMouseDown = (e: React.MouseEvent, landmarkId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingPinId(landmarkId);
    setSelectedLandmarkId(landmarkId);
  };

  // Container interaction handlers
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCalibratingMode || e.button !== 0) return; // Left click only
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (effectiveTool === 'hand') {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
    } else {
      setClickStart({ x: e.clientX, y: e.clientY });
    }
  };

  // Recalculate live homography matrix in background
  const recalculateLiveHomography = async (pointsOverride?: Record<string, CalibrationPointData>) => {
    const pts = pointsOverride || calibrationPoints;
    const pointsData = Object.values(pts);
    if (pointsData.length < 4) return;
    
    try {
      const response = await fetch('http://localhost:8000/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pointsData })
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentHomography(data.homography);
      }
    } catch (err) {
      console.error("Failed to update live homography overlay:", err);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCalibratingMode) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (draggingPinId && videoMetadata) {
      // Map coordinates precisely including active scale and translations (top-left origin math)
      const xOrig = (clickX - panX) / zoom;
      const yOrig = (clickY - panY) / zoom;

      const screenX = Math.max(0, Math.min(100, (xOrig / rect.width) * 100));
      const screenY = Math.max(0, Math.min(100, (yOrig / rect.height) * 100));

      const actualX = (screenX / 100) * videoMetadata.width;
      const actualY = (screenY / 100) * videoMetadata.height;

      const landmark = landmarks.find(l => l.id === draggingPinId);
      if (landmark) {
        setCalibrationPoints(prev => ({
          ...prev,
          [draggingPinId]: {
            screenX,
            screenY,
            pixel: [actualX, actualY],
            real: landmark.real
          }
        }));
      }
    } else if (isDragging) {
      setPanX(e.clientX - dragStart.x);
      setPanY(e.clientY - dragStart.y);
    }
  };

  const handleContainerMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCalibratingMode) return;

    if (draggingPinId) {
      setDraggingPinId(null);
      // Automatically update live calibration grid overlay if enabled
      if (showGridOverlay) {
        recalculateLiveHomography();
      }
      return;
    }

    if (isDragging) {
      setIsDragging(false);
      return;
    }

    // Treat as click pin drop if click displacement is minimal
    const dx = Math.abs(e.clientX - clickStart.x);
    const dy = Math.abs(e.clientY - clickStart.y);
    if (dx < 4 && dy < 4 && effectiveTool === 'crosshair' && videoMetadata) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const xOrig = (clickX - panX) / zoom;
      const yOrig = (clickY - panY) / zoom;

      const screenX = (xOrig / rect.width) * 100;
      const screenY = (yOrig / rect.height) * 100;

      // Ensure coordinate lands on original image physical footprint
      if (screenX >= 0 && screenX <= 100 && screenY >= 0 && screenY <= 100) {
        const actualX = (screenX / 100) * videoMetadata.width;
        const actualY = (screenY / 100) * videoMetadata.height;

        setCalibrationPoints(prev => {
          const updated = {
            ...prev,
            [selectedLandmarkId]: {
              screenX,
              screenY,
              pixel: [actualX, actualY],
              real: activeLandmark.real
            }
          };
          // Recalculate overlay on active new pin drop if grid is turned on
          if (showGridOverlay && Object.keys(updated).length >= 4) {
            recalculateLiveHomography(updated);
          }
          return updated;
        });
      }
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setDraggingPinId(null);
  };

  // Submit calibration coordinates
  const saveCalibration = async () => {
    const pointsData = Object.values(calibrationPoints);
    if (pointsData.length < 4) return;
    
    setIsCalibratingSaving(true);
    
    try {
      const response = await fetch('http://localhost:8000/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pointsData })
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || 'Calibration failed.');
      }
      
      const data = await response.json();
      setCurrentHomography(data.homography);
      setCalibrated(true);
      setIsCalibratingMode(false);
      setShowGridOverlay(false);
      setZoom(1);
      setPanX(0);
      setPanY(0);
      alert('Camera calibrated successfully! The tracking engine is now calibrated to your custom field landmarks.');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to calibrate camera.');
    } finally {
      setIsCalibratingSaving(false);
    }
  };

  const startAnalysis = async () => {
    try {
      setProcessingStatus('processing');
      setProcessingProgress(0.0);
      setProcessingMessage('Dispatched tracking task...');
      setView('processing');

      const response = await fetch('http://localhost:8000/api/process', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to dispatch tracking pipeline');
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to start video analysis pipeline.');
      setProcessingStatus('idle');
      setView('upload');
    }
  };

  const calibratedCount = Object.keys(calibrationPoints).length;
  const H_inv = currentHomography ? invert3x3(currentHomography) : null;

  // Manually approximate curved D-penalty areas for the warped vector overlay
  const getLeftPenaltyAreaPoints = (H_matrix: number[][]) => {
    if (!videoMetadata) return '';
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
          (projected[0] / videoMetadata.width) * 100,
          (projected[1] / videoMetadata.height) * 100
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
          (projected[0] / videoMetadata.width) * 100,
          (projected[1] / videoMetadata.height) * 100
        ]);
      }
    }
    return points.map(pt => `${pt[0]},${pt[1]}`).join(' ');
  };

  const getRightPenaltyAreaPoints = (H_matrix: number[][]) => {
    if (!videoMetadata) return '';
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
          (projected[0] / videoMetadata.width) * 100,
          (projected[1] / videoMetadata.height) * 100
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
          (projected[0] / videoMetadata.width) * 100,
          (projected[1] / videoMetadata.height) * 100
        ]);
      }
    }
    return points.map(pt => `${pt[0]},${pt[1]}`).join(' ');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] px-6 py-12 max-w-6xl mx-auto w-full">
      {/* Intro Header */}
      <div className="text-center mb-10 max-w-3xl">
        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-indigo-400 to-cyan-400 tracking-tight mb-4 uppercase">
          Tactical Player Vision
        </h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          Upload any match video. Our AI tracking engine automatically detects players, clusters jersey colors, and groups players into teams. We visualize team paths in glowing <span className="text-purple-400 font-bold">Purple</span> & <span className="text-cyan-400 font-bold">Aqua</span> bounding boxes.
        </p>
      </div>

      <div className="w-full">
        {!videoMetadata ? (
          /* Glassmorphic Dropzone */
          <div className="w-full max-w-3xl mx-auto">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={triggerFileInput}
              className={`glass relative group flex flex-col items-center justify-center p-14 rounded-3xl border-2 border-dashed cursor-pointer transition-all duration-500 ${
                dragActive 
                  ? 'border-purple-500 bg-purple-950/10 shadow-[0_0_40px_rgba(168,85,247,0.15)] scale-[1.01]' 
                  : 'border-gray-800 hover:border-purple-500/50 hover:bg-gray-900/30 hover:shadow-[0_0_30px_rgba(168,85,247,0.04)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4, video/quicktime, video/avi, video/mkv"
                onChange={handleFileChange}
                className="hidden"
                disabled={isUploading}
              />
              
              {isUploading ? (
                <div className="flex flex-col items-center space-y-6 py-8">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
                    <Loader2 className="w-10 h-10 text-purple-400 animate-pulse absolute top-5 left-5" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-black text-gray-100">Reading Video Stream...</h3>
                    <p className="text-sm text-gray-500 mt-2 font-medium">Extracting match dimensions & calibration coordinates.</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-6 text-center py-6">
                  <div className="w-24 h-24 rounded-2xl bg-purple-950/20 border border-purple-500/10 flex items-center justify-center text-purple-400 group-hover:scale-105 group-hover:bg-purple-950/30 group-hover:border-purple-500/30 transition-all duration-300">
                    <Upload className="w-12 h-12" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-gray-100 group-hover:text-purple-400 transition-colors">
                      DRAG & DROP FOOTBALL VIDEO
                    </h3>
                    <p className="text-gray-400 mt-2 max-w-md text-sm leading-relaxed">
                      Select any standard MP4 / AVI match recording. Local privacy is fully maintained.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-[0_4px_20px_rgba(168,85,247,0.35)] hover:shadow-[0_4px_25px_rgba(168,85,247,0.55)] active:scale-95 cursor-pointer"
                  >
                    Browse Files
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Thumbnail Preview & Calibration Dashboard */
          <div className="glass rounded-3xl overflow-hidden border border-gray-850 shadow-2xl animate-fade-in bg-gray-900/25">
            <div className="grid grid-cols-1 lg:grid-cols-12">
              
              {/* Left Side: Extraction Thumbnail / Interactive Calibration Canvas (8 cols) */}
              <div 
                ref={containerRef}
                onMouseDown={handleContainerMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleContainerMouseUp}
                onMouseLeave={handleMouseLeave}
                onWheel={handleWheel}
                className={`lg:col-span-8 relative aspect-video bg-black flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-gray-850 select-none ${
                  isCalibratingMode 
                    ? (draggingPinId 
                        ? 'cursor-grabbing' 
                        : (effectiveTool === 'hand' 
                            ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') 
                            : 'cursor-crosshair')) 
                    : ''
                }`}
              >
                {/* Scaled/Zoomed Image Wrapper */}
                <div
                  className="w-full h-full relative transition-transform duration-75 ease-out"
                  style={{
                    transformOrigin: 'top left',
                    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                  }}
                >
                  <img
                    src={videoMetadata.firstFrameUrl}
                    alt="Extraction frame"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${
                      isCalibratingMode ? 'opacity-95' : 'opacity-85'
                    }`}
                    draggable={false}
                  />

                  {/* Projected Warped Calibration Grid Overlay (Draws inside video container, in RED) */}
                  {showGridOverlay && H_inv && (
                    <svg 
                      className="absolute inset-0 w-full h-full pointer-events-none z-10 animate-fade-in"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                    >
                      {/* Warped Pitch Lines */}
                      {pitchSegments.map((seg, sIdx) => {
                        const pt1 = projectPoint(seg.rx1, seg.ry1, H_inv);
                        const pt2 = projectPoint(seg.rx2, seg.ry2, H_inv);
                        if (!pt1 || !pt2) return null;
                        
                        const x1 = (pt1[0] / videoMetadata.width) * 100;
                        const y1 = (pt1[1] / videoMetadata.height) * 100;
                        const x2 = (pt2[0] / videoMetadata.width) * 100;
                        const y2 = (pt2[1] / videoMetadata.height) * 100;

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
                        const sx = (projected[0] / videoMetadata.width) * 100;
                        const sy = (projected[1] / videoMetadata.height) * 100;
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
                        const sx = (projected[0] / videoMetadata.width) * 100;
                        const sy = (projected[1] / videoMetadata.height) * 100;
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
                        const sx = (projected[0] / videoMetadata.width) * 100;
                        const sy = (projected[1] / videoMetadata.height) * 100;
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

                  {/* Calibration Pin overlays inside the zoomed container */}
                  {isCalibratingMode && Object.entries(calibrationPoints).map(([id, pt]) => {
                    const isActive = id === selectedLandmarkId;
                    const idx = landmarks.findIndex(l => l.id === id);
                    return (
                      <div
                        key={id}
                        onMouseDown={(e) => handlePinMouseDown(e, id)}
                        className={`absolute w-7.5 h-7.5 rounded-full flex items-center justify-center text-[10.5px] font-black text-white shadow-xl border-[2.5px] border-white animate-scale-up cursor-grab active:cursor-grabbing hover:scale-110 transition-transform z-20 ${
                          isActive 
                            ? 'bg-purple-600 shadow-[0_0_15px_#a855f7]' 
                            : 'bg-emerald-500 shadow-[0_0_12px_#10b981]'
                        }`}
                        style={{
                          left: `${pt.screenX}%`,
                          top: `${pt.screenY}%`,
                          transform: 'translate(-50%, -50%)',
                          fontFamily: 'monospace'
                        }}
                        title={`Drag to reposition ${landmarks[idx].name}`}
                      >
                        {idx + 1}
                      </div>
                    );
                  })}
                </div>

                {/* Corner indicator overlay (Only visible in normal video preview mode) */}
                {!isCalibratingMode && (
                  <div className="absolute top-4 left-4 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-white/5 backdrop-blur-md">
                    <Film className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-black tracking-wider text-gray-200 uppercase font-mono">Frame 00:01</span>
                  </div>
                )}

                {/* Live Calibration Grid Overlay Toggle for Standard Video Preview Mode */}
                {!isCalibratingMode && isCalibrated && currentHomography && (
                  <div className="absolute top-4 right-4 flex items-center gap-2 z-10 pointer-events-auto">
                    <button
                      onClick={() => setShowGridOverlay(!showGridOverlay)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-bold text-[10.5px] cursor-pointer transition-all shadow-lg select-none ${
                        showGridOverlay
                          ? 'bg-red-600 hover:bg-red-500 border-red-400 text-white shadow-[0_0_12px_rgba(239,68,68,0.35)]'
                          : 'bg-black/65 hover:bg-black/85 border-white/5 text-gray-305 hover:text-white'
                      }`}
                      title="Toggle Warped Perspective Field Grid Overlay"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      Grid: {showGridOverlay ? 'SHOW' : 'HIDE'}
                    </button>
                  </div>
                )}

                {/* Interactive Zoom & Tool Selection Toolbar */}
                {isCalibratingMode && (
                  <div className="absolute bottom-4 left-4 flex items-center gap-2 p-1.5 rounded-xl bg-black/85 border border-white/5 backdrop-blur-md shadow-2xl">
                    {/* Tool Switches */}
                    <div className="flex gap-1 border-r border-gray-800 pr-1.5">
                      <button
                        onClick={() => setActiveTool('crosshair')}
                        className={`p-2 rounded-lg transition-all cursor-pointer border ${
                          effectiveTool === 'crosshair'
                            ? 'bg-purple-950/40 border-purple-500/35 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                            : 'bg-transparent border-transparent text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                        title="Place Pins (Crosshair Tool)"
                      >
                        <Crosshair className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setActiveTool('hand')}
                        className={`p-2 rounded-lg transition-all cursor-pointer border ${
                          effectiveTool === 'hand'
                            ? 'bg-purple-950/40 border-purple-500/35 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                            : 'bg-transparent border-transparent text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                        title="Pan Canvas (Hand Tool / Hold Space)"
                      >
                        <Hand className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Live Calibration Grid Overlay Toggle (Crimson Red Theme when active) */}
                    <div className="flex gap-1 border-r border-gray-800 pr-1.5">
                      <button
                        onClick={async () => {
                          if (showGridOverlay) {
                            setShowGridOverlay(false);
                          } else {
                            if (calibratedCount < 4) {
                              alert("Please drop at least 4 landmarks to preview the calibration grid.");
                              return;
                            }
                            await recalculateLiveHomography();
                            setShowGridOverlay(true);
                          }
                        }}
                        disabled={calibratedCount < 4}
                        className={`p-2 rounded-lg transition-all border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          showGridOverlay
                            ? 'bg-red-955/45 border-red-500/40 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.25)]'
                            : 'bg-transparent border-transparent text-gray-400 hover:text-white hover:bg-gray-800'
                        }`}
                        title="Toggle Warped Football Field Overlay (Requires 4+ points)"
                      >
                        <Grid className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Manual Zoom Actions */}
                    <button
                      onClick={() => adjustZoom(0.5)}
                      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-all cursor-pointer border border-white/5 active:scale-90"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => adjustZoom(-0.5)}
                      disabled={zoom === 1}
                      className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600 disabled:cursor-not-allowed text-gray-300 hover:text-white transition-all cursor-pointer border border-white/5 active:scale-90"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <div className="flex items-center px-1.5 text-[10px] font-bold font-mono text-gray-400 min-w-[38px] justify-center">
                      {zoom.toFixed(1)}x
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side: Landmark Calibration Dashboard / Match Specs (4 cols) */}
              <div className="lg:col-span-4 p-6 flex flex-col justify-between min-h-[460px] bg-gray-900/10 text-gray-200">
                
                {isCalibratingMode ? (
                  /* Calibration Mode Active */
                  <div className="space-y-4 flex flex-col justify-between flex-1">
                    <div className="space-y-4">
                      <div>
                        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 uppercase font-mono">
                          Rigid Calibration
                        </span>
                        <h3 className="text-xl font-black text-gray-100 mt-2">
                          Point Landmarking
                        </h3>
                        <p className="text-gray-400 mt-1 text-[11px] leading-relaxed">
                          Click on the visual football field points below to select a landmark, then pin it exactly on the match frame.
                        </p>
                      </div>

                      {/* Interactive 2D Pitch Landmark Checklist (Curved D-Penalty Areas) */}
                      <div className="space-y-2">
                        <label className="text-[10px] text-gray-500 font-black tracking-widest uppercase block font-mono">
                          1. Click Spot on Field ({calibratedCount}/4+ points)
                        </label>
                        
                        <div className="relative rounded-2xl overflow-hidden border border-gray-800 aspect-[30/16] w-full shadow-inner bg-[#04160f] select-none p-0">
                          {/* Pitch Lines Vector Layer */}
                          <svg
                            className="absolute inset-0 w-full h-full pointer-events-none"
                            viewBox="0 0 300 160"
                            fill="none"
                          >
                            {/* Outer boundary */}
                            <rect x="8" y="8" width="284" height="144" stroke="#065f46" strokeWidth="1.5" className="opacity-45" />
                            
                            {/* Center Dot */}
                            <circle cx="150" cy="80" r="2.5" fill="#065f46" className="opacity-45" />

                            {/* Left Curved Penalty Box (radius 50px centered on goalposts at y=65, y=95) */}
                            <path
                              d="M 8,15 A 50,50 0 0,1 58,65 L 58,95 A 50,50 0 0,1 8,145"
                              stroke="#065f46"
                              strokeWidth="1.5"
                              className="opacity-45"
                            />
                            {/* Left Penalty Dot outside arc at x=68 (6m), y=80 */}
                            <circle cx="68" cy="80" r="2.5" fill="#065f46" className="opacity-45" />

                            {/* Right Curved Penalty Box */}
                            <path
                              d="M 292,15 A 50,50 0 0,0 242,65 L 242,95 A 50,50 0 0,0 292,145"
                              stroke="#065f46"
                              strokeWidth="1.5"
                              className="opacity-45"
                            />
                            {/* Right Penalty Dot outside arc at x=232 (24m) */}
                            <circle cx="232" cy="80" r="2.5" fill="#065f46" className="opacity-45" />
                          </svg>

                          {/* Landmarks interactive overlay dots */}
                          {landmarks.map((l, idx) => {
                            const rx = l.real[0];
                            const ry = l.real[1];
                            
                            // Map coordinates to percentage layout with slight margin padding
                            const padX = 8;
                            const padY = 8;
                            const xPct = padX + (rx / 30) * (100 - padX * 2);
                            const yPct = padY + (ry / 16) * (100 - padY * 2);

                            const pt = calibrationPoints[l.id];
                            const isActive = selectedLandmarkId === l.id;
                            const isCalibrated = !!pt;

                            return (
                              <button
                                key={l.id}
                                type="button"
                                onClick={() => setSelectedLandmarkId(l.id)}
                                className={`absolute w-5.5 h-5.5 rounded-full border -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-[9px] font-black font-mono text-white transition-all duration-300 hover:scale-120 active:scale-95 cursor-pointer z-10 ${
                                  isActive
                                    ? 'bg-purple-500 border-white shadow-[0_0_8px_#a855f7] scale-110'
                                    : isCalibrated
                                      ? 'bg-emerald-500 border-white shadow-[0_0_6px_#10b981]'
                                      : 'bg-gray-855 border-gray-700 hover:bg-gray-800 hover:border-gray-600 text-gray-400 hover:text-white'
                                  }`}
                                style={{
                                  left: `${xPct}%`,
                                  top: `${yPct}%`,
                                }}
                                title={l.name}
                              >
                                {idx + 1}
                                {isActive && (
                                  <span className="absolute -inset-1 rounded-full border border-purple-400 animate-ping opacity-75" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Landmark Help Banner */}
                      <div className="p-3 py-2.5 rounded-xl border border-purple-500/20 bg-purple-950/10 flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="text-[8.5px] text-purple-400 font-bold uppercase tracking-wider font-mono">
                            Target Landmark
                          </div>
                          <p className="text-xs text-gray-200 font-semibold leading-normal">
                            Pin the <strong className="text-purple-300 underline font-extrabold">{activeLandmark.name.split(' (')[0]}</strong> on the video frame image.
                          </p>
                        </div>
                        {calibrationPoints[selectedLandmarkId] && (
                          <button
                            type="button"
                            onClick={() => {
                              setCalibrationPoints(prev => {
                                const updated = { ...prev };
                                delete updated[selectedLandmarkId];
                                if (showGridOverlay) {
                                  if (Object.keys(updated).length >= 4) {
                                    recalculateLiveHomography(updated);
                                  } else {
                                    setShowGridOverlay(false);
                                  }
                                }
                                return updated;
                              });
                            }}
                            className="p-2 rounded-lg bg-red-955/20 hover:bg-red-955/40 border border-red-500/25 hover:border-red-500/50 text-red-400 hover:text-red-300 text-[10px] font-bold font-mono transition-all flex items-center gap-1 cursor-pointer active:scale-95 shrink-0"
                            title="Remove pin for this landmark"
                          >
                            <X className="w-3 h-3" />
                            Clear Pin
                          </button>
                        )}
                      </div>

                      {/* Calibrated Points Checklist Details */}
                      {calibratedCount > 0 && (
                        <div className="space-y-1">
                          <span className="text-[9px] text-gray-500 font-black tracking-widest uppercase block font-mono">
                            2. Calibrated Details
                          </span>
                          <div className="max-h-[85px] overflow-y-auto rounded-xl border border-gray-850 p-2 space-y-1 text-[10px] font-mono">
                            {landmarks.map((l, idx) => {
                              const pt = calibrationPoints[l.id];
                              if (!pt) return null;
                              const isActive = selectedLandmarkId === l.id;
                              return (
                                <div 
                                  key={l.id} 
                                  onClick={() => setSelectedLandmarkId(l.id)}
                                  className={`flex items-center justify-between p-1.5 rounded-xl cursor-pointer transition-all ${
                                    isActive 
                                      ? 'bg-purple-950/30 border border-purple-500/20 text-purple-300 font-bold' 
                                      : 'hover:bg-gray-800/40 text-gray-400 border border-transparent'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {/* Clear Badge Marker matching the pin numbers */}
                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-black font-mono text-white ${
                                      isActive
                                        ? 'bg-purple-600 shadow-[0_0_6px_rgba(168,85,247,0.4)]'
                                        : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                                    }`}>
                                      {idx + 1}
                                    </div>
                                    <span className="truncate max-w-[120px] text-xs font-semibold">{l.name.split(' (')[0]}</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <span className="text-emerald-400 font-bold text-[10.5px]">
                                      [{(pt.screenX).toFixed(0)}%, {(pt.screenY).toFixed(0)}%]
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCalibrationPoints(prev => {
                                          const updated = { ...prev };
                                          delete updated[l.id];
                                          if (showGridOverlay) {
                                            if (Object.keys(updated).length >= 4) {
                                              recalculateLiveHomography(updated);
                                            } else {
                                              setShowGridOverlay(false);
                                            }
                                          }
                                          return updated;
                                        });
                                      }}
                                      className="p-1 rounded hover:bg-gray-800 hover:text-red-400 text-gray-500 transition-colors cursor-pointer"
                                      title="Remove this pin"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {calibratedCount > 0 && (
                        <button 
                          onClick={() => {
                            setCalibrationPoints({});
                            setShowGridOverlay(false);
                          }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-gray-850 text-gray-400 hover:text-white transition-all cursor-pointer border border-gray-800 text-[10px] font-bold font-mono active:scale-[0.98]"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Clear Calibration
                        </button>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setIsCalibratingMode(false);
                            setCalibrationPoints({});
                            setShowGridOverlay(false);
                            setZoom(1);
                            setPanX(0);
                            setPanY(0);
                          }}
                          className="px-4 py-3.5 rounded-xl border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-900/60 font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Cancel
                        </button>
                        
                        <button
                          disabled={calibratedCount < 4 || isCalibratingSaving}
                          onClick={saveCalibration}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg active:scale-[0.98] cursor-pointer"
                        >
                          {isCalibratingSaving ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin text-white" />
                              Calibrating...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4 text-emerald-300" />
                              Apply Calibration
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Mode Active */
                  <div className="space-y-6 flex flex-col justify-between flex-1">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 uppercase font-mono">
                          Stream Extracted
                        </span>
                        {isCalibrated && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-black tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 uppercase font-mono shadow-[0_0_10px_rgba(16,185,129,0.15)] animate-pulse">
                            <Check className="w-2.5 h-2.5" />
                            Calibrated
                          </span>
                        )}
                      </div>
                      
                      <h3 className="text-xl font-black text-gray-100 mt-3 break-all line-clamp-1" title={videoMetadata.filename}>
                        {videoMetadata.filename}
                      </h3>
                      
                      {/* Specs List Grid */}
                      <div className="grid grid-cols-2 gap-3 mt-4 text-xs font-mono">
                        <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                          <span className="text-[9px] text-gray-500 font-bold block uppercase tracking-wider">Resolution</span>
                          <span className="text-gray-200 font-black">{videoMetadata.width} × {videoMetadata.height} px</span>
                        </div>
                        <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                          <span className="text-[9px] text-gray-500 font-bold block uppercase tracking-wider">Framerate</span>
                          <span className="text-gray-200 font-black">{videoMetadata.fps} FPS</span>
                        </div>
                        <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                          <span className="text-[9px] text-gray-500 font-bold block uppercase tracking-wider">Duration</span>
                          <span className="text-gray-200 font-black">
                            {Math.floor(videoMetadata.duration / 60)}m {Math.floor(videoMetadata.duration % 60)}s
                          </span>
                        </div>
                        <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                          <span className="text-[9px] text-gray-500 font-bold block uppercase tracking-wider">Frames</span>
                          <span className="text-gray-200 font-black">{videoMetadata.totalFrames} f</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setVideoMetadata(null)}
                          className="px-4 py-3 rounded-xl border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-900/60 font-black text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
                        >
                          Replace
                        </button>
                        
                        <button
                          onClick={() => setIsCalibratingMode(true)}
                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all border cursor-pointer ${
                            isCalibrated
                              ? 'bg-emerald-950/15 border-emerald-500/40 text-emerald-400 hover:bg-emerald-950/25 hover:border-emerald-500'
                              : 'bg-gray-850 border-gray-800 text-gray-300 hover:bg-gray-800 hover:border-gray-700'
                          }`}
                        >
                          <Settings className="w-4 h-4 text-purple-400" />
                          {isCalibrated ? 'Recalibrate Field' : 'Calibrate Landmarks'}
                        </button>
                      </div>

                      <button
                        onClick={startAnalysis}
                        className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-indigo-500 hover:to-cyan-400 text-white font-black text-sm uppercase tracking-wider transition-all shadow-[0_4px_20px_rgba(168,85,247,0.3)] hover:shadow-[0_4px_25px_rgba(168,85,247,0.55)] active:scale-[0.98] cursor-pointer"
                      >
                        Run Tracking & Team Clustering
                        <ArrowRight className="w-4 h-4 text-cyan-300" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
