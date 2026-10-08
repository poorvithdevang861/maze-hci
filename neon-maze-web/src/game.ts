import type { Direction } from "./gesture";
import { END, START, isWall, tileCenter, type Tile } from "./maze";

const MOVE_SPEED = 220; // pixels per second

export const VECTORS: Record<Direction, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

export type WinEvent = { points: number; time: number; score: number; stage: number };

function step(t: Tile, d: Direction): Tile {
  return { row: t.row + VECTORS[d].dy, col: t.col + VECTORS[d].dx };
}

function canMove(t: Tile, d: Direction): boolean {
  const n = step(t, d);
  return !isWall(n.row, n.col);
}

/** Tile-to-tile movement (can't snag on corners), timing and scoring. */
export class Game {
  tile: Tile = { ...START };
  target: Tile | null = null;
  pos = tileCenter(START);
  moveDir: Direction | null = null;
  facing: Direction = "DOWN";

  score = 0;
  completions = 0;
  bestTime: number | null = null;
  stage = 1;
  /** True while the player is pushing into a wall */
  blocked = false;
  private runStart: number | null = null;

  get moving(): boolean {
    return this.target !== null;
  }

  elapsed(now: number): number {
    return this.runStart === null ? 0 : (now - this.runStart) / 1000;
  }

  update(dt: number, want: Direction | null, now: number): WinEvent | null {
    if (want) this.facing = want;

    if (this.target && want && this.moveDir && want === OPPOSITE[this.moveDir]) {
      [this.tile, this.target] = [this.target, this.tile];
      this.moveDir = want;
    }
    if (!this.target && want && canMove(this.tile, want)) {
      this.target = step(this.tile, want);
      this.moveDir = want;
      if (this.runStart === null) this.runStart = now;
    }
    this.blocked = !this.target && want !== null;
    if (!this.target) return null;

    const goal = tileCenter(this.target);
    const dist = Math.hypot(goal.x - this.pos.x, goal.y - this.pos.y);
    const stepPx = MOVE_SPEED * dt;

    if (stepPx < dist) {
      this.pos.x += ((goal.x - this.pos.x) / dist) * stepPx;
      this.pos.y += ((goal.y - this.pos.y) / dist) * stepPx;
      return null;
    }

    this.pos = goal;
    this.tile = this.target;
    this.target = null;

    if (this.tile.row === END.row && this.tile.col === END.col) {
      return this.win(now);
    }
    if (want && canMove(this.tile, want)) {
      this.target = step(this.tile, want);
      this.moveDir = want;
    }
    return null;
  }

  private win(now: number): WinEvent {
    const time = this.elapsed(now);
    // 100 for finishing plus up to 200 bonus, losing 2 points per second
    const points = 100 + Math.max(0, 200 - Math.floor(time) * 2);
    this.score += points;
    this.completions += 1;
    if (this.bestTime === null || time < this.bestTime) this.bestTime = time;
    this.stage += 1;

    this.tile = { ...START };
    this.pos = tileCenter(START);
    this.target = null;
    this.runStart = null;
    return { points, time, score: this.score, stage: this.stage };
  }
}
