import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dev: resolve(__dirname, 'dev.html'),
        lab: resolve(__dirname, 'lab.html'),
        aim: resolve(__dirname, 'aim.html'),
        range: resolve(__dirname, 'range.html'),
        logs: resolve(__dirname, 'logs.html'),
      },
    },
  },
  server: {
    open: true,
  },
});
