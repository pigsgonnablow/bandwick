import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import pkg from './package.json';

// stamped into the title card so the live Pages site can be checked against the latest commit
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

export default defineConfig(({ command }) => ({
  define: {
    __BUILD__: JSON.stringify(
      command === 'build' ? `v${pkg.version} · ${commit()} · ${new Date().toISOString().slice(0, 10)}` : `v${pkg.version} · dev`,
    ),
  },
  plugins: [preact(), viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
  // classic (non-module) workers: Chromium refuses module workers from blob URLs when the page is
  // opened straight from disk (file://), which would push the simulation onto the main thread
  worker: { format: 'iife' },
  assetsInclude: ['**/*.glb'],
}));
