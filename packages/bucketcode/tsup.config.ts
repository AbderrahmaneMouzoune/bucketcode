import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsup'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'protocol/index': 'src/protocol/index.ts',
    // Client-safe on purpose: nothing reachable from here imports the AWS SDK,
    // so a browser bundle that only wants sync codes stays small.
    codes: 'src/codes.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'node20',
  platform: 'node',
  // nanoid is ESM-only; bundling it keeps the CommonJS build usable.
  noExternal: ['nanoid'],
  define: {
    __VERSION__: JSON.stringify(version),
  },
})
