import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Restrict to localhost by default for security. Override with VITE_HOST env var for network access.
    host: process.env.VITE_HOST || '127.0.0.1',
    port: parseInt(process.env.VITE_PORT || '3000', 10),
    allowedHosts: true,
  },
});
