import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  // Neutral, not node: this package has to bundle for a browser too.
  platform: 'neutral',
  // nanoid is ESM-only; bundling it keeps the CommonJS build usable.
  noExternal: ['nanoid'],
})
