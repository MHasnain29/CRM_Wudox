import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";

// dev-tunnel.env → PUBLIC_API_URL on the backend only (Twilio webhooks). Frontend keeps VITE_API_URL=http://localhost:3001 to avoid ngrok CORS.

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: path.resolve(__dirname, "../backend/client"),
    emptyOutDir: true,
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
