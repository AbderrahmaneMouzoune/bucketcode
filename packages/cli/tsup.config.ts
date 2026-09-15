import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  // A binary is executed, never imported: one ESM build is all it needs.
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  platform: 'node',
  define: {
    __VERSION__: JSON.stringify(version),
  },
})
