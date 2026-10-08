import "./controller.css";
import { GestureFilter, HandTracker, type Direction } from "./gesture";
import { RemoteController, type HostMessage } from "./remote";
import { drawHand } from "./render";

type Mode = "pad" | "swipe" | "tilt" | "gesture";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  conn: $("conn"),
  connText: $("conn-text"),
  stage: $("c-stage"),
  score: $("c-score"),
  cleared: $("c-cleared"),
  join: $("join"),
  joinForm: $<HTMLFormElement>("join-form"),
  joinTitle: $("join-title"),
  joinSub: $("join-sub"),
  connectBtn: $<HTMLButtonElement>("connect-btn"),
  doneBtn: $<HTMLButtonElement>("done-btn"),
  codeInput: $<HTMLInputElement>("code-input"),
  joinError: $("join-error"),
  play: $("play"),
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>(".tab")),
  modes: Array.from(document.querySelectorAll<HTMLElement>(".mode")),
  pads: Array.from(document.querySelectorAll<HTMLButtonElement>(".bpad")),
  swipeArea: $("swipe-area"),
  swipeArrow: $("swipe-arrow"),
  tiltBall: $("tilt-ball"),
  tiltBtn: $<HTMLButtonElement>("tilt-btn"),
  tiltCal: $<HTMLButtonElement>("tilt-cal"),
  tiltHint: $("tilt-hint"),
  gVideo: $<HTMLVideoElement>("g-video"),
  gCanvas: $<HTMLCanvasElement>("g-canvas"),
  gBtn: $<HTMLButtonElement>("g-btn"),
  gStatus: $("g-status"),
  currentDir: $("current-dir"),
};

const remote = new RemoteController();
let mode: Mode = "pad";
const modeDir: Record<Mode, Direction | null> = { pad: null, swipe: null, tilt: null, gesture: null };

// ---------- Connection ----------
function setConn(state: "idle" | "connecting" | "connected" | "error", text: string): void {
  els.conn.dataset.state = state;
  els.connText.textContent = text;
}

function showJoin(message = "", isError = true): void {
  els.join.hidden = false;
  els.play.hidden = true;
  els.doneBtn.hidden = true;
  els.connectBtn.disabled = false;
  els.connectBtn.textContent = "Connect";
  els.joinError.textContent = message;
  els.joinError.style.color = isError ? "" : "var(--muted)";

  const code = els.codeInput.value.trim().toUpperCase();
  if (code.length === 5) {
    els.joinTitle.textContent = `Room ${code}`;
    els.joinSub.textContent = "Tap Connect to control the game on the laptop.";
  } else {
    els.joinTitle.textContent = "Join a game";
    els.joinSub.textContent = "Enter the room code shown on the laptop.";
  }
}

function connect(code: string): void {
  code = code.trim().toUpperCase();
  if (code.length !== 5) {
    showJoin("Room codes have 5 characters.");
    return;
  }
  history.replaceState(null, "", `#${code}`);
  els.codeInput.value = code;
  setConn("connecting", "Connecting…");
  els.joinError.textContent = "";
  els.connectBtn.disabled = true;
  els.connectBtn.textContent = "Connecting…";
  remote.connect(code);
}

remote.onOpen = () => {
  setConn("connected", "Connected");
  els.join.hidden = true;
  els.play.hidden = false;
  els.doneBtn.hidden = false;
};
remote.onClose = (reason) => {
  setConn("error", "Disconnected");
  showJoin(reason);
};

els.doneBtn.addEventListener("click", () => {
  for (const key of Object.keys(modeDir) as Mode[]) modeDir[key] = null;
  remote.disconnect();
  setConn("idle", "Not connected");
  showJoin("You left the game. Tap Connect to join again.", false);
});
remote.onMessage = (msg: HostMessage) => {
  if (msg.t === "state") {
    els.stage.textContent = String(msg.stage);
    els.score.textContent = String(msg.score);
    els.cleared.textContent = String(msg.cleared);
    document.documentElement.style.setProperty("--neon", msg.neon);
    document.documentElement.style.setProperty("--goal", msg.goal);
  } else if (msg.e === "win") {
    navigator.vibrate?.([80, 60, 160]);
  } else if (msg.e === "bump") {
    navigator.vibrate?.(25);
  }
};

els.joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  connect(els.codeInput.value);
});

els.codeInput.value = location.hash.slice(1).toUpperCase();
showJoin();
// Scanning a new QR code while this page is open only changes the hash
window.addEventListener("hashchange", () => {
  const code = location.hash.slice(1).toUpperCase();
  if (!code || code === els.codeInput.value) return;
  for (const key of Object.keys(modeDir) as Mode[]) modeDir[key] = null;
  remote.disconnect();
  setConn("idle", "Not connected");
  els.codeInput.value = code;
  showJoin();
});
els.codeInput.addEventListener("input", () => {
  els.codeInput.value = els.codeInput.value.toUpperCase();
});

// Stop the robot if the phone locks or the tab is hidden
document.addEventListener("visibilitychange", () => {
  if (document.hidden) remote.send(null);
});

// ---------- Tabs ----------
for (const tab of els.tabs) {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode as Mode;
    for (const t of els.tabs) t.classList.toggle("active", t === tab);
    for (const m of els.modes) m.classList.toggle("active", m.dataset.mode === mode);
  });
}

