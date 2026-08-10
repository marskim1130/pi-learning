import type { ServerResponse } from "node:http";

import type { LearningEvent } from "./protocol.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Fan-out for server-sent events (spec 9.3). Writes `event: <type>\ndata: <json>\n\n`
 * frames to every connected response and emits a `: ping` comment every 20s so
 * proxies/browsers do not silently drop idle connections.
 */
export class SseHub {
  private readonly clients = new Set<ServerResponse>();
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  get size(): number {
    return this.clients.size;
  }

  addClient(response: ServerResponse): void {
    response.on("close", () => this.removeClient(response));
    response.on("error", () => this.removeClient(response));
    this.clients.add(response);
    if (this.heartbeatTimer === undefined) {
      this.heartbeatTimer = setInterval(
        () => this.heartbeat(),
        HEARTBEAT_INTERVAL_MS
      );
    }
  }

  removeClient(response: ServerResponse): void {
    this.clients.delete(response);
    if (this.clients.size === 0 && this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  broadcast(event: LearningEvent): void {
    const frame = `event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      client.write(frame);
    }
  }

  close(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const client of [...this.clients]) {
      client.end();
    }
    this.clients.clear();
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      client.write(": ping\n\n");
    }
  }
}
