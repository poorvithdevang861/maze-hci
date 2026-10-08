import Peer from "peerjs";
import type { Direction } from "./gesture";

/** Phone -> laptop */
export type PhoneMessage = { t: "dir"; d: Direction | null };

/** Laptop -> phone */
export type HostMessage =
  | { t: "state"; score: number; stage: number; cleared: number; theme: string; neon: string; goal: string }
  | { t: "event"; e: "win"; points: number }
  | { t: "event"; e: "bump" };

const PEER_PREFIX = "neon-maze-room-";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function roomPeerId(code: string): string {
  return PEER_PREFIX + code.toUpperCase();
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function relayUrl(role: "host" | "phone", code: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${import.meta.env.BASE_URL}relay?role=${role}&room=${code}`;
}

function parse(data: unknown): any {
  try {
    return JSON.parse(String(data));
  } catch {
    return null;
  }
}

/** One connected phone, whichever transport it came in on. */
type PhoneLink = { send(msg: HostMessage): void; close(): void };

export type HostStatus = { ready: boolean; phones: number; code: string; error?: string };

/**
 * Laptop side: opens a room that phones join by code. Phones reach it through
 * the game server's WebSocket relay, or directly over WebRTC (PeerJS) when
 * the game is hosted somewhere without the relay.
 */
export class RemoteHost {
  code = randomCode();
  direction: Direction | null = null;
  onStatus: (status: HostStatus) => void = () => {};
  onPhoneJoined: () => void = () => {};

  private peer: Peer | null = null;
  private ws: WebSocket | null = null;
  private relayOpen = false;
  private relayRetry = 0;
  private dirs = new Map<PhoneLink, Direction | null>();

  get phones(): number {
    return this.dirs.size;
  }

  start(): void {
    if (this.peer || this.ws) return;
    this.openRelay();
    this.openPeer();
  }

  send(msg: HostMessage): void {
    for (const link of this.dirs.keys()) link.send(msg);
  }

  disconnectAll(): void {
    for (const link of this.dirs.keys()) link.close();
    this.dirs.clear();
    this.recompute();
    this.emit();
  }

  /** The code is already in use by another laptop; start over with a new one. */
  private newRoom(): void {
    const ws = this.ws;
    const peer = this.peer;
    this.ws = null;
    this.peer = null;
    this.relayOpen = false;
    ws?.close();
    peer?.destroy();
    this.disconnectAll();
    this.code = randomCode();
    this.start();
  }

  private openRelay(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl("host", this.code));
    } catch {
      return;
    }
    this.ws = ws;
    const links = new Map<string, PhoneLink>();
    const current = () => this.ws === ws;

    ws.onopen = () => {
      if (!current()) return;
      this.relayOpen = true;
      this.relayRetry = 0;
      this.emit();
    };
    ws.onmessage = (ev) => {
      if (!current()) return;
      const m = parse(ev.data);
      if (!m) return;
      if (m.sys === "taken") {
        this.newRoom();
      } else if (m.sys === "join") {
        const id = m.id as string;
        const link: PhoneLink = {
          send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ to: id, msg })),
          close: () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ sys: "kick", id })),
        };
        links.set(id, link);
        this.addPhone(link);
      } else if (m.sys === "leave") {
        const link = links.get(m.id);
        if (link) {
          links.delete(m.id);
          this.dropPhone(link);
        }
      } else if (m.from) {
        const link = links.get(m.from);
        if (link) this.handle(link, m.msg);
      }
    };
    ws.onclose = () => {
      if (!current()) return;
      this.ws = null;
      this.relayOpen = false;
      for (const link of links.values()) this.dropPhone(link);
      this.emit();
      // Back off when the server has no relay (e.g. static hosting)
      this.relayRetry++;
      setTimeout(() => {
        if (!this.ws) this.openRelay();
      }, Math.min(30_000, 2_000 * this.relayRetry));
    };
  }

  private openPeer(): void {
    const peer = new Peer(roomPeerId(this.code));
    this.peer = peer;
    const current = () => this.peer === peer;

    peer.on("open", () => current() && this.emit());
    peer.on("connection", (conn) => {
      const link: PhoneLink = {
        send: (msg) => conn.open && conn.send(msg),
        close: () => conn.close(),
      };
      conn.on("open", () => this.addPhone(link));
      conn.on("data", (data) => this.handle(link, data));
      conn.on("close", () => this.dropPhone(link));
      conn.on("error", () => this.dropPhone(link));
    });
    peer.on("disconnected", () => {
      if (current() && !peer.destroyed) peer.reconnect();
    });
    peer.on("error", (err) => {
      if (!current()) return;
      if (err.type === "unavailable-id") {
        this.newRoom();
        return;
      }
      // The relay alone is enough, so only report PeerJS problems without it
      if (!this.relayOpen) this.emit(err.message);
    });
  }

  private addPhone(link: PhoneLink): void {
    this.dirs.set(link, null);
    this.emit();
    this.onPhoneJoined();
  }

  private dropPhone(link: PhoneLink): void {
    if (!this.dirs.delete(link)) return;
    this.recompute();
    this.emit();
  }

  private handle(link: PhoneLink, data: unknown): void {
    const msg = data as PhoneMessage;
    if (msg?.t === "dir" && this.dirs.has(link)) {
      this.dirs.set(link, msg.d);
      this.recompute();
    }
  }

  private recompute(): void {
    this.direction = null;
    for (const d of this.dirs.values()) {
      if (d) this.direction = d;
    }
  }

  private emit(error?: string): void {
    this.onStatus({
      ready: this.relayOpen || !!this.peer?.open,
      phones: this.dirs.size,
      code: this.code,
      error,
    });
  }
}

/** The phone's side of an open connection. */
type HostLink = { send(msg: PhoneMessage): void; close(): void; open(): boolean };

/** Phone side: joins a laptop's room and sends directions. */
export class RemoteController {
  onOpen: () => void = () => {};
  onClose: (reason: string) => void = () => {};
  onMessage: (msg: HostMessage) => void = () => {};

  private attempt: object | null = null;
  private link: HostLink | null = null;
  private cleanup: (() => void) | null = null;
  private lastSent: Direction | null | undefined = undefined;

  connect(code: string): void {
    this.disconnect();
    const attempt = {};
    this.attempt = attempt;
    this.connectRelay(code.toUpperCase(), attempt);
  }

  disconnect(): void {
    this.link?.send({ t: "dir", d: null });
    const cleanup = this.cleanup;
    this.attempt = null;
    this.link = null;
    this.cleanup = null;
    // Give the stop message a moment to arrive before tearing down
    if (cleanup) setTimeout(cleanup, 150);
  }

  get open(): boolean {
    return !!this.link?.open();
  }

  send(direction: Direction | null): void {
    if (!this.link?.open() || direction === this.lastSent) return;
    this.lastSent = direction;
    this.link.send({ t: "dir", d: direction });
  }

  private connected(attempt: object, link: HostLink): void {
    if (this.attempt !== attempt) return;
    this.link = link;
    this.lastSent = undefined;
    this.onOpen();
  }

  private lost(attempt: object, reason: string): void {
    if (this.attempt !== attempt) return;
    this.attempt = null;
    this.link = null;
    this.cleanup?.();
    this.cleanup = null;
    this.onClose(reason);
  }

  /** Try the game server's relay first; fall back to WebRTC if it isn't there. */
  private connectRelay(code: string, attempt: object): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl("phone", code));
    } catch {
      this.connectPeer(code, attempt);
      return;
    }
    let joined = false;
    let fellBack = false;
    const fallBack = () => {
      if (joined || fellBack || this.attempt !== attempt) return;
      fellBack = true;
      clearTimeout(timer);
      ws.onclose = null;
      ws.close();
      this.connectPeer(code, attempt);
    };
    const timer = setTimeout(fallBack, 5000);
    this.cleanup = () => {
      clearTimeout(timer);
      ws.onclose = null;
      ws.close();
    };

    ws.onmessage = (ev) => {
      const m = parse(ev.data);
      if (!m) return;
      if (m.sys === "joined") {
        joined = true;
        clearTimeout(timer);
        this.connected(attempt, {
          send: (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)),
          close: () => ws.close(),
          open: () => ws.readyState === WebSocket.OPEN,
        });
      } else if (m.sys === "no-room") {
        fallBack();
      } else if (m.msg && this.attempt === attempt) {
        this.onMessage(m.msg as HostMessage);
      }
    };
    ws.onclose = () => {
      if (joined) this.lost(attempt, "The game ended the connection.");
      else fallBack();
    };
  }

  private connectPeer(code: string, attempt: object): void {
    if (this.attempt !== attempt) return;
    const peer = new Peer();
    this.cleanup = () => peer.destroy();

    peer.on("open", () => {
      const conn = peer.connect(roomPeerId(code), { reliable: true });
      conn.on("open", () =>
        this.connected(attempt, {
          send: (msg) => conn.open && conn.send(msg),
          close: () => conn.close(),
          open: () => conn.open,
        }),
      );
      conn.on("data", (data) => this.attempt === attempt && this.onMessage(data as HostMessage));
      conn.on("close", () => this.lost(attempt, "The game ended the connection."));
      conn.on("error", () => this.lost(attempt, "Connection error."));
    });
    peer.on("error", (err) => {
      const reason =
        err.type === "peer-unavailable"
          ? "No game found with that code. Check the code on the laptop."
          : `Connection problem: ${err.message}`;
      this.lost(attempt, reason);
    });
  }
}
