import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
  // classic (non-module) workers: Chromium refuses module workers from blob URLs when the page is
  // opened straight from disk (file://), which would push the simulation onto the main thread
  worker: { format: 'iife' },
  assetsInclude: ['**/*.glb'],
});
