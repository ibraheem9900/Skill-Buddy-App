/**
 * Unit tests for the money side of the realtime layer (lib/moneyEvents.ts):
 * typing, the safe payload accessors, the event -> refresh map, de-duplication,
 * the debounce band, the banner copy and the resync.
 *
 * Every envelope below is SYNTHETIC and shaped exactly like the shared envelope
 * `{ type, data, timestamp }` (lib/realtimeEvents.parseRealtimeEnvelope validates
 * it first, so these run through the same path a socket frame takes). The guide
 * documents no payload fields, so the tests also pin what happens when the data
 * is empty, wrong-typed, or carries only half of an amount.
 *
 * Run through the project's own harness: `pnpm run test`. Pure functions only.
 */
import { parseRealtimeEnvelope } from '../realtimeEvents';
import { debounce } from '../debounce';
import {
  MONEY_BANNER_COPY,
  MONEY_DEDUPE_WINDOW_MS,
  MONEY_EVENT_TYPES,
  MONEY_REFRESH_TARGETS,
  applyMoneyRefreshPlan,
  createMoneyEventDeduper,
  emitMoneyRefresh,
  formatMoneyAmount,
  isMoneyEventType,
  moneyBannerContent,
  moneyBannerTarget,
  moneyEventAmount,
  moneyEventIds,
  moneyEventKey,
  moneyRefreshBusSize,
  moneyRefreshPlan,
  moneyResyncPlan,
  planTouchesJob,
  resetMoneyRefreshBus,
  subscribeMoneyRefresh,
  type MoneyEventPlan,
  type MoneyRefreshTarget,
} from '../moneyEvents';

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

function deepEq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(`${label} — expected ${b}, got ${a}`, a === b);
}

function envelope(type: string, data: unknown, timestamp = '2026-10-16T12:00:00Z'): string {
  return JSON.stringify({ type, data, timestamp });
}

/** Parse one synthetic frame the way the socket layer does, then plan it. */
function planFrame(type: string, data: unknown): MoneyEventPlan | null {
  const event = parseRealtimeEnvelope(envelope(type, data));
  if (event === null) return null;
  return moneyRefreshPlan(event.type, event.data);
}

/** A recording stand-in for the real helpers (no React, no network). */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      invalidateJobDetail: (jobId: number) => calls.push(`jobDetail:${jobId}`),
      invalidateJobList: () => calls.push('jobList'),
      resyncMyBids: () => calls.push('myBids'),
      refreshWallets: () => calls.push('wallet'),
    },
  };
}

/* ------------------------------------------------------------ the ten types */

eq('the guide names ten money events', MONEY_EVENT_TYPES.length, 10);
for (const type of MONEY_EVENT_TYPES) {
  check(`${type} is a money event type`, isMoneyEventType(type));
}
check('a bidding event is not a money event', !isMoneyEventType('bid.created'));
check('an invented money type is not documented', !isMoneyEventType('payment.received'));

/* --------------------------------------------- plan: target per event type */

const JOB_EVENT = { job_id: 42 };
const EXPECTED_TARGETS: Record<string, MoneyRefreshTarget[]> = {
  'payment.pending': ['jobDetail', 'jobList', 'myBids'],
  'payment.succeeded': ['jobDetail', 'jobList', 'myBids', 'wallet'],
  'payment.failed': ['jobDetail', 'jobList'],
  'payment.disputed': ['jobDetail', 'jobList'],
  'payment.refunded': ['jobDetail', 'jobList', 'wallet'],
  'invoice.created': ['jobDetail'],
  'invoice.overdue': ['jobDetail', 'jobList'],
  'escrow.release_scheduled': ['jobDetail', 'jobList'],
  'escrow.released': ['jobDetail', 'jobList', 'myBids', 'wallet'],
  'wallet.credit_earned': ['wallet'],
};

for (const type of MONEY_EVENT_TYPES) {
  const plan = planFrame(type, JOB_EVENT);
  eq(`${type} plans a known event`, plan?.known, true);
  deepEq(`${type} refreshes exactly`, plan?.targets, EXPECTED_TARGETS[type]);
  deepEq(`${type} carries the job id`, plan?.jobIds, [42]);
}

