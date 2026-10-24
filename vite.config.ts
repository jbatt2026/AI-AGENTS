import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Restrict to localhost by default. Override with VITE_HOST / VITE_PORT for
// network access (trusted networks only). The dev and preview servers share
// one binding so `npm run dev` and `npm run preview` behave the same.
const binding = {
  host: process.env.VITE_HOST || '127.0.0.1',
  port: parseInt(process.env.VITE_PORT || '3000', 10),
};

// /api goes to the local agent server. The bearer token lives in a 0600 file the
// server writes at startup; it is attached here, so the browser never holds it.
const agentPort = process.env.AGENT_SERVER_PORT || '8787';
const proxy = {
  '/api': {
    target: `http://127.0.0.1:${agentPort}`,
    configure: (p: { on: (e: string, cb: (req: { setHeader: (k: string, v: string) => void }) => void) => void }) => {
      p.on('proxyReq', (req) => {
        try {
          req.setHeader('authorization', `Bearer ${readFileSync('.agent-token', 'utf8').trim()}`);
        } catch {
          // Server not started yet; it will answer 401 and the GUI shows "unreachable".
        }
      });
    },
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { ...binding, proxy },
  preview: { ...binding, proxy },
});
