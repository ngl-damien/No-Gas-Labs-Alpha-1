
import React, { useRef, useEffect } from 'react';

interface Player {
  id: number;
  x: number;
  y: number;
  health: number;
  gas: number;
  alive: boolean;
  score: number;
  combo: number;
  name?: string;
}

interface GameCanvasProps {
  players: { [key: number]: Player };
  playerId: number | null;
  onSlap: () => void;
}

export function GameCanvas({ players, playerId, onSlap }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width;
        canvas.height = Math.max(400, rect.height);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const drawPlayer = (player: Player) => {
      const radius = 20;
      const x = player.x || Math.random() * (canvas.width - 40) + 20;
      const y = player.y || Math.random() * (canvas.height - 40) + 20;

      // Player circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = player.id === playerId ? '#22c55e' : player.alive ? '#3b82f6' : '#6b7280';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Health bar
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(x - radius, y - radius - 12, radius * 2, 4);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x - radius, y - radius - 12, (radius * 2) * (player.health / 100), 4);

      // Gas bar
      ctx.fillStyle = '#374151';
      ctx.fillRect(x - radius, y - radius - 6, radius * 2, 3);
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(x - radius, y - radius - 6, (radius * 2) * (player.gas / 100), 3);

      // Player ID
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`P${player.id}`, x, y + radius + 15);

      // Score
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px monospace';
      ctx.fillText(`${player.score}`, x, y + radius + 28);
    };

    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw arena border
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);

      // Draw grid
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw players
      Object.values(players).forEach(drawPlayer);

      // Draw instructions if no other players
      if (Object.keys(players).length <= 1) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Click SLAP to start playing!', canvas.width / 2, canvas.height / 2);
        ctx.font = '12px sans-serif';
        ctx.fillText('Other players will join automatically', canvas.width / 2, canvas.height / 2 + 25);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    // Handle canvas clicks for slapping
    const handleCanvasClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Check if click is near any player
      for (const player of Object.values(players)) {
        if (player.id === playerId) continue;
        
        const playerX = player.x || Math.random() * (canvas.width - 40) + 20;
        const playerY = player.y || Math.random() * (canvas.height - 40) + 20;
        const distance = Math.sqrt((clickX - playerX) ** 2 + (clickY - playerY) ** 2);
        
        if (distance < 30) {
          onSlap();
          break;
        }
      }
    };

    canvas.addEventListener('click', handleCanvasClick);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('click', handleCanvasClick);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [players, playerId, onSlap]);

  return (
    <div className="relative w-full h-96 bg-slate-900 rounded-lg overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
