import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"] },
});

/** Monitors join the "monitors" room to receive every relayed event. */
const MONITOR_ROOM = "monitors";

io.on("connection", (socket) => {
  const sessionId = socket.handshake.auth?.sessionId ?? null;
  if (sessionId) socket.join(`session:${sessionId}`);

  console.log(`[io] connect ${socket.id} session=${sessionId ?? "n/a"}`);

  socket.on("monitor:join", () => {
    socket.join(MONITOR_ROOM);
    socket.emit("monitor:joined", { ok: true });
  });

  socket.on("monitor:leave", () => {
    socket.leave(MONITOR_ROOM);
  });

  socket.on("session:join", (payload) => {
    if (payload?.sessionId) socket.join(`session:${payload.sessionId}`);
    io.to(MONITOR_ROOM).emit("session:join", payload);
  });

  socket.on("session:leave", (payload) => {
    if (payload?.sessionId) socket.leave(`session:${payload.sessionId}`);
    io.to(MONITOR_ROOM).emit("session:leave", payload);
  });

  // Client -> monitors
  for (const ev of ["session:step_changed", "submission:created"]) {
    socket.on(ev, (payload) => {
      io.to(MONITOR_ROOM).emit(ev, payload);
    });
  }

  // Monitor -> targeted session
  socket.on("admin:navigate", (payload) => {
    if (!payload?.sessionId || typeof payload.path !== "string") return;
    io.to(`session:${payload.sessionId}`).emit("admin:navigate", { path: payload.path });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[io] disconnect ${socket.id} reason=${reason}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server listening on :${PORT} (CORS: ${CORS_ORIGIN})`);
});
