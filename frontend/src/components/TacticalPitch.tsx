import React, { useEffect, useRef, useState } from 'react';
import { Target, Users, Play, Pause, FastForward, Info } from 'lucide-react';

interface TrackingPoint {
  id: number;
  pixel_x: number;
  pixel_y: number;
  field_x: number;
  field_y: number;
  team?: string;
  role?: string;
}

interface TacticalPitchProps {
  trackingData: TrackingPoint[];
  wsActive: boolean;
}

export default function TacticalPitch({ trackingData = [], wsActive }: TacticalPitchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trailsRef = useRef<Record<number, [number, number][]>>({});
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);

  const PITCH_WIDTH_METERS = 30;
  const PITCH_HEIGHT_METERS = 16;

  // Track trails history
  useEffect(() => {
    // Append current points to trails
    trackingData.forEach(player => {
      if (!trailsRef.current[player.id]) {
        trailsRef.current[player.id] = [];
      }
      trailsRef.current[player.id].push([player.field_x, player.field_y]);
      // Limit to last 45 frames for performance and layout aesthetics
      if (trailsRef.current[player.id].length > 45) {
        trailsRef.current[player.id].shift();
      }
    });

    // Clean up inactive trails
    const currentIds = new Set(trackingData.map(p => p.id));
    Object.keys(trailsRef.current).forEach(id => {
      const numericId = parseInt(id);
      if (!currentIds.has(numericId) && trackingData.length > 0) {
        delete trailsRef.current[numericId];
      }
    });
  }, [trackingData]);

  // Clean all trails if websocket starts or stops
  useEffect(() => {
    trailsRef.current = {};
  }, [wsActive]);

  // Dynamic canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaleX = canvas.width / PITCH_WIDTH_METERS;
    const scaleY = canvas.height / PITCH_HEIGHT_METERS;

    // 1. Draw Green Pitch Background
    ctx.fillStyle = '#081c15'; // Dark premium grass theme matching our index.css color variables
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grass cut lines (stripes)
    const stripeWidth = canvas.width / 12;
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) {
        ctx.fillStyle = '#0b251a';
        ctx.fillRect(i * stripeWidth, 0, stripeWidth, canvas.height);
      }
    }

    // 2. Draw Pitch Markings (White Lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2.5;

    // Outer boundary
    ctx.strokeRect(0, 0, canvas.width, canvas.height);

    // Halfway line
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Center circle (3.0m radius futsal standard)
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 3.0 * scaleX, 0, 2 * Math.PI);
    ctx.stroke();

    // Center mark spot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 3, 0, 2 * Math.PI);
    ctx.fill();

    // Left Penalty Box (6m deep, 10m widecentered on Y=8.0)
    ctx.strokeRect(0, 3.0 * scaleY, 6.0 * scaleX, 10.0 * scaleY);
    // Left Penalty spot (6m out)
    ctx.beginPath();
    ctx.arc(6.0 * scaleX, canvas.height / 2, 3, 0, 2 * Math.PI);
    ctx.fill();

    // Right Penalty Box (6m deep, 10m wide centered on Y=8.0)
    ctx.strokeRect(canvas.width - 6.0 * scaleX, 3.0 * scaleY, 6.0 * scaleX, 10.0 * scaleY);
    // Right Penalty spot (6m out)
    ctx.beginPath();
    ctx.arc(canvas.width - 6.0 * scaleX, canvas.height / 2, 3, 0, 2 * Math.PI);
    ctx.fill();

    // Goals (Centered on Y=8.0, 3m wide futsal goals drawn sticking out)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    // Left goal
    ctx.strokeRect(-8, 6.5 * scaleY, 8, 3.0 * scaleY);
    // Right goal
    ctx.strokeRect(canvas.width, 6.5 * scaleY, 8, 3.0 * scaleY);

    // Reset line width for trails
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';

    Object.keys(trailsRef.current).forEach(id => {
      const numericId = parseInt(id);
      const trail = trailsRef.current[numericId];
      if (!trail || trail.length < 2) return;

      // Check player details for matching trail colors
      const activePlayer = trackingData.find(p => p.id === numericId);
      const isTeamA = activePlayer ? activePlayer.team === 'A' : numericId % 2 === 0;
      
      ctx.beginPath();
      ctx.moveTo(trail[0][0] * scaleX, trail[0][1] * scaleY);
      for (let i = 1; i < trail.length; i++) {
        ctx.lineTo(trail[i][0] * scaleX, trail[i][1] * scaleY);
      }

      // Configure a gorgeous fading trail stroke
      const gradient = ctx.createLinearGradient(
        trail[0][0] * scaleX, trail[0][1] * scaleY,
        trail[trail.length - 1][0] * scaleX, trail[trail.length - 1][1] * scaleY
      );
      
      if (isTeamA) {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.05)');  // Team Blue
        gradient.addColorStop(1, 'rgba(96, 165, 250, 0.45)');
      } else {
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.05)');   // Team Red
        gradient.addColorStop(1, 'rgba(248, 113, 113, 0.45)');
      }

      ctx.strokeStyle = gradient;
      ctx.lineWidth = selectedPlayerId === numericId ? 5.0 : 3.0;
      ctx.stroke();
    });

    // 4. Draw Player circular badges
    trackingData.forEach(player => {
      const cx = player.field_x * scaleX;
      const cy = player.field_y * scaleY;
      
      // Determine colors based on team
      const isTeamA = player.team ? player.team === 'A' : player.id % 2 === 0;
      const primaryColor = isTeamA ? '#3b82f6' : '#ef4444'; // Blue vs Red
      const secondaryColor = '#ffffff';
      
      const isSelected = selectedPlayerId === player.id;

      // Draw select halo glow ring if selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(250, 204, 21, 0.25)'; // Yellow glowing halo
        ctx.fill();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw main player circle
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, 2 * Math.PI);
      ctx.fillStyle = primaryColor;
      ctx.fill();
      ctx.strokeStyle = secondaryColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw player jersey number
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Format jersey e.g., P1, P2 or just 1, 2
      ctx.fillText(player.id.toString(), cx, cy);

      // Draw role acronym above player circle
      if (player.role) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '8px monospace';
        ctx.fillText(player.role.toUpperCase(), cx, cy - 20);
      }
    });

  }, [trackingData, selectedPlayerId]);

  // Click on tactical canvas to select and inspect players
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * PITCH_WIDTH_METERS;
    const clickY = ((e.clientY - rect.top) / rect.height) * PITCH_HEIGHT_METERS;

    // Find nearest player
    let closestPlayer: TrackingPoint | null = null;
    let minDistance = 5.0; // max click distance in meters

    trackingData.forEach(player => {
      const dx = player.field_x - clickX;
      const dy = player.field_y - clickY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < minDistance) {
        minDistance = dist;
        closestPlayer = player;
      }
    });

    if (closestPlayer) {
      setSelectedPlayerId((closestPlayer as TrackingPoint).id);
    } else {
      setSelectedPlayerId(null);
    }
  };

  const selectedPlayerInfo = trackingData.find(p => p.id === selectedPlayerId);

  return (
    <div className="flex flex-col gap-4 p-6 glass rounded-2xl border border-[#ffffff08] shadow-2xl relative overflow-hidden">
      
      {/* Title Header */}
      <div className="flex justify-between items-center border-b border-[#ffffff10] pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-white">2D Top-Down Tactical Map</h3>
            <p className="text-xs text-gray-400">Live projected birds-eye visualization with kinematic filtering</p>
          </div>
        </div>
      </div>

      {/* Main Pitch Field Canvas */}
      <div className="flex justify-center bg-slate-950/40 p-4 rounded-xl border border-slate-800 shadow-inner">
        <canvas
          ref={canvasRef}
          width={840}
          height={544}
          onClick={handleCanvasClick}
          className="rounded-lg border border-slate-900 shadow-lg cursor-pointer w-full max-w-[840px] aspect-[840/544]"
        />
      </div>

      {/* Tactical Meta Stats & Active Inspector */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Active Player Inspector */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 text-xs flex flex-col gap-3">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5 border-b border-[#ffffff05] pb-2">
            <Target className="w-4 h-4 text-emerald-400" /> Active Player Inspector
          </span>
          {selectedPlayerInfo ? (
            <div className="grid grid-cols-2 gap-2 text-slate-300 font-mono">
              <span className="text-gray-400">Player ID:</span>
              <span className="font-bold text-emerald-400">Jersey #{selectedPlayerInfo.id}</span>
              
              <span className="text-gray-400">Assigned Team:</span>
              <span className={selectedPlayerInfo.team === 'A' ? 'text-blue-400 font-bold' : 'text-red-400 font-bold'}>
                Team {selectedPlayerInfo.team || 'A'}
              </span>

              <span className="text-gray-400">Role / Position:</span>
              <span className="text-white capitalize">{selectedPlayerInfo.role || 'Player'}</span>

              <span className="text-gray-400">Pitch Coordinates:</span>
              <span className="text-amber-400 font-bold">
                X: {selectedPlayerInfo.field_x.toFixed(2)}m, Y: {selectedPlayerInfo.field_y.toFixed(2)}m
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 py-4 justify-center">
              <Info className="w-4 h-4" />
              <span>Click on any player badge on the field to inspect movement telemetry</span>
            </div>
          )}
        </div>

        {/* Live Broadcast Telemetry */}
        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800 text-xs flex flex-col gap-2">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5 border-b border-[#ffffff05] pb-2">
            <FastForward className="w-4 h-4 text-blue-400" /> Game Telemetry Stats
          </span>
          <div className="flex flex-col gap-2 text-slate-300 font-mono">
            <div className="flex justify-between">
              <span className="text-gray-400">Total Tracked Objects:</span>
              <span className="text-white font-bold">{trackingData.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Active Pipeline Speed:</span>
              <span className="text-emerald-400 font-bold">{wsActive ? '20 FPS' : 'Idle'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Physical Pitch Size:</span>
              <span className="text-white">30m x 16m (Custom Mini Pitch)</span>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
