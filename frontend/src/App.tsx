import { usePitchTrackStore } from './store/pitchtrackStore';
import { UploadView } from './components/UploadView';
import { ProcessingView } from './components/ProcessingView';
import { DashboardView } from './components/DashboardView';
import { Shield, Sparkles, RefreshCw } from 'lucide-react';

function App() {
  const { currentView, resetAll, results } = usePitchTrackStore();

  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col font-sans text-gray-100">
      {/* Top Premium Navbar */}
      <header className="glass sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-[0_4px_30px_rgba(0,0,0,0.4)] border-b border-gray-900 bg-gray-950/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-500 to-cyan-400 flex items-center justify-center text-white font-black text-lg shadow-[0_0_15px_rgba(168,85,247,0.3)]">
            P
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-gray-100 tracking-wider">
                PITCHTRACK <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">AI</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 tracking-widest uppercase">
                v3
              </span>
            </div>
            <span className="text-[10px] text-gray-500 font-bold block -mt-0.5 tracking-wider uppercase">
              Local-First Tactical Match Analyzer
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-xs font-semibold text-gray-400">
          <div className="hidden sm:flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-cyan-400" />
            <span>Server-side Tracking Privacy</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>YOLOv8 & KMeans Color Division</span>
          </div>
          {results && (
            <button
              onClick={resetAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white transition-all border border-gray-750 active:scale-95 cursor-pointer text-xs"
            >
              <RefreshCw className="w-3 h-3 text-purple-400" />
              New Analysis
            </button>
          )}
        </div>
      </header>

      {/* Primary View Router */}
      <main className="flex-1 flex flex-col justify-center">
        {currentView === 'upload' && <UploadView />}
        {currentView === 'processing' && <ProcessingView />}
        {currentView === 'dashboard' && <DashboardView />}
      </main>

      {/* Premium Footer */}
      <footer className="py-6 text-center text-xs text-gray-600 border-t border-gray-950 bg-gray-950/25">
        <p>© 2026 PitchTrack AI. Styled with Glowing Purples & Aquas. For Football Vision Research.</p>
      </footer>
    </div>
  );
}

export default App;
