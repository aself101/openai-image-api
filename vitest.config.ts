import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10000, // Allow for rate limiting delays in tests
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts is the 56-line bin entry (process.argv/process.exit wiring),
      // covered by the subprocess tests in test/cli.test.ts; cli-core.ts, where
      // the CLI logic lives, is measured.
      exclude: ['src/cli.ts'],
    },
  },
});
