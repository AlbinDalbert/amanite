import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    target: ["es2021", "chrome100", "safari13"],
    minify: process.env.TAURI_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_DEBUG)
  }
});
