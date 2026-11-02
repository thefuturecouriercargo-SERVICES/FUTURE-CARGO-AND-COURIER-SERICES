import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";
import { verifyToken, verifyVendorToken } from "../utils/jwt";

let io: SocketIOServer | undefined;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const cookieValue = (name: string) =>
      socket.handshake.headers.cookie
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${name}=`))
        ?.split("=")[1];

    const token = socket.handshake.auth?.token || cookieValue(env.cookieName);

    if (token) {
      try {
        const payload = verifyToken(token);
        socket.data.user = payload;
        return next();
      } catch {
        return next(new Error("Unauthorized"));
      }
    }

    // Vendor portal: vendors only get a data-free "refresh" ping (see emitGlobal),
    // never the order payloads that staff receive.
    const vendorToken = cookieValue(env.vendorCookieName);
    if (vendorToken) {
      try {
        const v = verifyVendorToken(vendorToken);
        if (v.type !== "VENDOR") return next(new Error("Unauthorized"));
        socket.data.vendor = v;
        return next();
      } catch {
        return next(new Error("Unauthorized"));
      }
    }

    next(new Error("Unauthorized"));
  });

  io.on("connection", (socket) => {
    if (socket.data.vendor) {
      socket.join("vendors");
      return;
    }
    socket.join("staff");
    const user = socket.data.user;
    // Admins join a broadcast room; drivers join a personal room for targeted updates.
    if (user?.role === "SUPER_ADMIN") {
      socket.join("admins");
    }
    if (user?.sub) {
      socket.join(`user:${user.sub}`);
    }
  });

  return io;
}

/** Broadcast an event to all connected admin dashboards + all drivers (global ops feed). */
export function emitGlobal(event: string, payload: unknown) {
  io?.to("staff").emit(event, payload);
  // Vendors just learn that something changed, so their portal can reload its own data.
  io?.to("vendors").emit("live:refresh", { event });
}

/** Send an event only to a specific driver's room (e.g. "you were assigned an order"). */
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function getIO(): SocketIOServer | undefined {
  return io;
}
