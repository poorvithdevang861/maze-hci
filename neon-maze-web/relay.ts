import type { Server } from "node:http";
import type { Plugin } from "vite";
import { WebSocket, WebSocketServer } from "ws";

/*
 * Phone <-> laptop relay over a WebSocket on the same server that serves the
 * game. It works on any network that can load the page, unlike direct WebRTC
 * links, which campus and office Wi-Fi often block.
 *
 * Host:  /relay?role=host&room=CODE   sends {to, msg} or {sys:"kick", id}
 * Phone: /relay?role=phone&room=CODE  sends msg, receives {msg}
 */

type Room = { host: WebSocket; phones: Map<string, WebSocket> };

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function parse(raw: unknown): any {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function attachRelay(httpServer: Server | null | undefined): void {
  if (!httpServer) return;
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map<string, Room>();
  let nextId = 1;

  // Cloudflare drops WebSockets that are idle for ~100s
  const alive = setInterval(() => {
    for (const ws of wss.clients) ws.ping();
  }, 25_000);
  httpServer.on("close", () => clearInterval(alive));

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.endsWith("/relay")) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      const code = (url.searchParams.get("room") ?? "").toUpperCase();
      if (url.searchParams.get("role") === "host") host(ws, code);
      else phone(ws, code);
    });
  });

  function host(ws: WebSocket, code: string): void {
    if (rooms.has(code)) {
      send(ws, { sys: "taken" });
      ws.close();
      return;
    }
    const room: Room = { host: ws, phones: new Map() };
    rooms.set(code, room);

    ws.on("message", (raw) => {
      const m = parse(raw);
      if (!m) return;
      if (m.sys === "kick") room.phones.get(m.id)?.close();
      else if (m.to) {
        const p = room.phones.get(m.to);
        if (p) send(p, { msg: m.msg });
      }
    });
    ws.on("close", () => {
      if (rooms.get(code) === room) rooms.delete(code);
      for (const p of room.phones.values()) p.close();
    });
  }

  function phone(ws: WebSocket, code: string): void {
    const room = rooms.get(code);
    if (!room) {
      send(ws, { sys: "no-room" });
      ws.close();
      return;
    }
    const id = String(nextId++);
    room.phones.set(id, ws);
    send(ws, { sys: "joined" });
    send(room.host, { sys: "join", id });

    ws.on("message", (raw) => {
      const m = parse(raw);
      if (m) send(room.host, { from: id, msg: m });
    });
    ws.on("close", () => {
      if (room.phones.delete(id)) send(room.host, { sys: "leave", id });
    });
  }
}

export function relayPlugin(): Plugin {
  return {
    name: "neon-maze-relay",
    configureServer(server) {
      attachRelay(server.httpServer as Server | null);
    },
    configurePreviewServer(server) {
      attachRelay(server.httpServer as Server);
    },
  };
}
