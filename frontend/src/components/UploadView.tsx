import React, { useRef, useState } from 'react';
import { usePitchTrackStore } from '../store/pitchtrackStore';
import { Upload, Film, ArrowRight, Play, Loader2 } from 'lucide-react';

export const UploadView: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  
  const { 
    isUploading, 
    videoMetadata, 
    setUploading, 
    setVideoMetadata, 
    setView 
  } = usePitchTrackStore();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      await uploadFile(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await uploadFile(file);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.mp4') && !file.name.toLowerCase().endsWith('.mov')) {
      alert('Please upload an MP4 or MOV video file.');
      return;
    }
    
    setLocalFile(file);
    setUploading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Upload failed. Please ensure the backend is running.');
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
      alert(err.message || 'Failed to upload video to backend.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 py-8">
      {/* Title block */}
      <div className="text-center mb-10 max-w-2xl">
        <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-green-500 to-teal-500 tracking-tight mb-4">
          PitchTrack AI
        </h1>
        <p className="text-lg text-gray-400">
          Transform small-sided football camera footage into high-precision player tracking data and interactive real-world metric analytics.
        </p>
      </div>

      <div className="w-full max-w-3xl">
        {/* Upload Container */}
        {!videoMetadata ? (
          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={triggerFileInput}
            className={`glass relative group flex flex-col items-center justify-center p-12 rounded-3xl border-2 border-dashed cursor-pointer transition-all duration-300 ${
              dragActive 
                ? 'border-emerald-500 bg-emerald-950/20 shadow-[0_0_30px_rgba(16,185,129,0.15)] scale-[1.01]' 
                : 'border-gray-800 hover:border-emerald-500/50 hover:bg-[#111827]/80 hover:shadow-[0_0_20px_rgba(16,185,129,0.05)]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4, video/quicktime"
              onChange={handleFileChange}
              className="hidden"
              disabled={isUploading}
            />
            
            {isUploading ? (
              <div className="flex flex-col items-center space-y-4 py-8">
                <Loader2 className="w-16 h-16 text-emerald-400 animate-spin" />
                <div className="text-center">
                  <h3 className="text-xl font-bold text-gray-200">Uploading Video File...</h3>
                  <p className="text-sm text-gray-500 mt-1">Extracting video metadata and first frame preview.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-6 text-center py-6">
                <div className="w-20 h-20 rounded-2xl bg-emerald-950/40 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 group-hover:bg-emerald-950/60 group-hover:border-emerald-500/40 transition-all duration-300">
                  <Upload className="w-10 h-10" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-gray-100 group-hover:text-emerald-400 transition-colors">
                    Drag & Drop Match Video
                  </h3>
                  <p className="text-gray-400 mt-2 max-w-md">
                    Select or drop an MP4 video of the small-sided match (16m × 30m pitch, fixed camera position).
                  </p>
                </div>
                <button
                  type="button"
                  className="px-6 py-3 rounded-full bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:shadow-[0_4px_20px_rgba(16,185,129,0.5)] active:scale-95"
                >
                  Browse Files
                </button>
              </div>
            )}
          </div>
        ) : (
          /* File Preview and Info Dashboard */
          <div className="glass rounded-3xl overflow-hidden border border-gray-800 shadow-2xl animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Image Preview */}
              <div className="relative aspect-video md:aspect-auto bg-black flex items-center justify-center group overflow-hidden border-b md:border-b-0 md:border-r border-gray-800">
                <img
                  src={videoMetadata.firstFrameUrl}
                  alt="First frame preview"
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700 opacity-90"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/60 border border-white/10 backdrop-blur-md">
                  <Film className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-semibold text-gray-200">First Frame Extracted</span>
                </div>
              </div>

              {/* Video Stats */}
              <div className="p-8 flex flex-col justify-between space-y-8">
                <div>
                  <span className="text-xs font-semibold tracking-wider text-emerald-400 uppercase">
                    Upload Completed
                  </span>
                  <h3 className="text-2xl font-extrabold text-gray-100 mt-1 break-all truncate" title={videoMetadata.filename}>
                    {videoMetadata.filename}
                  </h3>
                  
                  {/* Detailed Specs list */}
                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="p-3 bg-gray-900/40 rounded-xl border border-gray-800">
                      <span className="text-xs text-gray-500 block">Resolution</span>
                      <span className="text-base font-bold text-gray-200">{videoMetadata.width} × {videoMetadata.height} px</span>
                    </div>
                    <div className="p-3 bg-gray-900/40 rounded-xl border border-gray-800">
                      <span className="text-xs text-gray-500 block">Framerate</span>
                      <span className="text-base font-bold text-gray-200">{videoMetadata.fps} FPS</span>
                    </div>
                    <div className="p-3 bg-gray-900/40 rounded-xl border border-gray-800">
                      <span className="text-xs text-gray-500 block">Duration</span>
                      <span className="text-base font-bold text-gray-200">
                        {Math.floor(videoMetadata.duration / 60)}m {Math.floor(videoMetadata.duration % 60)}s
                      </span>
                    </div>
                    <div className="p-3 bg-gray-900/40 rounded-xl border border-gray-800">
                      <span className="text-xs text-gray-500 block">Frame Count</span>
                      <span className="text-base font-bold text-gray-200">{videoMetadata.totalFrames} frames</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setVideoMetadata(null)}
                    className="px-5 py-3.5 rounded-xl border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-900/60 font-semibold text-sm transition-all"
                  >
                    Change Video
                  </button>
                  <button
                    onClick={() => setView('calibrate')}
                    className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-500 text-black font-semibold text-sm hover:bg-emerald-400 transition-all shadow-[0_4px_12px_rgba(16,185,129,0.2)] hover:shadow-[0_4px_20px_rgba(16,185,129,0.4)] active:scale-[0.98]"
                  >
                    Configure Calibration
                    <ArrowRight className="w-4 h-4" />
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
