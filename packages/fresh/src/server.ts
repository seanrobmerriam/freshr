/**
 * Runtime bridge between Fresh and Bun.
 *
 * Fresh was originally written against `Deno.serve()` and
 * `Deno.upgradeWebSocket()`. This module provides the equivalent pieces on
 * top of `Bun.serve()` (and plain `node:` APIs where possible so that code
 * evaluated inside Vite's SSR runner keeps working on Node too).
 *
 * @module
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { Readable } from "node:stream";

/** Address of one side of a connection. */
export interface NetAddr {
  transport: "tcp" | "udp";
  hostname: string;
  port: number;
}

/** Information about the connection a request was received on. */
export interface ServeHandlerInfo {
  /** The remote address of the connection. */
  remoteAddr: NetAddr;
  /**
   * The Bun server that received the request, if any. Used to perform
   * WebSocket upgrades.
   */
  // deno-lint-ignore no-explicit-any
  server?: any;
}

// deno-lint-ignore no-explicit-any
type BunServer = any;

export function isBunServer(value: unknown): value is BunServer {
  return value !== null && typeof value === "object" &&
    // deno-lint-ignore no-explicit-any
    typeof (value as any).upgrade === "function" &&
    // deno-lint-ignore no-explicit-any
    typeof (value as any).requestIP === "function";
}

/**
 * Normalize whatever was passed as the second argument of a fetch handler
 * into a {@linkcode ServeHandlerInfo}. Bun passes its `Server` instance,
 * tests and adapters pass an info object directly.
 */
export function toServeHandlerInfo(
  req: Request,
  infoOrServer: unknown,
  fallback: ServeHandlerInfo,
): ServeHandlerInfo {
  if (isBunServer(infoOrServer)) {
    const ip = infoOrServer.requestIP(req) as
      | { address: string; port: number; family: string }
      | null;
    return {
      remoteAddr: ip
        ? { transport: "tcp", hostname: ip.address, port: ip.port }
        : fallback.remoteAddr,
      server: infoOrServer,
    };
  }
  if (infoOrServer !== null && typeof infoOrServer === "object") {
    return infoOrServer as ServeHandlerInfo;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function hasCode(err: unknown, code: string): boolean {
  return err !== null && typeof err === "object" &&
    // deno-lint-ignore no-explicit-any
    (err as any).code === code;
}

/** Equivalent of `err instanceof Deno.errors.NotFound` */
export function isNotFound(err: unknown): boolean {
  return hasCode(err, "ENOENT") || hasCode(err, "ENOTDIR");
}

/** Equivalent of `err instanceof Deno.errors.AlreadyExists` */
export function isAlreadyExists(err: unknown): boolean {
  return hasCode(err, "EEXIST");
}

/** Equivalent of `err instanceof Deno.errors.AddrInUse` */
export function isAddrInUse(err: unknown): boolean {
  return hasCode(err, "EADDRINUSE") ||
    (err instanceof Error && /EADDRINUSE|address.*in use/i.test(err.message));
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface OpenedFile {
  size: number;
  readable: ReadableStream<Uint8Array>;
  close(): void;
}

/** Open a file for streaming, like `Deno.open()` + `Deno.stat()`. */
export async function openFile(filePath: string): Promise<OpenedFile> {
  const stat = await fsp.stat(filePath);
  const nodeStream = fs.createReadStream(filePath);
  // Surface errors like ENOENT early, mirroring Deno.open() rejecting.
  await new Promise<void>((resolve, reject) => {
    nodeStream.once("open", () => resolve());
    nodeStream.once("error", reject);
  });
  const readable = Readable.toWeb(nodeStream) as unknown as ReadableStream<
    Uint8Array
  >;
  return {
    size: stat.size,
    readable,
    close: () => nodeStream.destroy(),
  };
}

// ---------------------------------------------------------------------------
// WebSockets
// ---------------------------------------------------------------------------

/** Options for upgrading a request to a WebSocket. */
export interface UpgradeWebSocketOptions {
  /** The WebSocket sub-protocol to negotiate. */
  protocol?: string;
  /** Idle timeout in seconds. Only applied on a per-server basis in Bun. */
  idleTimeout?: number;
}

/** Minimal surface of the socket implementation we forward to. */
interface SocketBackend {
  send(data: string | ArrayBufferLike | ArrayBufferView): unknown;
  close(code?: number, reason?: string): unknown;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * A server-side WebSocket that behaves like the standard browser
 * `WebSocket` interface (which is what `Deno.upgradeWebSocket()` returned),
 * backed by either a Bun `ServerWebSocket` or a `ws` socket.
 */
export class FreshWebSocket extends EventTarget {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;
  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = CLOSING;
  readonly CLOSED = CLOSED;

  readyState: number = CONNECTING;
  binaryType: BinaryType = "blob";
  protocol: string;
  readonly extensions = "";
  readonly url: string;
  bufferedAmount = 0;

  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  #backend: SocketBackend | null = null;

  constructor(url: string, protocol = "") {
    super();
    this.url = url;
    this.protocol = protocol;
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState === CONNECTING) {
      throw new DOMException(
        "Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.",
        "InvalidStateError",
      );
    }
    if (this.readyState !== OPEN || this.#backend === null) return;
    if (data instanceof Blob) {
      const backend = this.#backend;
      data.arrayBuffer().then((buf) => backend.send(buf));
      return;
    }
    this.#backend.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSING || this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    this.#backend?.close(code, reason);
  }

  #emit(ev: Event) {
    const prop = `on${ev.type}` as "onopen";
    const fn = this[prop];
    if (typeof fn === "function") fn.call(this, ev);
    this.dispatchEvent(ev);
  }

  /**
   * Backend events are dispatched asynchronously (in order) so that listeners
   * attached synchronously after the upgrade, like `socket.onopen = ...`,
   * observe them. Bun invokes `open` synchronously inside `server.upgrade()`.
   */
  #queue(fn: () => void) {
    queueMicrotask(fn);
  }

  /** @internal */
  _open(backend: SocketBackend): void {
    this.#backend = backend;
    this.#queue(() => {
      if (this.readyState === CONNECTING) this.readyState = OPEN;
      this.#emit(new Event("open"));
    });
  }

  /** @internal */
  _message(raw: unknown): void {
    this.#queue(() => this.#dispatchMessage(raw));
  }

  #dispatchMessage(raw: unknown): void {
    let data: unknown = raw;
    if (typeof raw !== "string") {
      let bytes: Uint8Array;
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw);
      } else if (Array.isArray(raw)) {
        // `ws` fragments
        const total = raw.reduce((n: number, b: Uint8Array) => n + b.length, 0);
        bytes = new Uint8Array(total);
        let offset = 0;
        for (const b of raw as Uint8Array[]) {
          bytes.set(b, offset);
          offset += b.length;
        }
      } else {
        const view = raw as ArrayBufferView;
        bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      }
      const copy = bytes.slice();
      data = this.binaryType === "arraybuffer" ? copy.buffer : new Blob([copy]);
    }
    this.#emit(new MessageEvent("message", { data }));
  }

  /** @internal */
  _close(code: number, reason: string): void {
    this.#queue(() => {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.#emit(
        new CloseEvent("close", { code, reason, wasClean: code !== 1006 }),
      );
    });
  }

  /** @internal */
  _error(error?: unknown): void {
    this.#queue(() => {
      const ev = typeof ErrorEvent !== "undefined"
        ? new ErrorEvent("error", { error, message: String(error ?? "") })
        : new Event("error");
      this.#emit(ev);
    });
  }
}

