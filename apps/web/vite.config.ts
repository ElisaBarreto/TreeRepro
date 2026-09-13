import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT;

export default defineConfig({
  plugins: [
    // Tests live next to the routes they cover (e.g. routes/app.test.tsx).
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.tsx?$',
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    // Only the Docker dev stack (which sets VITE_HMR_CLIENT_PORT) needs every
    // interface, so Caddy can reach Vite; on a laptop stay on loopback (issue #13).
    host: hmrClientPort ? '0.0.0.0' : 'localhost',
    port: 5173,
    strictPort: true,
    // Behind Caddy in Docker the browser reaches Vite through port 80 (docs/gotchas/docker.md).
    hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
