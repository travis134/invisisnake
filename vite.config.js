import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = "traviss-mac-studio.tailba4edc.ts.net";
const port = Number(process.env.PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port,
    allowedHosts: [host],
    origin: `https://${host}/proxy/${port}`,
    hmr: {
      protocol: "wss",
      host,
      clientPort: 443,
      path: `/proxy/${port}`,
    },
  },
});
