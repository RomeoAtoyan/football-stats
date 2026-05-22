import { create } from 'zustand';

export interface CalibrationMarker {
  id: string;
  label: string;
  section: 'LEFT' | 'CENTER' | 'RIGHT' | 'FIELD';
  description: string;
  real: [number, number]; // [X, Y] in meters
  pixel: [number, number] | null; // [x, y] in pixels
}

export interface PlayerPathPoint {
  frame: number;
  x: number;
  y: number;
  speed: number;
}

export interface PlayerSummary {
  id: number;
  distance: number;
  avgSpeed: number;
  topSpeed: number;
  path: PlayerPathPoint[];
}

export interface FrameDetection {
  id: number;
  bbox: [number, number, number, number]; // [x, y, w, h]
  real: [number, number];
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
  currentView: 'upload' | 'calibrate' | 'analytics';
  
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
  
  // Calibration State
  markers: CalibrationMarker[];
  activeMarkerId: string | null;
  gridOverlayUrl: string | null;
  isCalibrating: boolean;
  
  // Processing State
  processingStatus: 'idle' | 'processing' | 'completed' | 'failed';
  processingProgress: number;
  processingError: string | null;
  
  // Analytics State
  results: MatchResults | null;
  selectedPlayerId: number | null;
  currentFrame: number;
  isPlaying: boolean;
  playbackSpeed: number;
  
  // Actions
  setView: (view: 'upload' | 'calibrate' | 'analytics') => void;
  setVideoMetadata: (meta: PitchTrackState['videoMetadata']) => void;
  setUploading: (val: boolean) => void;
  
  // Calibration Actions
  setMarkerPixel: (id: string, pixel: [number, number] | null) => void;
  updateMarkerReal: (id: string, real: [number, number]) => void;
  setActiveMarkerId: (id: string | null) => void;
  resetCalibration: () => void;
  setGridOverlayUrl: (url: string | null) => void;
  setCalibrating: (val: boolean) => void;
  
  // Processing Actions
  setProcessingStatus: (status: PitchTrackState['processingStatus']) => void;
  setProcessingProgress: (progress: number) => void;
  setProcessingError: (err: string | null) => void;
  
  // Analytics Actions
  setResults: (results: MatchResults | null) => void;
  setSelectedPlayerId: (id: number | null) => void;
  setCurrentFrame: (frame: number) => void;
  setPlaying: (val: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
}

const initialMarkers: CalibrationMarker[] = [
  { id: 'corner_tl', label: 'Top-Left Corner', section: 'FIELD', description: 'Intersection of left goal line and top sideline', real: [0, 0], pixel: null },
  { id: 'corner_tr', label: 'Top-Right Corner', section: 'FIELD', description: 'Intersection of right goal line and top sideline', real: [30, 0], pixel: null },
  { id: 'corner_bl', label: 'Bottom-Left Corner', section: 'FIELD', description: 'Intersection of left goal line and bottom sideline', real: [0, 16], pixel: null },
  { id: 'corner_br', label: 'Bottom-Right Corner', section: 'FIELD', description: 'Intersection of right goal line and bottom sideline', real: [30, 16], pixel: null },
  { id: 'center_top', label: 'Center-Top Touchline', section: 'CENTER', description: 'Intersection of center line and top sideline', real: [15, 0], pixel: null },
  { id: 'center_bottom', label: 'Center-Bottom Touchline', section: 'CENTER', description: 'Intersection of center line and bottom sideline', real: [15, 16], pixel: null },
  { id: 'center_spot', label: 'Center Spot', section: 'CENTER', description: 'Kickoff spot in the center of the pitch', real: [15, 8], pixel: null },
  { id: 'penalty_l', label: 'Left Penalty Spot', section: 'LEFT', description: 'Penalty spot centered in front of the left goal (6m out)', real: [6, 8], pixel: null },
  { id: 'penalty_r', label: 'Right Penalty Spot', section: 'RIGHT', description: 'Penalty spot centered in front of the right goal (6m out)', real: [24, 8], pixel: null },
  { id: 'goal_lt', label: 'Left Goal - Top Post', section: 'LEFT', description: 'Left yellow goalpost on the ground line (further from camera)', real: [0, 6.5], pixel: null },
  { id: 'goal_lb', label: 'Left Goal - Bottom Post', section: 'LEFT', description: 'Left yellow goalpost on the ground line (closer to camera)', real: [0, 9.5], pixel: null },
  { id: 'goal_rt', label: 'Right Goal - Top Post', section: 'RIGHT', description: 'Right yellow goalpost on the ground line (further from camera)', real: [30, 6.5], pixel: null },
  { id: 'goal_rb', label: 'Right Goal - Bottom Post', section: 'RIGHT', description: 'Right yellow goalpost on the ground line (closer to camera)', real: [30, 9.5], pixel: null },
];

const loadPersistedMarkers = (): CalibrationMarker[] => {
  try {
    const saved = localStorage.getItem('pitchtrack_markers');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return initialMarkers.map(initial => {
          const match = parsed.find((m: any) => m.id === initial.id);
          return match ? { ...initial, pixel: match.pixel } : initial;
        });
      }
    }
  } catch (e) {
    console.error('Failed to load persisted markers:', e);
  }
  return initialMarkers;
};

