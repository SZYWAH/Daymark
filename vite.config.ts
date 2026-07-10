import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const appVersion = "0.1.0-rc.3";

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_"],
});