const FRESH_WS = Symbol.for("fresh.websocket");

/**
 * Marks responses returned from a successful Bun upgrade. The fetch handler
 * must return `undefined` to Bun in that case.
 */
const UPGRADED_RESPONSES: WeakSet<Response> =
  // deno-lint-ignore no-explicit-any
  (globalThis as any)[Symbol.for("fresh.upgradedResponses")] ??= new WeakSet<
    Response
  >();

export function isUpgradeResponse(res: unknown): boolean {
  return res instanceof Response && UPGRADED_RESPONSES.has(res);
}

/**
 * WebSocket handlers that must be passed to `Bun.serve()` for
 * `ctx.upgrade()` to work.
 *
 * ```ts
 * Bun.serve({ fetch: app.handler(), websocket });
 * ```
 */
export const websocket = {
  // deno-lint-ignore no-explicit-any
  open(ws: any) {
    const socket = ws.data?.[FRESH_WS] as FreshWebSocket | undefined;
    socket?._open(ws);
  },
  // deno-lint-ignore no-explicit-any
  message(ws: any, message: unknown) {
    const socket = ws.data?.[FRESH_WS] as FreshWebSocket | undefined;
    socket?._message(message);
  },
  // deno-lint-ignore no-explicit-any
  close(ws: any, code: number, reason: string) {
    const socket = ws.data?.[FRESH_WS] as FreshWebSocket | undefined;
    socket?._close(code, reason);
  },
};

/** Raw node:http upgrade handed over by an adapter like the Vite plugin. */
export interface NodeUpgradeSource {
  // deno-lint-ignore no-explicit-any
  socket: any;
  // deno-lint-ignore no-explicit-any
  head: any;
  /** The `node:http` `IncomingMessage` of the upgrade request. */
  // deno-lint-ignore no-explicit-any
  req?: any;
}

