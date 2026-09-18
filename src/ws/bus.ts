import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';

/**
 * Thin pub/sub wrapper so services never import socket.io directly and stay testable.
 * Events pushed to the two POC frontends:
 *   agent:state      — any agent state transition (incl. entering/leaving wrap_up)
 *   wrapup:tick      — per-second countdown for every agent currently in wrap_up
 *   routing:decision — every routing decision, including the skipped ones
 *   queue:depth      — live queue depths
 *   call:offered     — preview/manual offer awaiting agent confirmation
 *   call:assigned / call:ended
 *   campaign:pacing  — the pacing strategy's decision for a campaign tick
 *   settings:updated
 */
let io: SocketIOServer | null = null;

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    socket.emit('hello', { ok: true, at: new Date().toISOString() });
  });
  return io;
}

export function emit(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

export function getIO(): SocketIOServer | null {
  return io;
}