// ---------- Pad ----------
for (const pad of els.pads) {
  const dir = pad.dataset.dir as Direction;
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    modeDir.pad = dir;
  });
  const release = () => {
    if (modeDir.pad === dir) modeDir.pad = null;
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
}

// ---------- Swipe ----------
const ROTATION: Record<Direction, number> = { UP: 0, RIGHT: 90, DOWN: 180, LEFT: 270 };
let anchor: { x: number; y: number; id: number } | null = null;

els.swipeArea.addEventListener("pointerdown", (e) => {
  els.swipeArea.setPointerCapture(e.pointerId);
  anchor = { x: e.clientX, y: e.clientY, id: e.pointerId };
  els.swipeArea.classList.add("touching");
});
els.swipeArea.addEventListener("pointermove", (e) => {
  if (!anchor || e.pointerId !== anchor.id) return;
  const dx = e.clientX - anchor.x;
  const dy = e.clientY - anchor.y;
  if (Math.hypot(dx, dy) < 20) return;
  modeDir.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : dy > 0 ? "DOWN" : "UP";
  anchor = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
const endSwipe = () => {
  anchor = null;
  modeDir.swipe = null;
  els.swipeArea.classList.remove("touching");
};
els.swipeArea.addEventListener("pointerup", endSwipe);
els.swipeArea.addEventListener("pointercancel", endSwipe);

// ---------- Tilt ----------
const TILT_ON = 14;
const TILT_OFF = 8;
let tilt: { beta: number; gamma: number } | null = null;
let tiltZero: { beta: number; gamma: number } | null = null;

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

function onOrientation(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  tilt = { beta: e.beta, gamma: e.gamma };
  if (!tiltZero) tiltZero = { ...tilt };
}

els.tiltBtn.addEventListener("click", async () => {
  const perm = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
  if (perm && (await perm()) !== "granted") {
    els.tiltHint.textContent = "Motion access was denied. Allow it in Safari settings and reload.";
    return;
  }
  window.addEventListener("deviceorientation", onOrientation);
  els.tiltBtn.hidden = true;
  els.tiltCal.hidden = false;
  els.tiltHint.textContent = "Tilt toward where you want to go. Hold steady in the middle to stop.";
});
els.tiltCal.addEventListener("click", () => {
  tiltZero = tilt ? { ...tilt } : null;
});

function updateTilt(): void {
  if (!tilt || !tiltZero) return;
  // Tilting the top edge away = UP, right edge down = RIGHT
  const x = Math.max(-35, Math.min(35, tilt.gamma - tiltZero.gamma));
  const y = Math.max(-35, Math.min(35, tilt.beta - tiltZero.beta));
  const radius = els.tiltBall.parentElement!.clientWidth / 2 - 26;
  els.tiltBall.style.transform = `translate(${(x / 35) * radius}px, ${(y / 35) * radius}px)`;

  const current = modeDir.tilt;
  const keep =
    (current === "LEFT" && x < -TILT_OFF) ||
    (current === "RIGHT" && x > TILT_OFF) ||
    (current === "UP" && y < -TILT_OFF) ||
    (current === "DOWN" && y > TILT_OFF);
  if (keep) return;
  if (Math.max(Math.abs(x), Math.abs(y)) < TILT_ON) {
    modeDir.tilt = null;
  } else if (Math.abs(x) > Math.abs(y)) {
    modeDir.tilt = x > 0 ? "RIGHT" : "LEFT";
  } else {
    modeDir.tilt = y < 0 ? "UP" : "DOWN";
  }
}

// ---------- Gesture (phone camera) ----------
const filter = new GestureFilter();
let tracker: HandTracker | null = null;

els.gBtn.addEventListener("click", async () => {
  els.gBtn.disabled = true;
  try {
    if (!tracker) {
      els.gStatus.textContent = "Loading hand tracking model…";
      tracker = await HandTracker.create(els.gVideo);
    }
    els.gStatus.textContent = "Starting camera…";
    await tracker.start();
    els.gBtn.hidden = true;
    els.gStatus.textContent = "Pinch thumb + index and point to move. Open your hand to stop.";
  } catch (err) {
    console.error(err);
    els.gStatus.textContent = "Couldn't start the camera. Check camera permission for this site.";
  } finally {
    els.gBtn.disabled = false;
  }
});
els.gVideo.addEventListener("loadedmetadata", () => {
  els.gCanvas.width = els.gVideo.videoWidth;
  els.gCanvas.height = els.gVideo.videoHeight;
});

// ---------- Loop ----------
function frame(now: number): void {
  updateTilt();
  if (tracker) {
    const result = tracker.detect(now);
    if (result) {
      modeDir.gesture = filter.update(result.hand);
      const neon = getComputedStyle(document.documentElement).getPropertyValue("--neon");
      drawHand(els.gCanvas, result.hand, HandTracker.CONNECTIONS, neon);
    }
  }

  const dir = modeDir[mode];
  remote.send(dir);
  els.currentDir.textContent = dir ?? "STOP";
  for (const pad of els.pads) pad.classList.toggle("active", pad.dataset.dir === dir);
  els.swipeArrow.classList.toggle("show", mode === "swipe" && dir !== null);
  if (dir) els.swipeArrow.style.transform = `rotate(${ROTATION[dir]}deg)`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
