import { io, type Socket } from "socket.io-client";

/**
 * Centralized Socket.IO service for real-time operational monitoring.
 *
 * SAFETY: This layer transmits metadata only. Never pass card numbers,
 * CVVs, OTPs, passwords, PINs, or any credential/PII to emit* helpers.
 */

const SESSION_STORAGE_KEY = "ops.sessionId";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readSocketUrl(): string | undefined {
  const url = (import.meta.env["VITE_SOCKET_URL"] as string | undefined)?.trim();
  return url && url.length > 0 ? url : undefined;
}

function generateSessionId(): string {
  if (isBrowser() && "crypto" in window && "randomUUID" in window.crypto) {
    return window.crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  if (!isBrowser()) return "ssr";
  let id = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!id) {
    id = generateSessionId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  }
  return id;
}

export function getDeviceMetadata() {
  if (!isBrowser()) return { platform: "ssr" };
  return {
    userAgent: window.navigator.userAgent,
    language: window.navigator.language,
    platform: window.navigator.platform,
    screen: { width: window.screen.width, height: window.screen.height },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

type State = {
  socket: Socket | null;
  currentView: string | null;
  lastActivity: number;
  connected: boolean;
};

const state: State = {
  socket: null,
  currentView: null,
  lastActivity: Date.now(),
  connected: false,
};

/**
 * Whitelist of routes an inbound admin:navigate command may target.
 * Extend deliberately — never allow arbitrary/external URLs.
 */
export const ALLOWED_NAVIGATION_ROUTES = new Set<string>([
  "/",
  "/auth",
  "/admin",
  "/sessions",
]);

export function isAllowedRoute(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/")) return false;
  const base = path.split("?")[0]!.split("#")[0]!;
  return ALLOWED_NAVIGATION_ROUTES.has(base);
}

export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  if (state.socket) return state.socket;

  const url = readSocketUrl();
  if (!url) {
    // No socket URL configured — service is a no-op.
    return null;
  }

  const socket = io(url, {
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    auth: { sessionId: getSessionId() },
  });

  socket.on("connect", () => {
    state.connected = true;
    state.lastActivity = Date.now();
    socket.emit("session:join", {
      sessionId: getSessionId(),
      device: getDeviceMetadata(),
      timestamp: Date.now(),
    });
  });

  socket.on("disconnect", (reason) => {
    state.connected = false;
    console.info("[socket] disconnected:", reason);
  });

  socket.io.on("reconnect", (attempt) => {
    console.info("[socket] reconnected after", attempt, "attempts");
  });

  socket.on("connect_error", (err) => {
    console.warn("[socket] connect_error:", err.message);
  });

  state.socket = socket;
  return socket;
}

export function disconnectSocket(): void {
  state.socket?.disconnect();
  state.socket = null;
  state.connected = false;
}

function safeEmit(event: string, payload: Record<string, unknown>): void {
  const s = getSocket();
  if (!s) return;
  state.lastActivity = Date.now();
  s.emit(event, payload);
}

/** Emit a step/view change. Metadata only. */
export function emitStepChanged(currentStep: string): void {
  if (state.currentView === currentStep) return;
  state.currentView = currentStep;
  safeEmit("session:step_changed", {
    sessionId: getSessionId(),
    currentStep,
    timestamp: Date.now(),
  });
}

/** Emit that a form submission completed. Metadata only — no payload data. */
export function emitSubmissionCreated(
  submissionType: string,
  status: "pending" | "success" | "failed" = "pending",
): void {
  safeEmit("submission:created", {
    sessionId: getSessionId(),
    submissionType,
    status,
    timestamp: Date.now(),
  });
}

/**
 * Register a listener for admin:navigate commands.
 * Handler is invoked only when the target route passes the whitelist.
 */
export function onAdminNavigate(handler: (path: string) => void): () => void {
  const s = getSocket();
  if (!s) return () => {};
  const listener = (payload: unknown) => {
    const path =
      payload && typeof payload === "object" && "path" in payload
        ? (payload as { path: unknown }).path
        : payload;
    if (!isAllowedRoute(path)) {
      console.warn("[socket] rejected admin:navigate for non-whitelisted route:", path);
      return;
    }
    handler(path);
  };
  s.on("admin:navigate", listener);
  return () => {
    s.off("admin:navigate", listener);
  };
}

export function getConnectionState() {
  return {
    connected: state.connected,
    currentView: state.currentView,
    lastActivity: state.lastActivity,
    sessionId: isBrowser() ? getSessionId() : "ssr",
  };
}
