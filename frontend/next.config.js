// A new ID on every build — the update popup compares the running page's ID
// with the server's (/app-version) and asks users to update when they differ.
// Stored in process.env so build workers (which inherit it) all use the same ID.
if (!process.env.NEXT_PUBLIC_BUILD_ID) {
  process.env.NEXT_PUBLIC_BUILD_ID =
    (process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 12) + "-" + Date.now().toString(36);
}
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID,
  output: "standalone",
  // pdf.js (agent PDF reports) optionally requires "canvas" for Node — not needed in the browser.
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
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
