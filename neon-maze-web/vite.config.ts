import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { relayPlugin } from "./relay.ts";

export default defineConfig({
  // Allow HTTPS tunnels (needed for camera access when testing on a phone)
  server: { allowedHosts: [".trycloudflare.com"] },
  preview: { allowedHosts: [".trycloudflare.com"] },
  build: {
    rolldownOptions: {
      input: { main: "index.html", controller: "controller.html" },
    },
  },
  plugins: [
    relayPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Neon Maze",
        short_name: "Neon Maze",
        description: "Guide a neon robot through the maze using hand gestures from your webcam.",
        theme_color: "#090814",
        background_color: "#090814",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The MediaPipe WASM runtime and hand model are cached so the game works offline
        globPatterns: ["**/*.{js,css,html,svg,png,wasm,task}"],
        // The no-SIMD runtime is only for very old browsers; it still loads online
        globIgnores: ["**/*nosimd*"],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
});
