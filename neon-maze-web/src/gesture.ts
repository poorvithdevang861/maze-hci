import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type HandState = "NO HAND" | "OPEN" | "PINCH";
export type Hand = NormalizedLandmark[];

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

/**
 * Pinch + point detection, smoothed over recent frames.
 *
 * The robot moves only while thumb and index are pinched; the direction is
 * where the pinch sits relative to the wrist (hand up = UP, tilted
 * sideways = LEFT/RIGHT, pointing down = DOWN).
 */
export class GestureFilter {
  // Pinch distance as a fraction of hand size. Separate on/off thresholds
  // stop the pinch from flickering when the fingers hover near the limit.
  static readonly PINCH_ON = 0.3;
  static readonly PINCH_OFF = 0.5;

  pinched = false;
  direction: Direction | null = null;
  ratio: number | null = null;
  private history: (Direction | null)[] = [];

  get handState(): HandState {
    if (this.ratio === null) return "NO HAND";
    return this.pinched ? "PINCH" : "OPEN";
  }

  get strength(): number {
    if (this.ratio === null) return 0;
    const s = (1 - this.ratio) / (1 - GestureFilter.PINCH_ON);
    return Math.max(0, Math.min(1, s));
  }

  update(hand: Hand | undefined): Direction | null {
    let raw: Direction | null = null;

    if (!hand) {
      this.pinched = false;
      this.ratio = null;
    } else {
      const wrist = hand[WRIST];
      const mcp = hand[MIDDLE_MCP];
      const thumb = hand[THUMB_TIP];
      const index = hand[INDEX_TIP];

      const handSize = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
      const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
      this.ratio = handSize > 0 ? pinchDist / handSize : 1;
      const limit = this.pinched ? GestureFilter.PINCH_OFF : GestureFilter.PINCH_ON;
      this.pinched = this.ratio < limit;

      if (this.pinched) {
        // Landmarks are in raw camera space; negate x so it matches the mirrored view
        const dx = -((thumb.x + index.x) / 2 - wrist.x);
        const dy = (thumb.y + index.y) / 2 - wrist.y;
        raw = this.pointDirection(dx, dy);
      }
    }

    this.history.push(raw);
    if (this.history.length > 5) this.history.shift();

    const counts = new Map<Direction | null, number>();
    for (const d of this.history) counts.set(d, (counts.get(d) ?? 0) + 1);
    for (const [d, n] of counts) {
      if (n >= 3) this.direction = d;
    }
    return this.direction;
  }

  private pointDirection(dx: number, dy: number): Direction {
    const horizontal: Direction = dx > 0 ? "RIGHT" : "LEFT";
    const vertical: Direction = dy > 0 ? "DOWN" : "UP";
    // Near-diagonal poses keep the current axis instead of flip-flopping
    if (this.direction === horizontal && Math.abs(dx) > Math.abs(dy) * 0.75) return horizontal;
    if (this.direction === vertical && Math.abs(dy) > Math.abs(dx) * 0.75) return vertical;
    return Math.abs(dx) > Math.abs(dy) ? horizontal : vertical;
  }
}

/** Webcam + MediaPipe HandLandmarker, running entirely in the browser. */
export class HandTracker {
  static readonly CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;

  private landmarker: HandLandmarker;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;

  private constructor(landmarker: HandLandmarker, video: HTMLVideoElement) {
    this.landmarker = landmarker;
    this.video = video;
  }

  static async create(video: HTMLVideoElement): Promise<HandTracker> {
    const base = import.meta.env.BASE_URL;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
      runningMode: "VIDEO" as const,
      numHands: 1,
      minHandDetectionConfidence: 0.7,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    let landmarker: HandLandmarker;
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      landmarker = await HandLandmarker.createFromOptions(fileset, options("CPU"));
    }
    return new HandTracker(landmarker, video);
  }

  /** Starts the camera. Prefers the built-in webcam over an iPhone Continuity Camera. */
  async start(deviceId?: string): Promise<void> {
    this.stop();
    const video: MediaTrackConstraints = { width: 640, height: 480 };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = "user";
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });

    if (!deviceId) {
      const cameras = await HandTracker.listCameras();
      const current = this.stream.getVideoTracks()[0]?.label ?? "";
      const builtIn = cameras.find((c) => /facetime|built-in|integrated/i.test(c.label));
      if (builtIn && !/facetime|built-in|integrated/i.test(current)) {
        return this.start(builtIn.deviceId);
      }
    }

    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  get activeDeviceId(): string | undefined {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  }

  static async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  /** Returns landmarks for a new video frame, or null if there is no new frame yet. */
  detect(now: number): { hand: Hand | undefined } | null {
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = this.video.currentTime;
    const result = this.landmarker.detectForVideo(this.video, now);
    return { hand: result.landmarks[0] };
  }
}