/* ------------------------------- every type: the exact reads it triggers */

for (const type of MONEY_EVENT_TYPES) {
  const rec = recorder();
  const plan = planFrame(type, JOB_EVENT)!;
  const ran = applyMoneyRefreshPlan(plan, rec.deps);
  const expected: string[] = [];
  for (const target of EXPECTED_TARGETS[type]) {
    expected.push(target === 'jobDetail' ? 'jobDetail:42' : target);
  }
  deepEq(`${type} runs exactly its own reads`, ran, EXPECTED_TARGETS[type]);
  deepEq(`${type} performs those calls`, rec.calls, expected);
}

/* ------------------------------------------- no identifier -> list fallback */

for (const type of ['payment.succeeded', 'invoice.overdue', 'escrow.released'] as const) {
  const plan = planFrame(type, {})!;
  check(`${type} with no id never names a job`, plan.jobIds !== null && plan.jobIds.length === 0);
  check(`${type} with no id falls back to the job list`, plan.targets.includes('jobList'));
  check(`${type} with no id does not invent a job read`, !plan.targets.includes('jobDetail'));
}
deepEq(
  'escrow.released with no id keeps the wallet read',
  planFrame('escrow.released', {})?.targets,
  ['jobList', 'myBids', 'wallet']
);
deepEq(
  'a wallet-only event with no id refreshes only the wallet',
  planFrame('wallet.credit_earned', {})?.targets,
  ['wallet']
);

/* ------------------------------------------------- unknown types are ignored */

for (const type of ['payment.received', 'invoice.sent', 'escrow.held', 'brand.new']) {
  const plan = planFrame(type, JOB_EVENT)!;
  eq(`${type} is not planned`, plan.known, false);
  deepEq(`${type} refreshes nothing at all`, plan.targets, []);
  const rec = recorder();
  deepEq(`${type} runs no read`, applyMoneyRefreshPlan(plan, rec.deps), []);
  deepEq(`${type} calls nothing`, rec.calls, []);
  eq(`${type} has no banner`, moneyBannerContent(type, JOB_EVENT, 1), null);
}

/* -------------------------------------------------------- malformed payloads */

const MALFORMED: unknown[] = [
  undefined,
  null,
  0,
  'a string',
  [],
  {},
  { job_id: '12' },
  { job_id: -3 },
  { job_id: 1.5 },
  { job_id: Number.NaN },
];
for (const data of MALFORMED) {
  let threw = false;
  let plan: MoneyEventPlan | null = null;
  try {
    plan = moneyRefreshPlan('payment.succeeded', data);
    moneyEventIds(data);
    moneyEventAmount(data);
    moneyBannerContent('payment.succeeded', data, 1);
    applyMoneyRefreshPlan(moneyRefreshPlan('escrow.released', data), {
      invalidateJobDetail: () => {},
      invalidateJobList: () => {},
      resyncMyBids: () => {},
      refreshWallets: () => {},
    });
  } catch {
    threw = true;
  }
  check(`malformed data ${JSON.stringify(data) ?? 'undefined'} does not throw`, !threw);
  check(`malformed data ${JSON.stringify(data) ?? 'undefined'} still plans its event`, plan?.known === true);
  deepEq(`malformed data ${JSON.stringify(data) ?? 'undefined'} reads no ids`, moneyEventIds(data), {
    jobId: null,
    bidId: null,
    invoiceId: null,
    paymentId: null,
  });
}

deepEq('a string id is not coerced', moneyEventIds({ job_id: '12' }).jobId, null);
deepEq('all four identifiers are read', moneyEventIds({ job_id: 1, bid_id: 2, invoice_id: 3, payment_id: 4 }), {
  jobId: 1,
  bidId: 2,
  invoiceId: 3,
  paymentId: 4,
});

/* ------------------------------------------------------------------ amounts */

