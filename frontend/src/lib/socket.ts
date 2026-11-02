"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

/**
 * Lazily creates a single shared Socket.IO connection for realtime dashboard /
 * driver portal updates. The JWT is read from the httpOnly cookie server-side
 * during the socket handshake, so no token handling is needed here.
 *
 * Connects to the frontend's own origin (no URL argument = same-origin) rather
 * than the backend's separate domain directly — Next.js proxies /socket.io/*
 * through to the real backend (see next.config.js). This keeps the auth cookie
 * first-party from the browser's perspective, same fix as the REST API calls
 * needed for iPhone Safari's cross-site cookie blocking.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      // The default "/socket.io/" URL ends in a slash, which Next.js redirects
      // to "/socket.io" — and the backend 404s that, so live updates silently
      // never connected. "/socket.io/fc" (no trailing slash) passes through the
      // /socket.io/:path* rewrite untouched and the backend still accepts it.
      path: "/socket.io/fc",
      addTrailingSlash: false,
      withCredentials: true,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
