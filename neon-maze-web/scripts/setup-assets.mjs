// Copies the MediaPipe WASM runtime into public/ and downloads the hand model,
// so the app (and the installed PWA) works without any CDN.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = join(root, "public/mediapipe");
const modelPath = join(root, "public/models/hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

mkdirSync(wasmDest, { recursive: true });
for (const file of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  copyFileSync(join(wasmSrc, file), join(wasmDest, file));
}

if (!existsSync(modelPath)) {
  mkdirSync(dirname(modelPath), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log("Downloaded hand_landmarker.task");
}
