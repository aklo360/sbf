/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'solanabusinessfrogs.com',
      },
    ],
  },
  trailingSlash: true,
}

module.exports = nextConfig 