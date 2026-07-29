import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";
import { verifyToken } from "../utils/jwt";

let io: SocketIOServer | undefined;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers.cookie
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${env.cookieName}=`))
        ?.split("=")[1];

    if (!token) return next(new Error("Unauthorized"));

    try {
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
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
  io?.emit(event, payload);
}

/** Send an event only to a specific driver's room (e.g. "you were assigned an order"). */
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function getIO(): SocketIOServer | undefined {
  return io;
}
