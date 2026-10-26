import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
const server = createServer(app);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Initialize WebSocket server for multiplayer
  const wss = new WebSocketServer({
    server,
    // Add ping/pong to detect broken connections
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Global error handler for WebSocket server
  wss.on('error', (error) => {
    log(`WebSocket Server Error: ${error.message}`);
  });

  // Multiplayer game state
  let players: Record<number, {
    id: number;
    x: number;
    y: number;
    health: number;
    gas: number;
    alive: boolean;
    score: number;
    combo: number;
    name?: string;
  }> = {};
  let nextId = 1;

  function broadcast(data: any) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === 1) client.send(msg); // WebSocket.OPEN = 1
    });
  }

  function resetGame() {
    for (const id in players) {
      players[id].health = 100;
      players[id].gas = 100;
      players[id].x = Math.random() * 600 + 50;
      players[id].y = Math.random() * 400 + 50;
      players[id].alive = true;
      players[id].score = 0;
      players[id].combo = 1;
    }
    broadcast({ type: 'gameReset', players });
  }

  wss.on('connection', (ws) => {
    const playerId = nextId++;
    players[playerId] = {
      id: playerId,
      x: Math.random() * 600 + 50,
      y: Math.random() * 400 + 50,
      health: 100,
      gas: 100,
      alive: true,
      score: 0,
      combo: 1
    };

    ws.send(JSON.stringify({ type: 'init', id: playerId, players }));
    broadcast({ type: 'playerJoined', player: players[playerId] });

    log(`Player ${playerId} joined. Total players: ${Object.keys(players).length}`);

    // Add error handling for WebSocket
    ws.on('error', (error) => {
      log(`WebSocket error for player ${playerId}: ${error.message}`);
      if (players[playerId]) {
        delete players[playerId];
        broadcast({ type: 'playerLeft', id: playerId });
      }
    });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (!players[playerId]) return;

        if (data.type === 'move') {
          if (!players[playerId].alive) return;
          players[playerId].x = Math.max(20, Math.min(680, data.x));
          players[playerId].y = Math.max(20, Math.min(480, data.y));
          broadcast({ type: 'playerMoved', id: playerId, x: players[playerId].x, y: players[playerId].y });
        }

        else if (data.type === 'slap') {
          if (!players[playerId].alive || players[playerId].gas < 20) return;

          players[playerId].gas -= 20;
          players[playerId].score += 10;
          players[playerId].combo = Math.min(players[playerId].combo + 1, 50);

          // Check for hits on nearby players
          const targetId = data.targetId;
          if (players[targetId] && players[targetId].alive) {
            const dx = players[targetId].x - players[playerId].x;
            const dy = players[targetId].y - players[playerId].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 60) { // slap range
              players[targetId].health -= 25;
              players[playerId].score += 50 * players[playerId].combo;

              if (players[targetId].health <= 0) {
                players[targetId].alive = false;
                players[playerId].score += 200;
                broadcast({ type: 'playerDied', id: targetId, killerId: playerId });
              }

              broadcast({
                type: 'playerHit',
                id: targetId,
                health: players[targetId].health,
                attacker: playerId,
                damage: 25
              });
            }
          }

          broadcast({
            type: 'playerUpdate',
            id: playerId,
            gas: players[playerId].gas,
            score: players[playerId].score,
            combo: players[playerId].combo
          });
        }

        else if (data.type === 'updateProfile') {
          if (data.name) {
            players[playerId].name = data.name.substring(0, 20); // limit name length
          }
        }

      } catch (e) {
        log(`Invalid message from player ${playerId}: ${e}`);
      }
    });

    ws.on('close', () => {
      delete players[playerId];
      broadcast({ type: 'playerLeft', id: playerId });
      log(`Player ${playerId} left. Total players: ${Object.keys(players).length}`);
    });
  });

  // Gas recharge and game tick loop
  setInterval(() => {
    let activePlayers = 0;
    for (const id in players) {
      if (players[id].alive) {
        players[id].gas = Math.min(100, players[id].gas + 8);
        activePlayers++;
      }
    }

    if (activePlayers > 0) {
      broadcast({ type: 'gasRecharge', players });
    }

    // Auto-reset if only one player left and multiple were playing
    if (activePlayers === 1 && Object.keys(players).length > 1) {
      setTimeout(resetGame, 3000);
    }
  }, 1000);

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`🚀 No_Gas_Slaps™ server running on port ${port}`);
    log(`🎮 WebSocket multiplayer ready for connections`);
  });
})();