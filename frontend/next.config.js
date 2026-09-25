/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Proxies /api/* requests through the frontend's own domain to the actual
  // backend, instead of the browser calling the backend's separate Railway
  // subdomain directly. This makes every request same-origin from the
  // browser's point of view — the auth cookie is then a first-party cookie,
  // not a cross-site one, which is what Safari's default "Prevent Cross-Site
  // Tracking" setting was silently blocking.
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      // Same same-origin reasoning as /api above, for real-time updates. If the
      // raw WebSocket upgrade isn't proxied cleanly in some environment,
      // Socket.IO automatically falls back to HTTP long-polling, which this
      // rewrite handles the same way any other HTTP request does — so this
      // stays functional either way.
      {
        source: "/socket.io/:path*",
        destination: `${backendUrl}/socket.io/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
