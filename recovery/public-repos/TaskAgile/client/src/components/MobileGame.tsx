
import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';
import { Badge } from './ui/badge';
import { Trophy, Zap, Gift, Users } from 'lucide-react';

interface GameState {
  score: number;
  combo: number;
  health: number;
  gas: number;
  alive: boolean;
  dailyClaimed: boolean;
}

export function MobileGame() {
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    combo: 1,
    health: 100,
    gas: 100,
    alive: true,
    dailyClaimed: false
  });
  
  const [lastSlapTime, setLastSlapTime] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    // Gas recharge timer
    const gasTimer = setInterval(() => {
      setGameState(prev => ({
        ...prev,
        gas: Math.min(100, prev.gas + 5)
      }));
    }, 1000);

    return () => clearInterval(gasTimer);
  }, []);

  const handleSlap = () => {
    const now = Date.now();
    if (now - lastSlapTime < 250) return; // Rate limiting
    
    if (gameState.gas < 20) {
      navigator.vibrate && navigator.vibrate(100);
      return;
    }

    setGameState(prev => ({
      ...prev,
      score: prev.score + (10 * prev.combo),
      combo: Math.min(prev.combo + 1, 50),
      gas: Math.max(0, prev.gas - 20)
    }));

    setLastSlapTime(now);
    
    // Haptic feedback
    navigator.vibrate && navigator.vibrate([10, 5, 15]);
    
    // Audio feedback
    playHitSound();
  };

  const playHitSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'square';
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      // Audio context might not be available
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1e12) return `${(num / 1e12).toFixed(1)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toString();
  };

  const claimDailyReward = () => {
    if (!gameState.dailyClaimed) {
      setGameState(prev => ({
        ...prev,
        score: prev.score + 1000,
        dailyClaimed: true
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
              No_Gas_Slaps™
            </h1>
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "default" : "secondary"}>
                {formatNumber(gameState.score)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowStats(!showStats)}
              >
                <Trophy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Panel */}
      {showStats && (
        <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700">
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div>
              <div className="text-slate-400">Score</div>
              <div className="font-bold">{formatNumber(gameState.score)}</div>
            </div>
            <div>
              <div className="text-slate-400">Combo</div>
              <div className="font-bold">x{gameState.combo}</div>
            </div>
            <div>
              <div className="text-slate-400">Status</div>
              <Badge variant={gameState.alive ? "default" : "destructive"} className="text-xs">
                {gameState.alive ? "Alive" : "Dead"}
              </Badge>
            </div>
          </div>
        </div>
      )}

      {/* Main Game Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 space-y-6">
        {/* Status Bars */}
        <div className="w-full max-w-sm space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-red-400">Health</span>
              <span>{gameState.health}/100</span>
            </div>
            <Progress value={gameState.health} className="h-3" />
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-blue-400">Gas</span>
              <span>{gameState.gas}/100</span>
            </div>
            <Progress value={gameState.gas} className="h-3 bg-blue-900" />
          </div>
        </div>

        {/* Main Slap Button */}
        <div className="relative">
          <Button
            size="lg"
            className="w-48 h-48 rounded-full text-3xl font-bold bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 transform transition-all duration-150 hover:scale-105 active:scale-95 shadow-2xl"
            onClick={handleSlap}
            disabled={!gameState.alive || gameState.gas < 20}
          >
            <div className="flex flex-col items-center">
              <div>SLAP!</div>
              <div className="text-lg">x{gameState.combo}</div>
            </div>
          </Button>
          
          {/* Ripple effect */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-green-500/20 to-blue-500/20 animate-pulse"></div>
        </div>

        {/* Score Display */}
        <Card className="w-full max-w-sm bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6 text-center">
            <div className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
              {formatNumber(gameState.score)}
            </div>
            <div className="text-sm text-slate-400 mt-1">Total Score</div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Actions */}
      <div className="sticky bottom-0 p-4 bg-slate-900/80 backdrop-blur-sm border-t border-slate-700">
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={claimDailyReward}
            disabled={gameState.dailyClaimed}
            variant={gameState.dailyClaimed ? "secondary" : "default"}
            className="flex items-center gap-2"
          >
            <Gift className="h-4 w-4" />
            {gameState.dailyClaimed ? "Claimed!" : "Daily +1000"}
          </Button>
          
          <Button variant="outline" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Leaderboard
          </Button>
        </div>
      </div>

      {/* Game Instructions */}
      <div className="fixed bottom-20 left-4 right-4 pointer-events-none">
        <div className="text-center text-sm text-slate-400">
          {gameState.gas < 20 ? (
            <div className="bg-red-900/50 p-2 rounded-lg pointer-events-auto">
              ⛽ Not enough gas! Wait for recharge...
            </div>
          ) : (
            <div>Tap the button rapidly to build combos!</div>
          )}
        </div>
      </div>
    </div>
  );
}
