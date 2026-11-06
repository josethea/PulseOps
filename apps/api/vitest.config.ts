import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // esbuild does not emit decorator metadata, which Nest's constructor injection relies on.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    // Timers are driven explicitly by the tests so results are deterministic.
    env: { BACKGROUND_WORKERS: 'false' },
    // Integration tests share one seeded database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
