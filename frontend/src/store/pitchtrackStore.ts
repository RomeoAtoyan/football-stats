import { create } from 'zustand';

export interface PlayerPathPoint {
  frame: number;
  x: number;
  y: number;
  speed: number;
}

export interface PlayerSummary {
  id: number;
  team: 'A' | 'B';
  distance: number;
  avgSpeed: number;
  topSpeed: number;
  path: PlayerPathPoint[];
}

export interface FrameDetection {
  id: number;
  team: 'A' | 'B';
  bbox: [number, number, number, number]; // [x, y, w, h]
  real: [number, number]; // [rx, ry]
  speed: number;
}

export interface MatchResults {
  metadata: {
    width: number;
    height: number;
    fps: number;
    duration: number;
    totalFrames: number;
  };
  players: PlayerSummary[];
  frames: Record<string, FrameDetection[]>;
}

interface PitchTrackState {
  // Navigation
  currentView: 'upload' | 'processing' | 'dashboard';
  
  // Upload State
  videoMetadata: {
    filename: string;
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
    duration: number;
    firstFrameUrl: string;
  } | null;
  isUploading: boolean;
  
  // Processing State
  processingStatus: 'idle' | 'processing' | 'completed' | 'failed';
  processingProgress: number;
  processingMessage: string;
  processingError: string | null;
  
  // Analytics State
  results: MatchResults | null;
  selectedPlayerId: number | null;
  
  // Actions
  setView: (view: 'upload' | 'processing' | 'dashboard') => void;
  setVideoMetadata: (meta: PitchTrackState['videoMetadata']) => void;
  setUploading: (val: boolean) => void;
  
  // Processing Actions
  setProcessingStatus: (status: PitchTrackState['processingStatus']) => void;
  setProcessingProgress: (progress: number) => void;
  setProcessingMessage: (msg: string) => void;
  setProcessingError: (err: string | null) => void;
  
  // Analytics Actions
  setResults: (results: MatchResults | null) => void;
  setSelectedPlayerId: (id: number | null) => void;
  
  // Reset Action
  resetAll: () => void;
}

export const usePitchTrackStore = create<PitchTrackState>((set) => ({
  // Navigation
  currentView: 'upload',
  
  // Upload State
  videoMetadata: null,
  isUploading: false,
  
  // Processing State
  processingStatus: 'idle',
  processingProgress: 0.0,
  processingMessage: 'Ready',
  processingError: null,
  
  // Analytics State
  results: null,
  selectedPlayerId: null,
  
  // Actions
  setView: (view) => set({ currentView: view }),
  setVideoMetadata: (meta) => set({ videoMetadata: meta }),
  setUploading: (val) => set({ isUploading: val }),
  
  // Processing Actions
  setProcessingStatus: (status) => set({ processingStatus: status }),
  setProcessingProgress: (progress) => set({ processingProgress: progress }),
  setProcessingMessage: (msg) => set({ processingMessage: msg }),
  setProcessingError: (err) => set({ processingError: err }),
  
  // Analytics Actions
  setResults: (results) => set({ results }),
  setSelectedPlayerId: (id) => set({ selectedPlayerId: id }),
  
  // Reset
  resetAll: () => set({
    currentView: 'upload',
    videoMetadata: null,
    isUploading: false,
    processingStatus: 'idle',
    processingProgress: 0.0,
    processingMessage: 'Ready',
    processingError: null,
    results: null,
    selectedPlayerId: null,
  }),
}));
