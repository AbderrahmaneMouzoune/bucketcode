import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Hooks need a DOM; happy-dom is the cheap one.
    environment: 'happy-dom',
    include: ['src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test-helpers.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 88,
        branches: 75,
        functions: 90,
        lines: 88,
      },
    },
  },
})