// deno-lint-ignore no-explicit-any
let wsServer: any = null;

async function upgradeNodeSocket(
  socket: FreshWebSocket,
  source: NodeUpgradeSource,
) {
  if (wsServer === null) {
    const { WebSocketServer } = await import("ws");
    wsServer = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols: Set<string>) => {
        return socket.protocol && protocols.has(socket.protocol)
          ? socket.protocol
          : false;
      },
    });
  }
  // deno-lint-ignore no-explicit-any
  wsServer.handleUpgrade(source.req, source.socket, source.head, (ws: any) => {
    socket.protocol = ws.protocol ?? socket.protocol;
    ws.on("message", (data: unknown, isBinary: boolean) => {
      socket._message(
        isBinary ? data : (data as { toString(): string }).toString(),
      );
    });
    ws.on("close", (code: number, reason: { toString(): string }) => {
      socket._close(code, reason.toString());
    });
    ws.on("error", (err: unknown) => socket._error(err));
    socket._open(ws);
  });
}

/**
 * Bun equivalent of `Deno.upgradeWebSocket()`.
 */
export function upgradeWebSocket(
  req: Request,
  info: ServeHandlerInfo | undefined,
  options: UpgradeWebSocketOptions = {},
  nodeSource?: NodeUpgradeSource,
): { socket: FreshWebSocket; response: Response } {
  const socket = new FreshWebSocket(req.url, options.protocol ?? "");

  if (nodeSource !== undefined && nodeSource.req !== undefined) {
    upgradeNodeSocket(socket, nodeSource).catch((err) => socket._error(err));
    const response = new Response(null, { status: 200 });
    UPGRADED_RESPONSES.add(response);
    return { socket, response };
  }

  const server = info?.server;
  if (!isBunServer(server)) {
    throw new Error(
      "WebSocket upgrades require the request to be served by Bun.serve(). " +
        "Pass the Bun server as the second argument to the handler, " +
        "e.g. `Bun.serve({ fetch: app.handler(), websocket })`.",
    );
  }

  const headers: Record<string, string> = {};
  if (options.protocol) headers["Sec-WebSocket-Protocol"] = options.protocol;
  const ok = server.upgrade(req, {
    data: { [FRESH_WS]: socket },
    headers,
  });
  if (!ok) {
    throw new TypeError("Failed to upgrade the request to a WebSocket.");
  }

  const response = new Response(null, { status: 200 });
  UPGRADED_RESPONSES.add(response);
  return { socket, response };
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

export interface ServeOptions {
  port?: number;
  hostname?: string;
  cert?: string;
  key?: string;
  signal?: AbortSignal;
  onListen?: (addr: NetAddr) => void;
}

export type FetchHandler = (
  req: Request,
  info?: ServeHandlerInfo,
) => Promise<Response>;

/** Thin wrapper around `Bun.serve()` that mirrors `Deno.serve()`. */
export function serve(
  options: ServeOptions,
  handler: FetchHandler,
): { finished: Promise<void>; port: number; hostname: string } {
  // deno-lint-ignore no-explicit-any
  const Bun = (globalThis as any).Bun;
  if (Bun === undefined) {
    throw new Error("Fresh's built-in server requires the Bun runtime.");
  }

  const hostname = options.hostname ?? "0.0.0.0";
  // deno-lint-ignore no-explicit-any
  const server: any = Bun.serve({
    port: options.port ?? 8000,
    hostname,
    tls: options.cert && options.key
      ? { cert: options.cert, key: options.key }
      : undefined,
    websocket,
    // deno-lint-ignore no-explicit-any
    async fetch(req: Request, srv: any): Promise<Response | undefined> {
      const res = await handler(
        req,
        toServeHandlerInfo(req, srv, DEFAULT_INFO),
      );
      if (isUpgradeResponse(res)) return undefined;
      return res;
    },
  });

  const finished = new Promise<void>((resolve) => {
    if (options.signal) {
      const stop = () => {
        server.stop(true);
        resolve();
      };
      if (options.signal.aborted) stop();
      else options.signal.addEventListener("abort", stop, { once: true });
    }
  });

  const addr: NetAddr = {
    transport: "tcp",
    hostname: server.hostname ?? hostname,
    port: server.port,
  };
  if (options.onListen) {
    options.onListen(addr);
  } else {
    // deno-lint-ignore no-console
    console.log(`Listening on http://${addr.hostname}:${addr.port}/`);
  }

  return { finished, port: server.port, hostname: addr.hostname };
}

export const DEFAULT_INFO: ServeHandlerInfo = {
  localAddr: { transport: "tcp", hostname: "localhost", port: 8080 },
  remoteAddr: { transport: "tcp", hostname: "localhost", port: 1234 },
} as ServeHandlerInfo;
