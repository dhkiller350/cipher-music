import withPWA from '@ducanh2912/next-pwa';

// Static CORS headers applied to all /api/* routes at the infrastructure level.
// The Access-Control-Allow-Origin header (which must reflect the request origin
// for credentials: 'include' to work) is set dynamically per-request inside
// each route handler via the applyCorsHeaders() helper in src/lib/middleware.ts.
const corsHeaders = [
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
  { key: 'Access-Control-Allow-Headers', value: 'Authorization,Content-Type,X-Requested-With' },
  { key: 'Vary', value: 'Origin' },
];

const nextConfig = withPWA({
  dest: 'public',
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    disableDevLogs: true,
  },
})({
  reactStrictMode: true,

  async headers() {
    return [
      {
        // Apply CORS headers to all /api/* routes
        source: '/api/:path*',
        headers: corsHeaders,
      },
    ];
  },
});

export default nextConfig;
