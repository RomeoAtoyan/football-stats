import React from 'react';
import { usePitchTrackStore } from './store/pitchtrackStore';
import { UploadView } from './components/UploadView';
import { CalibrationView } from './components/CalibrationView';
import { AnalyticsView } from './components/AnalyticsView';
import { Shield, Sparkles, HelpCircle } from 'lucide-react';

function App() {
  const { currentView } = usePitchTrackStore();

  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col font-sans">
      {/* Top Premium Navbar */}
      <header className="glass-pitch sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-black font-black text-base shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse">
            P
          </div>
          <div>
            <span className="text-sm font-black text-gray-100 tracking-wider">
              PITCHTRACK <span className="text-emerald-400">AI</span>
            </span>
            <span className="text-[10px] text-gray-500 font-extrabold block -mt-1 tracking-widest uppercase">
              Local-First Match Tracking
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs font-semibold text-gray-400">
          <div className="hidden sm:flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>100% Client-Side Privacy</span>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-teal-400" />
            <span>YOLOv8 & ByteTrack Powered</span>
          </div>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="p-1 rounded-lg hover:bg-gray-800 hover:text-white transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Primary View Router */}
      <main className="flex-1">
        {currentView === 'upload' && <UploadView />}
        {currentView === 'calibrate' && <CalibrationView />}
        {currentView === 'analytics' && <AnalyticsView />}
      </main>

      {/* Premium Footer */}
      <footer className="py-6 text-center text-xs text-gray-600 border-t border-gray-900 bg-gray-950/20">
        <p>© 2026 PitchTrack AI. Crafted with ♥ for Advanced Football Analytics.</p>
      </footer>
    </div>
  );
}

export default App;
