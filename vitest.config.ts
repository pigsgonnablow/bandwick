// Test runner config (separate from vite.config.ts so the game's build plugins stay out of the tests).
// Layers: test/unit (pure functions, milliseconds), test/integration (whole worlds and simulations),
// test/regression (golden fingerprints and fixed bugs). `npm test` runs them all.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // whole-world simulations take a few seconds each
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
