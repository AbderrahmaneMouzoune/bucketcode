import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // No `treeshake`: it routes the output through Rollup, which strips module
  // level directives — taking the 'use client' banner below with it. esbuild's
  // own dead code elimination is enough for a package this size, and a React
  // package that loses that directive breaks on import from a Server Component.
  // This runs in a browser, not on a server.
  platform: 'browser',
  external: ['react'],
  // Every export here is a hook or a context, so the whole entry is client-side.
  // Stated once at the top of the bundle, where a React Server Components build
  // looks for it — bundlers do not reliably carry per-file directives through.
  banner: { js: "'use client';" },
})
