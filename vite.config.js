import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2019',
    sourcemap: false,
    chunkSizeWarningLimit: 800
  }
});
