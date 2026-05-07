/** @type {import('next').NextConfig} */
const isVercelBuild = process.env.VERCEL === '1' || process.env.VERCEL === 'true'

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  // In dev, isolate output in .next-dev to avoid stale/corrupted .next state.
  // In local production builds, use .next-local to avoid intermittent OneDrive locks.
  // On Vercel production builds, keep the default .next output.
  distDir:
    process.env.NODE_ENV !== 'production'
      ? '.next-dev'
      : !isVercelBuild
        ? '.next-local'
        : '.next',
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    // Allow deployment even if there are TypeScript errors
    // (We've fixed the critical ones, but this is a safety net)
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // Optimize images for better performance
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  // Enable compression
  compress: true,
  // Reduce bundle size
  experimental: {
    optimizePackageImports: ['three', '@react-three/fiber', '@react-three/drei'],
  },
}

module.exports = nextConfig


// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "pinspace",
  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
