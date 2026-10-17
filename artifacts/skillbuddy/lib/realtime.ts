/**
 * The shared realtime WebSocket service — one socket per logged-in user, open
 * while the app is in use, serving every flow and both roles.
 *
 * Protocol (backend "Frontend Integration Guide", 13 Oct 2026):
 *   - URL: wss://<HOST>/api/v1/ws?token=<ACCESS_TOKEN>, derived from the SAME
 *     base URL the REST client uses (https -> wss, http -> ws). The host is
 *     never hardcoded and the token is encodeURIComponent'd. Neither the URL
 *     nor the token is ever logged.
 *   - Server -> client: { type, data, timestamp } (see lib/realtimeEvents.ts).
 *   - Client -> server: ONLY { action: 'watch_job'|'unwatch_job', job_id: <number> }
 *     (a string job_id is silently ignored by the server, so it is never sent).
 *     The server never acknowledges commands.
 *   - Missing/invalid/expired/revoked token: the server closes with code 1008.
 *   - Events are NOT stored — a missed event is lost. REST stays the source of
 *     truth, so every (re)open notifies onReconnected listeners and screens
 *     refetch. The same event may arrive more than once, so handlers must be
 *     idempotent, and unknown types are ignored.
 *   - NO heartbeat is documented, and none is invented here: half-open sockets
 *     are handled by reconnect-on-foreground plus the REST refetch.
 *
 * This module is framework-agnostic ON PURPOSE: no React, no SecureStore, no
 * expo-* import, no global timer/WebSocket reference. Everything platform
 * specific (token read, refresh, logout, socket construction, scheduler) is
 * injected through {@link RealtimeConfig}, which is what lets the whole state
 * machine be unit tested with a fake socket and a fake clock.
 */

import { parseRealtimeEnvelope, type RealtimeEvent } from '@/lib/realtimeEvents';

export type RealtimeStatus =
  /** Configured but never started (no session yet), or stopped after a logout. */
  | 'idle'
  | 'connecting'
  | 'open'
  /** Closed unexpectedly and waiting out the backoff before the next attempt. */
  | 'reconnecting'
  /** App went to the background: the socket was closed on purpose. */
  | 'paused'
  /** Logged out, session over, or auth failed twice in a row. */
  | 'stopped';

/** Path of the realtime endpoint, appended to the REST base URL's host. */
export const REALTIME_PATH = '/api/v1/ws';

/** Reconnect backoff: 1s, 2s, 4s … capped at 30s (plus jitter). */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/**
 * Raised cap used while the socket has NEVER opened. A live endpoint that is
 * down comes back, so the normal 30s cap stays in place after a connection has
 * worked at least once; a socket that has never opened at all (wrong/missing
 * endpoint, backend outage at launch) must not make every installed app retry
 * around the clock, so from the sixth consecutive attempt the cap becomes 5
 * minutes. The first successful open resets everything to the fast ladder.
 */
export const RECONNECT_NEVER_OPENED_MAX_MS = 300_000;
/** Consecutive failed attempts still on the normal ladder before the raise. */
export const RECONNECT_NEVER_OPENED_ATTEMPTS = 5;
/** 1s << 9 == 512s, past the 5-minute cap — no need to keep doubling. */
const RECONNECT_MAX_EXPONENT = 9;

/** The close code the server uses for a missing/invalid/expired/revoked token. */
export const AUTH_FAILURE_CLOSE_CODE = 1008;
/**
 * Consecutive 1008 closes tolerated before the session is declared dead. The
 * second one arrives right after a *successful* refresh, which means the server
 * is still refusing the token — stop instead of looping forever.
 */
export const MAX_CONSECUTIVE_AUTH_CLOSES = 2;

/** Minimal shape of the platform WebSocket this service drives. */
export interface RealtimeSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data?: unknown }) => void) | null;
}

export type RealtimeEventHandler = (event: RealtimeEvent) => void;
export type RealtimeStatusListener = (status: RealtimeStatus) => void;
export type RealtimeReconnectListener = () => void;

/** Opaque handle returned by the injected scheduler (a platform timer id). */
export type RetryHandle = unknown;

export interface RealtimeConfig {
  /** wss://…/api/v1/ws?token=… built from the app's REST base URL. */
  buildUrl: (accessToken: string) => string;
  /** Reads the CURRENT access token from auth storage. Called at EVERY (re)connect. */
  getToken: () => Promise<string | null>;
  /**
   * Access-token refresh, through the app's existing single-flight mechanism
   * (the same one REST's 401 interceptor uses). Resolves with the new access
   * token, or null when the session could not be restored.
   */
  refreshToken: () => Promise<string | null>;
  /** The app's existing session-expired / logout path. */
  onAuthFailure: () => void;
  socketFactory: (url: string) => RealtimeSocketLike;
  scheduleRetry: (run: () => void, delayMs: number) => RetryHandle;
  cancelRetry: (handle: RetryHandle) => void;
  /** Injectable for deterministic jitter in tests (defaults to Math.random). */
  random?: () => number;
}

