import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
let gitSha = 'dev';
try { gitSha = execSync('git rev-parse --short HEAD').toString().trim(); } catch {}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GIT_SHA__: JSON.stringify(gitSha),
  },
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
