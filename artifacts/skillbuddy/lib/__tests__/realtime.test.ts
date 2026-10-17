/**
 * Unit tests for the shared realtime WebSocket layer (lib/realtime.ts).
 *
 * Run through the project's own harness: `pnpm run test` (there is no
 * jest/vitest in this workspace). No React, no network, no real timers: the
 * service takes an injected socket factory and scheduler, so the whole state
 * machine — backoff, epoch, watches, 1008 recovery, pause/resume — is driven
 * deterministically here. The live server behaviour is probed separately by a
 * throwaway script (see .freebuff/livetest/), never by these tests.
 */
import {
  AUTH_FAILURE_CLOSE_CODE,
  MAX_CONSECUTIVE_AUTH_CLOSES,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  RECONNECT_NEVER_OPENED_ATTEMPTS,
  RECONNECT_NEVER_OPENED_MAX_MS,
  buildRealtimeUrl,
  createRealtimeService,
  isValidRealtimeJobId,
  type RealtimeConfig,
  type RealtimeService,
  type RealtimeSocketLike,
} from '../realtime';
import type { RealtimeEvent } from '../realtimeEvents';

declare const console: { log: (msg: string) => void };

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(
    `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    actual === expected
  );
}

/** Drain pending microtasks (no wall-clock timers anywhere in these tests). */
async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/* ------------------------------------------------------------------ doubles */

class FakeSocket implements RealtimeSocketLike {
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data?: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  openFromServer(): void {
    if (this.onopen) this.onopen(null);
  }

  closeFromServer(code?: number): void {
    if (this.onclose) this.onclose({ code });
  }

  message(data: unknown): void {
    if (this.onmessage) this.onmessage({ data });
  }

  commands(): { action: string; job_id: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

interface FakeRetry {
  run: () => void;
  delayMs: number;
  cancelled: boolean;
}

class Harness {
  readonly sockets: FakeSocket[] = [];
  readonly retries: FakeRetry[] = [];
  readonly urls: string[] = [];
  readonly service: RealtimeService;
  token: string | null = 'access-token-1';
  tokenReads = 0;
  refreshQueue: (string | null)[] = [];
  refreshCalls = 0;
  authFailures = 0;
  random = 1;

  constructor(overrides: Partial<RealtimeConfig> = {}) {
    const config: RealtimeConfig = {
      buildUrl: (accessToken) => {
        const url = buildRealtimeUrl('https://api.skillbuddy.zeyshan.com', accessToken);
        this.urls.push(url);
        return url;
      },
      getToken: async () => {
        this.tokenReads += 1;
        return this.token;
      },
      refreshToken: async () => {
        this.refreshCalls += 1;
        const next = this.refreshQueue.length > 0 ? (this.refreshQueue.shift() as string | null) : null;
        // The real refresh (services/api.ts) writes the rotated tokens to
        // SecureStore; the socket then re-reads the access token from storage.
        if (next) this.token = next;
        return next;
      },
      onAuthFailure: () => {
        this.authFailures += 1;
      },
      socketFactory: () => {
        const socket = new FakeSocket();
        this.sockets.push(socket);
        return socket;
      },
      scheduleRetry: (run, delayMs) => {
        const handle: FakeRetry = { run, delayMs, cancelled: false };
        this.retries.push(handle);
        return handle;
      },
      cancelRetry: (handle) => {
        (handle as FakeRetry).cancelled = true;
      },
      random: () => this.random,
      ...overrides,
    };
    this.service = createRealtimeService(config);
  }

  get socket(): FakeSocket {
    return this.sockets[this.sockets.length - 1];
  }

  delays(): number[] {
    return this.retries.map((retry) => retry.delayMs);
  }

  runLastRetry(): void {
    const retry = this.retries[this.retries.length - 1];
    retry.run();
  }
}

/* ------------------------------------------------------------------- runner */

async function main(): Promise<void> {
  /* =============================================== ws/wss URL from the base */

  eq(
    'https base becomes wss with the documented path and query',
    buildRealtimeUrl('https://api.skillbuddy.zeyshan.com', 'abc'),
    'wss://api.skillbuddy.zeyshan.com/api/v1/ws?token=abc'
  );
  eq(
    'http base becomes ws (local/dev backends)',
    buildRealtimeUrl('http://10.0.0.5:8000', 'abc'),
    'ws://10.0.0.5:8000/api/v1/ws?token=abc'
  );
  eq(
    'trailing slashes on the base URL are trimmed',
    buildRealtimeUrl('https://h.test///', 'abc'),
    'wss://h.test/api/v1/ws?token=abc'
  );
  eq(
    'the token is percent-encoded',
    buildRealtimeUrl('https://h.test', 'a b+c/d&e=f'),
    'wss://h.test/api/v1/ws?token=a%20b%2Bc%2Fd%26e%3Df'
  );
  check(
    'the URL always follows the base URL host (never a hardcoded one)',
    buildRealtimeUrl('http://127.0.0.1:9000', 'x').startsWith('ws://127.0.0.1:9000/')
  );

  /* ================================================== numeric job id guard */

  check('a finite integer job id is valid', isValidRealtimeJobId(42) === true);
  check('a negative integer is still a valid JSON number', isValidRealtimeJobId(-3) === true);
  check('a string job id is rejected', isValidRealtimeJobId('42') === false);
  check('a float job id is rejected', isValidRealtimeJobId(4.5) === false);
  check('NaN is rejected', isValidRealtimeJobId(Number.NaN) === false);
  check('Infinity is rejected', isValidRealtimeJobId(Number.POSITIVE_INFINITY) === false);
  check('null is rejected', isValidRealtimeJobId(null) === false);

  /* =============================== connect: one socket, watches, URL, token */

  const a = new Harness();
  const statuses: string[] = [];
  a.service.subscribeStatus((status) => statuses.push(status));

  a.service.watchJob(7);
  eq('watching while there is no socket sends nothing', a.sockets.length, 0);

  a.service.connect();
  a.service.connect(); // must not open a second socket
  await settle();
  eq('two connect() calls produce exactly one socket', a.sockets.length, 1);
  eq('the token is read at connect time', a.tokenReads, 1);
  eq(
    'the socket URL is built from the current token',
    a.urls[0],
    'wss://api.skillbuddy.zeyshan.com/api/v1/ws?token=access-token-1'
  );
  eq('status is connecting before open', a.service.getStatus(), 'connecting');

  let reconnects = 0;
  a.service.onReconnected(() => {
    reconnects += 1;
  });

  a.socket.openFromServer();
  eq('status is open after the handshake', a.service.getStatus(), 'open');
  eq(
    'the desired watch is sent on the FIRST open too',
    JSON.stringify(a.socket.commands()),
    JSON.stringify([{ action: 'watch_job', job_id: 7 }])
  );
  check(
    'job_id goes out as a JSON number, never a string',
    typeof a.socket.commands()[0].job_id === 'number'
  );
  eq('onReconnected fires on the first open', reconnects, 1);

  a.service.connect();
  eq('connect() while open is a no-op (never two sockets)', a.sockets.length, 1);

  /* ============================================ watch/unwatch ref counting */

  const b = new Harness();
  b.service.connect();
  await settle();
  b.socket.openFromServer();

  b.service.watchJob(3);
  eq('a first watcher sends one watch_job', b.socket.sent.length, 1);
  b.service.watchJob(3);
  eq('a second watcher of the same job sends nothing', b.socket.sent.length, 1);
  b.service.unwatchJob(3);
  eq('the first unwatch keeps the watch (other screen still watching)', b.socket.sent.length, 1);
  b.service.unwatchJob(3);
  eq('the last unwatch sends unwatch_job', b.socket.sent.length, 2);
  eq(
    'unwatch_job carries the numeric job id',
    JSON.stringify(b.socket.commands()[1]),
    JSON.stringify({ action: 'unwatch_job', job_id: 3 })
  );
  b.service.unwatchJob(3);
  eq('an extra unwatch of an unknown job sends nothing', b.socket.sent.length, 2);
  b.service.watchJob(3.5 as unknown as number);
  b.service.watchJob('9' as unknown as number);
  eq('non-numeric job ids are never sent to the server', b.socket.sent.length, 2);

  /* ============================= watches survive a drop and are re-sent on open */

  const c = new Harness();
  let cReconnects = 0;
  c.service.onReconnected(() => {
    cReconnects += 1;
  });
  c.service.connect();
  await settle();
  c.socket.openFromServer();
  eq('onReconnected fires on the first open', cReconnects, 1);
  c.service.watchJob(11);
  c.service.watchJob(12);
  eq('both jobs are watched while open', c.socket.sent.length, 2);

  const firstSocket = c.socket;
  firstSocket.closeFromServer(1006);
  eq('a drop schedules exactly one reconnect', c.retries.length, 1);
  eq('the first retry waits the base backoff', c.delays()[0], RECONNECT_BASE_MS);
  eq('status is reconnecting while waiting', c.service.getStatus(), 'reconnecting');

  c.runLastRetry();
  await settle();
  eq('the retry opens a fresh socket', c.sockets.length, 2);
  c.socket.openFromServer();
  eq(
    'BOTH desired watches are re-sent after the reconnect',
    JSON.stringify(c.socket.commands()),
    JSON.stringify([
      { action: 'watch_job', job_id: 11 },
      { action: 'watch_job', job_id: 12 },
    ])
  );
  eq('onReconnected fires again on every reconnect', cReconnects, 2);

  /* ===================================================== backoff + jitter */

  const d = new Harness();
  d.service.connect();
  await settle();
  const EXPECTED = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
  const observed: number[] = [];
  d.socket.openFromServer();
  for (let i = 0; i < EXPECTED.length; i += 1) {
    const current = d.socket;
    current.closeFromServer(1006);
    observed.push(d.delays()[d.delays().length - 1]);
    d.runLastRetry();
    await settle();
  }
  eq(
    'backoff doubles 1s..30s then stays capped at 30s',
    observed.join(','),
    EXPECTED.join(',')
  );
  eq('the cap is the documented 30s', RECONNECT_MAX_MS, 30000);

  // A successful open resets the backoff to the base delay.
  const resetHarness = new Harness();
  resetHarness.service.connect();
  await settle();
  resetHarness.socket.closeFromServer(1006);
  resetHarness.runLastRetry();
  await settle();
  resetHarness.socket.openFromServer();
  resetHarness.socket.closeFromServer(1006);
  eq('a successful open resets the backoff to 1s', resetHarness.delays().join(','), '1000,1000');

  const jittered = new Harness();
  jittered.random = 0;
  jittered.service.connect();
  await settle();
  jittered.socket.closeFromServer(1006);
  eq(
    'jitter keeps the delay inside [base/2, base]',
    jittered.delays()[0],
    RECONNECT_BASE_MS / 2
  );

  /* ============== never-opened endpoint: the cap is raised to 5 minutes ===== */

  const neverOpened = new Harness();
  neverOpened.service.connect();
  await settle();
  const NEVER_OPENED_EXPECTED = [
    1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000,
  ];
  const neverOpenedDelays: number[] = [];
  for (let i = 0; i < NEVER_OPENED_EXPECTED.length; i += 1) {
    neverOpened.socket.closeFromServer(1006);
    neverOpenedDelays.push(neverOpened.delays()[neverOpened.delays().length - 1]);
    neverOpened.runLastRetry();
    await settle();
  }
  eq(
    'a socket that never opened uses the normal 1s..16s ladder first',
    neverOpenedDelays.slice(0, 5).join(','),
    '1000,2000,4000,8000,16000'
  );
  eq(
    'from the sixth attempt the cap is raised (no 30s plateau)',
    neverOpenedDelays.join(','),
    NEVER_OPENED_EXPECTED.join(',')
  );
  eq(
    'the raised cap is exactly 5 minutes',
    RECONNECT_NEVER_OPENED_MAX_MS,
    300000
  );
  eq(
    'the raise happens after the fifth consecutive attempt',
    RECONNECT_NEVER_OPENED_ATTEMPTS,
    5
  );
  eq(
    'the never-opened ladder never exceeds 5 minutes',
    Math.max(...neverOpenedDelays) <= RECONNECT_NEVER_OPENED_MAX_MS,
    true
  );
  eq(
    'the previous 30s cap is no longer used once the cap is raised',
    neverOpenedDelays.slice(5).every((delay) => delay > RECONNECT_MAX_MS),
    true
  );

  // Coming back to the app retries fast again.
  neverOpened.service.pause();
  neverOpened.service.resume();
  await settle();
  neverOpened.socket.closeFromServer(1006);
  eq(
    'foregrounding restarts the fast ladder',
    neverOpened.delays()[neverOpened.delays().length - 1],
    RECONNECT_BASE_MS
  );

  // One successful open restores the ordinary 30s cap forever after.
  const openedThenDropped = new Harness();
  openedThenDropped.service.connect();
  await settle();
  openedThenDropped.socket.openFromServer();
  const afterOpen: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    openedThenDropped.socket.closeFromServer(1006);
    afterOpen.push(openedThenDropped.delays()[openedThenDropped.delays().length - 1]);
    openedThenDropped.runLastRetry();
    await settle();
  }
  eq(
    'after it opened once, drops cap at 30s again (never 5 minutes)',
    afterOpen.join(','),
    '1000,2000,4000,8000,16000,30000,30000'
  );

  /* ============================== only onclose schedules; never double-schedule */

  const e = new Harness();
  e.service.connect();
  await settle();
  e.socket.openFromServer();
  if (e.socket.onerror) e.socket.onerror({ message: 'transport blip' });
  eq('onerror alone never schedules a reconnect', e.retries.length, 0);
  eq('onerror alone leaves the socket open', e.service.getStatus(), 'open');

  const lateClose = e.socket.onclose;
  e.socket.closeFromServer(1006);
  eq('the close schedules one reconnect', e.retries.length, 1);
  if (lateClose) lateClose({ code: 1006 });
  eq('a repeated close event cannot double-schedule', e.retries.length, 1);

  /* ================================== 1008 -> refresh -> reconnect, then stop */

  const f = new Harness();
  f.refreshQueue = ['access-token-2', 'access-token-3'];
  f.service.connect();
  await settle();
  f.socket.openFromServer();

  f.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE);
  await settle();
  eq('close 1008 refreshes the token exactly once', f.refreshCalls, 1);
  eq('1008 does not use the backoff timer', f.retries.length, 0);
  eq('the reconnected socket reads the token again', f.tokenReads, 2);
  eq(
    'the reconnect uses the refreshed token',
    f.urls[1],
    'wss://api.skillbuddy.zeyshan.com/api/v1/ws?token=access-token-2'
  );
  eq('no logout while a refresh can still fix it', f.authFailures, 0);

  // A successful open after the refresh clears the streak …
  f.socket.openFromServer();
  eq('a successful open clears the 1008 streak', f.service.getStatus(), 'open');
  f.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE);
  await settle();
  eq('another isolated 1008 still refreshes rather than giving up', f.refreshCalls, 2);
  eq('that isolated 1008 did not stop the session', f.authFailures, 0);
  eq('the session is reconnecting again, not stopped', f.service.getStatus(), 'reconnecting');

  // … but a SECOND 1008 in a row, right after a successful refresh, stops.
  const g = new Harness();
  g.refreshQueue = ['access-token-2', 'access-token-3'];
  g.service.connect();
  await settle();
  g.socket.openFromServer();
  g.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE);
  await settle();
  eq('the first 1008 refreshes', g.refreshCalls, 1);
  g.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE); // no successful open in between
  await settle();
  eq('the second 1008 in a row does NOT refresh again', g.refreshCalls, 1);
  eq('the second 1008 in a row triggers the logout path', g.authFailures, 1);
  eq('the service stops instead of looping', g.service.getStatus(), 'stopped');
  eq('the tolerated streak is exactly one retry', MAX_CONSECUTIVE_AUTH_CLOSES, 2);

  eq('the auth-failure stop never arms a backoff retry', g.retries.length, 0);

  /* ======================================= refresh failure -> stop + logout */

  const h = new Harness();
  h.refreshQueue = [null];
  h.service.connect();
  await settle();
  h.socket.openFromServer();
  h.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE);
  await settle();
  eq('a refresh that yields no token stops the service', h.service.getStatus(), 'stopped');
  eq('a failed refresh triggers the logout path', h.authFailures, 1);

  const i = new Harness({
    refreshToken: async () => {
      throw new Error('refresh endpoint unreachable');
    },
  });
  i.service.connect();
  await settle();
  i.socket.openFromServer();
  i.socket.closeFromServer(AUTH_FAILURE_CLOSE_CODE);
  await settle();
  eq('a throwing refresh stops the service', i.service.getStatus(), 'stopped');
  eq('a throwing refresh triggers the logout path', i.authFailures, 1);

  const missingToken = new Harness();
  missingToken.token = null;
  missingToken.service.connect();
  await settle();
  eq('no stored token means no socket is created', missingToken.sockets.length, 0);
  eq('no stored token means no refresh storm', missingToken.refreshCalls, 0);
  eq('status ends stopped when there is no session', missingToken.service.getStatus(), 'stopped');
  eq('no session is not treated as a logout event', missingToken.authFailures, 0);

  /* ============================================== intentional close / pause */

  const j = new Harness();
  j.service.connect();
  await settle();
  j.socket.openFromServer();
  const pausedSocket = j.socket;
  const staleMessage = pausedSocket.onmessage;
  j.service.pause();
  eq('pause closes the socket on purpose', pausedSocket.closedWith !== null, true);
  eq('pause reports the paused status', j.service.getStatus(), 'paused');
  eq('pause schedules no retry', j.retries.length, 0);
  if (staleMessage) staleMessage({ data: JSON.stringify({ type: 'bid.created', data: {}, timestamp: '' }) });
  j.socket.openFromServer();
  eq('events from the paused socket are ignored', j.service.getStatus(), 'paused');
  eq('pausing never opens another socket', j.sockets.length, 1);

  j.service.resume();
  await settle();
  eq('resume reconnects immediately', j.sockets.length, 2);
  j.socket.openFromServer();
  eq('status is open again after resume', j.service.getStatus(), 'open');
  j.socket.closeFromServer(1006);
  eq('resume resets the backoff to the base delay', j.delays()[0], RECONNECT_BASE_MS);

  const k = new Harness();
  k.service.connect();
  await settle();
  k.socket.openFromServer();
  const stopSocket = k.socket;
  const staleClose = stopSocket.onclose;
  k.service.disconnect();
  eq('disconnect closes the socket on purpose', stopSocket.closedWith !== null, true);
  eq('disconnect reports the stopped status', k.service.getStatus(), 'stopped');
  if (staleClose) staleClose({ code: 1006 });
  eq('an intentional close never reconnects', k.retries.length, 0);

  /* ======================================= account switch: watches are dropped */

  const l = new Harness();
  l.service.connect();
  await settle();
  l.socket.openFromServer();
  l.service.watchJob(5);
  eq('the old account watches its job', l.socket.sent.length, 1);
  l.service.stop(); // logout / account switch
  l.service.connect();
  await settle();
  l.socket.openFromServer();
  eq('the new session inherits NO watches from the old account', l.socket.sent.length, 0);
  l.service.watchJob(9);
  eq('the new session can watch its own job', l.socket.sent.length, 1);
  eq(
    'the new session sends the new job id',
    l.socket.commands()[0].job_id,
    9
  );

  /* ================================== late events from an old epoch are dropped */

  const m = new Harness();
  const received: RealtimeEvent[] = [];
  m.service.on('bid.created', (event) => received.push(event));
  m.service.connect();
  await settle();
  const oldSocket = m.socket;
  const oldMessage = oldSocket.onmessage;
  m.socket.openFromServer();
  const VALID = JSON.stringify({
    type: 'bid.created',
    data: {
      job_id: 1,
      bid_id: 2,
      provider_id: 3,
      offered_price: '25.50',
      eta_minutes: 45,
      total_score: 12.5,
    },
    timestamp: '2026-10-13T12:00:00Z',
  });
  if (oldMessage) oldMessage({ data: VALID });
  eq('an event from the current socket reaches the handler', received.length, 1);

  m.service.stop();
  m.service.connect();
  await settle();
  m.socket.openFromServer();
  if (oldMessage) oldMessage({ data: VALID });
  eq('a late event from the pre-switch socket is dropped', received.length, 1);
  m.socket.message(VALID);
  eq('the current socket still delivers', received.length, 2);

  /* ================================ envelope validation + handler isolation */

  const n = new Harness();
  const bids: RealtimeEvent[] = [];
  const nearby: RealtimeEvent[] = [];
  const undefinedTypes: RealtimeEvent[] = [];
  const seen: string[] = [];
  n.service.on('bid.created', (event) => {
    seen.push('first');
    throw new Error('a broken handler');
  });
  n.service.on('bid.created', (event) => {
    seen.push('second');
    bids.push(event);
  });
  n.service.on('job.nearby_opened', (event) => nearby.push(event));
  n.service.on('payment.succeeded', (event) => undefinedTypes.push(event));
  n.service.connect();
  await settle();
  n.socket.openFromServer();

  n.socket.message('{ this is not json');
  n.socket.message(undefined);
  n.socket.message(JSON.stringify([1, 2, 3]));
  n.socket.message(JSON.stringify({ data: { job_id: 1 }, timestamp: 't' }));
  n.socket.message(JSON.stringify({ type: 7, data: { job_id: 1 } }));
  n.socket.message(JSON.stringify({ type: 'bid.created' }));
  n.socket.message(JSON.stringify({ type: 'bid.created', data: 'nope' }));
  n.socket.message(JSON.stringify({ type: 'bid.created', data: null }));
  eq('malformed JSON is ignored', bids.length, 0);
  eq('a non-string frame is ignored', bids.length, 0);
  eq('a JSON array is not an envelope', bids.length, 0);
  eq('an envelope without a type is ignored', bids.length, 0);
  eq('a non-string type is ignored', bids.length, 0);
  eq('an envelope without data is ignored', bids.length, 0);
  eq('a non-object data is ignored', bids.length, 0);
  eq('a null data is ignored', bids.length, 0);

  n.socket.message(JSON.stringify({ type: 'job.bidding_closed', data: { job_id: 1 }, timestamp: 't' }));
  eq('an event with no listener is ignored', nearby.length, 0);

  n.socket.message(
    JSON.stringify({ type: 'job.nearby_opened', data: { job_id: 4, distance_km: 2.5 }, timestamp: 't' })
  );
  eq('the listener for its own type is called', nearby.length, 1);
  eq('a documented event is not misrouted', bids.length, 0);

  n.socket.message(VALID);
  eq('a throwing handler never blocks the others', seen.join(','), 'first,second');
  eq('the good handler still received the event', bids.length, 1);
  eq('the parsed event keeps its type', bids[0].type, 'bid.created');
  eq(
    'money-like values stay decimal strings',
    typeof (bids[0].data as { offered_price?: unknown }).offered_price,
    'string'
  );

  n.socket.message(JSON.stringify({ type: 'payment.succeeded', data: { amount: '1.00' }, timestamp: 't' }));
  eq('an undocumented type reaches only an explicit listener for it', undefinedTypes.length, 1);

  /* ====================================================== status subscribing */

  const o = new Harness();
  const seenStatuses: string[] = [];
  const unsubscribe = o.service.subscribeStatus((status) => seenStatuses.push(status));
  eq('subscribeStatus emits the current status immediately', seenStatuses.join(','), 'idle');
  o.service.connect();
  await settle();
  o.socket.openFromServer();
  eq('status transitions are published', seenStatuses.join(','), 'idle,connecting,open');
  unsubscribe();
  o.socket.closeFromServer(1006);
  eq('an unsubscribed listener hears nothing more', seenStatuses.join(','), 'idle,connecting,open');

  /* ------------------------------------------------ a stopped service is inert */

  o.service.stop();
  eq('stop reports stopped', o.service.getStatus(), 'stopped');
  o.service.pause();
  eq('pausing a stopped service is a no-op', o.service.getStatus(), 'stopped');
  o.service.resume();
  await settle();
  eq('resuming a stopped service does not reconnect', o.sockets.length, 1);

  /* ------------------------------------------------------------------ report */

  for (const failure of failures) console.log(`  x ${failure}`);
  console.log(`realtime: ${passed}/${passed + failures.length} assertions passed`);
}

void main();