/**
 * Derive the realtime URL from the REST base URL.
 *
 * https -> wss, http -> ws, any trailing slash is trimmed, and the token is
 * percent-encoded (the URL is never logged by this module).
 */
export function buildRealtimeUrl(baseUrl: string, accessToken: string, path = REALTIME_PATH): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const socketBase = trimmed.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  return `${socketBase}${path}?token=${encodeURIComponent(accessToken)}`;
}

/**
 * True for the job ids the protocol accepts: a finite JSON NUMBER, integer.
 * Named apart from lib/jobPublish's `isValidJobId` (REST path ids) on purpose.
 */
export function isValidRealtimeJobId(jobId: unknown): jobId is number {
  return typeof jobId === 'number' && Number.isFinite(jobId) && Number.isInteger(jobId);
}

/** Commands the client is allowed to send (the guide documents no others). */
export type RealtimeCommand = 'watch_job' | 'unwatch_job';

export class RealtimeService {
  private readonly config: RealtimeConfig;
  private readonly random: () => number;

  private status: RealtimeStatus = 'idle';
  private readonly statusListeners = new Set<RealtimeStatusListener>();
  private readonly handlers = new Map<string, Set<RealtimeEventHandler>>();
  private readonly reconnectListeners = new Set<RealtimeReconnectListener>();

  /**
   * DESIRED watches: job id -> reference count. Kept while the socket is down
   * (re-sent on the next open) and held per job id so two screens watching the
   * same job cannot unwatch each other.
   */
  private readonly watches = new Map<number, number>();

  private socket: RealtimeSocketLike | null = null;
  /**
   * Connection epoch: bumped whenever a socket is created or abandoned. Every
   * socket callback captures the epoch it belongs to, so a late message/close
   * from a socket that was replaced (reconnect, pause, account switch) is
   * dropped instead of corrupting the current connection's state.
   */
  private epoch = 0;
  private attempt = 0;
  private authCloses = 0;
  private retryHandle: RetryHandle | null = null;
  /** Synchronous "a connect attempt is in flight" latch — see connect(). */
  private opening = false;
  /** connect() was requested and the service has not been stopped since. */
  private started = false;
  /** The app is in the background: socket closed on purpose, no retry loop. */
  private paused = false;
  private everOpened = false;

  constructor(config: RealtimeConfig) {
    this.config = config;
    this.random = config.random ?? Math.random;
  }

