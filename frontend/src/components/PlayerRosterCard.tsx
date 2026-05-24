import React from 'react';
import type { PlayerSummary } from '../store/pitchtrackStore';
import { Gauge, Route, User } from 'lucide-react';

interface PlayerRosterCardProps {
  player: PlayerSummary;
  thumbnailUrl?: string;
  isSelected: boolean;
  isLoadingThumb?: boolean;
  onSelect: () => void;
}

const teamStyles = {
  A: {
    ring: 'ring-purple-500/60',
    selectedBg: 'bg-purple-500/15 border-purple-500/50',
    idleBg: 'bg-white/[0.03] border-white/10 hover:border-purple-500/35 hover:bg-purple-500/8',
    badge: 'bg-purple-600 text-white',
    accent: 'text-purple-400',
    placeholder: 'from-purple-900/40 to-purple-950/20',
  },
  B: {
    ring: 'ring-cyan-400/60',
    selectedBg: 'bg-cyan-500/15 border-cyan-400/50',
    idleBg: 'bg-white/[0.03] border-white/10 hover:border-cyan-400/35 hover:bg-cyan-500/8',
    badge: 'bg-cyan-400 text-gray-950',
    accent: 'text-cyan-400',
    placeholder: 'from-cyan-900/40 to-cyan-950/20',
  },
} as const;

export const PlayerRosterCard: React.FC<PlayerRosterCardProps> = ({
  player,
  thumbnailUrl,
  isSelected,
  isLoadingThumb,
  onSelect,
}) => {
  const s = teamStyles[player.team];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex flex-col rounded-xl border text-left transition-all duration-200 cursor-pointer overflow-hidden ${
        isSelected ? `${s.selectedBg} ring-2 ${s.ring} shadow-lg` : s.idleBg
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-gray-950">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Player ${player.id}`}
            className="h-full w-full object-cover object-top scale-105 group-hover:scale-110 transition-transform duration-300"
          />
        ) : (
          <div
            className={`flex h-full w-full items-center justify-center bg-gradient-to-b ${s.placeholder}`}
          >
            {isLoadingThumb ? (
              <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
            ) : (
              <User className={`h-8 w-8 ${s.accent} opacity-40`} />
            )}
          </div>
        )}

        {/* ID badge */}
        <span
          className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wide shadow-md ${s.badge}`}
        >
          P{player.id}
        </span>

        {isSelected && (
          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-black/55 text-white border border-white/10">
            Active
          </span>
        )}
      </div>

      {/* Stats strip */}
      <div className="px-2.5 py-2 space-y-1 border-t border-white/5">
        <div className="flex items-center justify-between gap-1 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <Route className="w-3 h-3" />
            Distance
          </span>
          <span className="font-semibold text-gray-200 tabular-nums">{player.distance} m</span>
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            Avg
          </span>
          <span className={`font-semibold tabular-nums ${s.accent}`}>{player.avgSpeed} km/h</span>
        </div>
      </div>
    </button>
  );
};
