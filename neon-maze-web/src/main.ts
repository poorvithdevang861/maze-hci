import "./style.css";
import QRCode from "qrcode";
import { Game, type WinEvent } from "./game";
import { GestureFilter, HandTracker, type Direction } from "./gesture";
import { themeForStage } from "./maze";
import { RemoteHost } from "./remote";
import { Renderer, drawHand } from "./render";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  maze: $<HTMLCanvasElement>("maze"),
  video: $<HTMLVideoElement>("video"),
  handCanvas: $<HTMLCanvasElement>("hand-canvas"),
  cameraCard: document.querySelector<HTMLElement>(".camera-card")!,
  cameraSelect: $<HTMLSelectElement>("camera-select"),
  stageChip: $("stage-chip"),
  installBtn: $<HTMLButtonElement>("install-btn"),
  startScreen: $("start-screen"),
  startBtn: $<HTMLButtonElement>("start-btn"),
  keyboardBtn: $<HTMLButtonElement>("keyboard-btn"),
  startStatus: $("start-status"),
  score: $("stat-score"),
  time: $("stat-time"),
  best: $("stat-best"),
  cleared: $("stat-cleared"),
  handDot: $("hand-dot"),
  handState: $("hand-state"),
  meterFill: $("meter-fill"),
  winCard: $("win-card"),
  winPoints: $("win-points"),
  winInfo: $("win-info"),
  winNext: $("win-next"),
  pads: Array.from(document.querySelectorAll<HTMLButtonElement>(".pad")),
  phoneBtn: $<HTMLButtonElement>("phone-btn"),
  phoneChip: $("phone-chip"),
  phoneModal: $("phone-modal"),
  phoneClose: $<HTMLButtonElement>("phone-close"),
  phoneDone: $<HTMLButtonElement>("phone-done"),
  phoneDisconnect: $<HTMLButtonElement>("phone-disconnect"),
  phoneStatus: $("phone-status"),
  phoneWarning: $("phone-warning"),
  roomCode: $("room-code"),
  qr: $<HTMLCanvasElement>("qr"),
};

const game = new Game();
const filter = new GestureFilter();
const renderer = new Renderer(els.maze);
let tracker: HandTracker | null = null;
let playing = false;

// ---------- Theme ----------
function applyTheme(stage: number): void {
  const theme = themeForStage(stage);
  renderer.setTheme(theme);
  const root = document.documentElement.style;
  root.setProperty("--neon", theme.edge);
  root.setProperty("--goal", theme.goal);
  els.stageChip.textContent = `STAGE ${stage} · ${theme.name}`;
}
applyTheme(game.stage);

// ---------- Keyboard + on-screen pad ----------
const KEYS: Record<string, Direction> = {
  ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT",
  w: "UP", s: "DOWN", a: "LEFT", d: "RIGHT",
};
const heldKeys: Direction[] = [];
let padDir: Direction | null = null;

window.addEventListener("keydown", (e) => {
  const dir = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!dir) return;
  e.preventDefault();
  if (!heldKeys.includes(dir)) heldKeys.push(dir);
  if (!playing) startPlaying();
});
window.addEventListener("keyup", (e) => {
  const dir = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  const i = dir ? heldKeys.indexOf(dir) : -1;
  if (i >= 0) heldKeys.splice(i, 1);
});
window.addEventListener("blur", () => (heldKeys.length = 0));

for (const pad of els.pads) {
  const dir = pad.dataset.dir as Direction;
  pad.addEventListener("pointerdown", (e) => {
    pad.setPointerCapture(e.pointerId);
    padDir = dir;
  });
  const release = () => {
    if (padDir === dir) padDir = null;
  };
  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
}

// Drag on the maze to steer: direction follows the finger while it's down
const mazeFrame = document.querySelector<HTMLElement>(".maze-frame")!;
const SWIPE_THRESHOLD = 18;
let swipeDir: Direction | null = null;
let flickDir: Direction | null = null;
let swipeAnchor: { x: number; y: number; id: number } | null = null;

