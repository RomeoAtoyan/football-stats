import React, { useEffect } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { Cpu, AlertCircle, BarChart2 } from 'lucide-react';

export const ProcessingView: React.FC = () => {
  const { 
    processingProgress, 
    processingStatus, 
    processingMessage, 
    processingError,
    setProcessingProgress,
    setProcessingStatus,
    setProcessingMessage,
    setProcessingError,
    setResults,
    setView,
    resetAll
  } = usePitchTrackStore();

  useEffect(() => {
    let intervalId: any;

    const checkStatus = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/status');
        if (!response.ok) throw new Error('Failed to fetch status');
        
        const data = await response.json();
        setProcessingProgress(data.progress);
        setProcessingStatus(data.status);
        setProcessingMessage(data.message);
        
        if (data.status === 'completed') {
          clearInterval(intervalId);
          // Fetch final results JSON
          await fetchResults();
        } else if (data.status === 'failed') {
          clearInterval(intervalId);
          setProcessingError(data.error || 'Computer Vision tracking pipeline failed.');
        }
      } catch (err: any) {
        console.error('Status polling error:', err);
      }
    };

    const fetchResults = async () => {
      try {
        const response = await fetch('http://localhost:8000/api/results');
        if (!response.ok) throw new Error('Failed to fetch tracking results');
        
        const data = await response.json();
        setResults(data);
        setView('dashboard');
      } catch (err: any) {
        console.error(err);
        setProcessingStatus('failed');
        setProcessingError(err.message || 'Failed to download metrics dataset.');
      }
    };

    // Poll status every 800ms
    intervalId = setInterval(checkStatus, 800);
    checkStatus(); // Initial invocation

    return () => clearInterval(intervalId);
  }, []);

  const progressPercent = Math.min(100, Math.max(0, Math.round(processingProgress * 100)));

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 py-12 max-w-4xl mx-auto w-full">
      <div className="glass p-12 rounded-3xl border border-gray-850 shadow-2xl bg-gray-900/20 max-w-2xl w-full text-center relative overflow-hidden">
        {/* Background tactical coordinates grids effect */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(168,85,247,0.1),rgba(255,255,255,0))]" />
        
        {processingStatus === 'failed' ? (
          /* Error State Panel */
          <div className="space-y-6 animate-fade-in relative z-10">
            <div className="w-20 h-20 rounded-2xl bg-red-950/20 border border-red-500/20 flex items-center justify-center text-red-400 mx-auto shadow-[0_0_20px_rgba(239,68,68,0.1)]">
              <AlertCircle className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-100 uppercase tracking-wide">Analysis Pipeline Failed</h3>
              <p className="text-red-400 mt-3 font-semibold text-sm bg-red-950/10 p-3 rounded-xl border border-red-900/10 break-all font-mono">
                {processingError}
              </p>
            </div>
            <button
              onClick={resetAll}
              className="px-8 py-3.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-bold text-xs uppercase tracking-wider transition-all border border-gray-750 cursor-pointer active:scale-95 mx-auto block"
            >
              Back to Upload
            </button>
          </div>
        ) : (
          /* Active Processing Panel */
          <div className="space-y-8 animate-fade-in relative z-10">
            {/* Pulsing Tactical Core CPU */}
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white mx-auto shadow-[0_0_25px_rgba(168,85,247,0.4)] animate-pulse">
              <Cpu className="w-10 h-10 animate-spin" style={{ animationDuration: '6s' }} />
            </div>
            
            <div className="space-y-2">
              <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 uppercase animate-pulse">
                AI Tracking Dispatch Active
              </span>
              <h3 className="text-2xl font-black text-gray-100 mt-2 uppercase tracking-wide">
                COMPUTING TACTICAL LAYOUTS
              </h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto leading-relaxed">
                YOLOv8 is isolating players & the match ball. Dom jersey color clustering classifies squads in background threads.
              </p>
            </div>

            {/* Premium Glowing Progress Bar */}
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs font-black uppercase tracking-wider text-gray-400 font-mono">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
                  {progressPercent}% Complete
                </span>
                <span className="text-gray-500">Localhost Engine</span>
              </div>
              <div className="w-full h-3.5 bg-gray-950/65 rounded-full overflow-hidden p-0.5 border border-gray-850">
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-cyan-400 rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(168,85,247,0.5)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Micro logs view */}
            <div className="bg-gray-950/45 border border-gray-850 rounded-2xl p-4 text-left space-y-2.5 font-mono text-[11px] text-gray-400 max-w-lg mx-auto shadow-inner">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                <span className="text-gray-500 uppercase font-black tracking-wider text-[9px]">Pipeline Log:</span>
                <span className="text-purple-300 font-bold truncate">{processingMessage}</span>
              </div>
              <div className="border-t border-gray-805/30 pt-2 text-[10px] text-gray-500 leading-relaxed">
                * Running localized ultralytics YOLO inference... <br />
                * Bounding boxes color layout maps to: Purple vs Aqua. <br />
                * Estimating coordinate speeds via 2D Kalman smoothing.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
