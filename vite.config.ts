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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: binding,
  preview: binding,
});