eq('an amount with no currency is not readable', moneyEventAmount({ amount: '10.00' }), null);
eq('a currency with no amount is not readable', moneyEventAmount({ currency: 'EUR' }), null);
eq('a bad currency is not readable', moneyEventAmount({ amount: '10.00', currency: 'euros' }), null);
eq('a non-numeric amount is not readable', moneyEventAmount({ amount: 'ten', currency: 'EUR' }), null);
// A negative amount is a value the server chose to send (an adjustment or a
// refund line), so it is read and displayed truthfully with its sign rather than
// silently dropped.
deepEq('a negative amount is read as sent', moneyEventAmount({ amount: '-5', currency: 'EUR' }), {
  amount: '-5',
  currency: 'EUR',
});
check(
  'a negative amount keeps its sign when formatted',
  formatMoneyAmount({ amount: '-5', currency: 'EUR' }, 'en')?.includes('-') === true
);
deepEq('a decimal string with a currency is readable', moneyEventAmount({ amount: '10.50', currency: 'eur' }), {
  amount: '10.50',
  currency: 'EUR',
});
deepEq('a number amount with a currency is readable', moneyEventAmount({ amount: 12, currency: 'USD' }), {
  amount: '12',
  currency: 'USD',
});

const noAmountBanner = moneyBannerContent('payment.succeeded', { amount: '10.00', job_id: 5 }, 1)!;
eq('a banner shows no amount when the currency is missing', noAmountBanner.amount, null);
check('but it still shows the event', noAmountBanner.titleKey === 'money_evt_payment_succeeded');
const amountBanner = moneyBannerContent('escrow.released', { amount: '10.50', currency: 'EUR' }, 2)!;
deepEq('a banner keeps the amount it was given', amountBanner.amount, { amount: '10.50', currency: 'EUR' });
check(
  'an amount with a currency formats with the app locale',
  formatMoneyAmount({ amount: '1234.5', currency: 'EUR' }, 'en')?.includes('1,234.50') === true
);
eq('a null amount formats to null', formatMoneyAmount(null, 'en'), null);
check(
  'an unknown currency still prints the raw amount, never a wrong symbol',
  formatMoneyAmount({ amount: '10.00', currency: 'ZZZ' }, 'en')?.includes('10.00') === true
);

/* --------------------------------------------------------------- banner copy */

for (const type of MONEY_EVENT_TYPES) {
  const content = moneyBannerContent(type, JOB_EVENT, 1)!;
  eq(`${type} has its own translated line`, content.titleKey, MONEY_BANNER_COPY[type].titleKey);
  check(`${type} names the job it came with`, content.jobId === 42);
  check(`${type} has a stable animation key`, content.key.startsWith(`${type}:42:`));
}

check('no banner copy claims an amount', !Object.keys(MONEY_BANNER_COPY).some((k) =>
  JSON.stringify(MONEY_BANNER_COPY[k as keyof typeof MONEY_BANNER_COPY]).includes('{amount')
));

deepEq('a job event taps through to the job screen', moneyBannerTarget({ type: 'payment.failed', jobId: 9 }), {
  kind: 'job',
  jobId: 9,
});
deepEq('a wallet event with no job taps through to the wallet', moneyBannerTarget({ type: 'wallet.credit_earned', jobId: null }), {
  kind: 'wallet',
});
deepEq('a released escrow with no job also goes to the wallet', moneyBannerTarget({ type: 'escrow.released', jobId: null }), {
  kind: 'wallet',
});
eq(
  'an invoice event with no job has nowhere to go',
  moneyBannerTarget({ type: 'invoice.created', jobId: null }),
  null
);

/* ---------------------------------------------------------------- dedupe */

const deduper = createMoneyEventDeduper(MONEY_DEDUPE_WINDOW_MS);
const key = moneyEventKey('payment.succeeded', moneyEventIds({ job_id: 7 }));
eq('a fresh key is news', deduper.seen(key, 1_000), false);
eq('a repeat inside the window is not news', deduper.seen(key, 1_000 + MONEY_DEDUPE_WINDOW_MS - 1), true);
eq('the same key after the window is news again', deduper.seen(key, 1_000 + MONEY_DEDUPE_WINDOW_MS), false);
eq('a different id is separate news', deduper.seen(moneyEventKey('payment.succeeded', moneyEventIds({ job_id: 8 })), 2_000), false);
eq('a different type is separate news', deduper.seen(moneyEventKey('payment.failed', moneyEventIds({ job_id: 7 })), 2_001), false);
eq(
  'an id-less key dedupes on its own',
  deduper.seen(moneyEventKey('wallet.credit_earned', moneyEventIds({})), 3_000),
  false
);
check('the dedupe key ends with none when nothing was named', key === 'payment.succeeded:7');
const smallDeduper = createMoneyEventDeduper(MONEY_DEDUPE_WINDOW_MS, 2);
smallDeduper.seen('a', 1);
smallDeduper.seen('b', 1);
smallDeduper.seen('c', 1);
eq('the dedupe memory is bounded', smallDeduper.size(), 2);
smallDeduper.clear();
eq('clear() empties it', smallDeduper.size(), 0);
eq('an id-less event key reads none', moneyEventKey('invoice.created', moneyEventIds({})), 'invoice.created:none');

