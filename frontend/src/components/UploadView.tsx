import React, { useRef, useState } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { Upload, Film, ArrowRight, Loader2 } from 'lucide-react';

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

  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] px-6 py-12 max-w-5xl mx-auto w-full">
      {/* Strategic Vision Intro Header */}
      <div className="text-center mb-12 max-w-3xl">
        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-indigo-400 to-cyan-400 tracking-tight mb-4 uppercase">
          Tactical Player Vision
        </h1>
        <p className="text-gray-400 text-base leading-relaxed">
          Upload any match video. Our AI tracking engine automatically detects players, clusters jersey colors, and groups players into teams. We visualize team paths in glowing <span className="text-purple-400 font-bold">Purple</span> & <span className="text-cyan-400 font-bold">Aqua</span> bounding boxes.
        </p>
      </div>

      <div className="w-full max-w-3xl">
        {!videoMetadata ? (
          /* Glassmorphic Dropzone */
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
        ) : (
          /* Thumbnail Preview Dashboard */
          <div className="glass rounded-3xl overflow-hidden border border-gray-805 shadow-2xl animate-fade-in bg-gray-900/25">
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Left Side: Extraction Thumbnail */}
              <div className="relative aspect-video md:aspect-auto bg-black flex items-center justify-center overflow-hidden border-b md:border-b-0 md:border-r border-gray-850">
                <img
                  src={videoMetadata.firstFrameUrl}
                  alt="Extraction frame"
                  className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-transparent" />
                <div className="absolute bottom-5 left-5 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-white/5 backdrop-blur-md">
                  <Film className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-black tracking-wider text-gray-200 uppercase">Frame 00:01</span>
                </div>
              </div>

              {/* Right Side: Specs & Action Button */}
              <div className="p-8 flex flex-col justify-between space-y-8">
                <div>
                  <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 uppercase">
                    Stream Extracted
                  </span>
                  <h3 className="text-2xl font-black text-gray-100 mt-3 break-all line-clamp-1" title={videoMetadata.filename}>
                    {videoMetadata.filename}
                  </h3>
                  
                  {/* Dashboard stats list */}
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">Resolution</span>
                      <span className="text-sm font-black text-gray-200">{videoMetadata.width} × {videoMetadata.height} px</span>
                    </div>
                    <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">Framerate</span>
                      <span className="text-sm font-black text-gray-200">{videoMetadata.fps} FPS</span>
                    </div>
                    <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">Duration</span>
                      <span className="text-sm font-black text-gray-200">
                        {Math.floor(videoMetadata.duration / 60)}m {Math.floor(videoMetadata.duration % 60)}s
                      </span>
                    </div>
                    <div className="p-3 bg-gray-950/20 rounded-xl border border-gray-850">
                      <span className="text-[10px] text-gray-500 font-bold block uppercase tracking-wider">Frames</span>
                      <span className="text-sm font-black text-gray-200">{videoMetadata.totalFrames} frames</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <button
                    onClick={() => setVideoMetadata(null)}
                    className="px-5 py-3.5 rounded-xl border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-900/60 font-black text-xs uppercase tracking-wider transition-all cursor-pointer text-center"
                  >
                    Replace
                  </button>
                  <button
                    onClick={startAnalysis}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 hover:from-purple-500 hover:to-indigo-500 hover:to-cyan-400 text-white font-black text-xs uppercase tracking-wider transition-all shadow-[0_4px_20px_rgba(168,85,247,0.3)] hover:shadow-[0_4px_25px_rgba(168,85,247,0.55)] active:scale-[0.98] cursor-pointer"
                  >
                    Run Tracking & Team Clustering
                    <ArrowRight className="w-4 h-4 text-cyan-300" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
