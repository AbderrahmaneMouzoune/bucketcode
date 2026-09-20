import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 95,
        lines: 90,
      },
    },
  },
})
