
import React, { useState, useEffect } from 'react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Progress } from './components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { useIsMobile } from './hooks/use-is-mobile';
import { GameCanvas } from './components/GameCanvas';
import { MobileGame } from './components/MobileGame';
import { Trophy, Zap, Gift, Users, Volume2, VolumeX, HelpCircle } from 'lucide-react';

interface GameState {
  score: number;
  combo: number;
  powerUps: { [key: string]: any };
  dailyClaimed: boolean;
  health: number;
  gas: number;
  alive: boolean;
}

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

export default function App() {
  const isMobile = useIsMobile();
  const [gameState, setGameState] = useState<GameState>({
    score: 0,
    combo: 1,
    powerUps: {},
    dailyClaimed: false,
    health: 100,
    gas: 100,
    alive: true
  });
  
  const [players, setPlayers] = useState<{ [key: number]: Player }>({});
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [lastSlapTime, setLastSlapTime] = useState(0);

  // WebSocket connection
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      console.log('Connected to game server');
      setIsConnected(true);
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    websocket.onclose = () => {
      console.log('Disconnected from game server');
      setIsConnected(false);
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, []);

  const handleWebSocketMessage = (data: any) => {
    switch (data.type) {
      case 'init':
        setPlayerId(data.id);
        setPlayers(data.players);
        if (data.players[data.id]) {
          setGameState(prev => ({
            ...prev,
            health: data.players[data.id].health,
            gas: data.players[data.id].gas,
            alive: data.players[data.id].alive,
            score: data.players[data.id].score,
            combo: data.players[data.id].combo
          }));
        }
        break;

      case 'playerJoined':
        setPlayers(prev => ({
          ...prev,
          [data.player.id]: data.player
        }));
        break;

      case 'playerLeft':
        setPlayers(prev => {
          const newPlayers = { ...prev };
          delete newPlayers[data.id];
          return newPlayers;
        });
        break;

      case 'playerMoved':
        setPlayers(prev => ({
          ...prev,
          [data.id]: {
            ...prev[data.id],
            x: data.x,
            y: data.y
          }
        }));
        break;

      case 'playerHit':
        if (data.id === playerId) {
          setGameState(prev => ({
            ...prev,
            health: data.health
          }));
        }
        break;

      case 'playerUpdate':
        if (data.id === playerId) {
          setGameState(prev => ({
            ...prev,
            gas: data.gas,
            score: data.score,
            combo: data.combo
          }));
        }
        break;

      case 'playerDied':
        if (data.id === playerId) {
          setGameState(prev => ({
            ...prev,
            alive: false
          }));
        }
        break;

      case 'gasRecharge':
        if (data.players[playerId]) {
          setGameState(prev => ({
            ...prev,
            gas: data.players[playerId].gas
          }));
        }
        setPlayers(data.players);
        break;

      case 'gameReset':
        setPlayers(data.players);
        if (data.players[playerId]) {
          setGameState(prev => ({
            ...prev,
            health: data.players[playerId].health,
            gas: data.players[playerId].gas,
            alive: data.players[playerId].alive,
            score: data.players[playerId].score,
            combo: data.players[playerId].combo
          }));
        }
        break;
    }

    // Update leaderboard
    const playerList = Object.values(data.players || players).sort((a: any, b: any) => b.score - a.score);
    setLeaderboard(playerList.slice(0, 10));
  };

  const handleSlap = () => {
    if (!ws || !playerId || !gameState.alive) return;
    
    const now = Date.now();
    if (now - lastSlapTime < 250) return; // Rate limiting
    
    if (gameState.gas < 20) {
      console.log('Not enough gas to slap!');
      return;
    }

    // Find nearest target (for single player mode)
    const nearestTarget = Object.values(players).find(
      (player: Player) => player.id !== playerId && player.alive
    );

    if (nearestTarget) {
      ws.send(JSON.stringify({
        type: 'slap',
        targetId: nearestTarget.id
      }));
    } else {
      // Single player slap
      setGameState(prev => ({
        ...prev,
        score: prev.score + (10 * prev.combo),
        combo: Math.min(prev.combo + 1, 50),
        gas: Math.max(0, prev.gas - 20)
      }));
    }

    setLastSlapTime(now);
    
    // Play sound effect if not muted
    if (!isMuted) {
      playHitSound();
    }
  };

  const playHitSound = () => {
    // Simple audio feedback
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

  const formatNumber = (num: number): string => {
    if (num >= 1e12) return `${(num / 1e12).toFixed(1)}T`;
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
    return num.toString();
  };

  if (isMobile) {
    return <MobileGame />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
                No_Gas_Slaps™
              </h1>
              <Badge variant={isConnected ? "default" : "destructive"}>
                {isConnected ? "Online" : "Offline"}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowHelp(!showHelp)}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Game Area */}
          <div className="lg:col-span-2">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Game Arena</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span>Score: {formatNumber(gameState.score)}</span>
                    <span>Combo: x{gameState.combo}</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Game Canvas */}
                <div className="relative">
                  <GameCanvas 
                    players={players} 
                    playerId={playerId}
                    onSlap={handleSlap}
                  />
                  
                  {/* Main Slap Button */}
                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                    <Button
                      size="lg"
                      className="w-32 h-32 rounded-full text-2xl font-bold bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-600 transform transition-transform hover:scale-105 active:scale-95"
                      onClick={handleSlap}
                      disabled={!gameState.alive || gameState.gas < 20}
                    >
                      SLAP!
                    </Button>
                  </div>
                </div>

                {/* Status Bars */}
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Health</span>
                      <span>{gameState.health}/100</span>
                    </div>
                    <Progress value={gameState.health} className="h-2" />
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Gas</span>
                      <span>{gameState.gas}/100</span>
                    </div>
                    <Progress value={gameState.gas} className="h-2 bg-blue-200" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Player Stats */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Your Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span>Score:</span>
                  <span className="font-bold">{formatNumber(gameState.score)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Combo:</span>
                  <span className="font-bold">x{gameState.combo}</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <Badge variant={gameState.alive ? "default" : "destructive"}>
                    {gameState.alive ? "Alive" : "Dead"}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* Daily Reward */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gift className="h-5 w-5" />
                  Daily Reward
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={claimDailyReward}
                  disabled={gameState.dailyClaimed}
                  className="w-full"
                >
                  {gameState.dailyClaimed ? "Claimed!" : "Claim 1000 pts"}
                </Button>
              </CardContent>
            </Card>

            {/* Leaderboard */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Leaderboard
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {leaderboard.map((player, index) => (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between p-2 rounded ${
                        player.id === playerId ? "bg-blue-500/20" : "bg-slate-700/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">#{index + 1}</span>
                        <span>Player {player.id}</span>
                      </div>
                      <span className="font-bold">{formatNumber(player.score)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="bg-slate-800 border-slate-700 max-w-md w-full">
            <CardHeader>
              <CardTitle>How to Play</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-bold">🎯 Basic Gameplay</h4>
                <p className="text-sm text-slate-400">Click the SLAP button to earn points and build combos!</p>
              </div>
              <div>
                <h4 className="font-bold">⚡ Gas System</h4>
                <p className="text-sm text-slate-400">Each slap costs gas. Gas recharges automatically over time.</p>
              </div>
              <div>
                <h4 className="font-bold">🏆 Multiplayer</h4>
                <p className="text-sm text-slate-400">Compete with other players in real-time!</p>
              </div>
              <Button onClick={() => setShowHelp(false)} className="w-full">
                Got it!
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