export const usePitchTrackStore = create<PitchTrackState>((set) => ({
  // Navigation
  currentView: 'upload',
  
  // Upload State
  videoMetadata: null,
  isUploading: false,
  
  // Calibration State
  markers: loadPersistedMarkers(),
  activeMarkerId: 'corner_tr', // Start with the visible top-right corner
  gridOverlayUrl: null,
  isCalibrating: false,
  
  // Processing State
  processingStatus: 'idle',
  processingProgress: 0.0,
  processingError: null,
  
  // Analytics State
  results: null,
  selectedPlayerId: null,
  currentFrame: 0,
  isPlaying: false,
  playbackSpeed: 1.0,
  
  // Actions
  setView: (view) => set({ currentView: view }),
  setVideoMetadata: (meta) => set({ videoMetadata: meta }),
  setUploading: (val) => set({ isUploading: val }),
  
  // Calibration Actions
  setMarkerPixel: (id, pixel) => set((state) => {
    const updatedMarkers = state.markers.map(m => m.id === id ? { ...m, pixel } : m);
    try {
      localStorage.setItem('pitchtrack_markers', JSON.stringify(updatedMarkers));
    } catch (e) {
      console.error('Failed to save markers to localStorage:', e);
    }
    return { markers: updatedMarkers };
  }),
  
  updateMarkerReal: (id, real) => set((state) => {
    const updatedMarkers = state.markers.map(m => m.id === id ? { ...m, real } : m);
    try {
      localStorage.setItem('pitchtrack_markers', JSON.stringify(updatedMarkers));
    } catch (e) {
      console.error('Failed to save markers to localStorage:', e);
    }
    return { markers: updatedMarkers };
  }),
  
  setActiveMarkerId: (id) => set({ activeMarkerId: id }),
  
  resetCalibration: () => {
    try {
      localStorage.removeItem('pitchtrack_markers');
    } catch (e) {
      console.error('Failed to remove markers from localStorage:', e);
    }
    set({ 
      markers: initialMarkers.map(m => ({ ...m, pixel: null })),
      activeMarkerId: 'corner_tr',
      gridOverlayUrl: null
    });
  },
  
  setGridOverlayUrl: (url) => set({ gridOverlayUrl: url }),
  setCalibrating: (val) => set({ isCalibrating: val }),
  
  // Processing Actions
  setProcessingStatus: (status) => set({ processingStatus: status }),
  setProcessingProgress: (progress) => set({ processingProgress: progress }),
  setProcessingError: (err) => set({ processingError: err }),
  
  // Analytics Actions
  setResults: (results) => set({ results }),
  setSelectedPlayerId: (id) => set({ selectedPlayerId: id }),
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setPlaying: (val) => set({ isPlaying: val }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
}));