  /* --------------------------------------------------------------- status */

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /** Subscribe to status changes. The current status is emitted immediately. */
  subscribeStatus(listener: RealtimeStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of Array.from(this.statusListeners)) {
      try {
        listener(next);
      } catch {
        // A bad listener must never stop the others (or the socket).
      }
    }
  }

  /* ------------------------------------------------------------ lifecycle */

  /**
   * Start (or retry) the connection. A no-op while a socket exists or a connect
   * attempt is already in flight, so two sockets can never be open at once.
   */
  connect(): void {
    this.started = true;
    if (this.paused) return;
    if (this.socket !== null || this.opening) return;
    void this.open();
  }

  /**
   * Full stop: logout, account switch or a dead session. Clears the desired
   * watches, cancels any scheduled retry, closes the socket on purpose and
   * makes every later event from the old epoch a no-op.
   */
  stop(): void {
    this.started = false;
    this.paused = false;
    this.cancelRetry();
    this.closeIntentionally();
    this.attempt = 0;
    this.authCloses = 0;
    this.everOpened = false;
    this.watches.clear();
    this.setStatus('stopped');
  }

  /** Alias of {@link stop} — the public "close and do not come back" verb. */
  disconnect(): void {
    this.stop();
  }

  /**
   * App went to the background. Closes on purpose (the server sees a normal
   * close, not the 1008 auth path) and parks in 'paused' — no retry loop runs
   * while the phone is asleep. Desired watches are KEPT for the resume.
   */
  pause(): void {
    if (!this.started) return;
    this.paused = true;
    this.cancelRetry();
    this.closeIntentionally();
    this.setStatus('paused');
  }

  /** App came back: reconnect immediately, with the backoff reset. */
  resume(): void {
    if (!this.started) return;
    const wasPaused = this.paused;
    this.paused = false;
    if (!wasPaused) return;
    this.attempt = 0;
    this.connect();
  }

  private async open(): Promise<void> {
    if (this.socket !== null || this.opening) return;
    this.opening = true;
    const epoch = ++this.epoch;
    this.setStatus(this.everOpened || this.attempt > 0 ? 'reconnecting' : 'connecting');
    try {
      const token = await this.config.getToken();
      // Something happened while the token was being read (stop, pause, an
      // account switch, a newer attempt): abandon this attempt.
      if (epoch !== this.epoch || !this.started || this.paused) return;
      if (token === null || token === '') {
        // No session to present at all: there is nothing to refresh, so stop
        // quietly. The auth layer owns whether the session is really over.
        this.started = false;
        this.setStatus('stopped');
        return;
      }

      const socket = this.config.socketFactory(this.config.buildUrl(token));
      this.socket = socket;
      socket.onopen = () => this.handleOpen(epoch);
      socket.onclose = (event) => this.handleClose(epoch, event);
      // onerror is observational only: reconnects are scheduled from onclose
      // alone, otherwise a socket that errors and then closes would schedule two.
      socket.onerror = () => undefined;
      socket.onmessage = (event) => this.handleMessage(epoch, event);
    } catch {
      // getToken/socketFactory threw: treat it as a failed attempt and retry on
      // the normal schedule rather than dying silently.
      if (epoch === this.epoch && this.started && !this.paused) this.scheduleReconnect();
    } finally {
      this.opening = false;
    }
  }

  private handleOpen(epoch: number): void {
    if (epoch !== this.epoch) return; // a stale socket opened late: ignore it
    this.attempt = 0; // backoff resets on a successful open
    this.authCloses = 0; // the token is accepted again
    this.everOpened = true;
    this.setStatus('open');
    // Every open — including the first — re-sends the desired watches (they
    // belong to the socket, so a reconnect needs them again) and then tells
    // listeners to refetch over REST.
    this.sendAllWatches();
    this.notifyReconnected();
  }

  private handleClose(epoch: number, event: { code?: number; reason?: string } | undefined): void {
    if (epoch !== this.epoch) return; // a stale socket closed late: ignore it
    const socket = this.socket;
    this.socket = null;
    if (socket) this.detach(socket);
    if (!this.started || this.paused) return; // stopped/paused on purpose
    if (event?.code === AUTH_FAILURE_CLOSE_CODE) {
      void this.recoverFromAuthFailure();
      return;
    }
    this.scheduleReconnect();
  }

  private handleMessage(epoch: number, event: { data?: unknown } | undefined): void {
    if (epoch !== this.epoch) return; // a late message from an old socket
    const parsed = parseRealtimeEnvelope(event?.data);
    if (parsed === null) return; // malformed JSON / envelope: ignored
    const listeners = this.handlers.get(parsed.type);
    if (!listeners || listeners.size === 0) return; // unknown type: ignored
    for (const handler of Array.from(listeners)) {
      try {
        handler(parsed);
      } catch {
        // One failing handler must never break the others.
      }
    }
  }

  /* ----------------------------------------------------- auth (close 1008) */

  private async recoverFromAuthFailure(): Promise<void> {
    this.authCloses += 1;
    if (this.authCloses >= MAX_CONSECUTIVE_AUTH_CLOSES) {
      // 1008 again right after a successful refresh: the session is not coming
      // back. Stop (clearing watches) and hand over to the app's own
      // session-expired path — never loop.
      this.stopAsAuthFailure();
      return;
    }
    if (!this.started || this.paused) return;

    let token: string | null = null;
    try {
      token = await this.config.refreshToken();
    } catch {
      token = null;
    }
    if (token === null || token === '') {
      this.stopAsAuthFailure();
      return;
    }
    if (!this.started || this.paused) return;

    // An explicit re-authentication restarts the backoff from 1s.
    this.attempt = 0;
    this.connect();
  }

  private stopAsAuthFailure(): void {
    this.stop();
    try {
      this.config.onAuthFailure();
    } catch {
      // The app's logout path must never break the socket state machine.
    }
  }

  /* ---------------------------------------------------------------- retry */

  private scheduleReconnect(): void {
    if (this.retryHandle !== null) return; // never double-schedule
    if (!this.started || this.paused) return;
    const delay = this.nextBackoffDelay();
    this.setStatus('reconnecting');
    this.retryHandle = this.config.scheduleRetry(() => {
      this.retryHandle = null;
      if (!this.started || this.paused) return;
      this.connect();
    }, delay);
  }

  /**
   * 1s, 2s, 4s … capped at 30s, with jitter: the returned delay is uniformly in
   * [base/2, base], so `random() === 1` yields the exact documented sequence.
   *
   * While the socket has never opened, the cap rises to 5 minutes from the sixth
   * consecutive attempt (see RECONNECT_NEVER_OPENED_MAX_MS).
   */
  private nextBackoffDelay(): number {
    const exponent = Math.min(this.attempt, RECONNECT_MAX_EXPONENT);
    const cap =
      this.everOpened || this.attempt < RECONNECT_NEVER_OPENED_ATTEMPTS
        ? RECONNECT_MAX_MS
        : RECONNECT_NEVER_OPENED_MAX_MS;
    const base = Math.min(cap, RECONNECT_BASE_MS * 2 ** exponent);
    this.attempt = Math.min(exponent + 1, RECONNECT_MAX_EXPONENT + 1);
    const sample = this.random();
    const jitter = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 1;
    return Math.round(base / 2 + (base / 2) * jitter);
  }

  private cancelRetry(): void {
    if (this.retryHandle === null) return;
    const handle = this.retryHandle;
    this.retryHandle = null;
    this.config.cancelRetry(handle);
  }

  /**
   * Close on purpose: detach the handlers (so the close event never reaches the
   * reconnect logic), bump the epoch (so any late event from it is ignored) and
   * then close. This is what makes an intentional close never reconnect.
   */
  private closeIntentionally(): void {
    const socket = this.socket;
    this.socket = null;
    this.epoch += 1;
    if (!socket) return;
    this.detach(socket);
    try {
      socket.close();
    } catch {
      // A socket that refuses to close is not a reason to keep the app stuck.
    }
  }

  private detach(socket: RealtimeSocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  /* --------------------------------------------------------------- watches */

  /**
   * Watch a job for its bidding events. Reference-counted per job id and kept
   * even while the socket is down — the desired set is (re)sent on every open.
   * Non-integer/non-finite ids are ignored (the server ignores them too).
   */
  watchJob(jobId: number): void {
    if (!isValidRealtimeJobId(jobId)) return;
    const count = this.watches.get(jobId) ?? 0;
    this.watches.set(jobId, count + 1);
    // Only the FIRST watcher of a job sends the command: an already-watched job
    // is left alone (the extra reference is what keeps the watch alive for the
    // other screen). A reconnect re-sends every desired watch regardless.
    if (count === 0 && this.status === 'open') this.sendCommand('watch_job', jobId);
  }

  /**
   * Release one watcher of a job. The unwatch command is only sent when the last
   * watcher releases it; unknown ids are a no-op.
   */
  unwatchJob(jobId: number): void {
    if (!isValidRealtimeJobId(jobId)) return;
    const count = this.watches.get(jobId);
    if (count === undefined) return;
    if (count > 1) {
      this.watches.set(jobId, count - 1);
      return;
    }
    this.watches.delete(jobId);
    if (this.status === 'open') this.sendCommand('unwatch_job', jobId);
  }

  private sendAllWatches(): void {
    for (const jobId of Array.from(this.watches.keys())) {
      this.sendCommand('watch_job', jobId);
    }
  }

  private sendCommand(action: RealtimeCommand, jobId: number): void {
    const socket = this.socket;
    if (!socket || this.status !== 'open' || !isValidRealtimeJobId(jobId)) return;
    try {
      // job_id must go out as a JSON NUMBER — the server silently ignores strings.
      socket.send(JSON.stringify({ action, job_id: jobId }));
    } catch {
      // A send on a socket that just died is not fatal: onclose drives recovery.
    }
  }

  /* ----------------------------------------------------------- subscribers */

  /**
   * Subscribe to one event type. Returns an unsubscribe function. Malformed or
   * unknown messages never reach a handler (see handleMessage).
   */
  on(type: string, handler: RealtimeEventHandler): () => void {
    if (typeof type !== 'string' || type.length === 0 || typeof handler !== 'function') {
      return () => undefined;
    }
    let listeners = this.handlers.get(type);
    if (!listeners) {
      listeners = new Set<RealtimeEventHandler>();
      this.handlers.set(type, listeners);
    }
    listeners.add(handler);
    return () => {
      const current = this.handlers.get(type);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(type);
    };
  }

  /**
   * Subscribe to every (re)open, including the first one. Screens use this to
   * refetch their REST data, because events are never stored and a missed event
   * is lost.
   */
  onReconnected(listener: RealtimeReconnectListener): () => void {
    if (typeof listener !== 'function') return () => undefined;
    this.reconnectListeners.add(listener);
    return () => {
      this.reconnectListeners.delete(listener);
    };
  }

  private notifyReconnected(): void {
    for (const listener of Array.from(this.reconnectListeners)) {
      try {
        listener();
      } catch {
        // A failing listener must never break the others.
      }
    }
  }
}

/** Build a service. The app wires the platform pieces in; tests wire fakes. */
export function createRealtimeService(config: RealtimeConfig): RealtimeService {
  return new RealtimeService(config);
}