/* ------------------------------------------------- debounce: one burst, one refetch */

interface FakeTimer {
  id: number;
  run: () => void;
  delayMs: number;
}
const timers: FakeTimer[] = [];
let nextTimerId = 1;
const clock = {
  schedule: (run: () => void, delayMs: number) => {
    const id = nextTimerId++;
    timers.push({ id, run, delayMs });
    return id;
  },
  cancel: (handle: unknown) => {
    const index = timers.findIndex((timer) => timer.id === handle);
    if (index >= 0) timers.splice(index, 1);
  },
};
const flushed: MoneyEventPlan[] = [];
const burst = debounce<[MoneyEventPlan]>((plan) => flushed.push(plan), 350, clock);
burst(moneyRefreshPlan('payment.succeeded', JOB_EVENT));
burst(moneyRefreshPlan('escrow.release_scheduled', JOB_EVENT));
eq('a burst waits for silence', flushed.length, 0);
eq('the wait sits in the 300-500 ms band', timers[0]?.delayMs, 350);
runTimers();
eq('a burst produces ONE refetch', flushed.length, 1);
eq('the last event of the burst wins', flushed[0]?.type, 'escrow.release_scheduled');
burst.cancel();
eq('cancel() drops a pending refetch', timers.length, 0);

function runTimers(): void {
  const pending = timers.splice(0, timers.length);
  for (const timer of pending) timer.run();
}

/* ----------------------------------------------------------------- resync */

const resync = moneyResyncPlan();
eq('a resync is planned', resync.known, true);
deepEq('a resync re-reads everything', resync.targets, ['jobDetail', 'jobList', 'myBids', 'wallet']);
eq('a resync names no specific job', resync.jobIds, null);
check('a resync makes an open job screen re-read its own job', planTouchesJob(resync, 99) === true);
check('a named plan does not touch another job', planTouchesJob(moneyRefreshPlan('payment.failed', JOB_EVENT), 7) === false);
check('a named plan touches its own job', planTouchesJob(moneyRefreshPlan('payment.failed', JOB_EVENT), 42) === true);
check('a screen with no job never refetches', planTouchesJob(resync, null) === false);

/* ------------------------------------------------------------------- bus */

let seen: string[] = [];
const unsubscribeList = subscribeMoneyRefresh('jobList', (plan) => seen.push(`list:${plan.type}`));
const unsubscribeWallet = subscribeMoneyRefresh('wallet', (plan) => seen.push(`wallet:${plan.type}`));
eq('a target with one subscriber reports one', moneyRefreshBusSize('jobList'), 1);
emitMoneyRefresh(moneyRefreshPlan('payment.succeeded', JOB_EVENT));
deepEq('every subscriber of every named target hears it', seen, [
  'list:payment.succeeded',
  'wallet:payment.succeeded',
]);
seen = [];
unsubscribeList();
unsubscribeWallet();
emitMoneyRefresh(moneyRefreshPlan('payment.succeeded', JOB_EVENT));
deepEq('an unsubscribed target hears nothing', seen, []);
eq('the bus forgets the listener', moneyRefreshBusSize('jobList'), 0);
subscribeMoneyRefresh('myBids', () => seen.push('bids'));
resetMoneyRefreshBus();
eq('resetMoneyRefreshBus drops everybody (account switch)', moneyRefreshBusSize('myBids'), 0);

/* --------------------------------------------------------------- report */

for (const failure of failures) console.log(`  x ${failure}`);
console.log(`moneyEvents: ${passed}/${passed + failures.length} assertions passed`);
