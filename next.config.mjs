/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // Next's app router ignores dot-prefixed folders, so these well-known
    // agent discovery paths are served by normal route handlers behind rewrites.
    return [
      { source: '/.well-known/agent.json', destination: '/api/well-known/agent.json' },
      { source: '/llms.txt', destination: '/api/llms.txt' },
    ]
  },
}

export default nextConfig