mazeFrame.addEventListener("pointerdown", (e) => {
  if (!playing || e.pointerType === "mouse") return;
  mazeFrame.setPointerCapture(e.pointerId);
  swipeAnchor = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
mazeFrame.addEventListener("pointermove", (e) => {
  if (!swipeAnchor || e.pointerId !== swipeAnchor.id) return;
  const dx = e.clientX - swipeAnchor.x;
  const dy = e.clientY - swipeAnchor.y;
  if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
  const dir: Direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : dy > 0 ? "DOWN" : "UP";
  swipeDir = dir;
  // Re-anchor so turning needs only a short drag from the current spot
  swipeAnchor = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
const endSwipe = (e: PointerEvent) => {
  if (swipeAnchor && e.pointerId === swipeAnchor.id) {
    // A quick flick still moves one tile even if the finger lifts before the next frame
    flickDir = swipeDir;
    swipeAnchor = null;
    swipeDir = null;
  }
};
mazeFrame.addEventListener("pointerup", endSwipe);
mazeFrame.addEventListener("pointercancel", endSwipe);

// ---------- Start screen + camera ----------
function startPlaying(): void {
  playing = true;
  els.startScreen.classList.add("hidden");
}

function setStatus(text: string, error = false): void {
  els.startStatus.textContent = text;
  els.startStatus.classList.toggle("error", error);
}

async function populateCameras(): Promise<void> {
  const cameras = await HandTracker.listCameras();
  els.cameraSelect.innerHTML = "";
  cameras.forEach((cam, i) => {
    const option = document.createElement("option");
    option.value = cam.deviceId;
    option.textContent = cam.label || `Camera ${i + 1}`;
    els.cameraSelect.append(option);
  });
  els.cameraSelect.value = tracker?.activeDeviceId ?? "";
  els.cameraSelect.hidden = cameras.length < 2;
}

els.startBtn.addEventListener("click", async () => {
  els.startBtn.disabled = true;
  try {
    if (!tracker) {
      setStatus("Loading hand tracking model…");
      tracker = await HandTracker.create(els.video);
    }
    setStatus("Starting camera…");
    await tracker.start();
    els.cameraCard.classList.add("active");
    await populateCameras();
    setStatus("");
    startPlaying();
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError") {
      setStatus("Camera permission was blocked. Allow it in your browser settings, or play with arrow keys.", true);
    } else if (name === "NotFoundError") {
      setStatus("No camera found. You can still play with arrow keys.", true);
    } else {
      console.error(err);
      setStatus("Couldn't start hand tracking. Try reloading, or play with arrow keys.", true);
    }
  } finally {
    els.startBtn.disabled = false;
  }
});

els.keyboardBtn.addEventListener("click", startPlaying);

els.cameraSelect.addEventListener("change", async () => {
  await tracker?.start(els.cameraSelect.value);
});

els.video.addEventListener("loadedmetadata", () => {
  els.handCanvas.width = els.video.videoWidth;
  els.handCanvas.height = els.video.videoHeight;
});

// ---------- Phone controller ----------
const remote = new RemoteHost();
let shownCode = "";

function sendState(): void {
  const theme = themeForStage(game.stage);
  remote.send({
    t: "state",
    score: game.score,
    stage: game.stage,
    cleared: game.completions,
    theme: theme.name,
    neon: theme.edge,
    goal: theme.goal,
  });
}

function showRoomCode(code: string): void {
  if (code === shownCode) return;
  shownCode = code;
  els.roomCode.textContent = code;
  const url = `${location.origin}${import.meta.env.BASE_URL}controller.html#${code}`;
  QRCode.toCanvas(els.qr, url, { width: 220, margin: 1, color: { dark: "#0b0a18", light: "#ffffff" } });
}

remote.onStatus = ({ ready, phones, code, error }) => {
  showRoomCode(code);
  els.phoneChip.hidden = phones === 0;
  els.phoneDisconnect.hidden = phones === 0;
  els.phoneDisconnect.textContent = phones > 1 ? "Disconnect phones" : "Disconnect phone";
  els.phoneChip.textContent = phones > 1 ? `${phones} PHONES CONNECTED` : "PHONE CONNECTED";
  if (error) els.phoneStatus.textContent = `Connection problem: ${error}`;
  else if (phones > 0) els.phoneStatus.textContent = "Phone connected! You can close this window.";
  else els.phoneStatus.textContent = ready ? "Waiting for your phone…" : "Opening room…";
};

remote.onPhoneJoined = () => {
  sendState();
  if (!playing) startPlaying();
  window.setTimeout(() => (els.phoneModal.hidden = true), 1200);
};

function openPhoneModal(): void {
  remote.start();
  showRoomCode(remote.code);
  els.phoneWarning.hidden = !["localhost", "127.0.0.1"].includes(location.hostname);
  els.phoneModal.hidden = false;
}
els.phoneBtn.addEventListener("click", openPhoneModal);
if (new URLSearchParams(location.search).has("phone")) openPhoneModal();
els.phoneClose.addEventListener("click", () => (els.phoneModal.hidden = true));
els.phoneDone.addEventListener("click", () => (els.phoneModal.hidden = true));
els.phoneChip.addEventListener("click", openPhoneModal);
els.phoneDisconnect.addEventListener("click", () => remote.disconnectAll());
els.phoneModal.addEventListener("click", (e) => {
  if (e.target === els.phoneModal) els.phoneModal.hidden = true;
});

// ---------- Install as an app (PWA) ----------
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
let installPrompt: InstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e as InstallPromptEvent;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener("click", async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  els.installBtn.hidden = true;
});
window.addEventListener("appinstalled", () => (els.installBtn.hidden = true));

// ---------- Win ----------
let winTimeout = 0;
function showWin(ev: WinEvent): void {
  applyTheme(ev.stage);
  renderer.burst();
  const theme = themeForStage(ev.stage);
  els.winPoints.textContent = `+${ev.points} POINTS`;
  els.winInfo.textContent = `Time ${ev.time.toFixed(1)}s  |  Total score ${ev.score}`;
  els.winNext.textContent = `NEXT: STAGE ${ev.stage} · ${theme.name}`;
  els.winCard.classList.add("show");
  clearTimeout(winTimeout);
  winTimeout = window.setTimeout(() => els.winCard.classList.remove("show"), 2500);
  remote.send({ t: "event", e: "win", points: ev.points });
  sendState();
}

// ---------- UI updates ----------
function setText(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

function updateUI(now: number, want: Direction | null): void {
  setText(els.score, String(game.score));
  setText(els.time, `${game.elapsed(now).toFixed(1)}s`);
  setText(els.best, game.bestTime === null ? "--" : `${game.bestTime.toFixed(1)}s`);
  setText(els.cleared, String(game.completions));

  for (const pad of els.pads) pad.classList.toggle("active", pad.dataset.dir === want);

  const state = filter.handState;
  if (els.handDot.dataset.state !== state) {
    els.handDot.dataset.state = state;
    els.handState.dataset.state = state;
    els.handState.textContent = state;
  }
  els.meterFill.style.width = `${Math.round(filter.strength * 100)}%`;
  els.meterFill.classList.toggle("pinched", filter.pinched);
}

// ---------- Main loop ----------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (tracker) {
    const result = tracker.detect(now);
    if (result) {
      filter.update(result.hand);
      const neon = getComputedStyle(document.documentElement).getPropertyValue("--neon");
      drawHand(els.handCanvas, result.hand, HandTracker.CONNECTIONS, neon);
    }
  }

  const want =
    (tracker ? filter.direction : null) ??
    heldKeys[heldKeys.length - 1] ??
    padDir ??
    swipeDir ??
    flickDir ??
    remote.direction;

  if (playing) {
    const wasBlocked = game.blocked;
    const win = game.update(dt, want, now);
    if (win) showWin(win);
    if (game.blocked && !wasBlocked && remote.direction) remote.send({ t: "event", e: "bump" });
  }
  flickDir = null;

  renderer.draw(game, now / 1000, dt);
  updateUI(now, want);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

let lastDpr = window.devicePixelRatio;
window.addEventListener("resize", () => {
  if (window.devicePixelRatio !== lastDpr) {
    lastDpr = window.devicePixelRatio;
    renderer.resize();
  }
});
