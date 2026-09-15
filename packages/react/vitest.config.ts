import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Hooks need a DOM; happy-dom is the cheap one.
    environment: 'happy-dom',
    include: ['test/**/*.test.tsx'],
  },
})
