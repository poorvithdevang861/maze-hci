export const TILE = 40;

// 20x15 Maze Layout (W = Wall, Space = Path, S = Start, E = End)
export const LAYOUT = [
  "WWWWWWWWWWWWWWWWWWWW",
  "WS  W       W      W",
  "W W W WWWWW W WWWW W",
  "W W   W   W   W    W",
  "W WWWWW W WWWWW WW W",
  "W       W       W  W",
  "WWWW WWWWWWWWWWWW  W",
  "W    W      W      W",
  "W WWWW WWWW W WWWW W",
  "W W  W    W W W  W W",
  "W W  WWWW W W W  W W",
  "W W     W W   W  W W",
  "W WWWWW W WWWWW  W W",
  "W                WEW",
  "WWWWWWWWWWWWWWWWWWWW",
];

export const ROWS = LAYOUT.length;
export const COLS = LAYOUT[0].length;
export const MAZE_W = COLS * TILE;
export const MAZE_H = ROWS * TILE;

export type Tile = { row: number; col: number };

function findTile(ch: string): Tile {
  for (let row = 0; row < ROWS; row++) {
    const col = LAYOUT[row].indexOf(ch);
    if (col >= 0) return { row, col };
  }
  throw new Error(`Tile ${ch} not found in maze`);
}

export const START = findTile("S");
export const END = findTile("E");

export function isWall(row: number, col: number): boolean {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return LAYOUT[row][col] === "W";
}

export function tileCenter(t: Tile): { x: number; y: number } {
  return { x: t.col * TILE + TILE / 2, y: t.row * TILE + TILE / 2 };
}

export type Theme = {
  name: string;
  edge: string;
  fill: string;
  floor: string;
  floorAlt: string;
  goal: string;
};

// Neon theme per stage; cycles after the last one
export const THEMES: Theme[] = [
  { name: "CYAN",    edge: "#00c8ff", fill: "#161e46", floor: "#0e0c1c", floorAlt: "#131125", goal: "#ff3c8c" },
  { name: "MAGENTA", edge: "#ff46c8", fill: "#3a1240", floor: "#140a1a", floorAlt: "#1b0e22", goal: "#00e6ff" },
  { name: "LIME",    edge: "#78ff5a", fill: "#123422", floor: "#0a140e", floorAlt: "#0e1b13", goal: "#ff50c8" },
  { name: "SUNSET",  edge: "#ff8c28", fill: "#401e0e", floor: "#160d08", floorAlt: "#1d120b", goal: "#78c8ff" },
  { name: "VIOLET",  edge: "#aa6eff", fill: "#261650", floor: "#0f0a1e", floorAlt: "#150f28", goal: "#ffd666" },
  { name: "CRIMSON", edge: "#ff3c50", fill: "#42101a", floor: "#16080c", floorAlt: "#1e0c11", goal: "#00ffc8" },
];

export function themeForStage(stage: number): Theme {
  return THEMES[(stage - 1) % THEMES.length];
}
