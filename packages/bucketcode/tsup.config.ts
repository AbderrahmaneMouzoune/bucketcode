import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  // nanoid is ESM-only; bundling it keeps the CommonJS build usable.
  noExternal: ['nanoid'],
})
