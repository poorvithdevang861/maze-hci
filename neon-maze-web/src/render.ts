import type { Game } from "./game";
import { VECTORS } from "./game";
import { COLS, END, LAYOUT, MAZE_H, MAZE_W, ROWS, START, TILE, isWall, tileCenter, type Theme } from "./maze";

const GOLD = "#ffd666";
const ROBOT_BODY = "#ff9628";
const ROBOT_HEAD = "#d2e1f0";
const ROBOT_LEGS = "#96a5be";
const ROBOT_VISOR = "#191e32";
const ROBOT_EYE = "#00ffc8";

type Particle = { x: number; y: number; vx: number; vy: number; color: string; life: number };

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private mazeLayer: HTMLCanvasElement;
  private particles: Particle[] = [];
  private theme!: Theme;
  private dpr = 1;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.mazeLayer = document.createElement("canvas");
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = MAZE_W * this.dpr;
    this.canvas.height = MAZE_H * this.dpr;
    if (this.theme) this.setTheme(this.theme);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    const layer = this.mazeLayer;
    layer.width = MAZE_W * this.dpr;
    layer.height = MAZE_H * this.dpr;
    const ctx = layer.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = theme.floor;
    ctx.fillRect(0, 0, MAZE_W, MAZE_H);
    ctx.fillStyle = theme.floorAlt;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (LAYOUT[r][c] !== "W" && (r + c) % 2 === 0) ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }

    // Soft glow under the walls
    ctx.save();
    ctx.shadowColor = theme.edge;
    ctx.shadowBlur = 18;
    ctx.fillStyle = theme.fill;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (LAYOUT[r][c] === "W") ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    ctx.restore();
    ctx.fillStyle = theme.fill;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (LAYOUT[r][c] === "W") ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }

    // Neon outline only on wall sides that face open floor
    ctx.save();
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = 3;
    ctx.lineCap = "square";
    ctx.shadowColor = theme.edge;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (LAYOUT[r][c] !== "W") continue;
        const x = c * TILE + 1.5;
        const y = r * TILE + 1.5;
        const x2 = (c + 1) * TILE - 1.5;
        const y2 = (r + 1) * TILE - 1.5;
        if (r > 0 && !isWall(r - 1, c)) { ctx.moveTo(x, y); ctx.lineTo(x2, y); }
        if (r < ROWS - 1 && !isWall(r + 1, c)) { ctx.moveTo(x, y2); ctx.lineTo(x2, y2); }
        if (c > 0 && !isWall(r, c - 1)) { ctx.moveTo(x, y); ctx.lineTo(x, y2); }
        if (c < COLS - 1 && !isWall(r, c + 1)) { ctx.moveTo(x2, y); ctx.lineTo(x2, y2); }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Start pad
    const s = tileCenter(START);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  burst(): void {
    const { x, y } = tileCenter(END);
    const colors = [GOLD, this.theme.goal, this.theme.edge, ROBOT_EYE, ROBOT_BODY];
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 260;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 150,
        color: colors[i % colors.length],
        life: 0.8 + Math.random() * 0.8,
      });
    }
  }

  draw(game: Game, t: number, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.mazeLayer, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawGoal(t);
    this.drawRobot(game, t);
    this.drawParticles(dt);
  }

  private drawGoal(t: number): void {
    const ctx = this.ctx;
    const { x, y } = tileCenter(END);
    const pulse = (Math.sin(t * 4) + 1) / 2;

    const glow = ctx.createRadialGradient(x, y, 4, x, y, 30 + pulse * 6);
    glow.addColorStop(0, this.theme.goal + "aa");
    glow.addColorStop(1, this.theme.goal + "00");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 36, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.strokeStyle = this.theme.goal;
    ctx.lineWidth = 3;
    ctx.shadowColor = this.theme.goal;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = GOLD;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = t * 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 10 : 4;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  private drawRobot(game: Game, t: number): void {
    const ctx = this.ctx;
    const { x: cx, y: cy } = game.pos;
    const { dx: fx, dy: fy } = VECTORS[game.facing];
    const moving = game.moving;
    const bob = moving ? Math.sin(t * 14) * 2 : Math.sin(t * 3);
    const swing = moving ? Math.sin(t * 14) * 4 : 0;

    const rect = (x: number, y: number, w: number, h: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
    };
    const dot = (x: number, y: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16, 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    rect(cx - 7, cy + 6 + swing / 2, 5, 8, 2, ROBOT_LEGS);
    rect(cx + 2, cy + 6 - swing / 2, 5, 8, 2, ROBOT_LEGS);

    const bodyY = cy - 1 + bob;
    rect(cx - 9, bodyY, 18, 11, 4, ROBOT_BODY);
    dot(cx, bodyY + 5, 2, GOLD);

    // Head with visor; eyes look in the movement direction
    const headY = cy - 15 + bob;
    rect(cx - 11, headY, 22, 15, 6, ROBOT_HEAD);
    if (fy < 0) {
      rect(cx - 7, headY + 4, 14, 6, 3, "#aab9cd");
    } else {
      rect(cx - 8, headY + 3, 16, 9, 4, ROBOT_VISOR);
      const ex = cx + fx * 2;
      const ey = headY + 7 + fy;
      ctx.save();
      ctx.shadowColor = ROBOT_EYE;
      ctx.shadowBlur = 6;
      dot(ex - 3, ey, 2, ROBOT_EYE);
      dot(ex + 3, ey, 2, ROBOT_EYE);
      ctx.restore();
    }

    ctx.strokeStyle = ROBOT_HEAD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, headY);
    ctx.lineTo(cx, headY - 5);
    ctx.stroke();
    dot(cx, headY - 6, 3, Math.floor(t * 2) % 2 === 0 ? this.theme.goal : GOLD);
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life > 0) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 5, 5);
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}

/** Draws the hand skeleton over the (mirrored) camera preview. */
export function drawHand(
  canvas: HTMLCanvasElement,
  hand: { x: number; y: number }[] | undefined,
  connections: { start: number; end: number }[],
  color: string,
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!hand) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const { start, end } of connections) {
    ctx.moveTo(hand[start].x * w, hand[start].y * h);
    ctx.lineTo(hand[end].x * w, hand[end].y * h);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const p of hand) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
