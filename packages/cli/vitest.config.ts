import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      // Only `doctor` is covered today. This floor is here to stop the
      // number sliding further, not to claim the package is tested.
      thresholds: {
        statements: 30,
        branches: 25,
        functions: 30,
        lines: 30,
      },
    },
  },
})
