import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.PORT || 5173);
const proxyHost = process.env.VITE_ALLOWED_HOST;

const serverConfig = {
  host: "0.0.0.0",
  port,
};

if (proxyHost) {
  serverConfig.allowedHosts = [proxyHost];
  serverConfig.origin = `https://${proxyHost}/proxy/${port}`;
  serverConfig.hmr = {
    protocol: "wss",
    host: proxyHost,
    clientPort: 443,
    path: `/proxy/${port}`,
  };
}

export default defineConfig({
  plugins: [react()],
  server: serverConfig,
});
