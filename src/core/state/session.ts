import type { ApiClient } from "../api/client.js";

export interface RuntimeRecord {
  runtime_id: string;
  project_id: string;
  status: string;
  app_url?: string;
  lease_expires_at?: string;
  started_at?: string;
}

export interface BuildRecord {
  build_id?: string;
  id?: string;
  status: string;
  created_at?: string;
  completed_at?: string;
  exit_code?: number | null;
}

export class SessionState {
  private client: ApiClient | null = null;
  private runtimes = new Map<string, RuntimeRecord>();
  private builds = new Map<string, BuildRecord>();
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly eventHandlers = new Set<(event: { type: string; payload: unknown }) => void>();

  setClient(client: ApiClient): void {
    this.client = client;
  }

  get api(): ApiClient {
    if (!this.client) {
      throw new Error("Session state has no API client; the plugin failed to initialise.");
    }
    return this.client;
  }

  trackRuntime(runtime: RuntimeRecord): void {
    this.runtimes.set(runtime.runtime_id, runtime);
  }

  forgetRuntime(runtimeId: string): void {
    this.runtimes.delete(runtimeId);
  }

  getRuntime(runtimeId: string): RuntimeRecord | undefined {
    return this.runtimes.get(runtimeId);
  }

  listRuntimes(): RuntimeRecord[] {
    return Array.from(this.runtimes.values());
  }

  trackBuild(build: BuildRecord): void {
    const id = build.build_id ?? build.id;
    if (id) {
      this.builds.set(id, build);
    }
  }

  getBuild(buildId: string): BuildRecord | undefined {
    return this.builds.get(buildId);
  }

  onEvent(handler: (event: { type: string; payload: unknown }) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(type: string, payload: unknown): void {
    for (const handler of this.eventHandlers) {
      try {
        handler({ type, payload });
      } catch {
        // A failing subscriber must not break the socket loop.
      }
    }
  }

  private handleMessage(raw: string): void {
    try {
      const message = JSON.parse(raw);
      this.emit(message.type, message.payload);

      if (message.type === "runtime.started" && message.payload?.runtime_id) {
        this.trackRuntime(message.payload as RuntimeRecord);
      }
      if (message.type === "runtime.stopped" && message.payload?.runtime_id) {
        this.forgetRuntime(message.payload.runtime_id);
      }
    } catch {
      // Ignore malformed frames.
    }
  }

  connect(apiKey: string, controlPlaneUrl: string): void {
    if (this.socket && this.socket.readyState <= 1) {
      return;
    }

    const wsUrl = controlPlaneUrl.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(apiKey)}`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      this.scheduleReconnect(apiKey, controlPlaneUrl);
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private scheduleReconnect(apiKey: string, controlPlaneUrl: string): void {
    if (this.reconnectAttempts >= 10) {
      this.emit("disconnected", { reason: "reconnect limit reached" });
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.connect(apiKey, controlPlaneUrl);
    }, delay);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === 1;
  }
}
