import createMDX from '@next/mdx'
import rehypeShiki from '@shikijs/rehype'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],
  // Linting is a workspace-level task (`pnpm lint`), not a build step.
  eslint: { ignoreDuringBuilds: true },
}

const withMDX = createMDX({
  options: {
    rehypePlugins: [[rehypeShiki, { themes: { light: 'github-light', dark: 'github-dark' } }]],
  },
})

export default withMDX(nextConfig)
