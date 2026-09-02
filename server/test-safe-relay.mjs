import assert from "node:assert/strict";
import { io } from "socket.io-client";

const base = process.env.TEST_SOCKET_URL ?? "http://127.0.0.1:4310";
const options = { transports: ["websocket"], reconnection: false, timeout: 3000 };
const monitor = io(base, options);
const visitor = io(base, options);

await Promise.all([once(monitor, "connect"), once(visitor, "connect")]);
monitor.emit("monitor:join");
await once(monitor, "monitor:joined");

const safeMarkerPromise = once(monitor, "session:state_changed");
visitor.emit("session:state_changed", {
  sessionId: "session_test_1",
  eventType: "payment_method_submitted",
  state: "tokenization_required",
  cardBrand: "visa",
  cardLast4: "1234",
});
const safeMarker = await safeMarkerPromise;
assert.deepEqual(safeMarker, {
  sessionId: "session_test_1",
  eventType: "payment_method_submitted",
  state: "tokenization_required",
  cardBrand: "visa",
  cardLast4: "1234",
});

for (const unsafePayload of [
  {
    sessionId: "session_test_1",
    eventType: "payment_method_submitted",
    state: "submitted",
    cardNumber: "blocked-placeholder",
  },
  {
    sessionId: "session_test_1",
    eventType: "payment_challenge_submitted",
    state: "pending_provider_verification",
    otp: "blocked-placeholder",
  },
  {
    sessionId: "session_test_1",
    eventType: "page_viewed",
    state: "observed",
    metadata: { value: "not-allowlisted" },
  },
]) {
  const rejectedPromise = once(visitor, "safe:rejected");
  visitor.emit("session:state_changed", unsafePayload);
  const rejection = await rejectedPromise;
  assert.equal(rejection.reason, "unsafe_payload");
}

const navigationRejection = once(monitor, "safe:rejected");
monitor.emit("admin:navigate", {
  sessionId: "session_test_1",
  path: "/verfiy",
  search: "?otp=blocked-placeholder",
});
assert.equal((await navigationRejection).reason, "invalid_navigation");

monitor.close();
visitor.close();
console.log("safe relay integration passed");

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 3000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
