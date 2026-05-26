import React, { useState, useEffect } from 'react';
import CalibrationPanel from './components/CalibrationPanel';
import TacticalPitch from './components/TacticalPitch';
import { Play, Pause, Video, Upload, Activity, ShieldAlert, Sparkles } from 'lucide-react';

export default function App() {
  const [videoStatus, setVideoStatus] = useState<string>("idle");
  const [trackingData, setTrackingData] = useState<any[]>([]);
  const [wsActive, setWsActive] = useState<boolean>(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [savedCalibration, setSavedCalibration] = useState<any>(null);
  const [rmse, setRmse] = useState<number | null>(null);
  const [simModeActive, setSimModeActive] = useState<boolean>(false);
  const [totalFrames, setTotalFrames] = useState<number>(10);

  // Attempt to load pre-saved calibration when component mounts
  useEffect(() => {
    async function loadSavedCalibration() {
      try {
        const res = await fetch("http://localhost:8000/api/calibrate/saved");
        if (res.ok) {
          const result = await res.json();
          if (result.status === "success" && result.data) {
            setSavedCalibration(result.data);
            setRmse(result.data.rmse || null);
            setVideoStatus("ready"); // Automatically marks ready since we have coordinates
          }
        }
      } catch (err) {
        console.log("Could not load pre-existing calibration matrix from backend. Ready for manual points seeding.");
      }
    }
    loadSavedCalibration();
  }, []);

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVideoStatus("extracting_frames");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/api/video/upload", {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setTotalFrames(data.total_frames || 10);
        setVideoStatus("ready");
        setSimModeActive(false);
      } else {
        setVideoStatus("failed");
        alert("Video frame extraction failed. Falling back to simulator.");
      }
    } catch (err) {
      setVideoStatus("ready"); // Fallback to ready to allow mock simulator mode
      setSimModeActive(true);
      console.error(err);
    }
  };

  const startTrackingStream = () => {
    if (wsActive) {
      // Disconnect
      if (socket) {
        socket.close();
      }
      setWsActive(false);
      setTrackingData([]);
      return;
    }

    const ws = new WebSocket("ws://localhost:8000/ws/tracking");
    setSocket(ws);
    setWsActive(true);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.detections) {
          setTrackingData(data.detections);
        } else if (data.error) {
          console.error("Backend pipeline error:", data.error);
        }
      } catch (err) {
        console.error("Failed to parse websocket frame:", err);
      }
    };

    ws.onclose = () => {
      setWsActive(false);
      setTrackingData([]);
    };

    ws.onerror = (err) => {
      console.error("Websocket tracking stream error:", err);
      setWsActive(false);
    };
  };

  const handleCalibrationSuccess = (homography: number[][], points: any[], calculatedRmse: number) => {
    setSavedCalibration({ homography, points, rmse: calculatedRmse });
    setRmse(calculatedRmse);
    
    // Automatically make ready for tracking when calibration is successfully registered
    if (videoStatus === "idle" || videoStatus === "failed") {
      setVideoStatus("ready");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#f3f4f6] font-sans antialiased">
      
      {/* Decorative top ambient light glow */}
      <div className="absolute top-0 left-1/4 right-1/4 h-[250px] bg-gradient-to-b from-[#1b4332]/10 to-transparent blur-[120px] pointer-events-none" />

      {/* Main Header navigation */}
      <header className="border-b border-[#ffffff0a] bg-slate-950/40 backdrop-blur-md relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#2d6a4f] to-[#40916c] flex items-center justify-center shadow-lg shadow-emerald-950/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-emerald-400">
                PITCHTRACK AI
              </h1>
              <p className="text-[11px] text-gray-500 font-bold uppercase tracking-widest mt-0.5">
                Soccer Pitch Calibration & Multi-Player Tracking Utilizing SAM 3.1
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {simModeActive && (
              <div className="flex items-center gap-2 bg-amber-500/10 text-amber-400 px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/25">
                <Activity className="w-3.5 h-3.5" />
                <span>Running in Tactical Simulator mode</span>
              </div>
            )}
            
            <div className="flex items-center gap-2 bg-[#ffffff05] px-3 py-1.5 rounded-lg text-xs text-gray-400 border border-[#ffffff08]">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>GPU Server Host: root@141.0.85.212</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace layout */}
      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 xl:grid-cols-2 gap-8 relative z-10">
        
        {/* Left Side: Upload & Calibration Workspace */}
        <div className="flex flex-col gap-8">
          
          {/* Upload Video Stream Panel */}
          <div className="p-6 glass rounded-2xl border border-[#ffffff08] flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[#ffffff0a] pb-3">
              <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Video className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">1. Video Source Pipeline</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Select Broadcast Recording</label>
                <div className="relative">
                  <input 
                    type="file" 
                    id="video-uploader"
                    accept="video/*"
                    onChange={handleVideoUpload} 
                    className="hidden"
                  />
                  <label 
                    htmlFor="video-uploader"
                    className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-slate-900/60 hover:bg-slate-800 border border-[#ffffff0c] hover:border-slate-600 rounded-xl text-xs font-semibold text-white cursor-pointer transition shadow-sm"
                  >
                    <Upload className="w-4 h-4 text-emerald-400" />
                    <span>Upload Raw MP4 / AVI</span>
                  </label>
                </div>
              </div>

              <div className="bg-[#ffffff02] border border-[#ffffff05] p-3 rounded-xl flex flex-col gap-1 text-xs">
                <span className="text-gray-400">Stream Status:</span>
                <span className="font-mono text-emerald-400 font-bold capitalize">
                  {videoStatus.replace(/_/g, ' ')}
                </span>
                {simModeActive && (
                  <span className="text-[10px] text-amber-400/80">Using local mathematical mock engine</span>
                )}
              </div>
            </div>
          </div>

          {/* Interactive Calibration Panel */}
          <CalibrationPanel 
            onCalibrationSuccess={handleCalibrationSuccess} 
            savedCalibration={savedCalibration}
            videoStatus={videoStatus}
            simModeActive={simModeActive}
            totalFrames={totalFrames}
          />
        </div>

        {/* Right Side: Tracking Controllers & Birds Eye view */}
        <div className="flex flex-col gap-8">
          
          {/* Tracking Controller */}
          <div className="p-6 glass rounded-2xl border border-[#ffffff08] flex justify-between items-center shadow-2xl">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold text-white">2. Coordinate Projection Stream</h2>
              <p className="text-xs text-gray-400">Pipes Segmented player foot targets to metrics</p>
            </div>
            
            <button
              onClick={startTrackingStream}
              disabled={videoStatus !== "ready"}
              className={`flex items-center gap-2 px-6 py-3.5 rounded-xl font-bold transition shadow-lg ${
                videoStatus === "ready"
                  ? wsActive
                    ? "bg-rose-600 hover:bg-rose-500 text-white cursor-pointer shadow-rose-950/20"
                    : "bg-gradient-to-r from-emerald-600 to-[#2d6a4f] hover:from-emerald-500 hover:to-[#40916c] text-white cursor-pointer shadow-emerald-950/20"
                  : "bg-slate-900 border border-[#ffffff05] text-slate-600 cursor-not-allowed"
              }`}
            >
              {wsActive ? (
                <>
                  <Pause className="w-4 h-4 fill-white" />
                  <span>Pause Tracking Stream</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Start Tracking Engine</span>
                </>
              )}
            </button>
          </div>

          {/* Birds-Eye view Pitch Canvas representation */}
          <TacticalPitch trackingData={trackingData} wsActive={wsActive} />
        </div>

      </main>

      {/* Decorative footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 text-center text-xs text-gray-500 border-t border-[#ffffff05] mt-12 relative z-10">
        <span>© 2026 DeepMind Antigravity Pair Programming. Developed using Meta Segment Anything Model 3.1 & OpenCV Projection.</span>
      </footer>

    </div>
  );
}
