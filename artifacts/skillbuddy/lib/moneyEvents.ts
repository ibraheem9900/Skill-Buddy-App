/**
 * moneyEvents.ts
 *
 * Pure logic behind the MONEY side of the realtime layer — the user-targeted
 * events the Integration Guide (section 5, 13 Oct 2026) names on the same /ws
 * socket, with the same envelope and the same "refetch on event" rule:
 *
 *   payment.pending            payment.succeeded          payment.failed
 *   payment.disputed           payment.refunded
 *   invoice.created            invoice.overdue
 *   escrow.release_scheduled   escrow.released
 *   wallet.credit_earned
 *
 * These need no `watch_job`: they are delivered to the signed-in user.
 *
 * ── PAYLOADS ARE NOT DOCUMENTED ───────────────────────────────────────────
 * The guide names the types and nothing else, so NO FIELD IS EVER ASSUMED. The
 * identifiers below are read through safe accessors that accept only what they
 * can prove (a positive integer id, a decimal amount AND a currency); anything
 * else reads as "not sent". A frame with no identifier still refreshes the
 * relevant LIST instead of guessing which row changed, and a frame whose data
 * is empty, wrong-typed or not an object at all is handled without throwing.
 *
 * ── THE EVENT IS NEVER THE STATUS ─────────────────────────────────────────
 * Nothing here writes a job or bid status. An event only says "something about
 * money changed", and the handler refetches the REST resource that owns the
 * truth (GET /jobs/{id}, the job list, the bids list, GET /wallet/*) so the UI
 * always shows the server's own status — never one inferred from an event name.
 *
 * ── NO MONEY MOVES ────────────────────────────────────────────────────────
 * Every target in the refresh map is a GET the app already performs. No path in
 * this module creates a payment, an intent, a refund or a payout.
 *
 * No React, no socket, no storage: context/MoneyEventsContext.tsx subscribes and
 * calls these functions, so every decision above is pinned by the project's
 * dependency-free test harness (`pnpm run test`).
 */

/** The documented event types. (See the note in the final report: the guide
 *  names TEN distinct types, so exactly ten are typed here — inventing an
 *  eleventh name would be guessing at the protocol.) */
export const MONEY_EVENT_TYPES = [
  'payment.pending',
  'payment.succeeded',
  'payment.failed',
  'payment.disputed',
  'payment.refunded',
  'invoice.created',
  'invoice.overdue',
  'escrow.release_scheduled',
  'escrow.released',
  'wallet.credit_earned',
] as const;

export type MoneyEventType = (typeof MONEY_EVENT_TYPES)[number];

/** A repeat of the same (type, id) inside this window is not news twice. */
export const MONEY_DEDUPE_WINDOW_MS = 5_000;

/** How many dedupe keys are remembered. */
export const MONEY_DEDUPE_SIZE = 200;

/** How long a money banner stays on screen before it dismisses itself. */
export const MONEY_BANNER_MS = 10_000;

/** The refresh targets a plan can name. Every one is an EXISTING app read. */
export type MoneyRefreshTarget = 'jobDetail' | 'jobList' | 'myBids' | 'wallet';

const TARGET_ORDER: readonly MoneyRefreshTarget[] = ['jobDetail', 'jobList', 'myBids', 'wallet'];

/** Membership test for the documented types (exact strings only). */
export function isMoneyEventType(type: unknown): type is MoneyEventType {
  return typeof type === 'string' && (MONEY_EVENT_TYPES as readonly string[]).includes(type);
}

/* ────────────────────────────────────────────── safe payload accessors ── */

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** The identifiers the guide's payloads MIGHT carry, each or none. */
export interface MoneyEventIds {
  jobId: number | null;
  bidId: number | null;
  invoiceId: number | null;
  paymentId: number | null;
}

const NO_IDS: MoneyEventIds = { jobId: null, bidId: null, invoiceId: null, paymentId: null };

/**
 * Read the known identifiers out of an undocumented payload.
 *
 * Only the four names the guide's own examples use are read, each as a positive
 * integer. A string "12" is NOT accepted: the app has never been told the type
 * of these fields, so it does not guess at coercion either. Anything unreadable
 * is null, and null means "not sent" — never "zero", never "unknown id".
 */
export function moneyEventIds(data: unknown): MoneyEventIds {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ...NO_IDS };
  const payload = data as Record<string, unknown>;
  return {
    jobId: isPositiveInt(payload.job_id) ? payload.job_id : null,
    bidId: isPositiveInt(payload.bid_id) ? payload.bid_id : null,
    invoiceId: isPositiveInt(payload.invoice_id) ? payload.invoice_id : null,
    paymentId: isPositiveInt(payload.payment_id) ? payload.payment_id : null,
  };
}

/** An amount the payload really carried, with the currency it is in. */
export interface MoneyAmount {
  /** The decimal string exactly as the server sent it (money is never a float here). */
  amount: string;
  currency: string;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Read an amount ONLY when the payload carries BOTH a usable amount and a
 * currency. A bare `amount` with no `currency` is not shown anywhere: the app
 * cannot state money it cannot name the currency of.
 */
export function moneyEventAmount(data: unknown): MoneyAmount | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;

  const raw = payload.amount;
  let amount: string;
  if (typeof raw === 'string') amount = raw.trim();
  else if (typeof raw === 'number' && Number.isFinite(raw)) amount = String(raw);
  else return null;
  if (amount.length === 0 || !DECIMAL.test(amount)) return null;

  const currencyRaw = payload.currency;
  if (typeof currencyRaw !== 'string') return null;
  const currency = currencyRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  return { amount, currency };
}

/**
 * Format an amount for display, decimal-safe.
 *
 * The value is formatted through `Intl` with the app's own locale, so the
 * separator and symbol are the user's; when the environment has no data for the
 * currency (or throws) the literal `amount CURRENCY` is used instead of a wrong
 * symbol. Returns null when there is nothing truthful to show — callers then
 * render no amount at all.
 */
export function formatMoneyAmount(
  amount: MoneyAmount | null,
  locale: string
): string | null {
  if (amount === null) return null;
  try {
    const numeric = Number(amount.amount);
    if (!Number.isFinite(numeric)) return `${amount.amount} ${amount.currency}`;
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: amount.currency,
    }).format(numeric);
  } catch {
    return `${amount.amount} ${amount.currency}`;
  }
}

/* ──────────────────────────────────────────────────── deduplication ── */

/** The identity of one event for de-duplication: its type plus its best id. */
export function moneyEventKey(type: string, ids: MoneyEventIds): string {
  const id = ids.jobId ?? ids.bidId ?? ids.invoiceId ?? ids.paymentId;
  return id === null ? `${type}:none` : `${type}:${id}`;
}

export interface MoneyEventDeduper {
  /** Remember this key; TRUE when it was already seen inside the window. */
  seen(key: string, nowMs?: number): boolean;
  clear(): void;
  size(): number;
}

/**
 * A bounded memory of (type, id) keys with a window.
 *
 * A reconnect replays nothing, but a re-delivery would, and the same news can be
 * announced by two names (`payment.succeeded` and a follow-up `escrow.*`). A key
 * seen again inside `windowMs` is not news: it produces no second banner and no
 * second refetch. After the window it is news again, because a genuinely new
 * occurrence is exactly what a fresh frame with the same ids means.
 */
export function createMoneyEventDeduper(
  windowMs: number = MONEY_DEDUPE_WINDOW_MS,
  max: number = MONEY_DEDUPE_SIZE,
  now: () => number = () => Date.now()
): MoneyEventDeduper {
  const window = windowMs > 0 ? windowMs : 1;
  const limit = max > 0 ? max : 1;
  const seenAt = new Map<string, number>();

  return {
    seen: (key, nowMs) => {
      const at = typeof nowMs === 'number' ? nowMs : now();
      const previous = seenAt.get(key);
      if (previous !== undefined && at - previous < window) return true;
      // Re-insert so the map's insertion order stays the eviction order.
      seenAt.delete(key);
      seenAt.set(key, at);
      while (seenAt.size > limit) {
        const oldest = seenAt.keys().next();
        if (oldest.done) break;
        seenAt.delete(oldest.value);
      }
      return false;
    },
    clear: () => seenAt.clear(),
    size: () => seenAt.size,
  };
}

/* ────────────────────────────────────────────────────── refresh map ── */

/**
 * What each event makes stale, expressed only in reads the app already performs:
 *
 *   jobDetail  GET /api/v1/jobs/{id}          (the job's OWN status — the truth)
 *   jobList    GET /api/v1/jobs               (the client's job list / jobs tab)
 *   myBids     GET /api/v1/bids/mine and the one-job bid lookup
 *   wallet     GET /api/v1/wallet/provider and GET /api/v1/wallet/credits
 *
 * Only the events whose meaning touches money in or out of a wallet include
 * `wallet`; a failed or disputed payment changes a job's state, not a balance.
 */
export const MONEY_REFRESH_TARGETS: Record<MoneyEventType, readonly MoneyRefreshTarget[]> = {
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

/** The event types that are about a JOB (so a missing id means "the lists"). */
const JOB_SCOPED = /^(payment|invoice|escrow)\./;

/** The target of a target-free plan: nothing was listened to, so re-read it all. */
export const MONEY_RESYNC_PLAN_TYPE = '$resync';

/** One applied event, resolved into what has to be re-read. */
export interface MoneyEventPlan {
  type: string;
  /** False for a type the guide does not document — such a plan does nothing. */
  known: boolean;
  ids: MoneyEventIds;
  /**
   * The job ids to re-read. `[]` when the payload named none, and `null` for a
   * resync — which means EVERY mounted job screen re-reads its own job, because
   * a resync carries no id by definition.
   */
  jobIds: number[] | null;
  targets: MoneyRefreshTarget[];
}

/**
 * Resolve one event into a refresh plan.
 *
 * With a job id: the job itself is re-read, plus the lists that carry it.
 * WITHOUT a job id: the job-specific target is dropped and the LISTS are
 * re-read instead — the app never guesses which job an anonymous frame meant.
 * An undocumented type yields no targets at all (unknown events are ignored).
 */
export function moneyRefreshPlan(type: string, data: unknown): MoneyEventPlan {
  const ids = moneyEventIds(data);
  const jobIds = ids.jobId === null ? [] : [ids.jobId];

  if (!isMoneyEventType(type)) {
    return { type, known: false, ids, jobIds: [], targets: [] };
  }

  const declared = MONEY_REFRESH_TARGETS[type];
  const targets: MoneyRefreshTarget[] = [];
  for (const target of TARGET_ORDER) {
    if (!declared.includes(target)) continue;
    if (target === 'jobDetail' && jobIds.length === 0) continue;
    targets.push(target);
  }
  // A job-scoped frame with no identifier still means "some job moved":
  // re-read the list rather than nothing.
  if (jobIds.length === 0 && JOB_SCOPED.test(type) && !targets.includes('jobList')) {
    targets.push('jobList');
    targets.sort((a, b) => TARGET_ORDER.indexOf(a) - TARGET_ORDER.indexOf(b));
  }

  return { type, known: true, ids, jobIds, targets };
}

/**
 * What a reconnect or an app resume has to re-read.
 *
 * Events are never stored and a missed frame is lost, so every socket (re)open
 * and every return to the foreground re-reads ALL the money-related resources:
 * the mounted job screens (each its own job), the job lists, the bids, and the
 * wallets. There is no id to work from, hence `jobIds: null`.
 */
export function moneyResyncPlan(): MoneyEventPlan {
  return {
    type: MONEY_RESYNC_PLAN_TYPE,
    known: true,
    ids: { ...NO_IDS },
    jobIds: null,
    targets: [...TARGET_ORDER],
  };
}

/** The reads the handler can perform. Every one already exists in the app. */
export interface MoneyRefreshDeps {
  /** Drop one job from the job-detail cache (hooks/useJobDetail). */
  invalidateJobDetail: (jobId: number) => void;
  /** Tell every mounted job list its data is stale (hooks/useJobList). */
  invalidateJobList: () => void;
  /** Re-read the provider's bids: the list and the one-job lookup. */
  resyncMyBids: () => void;
  /** Re-read the wallets (hooks/useWallet). */
  refreshWallets: () => void;
}

/**
 * The caches a plan invalidates. Screens are NOT called from here: the handler
 * publishes the plan on the bus (emitMoneyRefresh) and a mounted screen re-reads
 * when planTouchesJob says the plan is about it.
 */

/**
 * Run a plan. Only the targets the plan names are touched, in a fixed order, and
 * the function returns the targets it ran so a test can assert the exact set.
 */
export function applyMoneyRefreshPlan(plan: MoneyEventPlan, deps: MoneyRefreshDeps): MoneyRefreshTarget[] {
  if (!plan.known) return [];
  const ran: MoneyRefreshTarget[] = [];

  for (const target of plan.targets) {
    switch (target) {
      case 'jobDetail': {
        // A resync names no job: the mounted screens re-read their own, which is
        // what the published plan tells them. Nothing to invalidate here.
        if (plan.jobIds === null) {
          ran.push(target);
          break;
        }
        if (plan.jobIds.length === 0) break;
        for (const jobId of plan.jobIds) deps.invalidateJobDetail(jobId);
        ran.push(target);
        break;
      }
      case 'jobList':
        deps.invalidateJobList();
        ran.push(target);
        break;
      case 'myBids':
        deps.resyncMyBids();
        ran.push(target);
        break;
      case 'wallet':
        deps.refreshWallets();
        ran.push(target);
        break;
      default:
        break;
    }
  }

  return ran;
}

/* ───────────────────────────────────────── the screen-facing bus ── */

/**
 * How a screen hears about a plan. `jobList`, `myBids` and `wallet` screens
 * subscribe by target; a screen showing ONE job subscribes for `jobDetail` and
 * refetches when its own id is in `plan.jobIds` — or on any plan whose `jobIds`
 * is `null` (a resync).
 */
export type MoneyRefreshListener = (plan: MoneyEventPlan) => void;

const bus = new Map<MoneyRefreshTarget, Set<MoneyRefreshListener>>();

/** Subscribe to one target. Returns the unsubscribe. */
export function subscribeMoneyRefresh(target: MoneyRefreshTarget, listener: MoneyRefreshListener): () => void {
  let listeners = bus.get(target);
  if (!listeners) {
    listeners = new Set();
    bus.set(target, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
  };
}

/** Publish a plan to the screens listening on its targets. */
export function emitMoneyRefresh(plan: MoneyEventPlan): void {
  for (const target of plan.targets) {
    const listeners = bus.get(target);
    if (!listeners) continue;
    for (const listener of Array.from(listeners)) listener(plan);
  }
}

/**
 * Should a screen that is showing `jobId` re-read on this plan?
 *
 * Yes when the plan names that job, and yes for a resync (whose `jobIds` is
 * `null`). A plan that names OTHER jobs leaves this screen alone, so a payment on
 * one job never makes every open job screen refetch.
 */
export function planTouchesJob(plan: MoneyEventPlan, jobId: number | null | undefined): boolean {
  if (jobId === null || jobId === undefined) return false;
  if (plan.jobIds === null) return true;
  return plan.jobIds.includes(jobId);
}

/** Drop every subscriber — used when the account changes. */
export function resetMoneyRefreshBus(): void {
  bus.clear();
}

/** How many listeners one target has (test/diagnostic helper). */
export function moneyRefreshBusSize(target: MoneyRefreshTarget): number {
  return bus.get(target)?.size ?? 0;
}

/* ─────────────────────────────────────────────────────── banner copy ── */

export type MoneyBannerTone = 'info' | 'success' | 'warning' | 'danger';

/** The translated line each event shows. Neutral and factual: it names the event
 *  and claims nothing the event does not (no amounts, no next steps). */
export const MONEY_BANNER_COPY: Record<MoneyEventType, { titleKey: MoneyBannerTitleKey; tone: MoneyBannerTone }> = {
  'payment.pending': { titleKey: 'money_evt_payment_pending', tone: 'info' },
  'payment.succeeded': { titleKey: 'money_evt_payment_succeeded', tone: 'success' },
  'payment.failed': { titleKey: 'money_evt_payment_failed', tone: 'danger' },
  'payment.disputed': { titleKey: 'money_evt_payment_disputed', tone: 'warning' },
  'payment.refunded': { titleKey: 'money_evt_payment_refunded', tone: 'info' },
  'invoice.created': { titleKey: 'money_evt_invoice_created', tone: 'info' },
  'invoice.overdue': { titleKey: 'money_evt_invoice_overdue', tone: 'warning' },
  'escrow.release_scheduled': { titleKey: 'money_evt_escrow_scheduled', tone: 'info' },
  'escrow.released': { titleKey: 'money_evt_escrow_released', tone: 'success' },
  'wallet.credit_earned': { titleKey: 'money_evt_credit_earned', tone: 'success' },
};

export type MoneyBannerTitleKey =
  | 'money_evt_payment_pending'
  | 'money_evt_payment_succeeded'
  | 'money_evt_payment_failed'
  | 'money_evt_payment_disputed'
  | 'money_evt_payment_refunded'
  | 'money_evt_invoice_created'
  | 'money_evt_invoice_overdue'
  | 'money_evt_escrow_scheduled'
  | 'money_evt_escrow_released'
  | 'money_evt_credit_earned';

/** What the banner renders, decided entirely by this module. */
export interface MoneyBannerContent {
  type: MoneyEventType;
  /** The translated line — resolved by the banner, so a language switch applies. */
  titleKey: MoneyBannerTitleKey;
  tone: MoneyBannerTone;
  /**
   * The amount the payload really carried, or null. The banner formats it with
   * the CURRENT locale at render time; null means the banner shows no amount at
   * all, because either half was missing.
   */
  amount: MoneyAmount | null;
  /** The existing screen the banner can open, or null to just dismiss. */
  jobId: number | null;
  /** Stable identity so React re-animates for a NEW event, not a re-render. */
  key: string;
}

/** Where the banner's action may go: an EXISTING screen, or nowhere. */
export type MoneyBannerTarget = { kind: 'job'; jobId: number } | { kind: 'wallet' } | null;

/**
 * The banner's tap target.
 *
 * A job id means the job screen that already exists. With no job id, a money
 * event still has exactly one place in this app that shows it — the wallet
 * screen — and only for the events that actually move wallet money; everything
 * else has no target at all and the banner just dismisses (there is no invoice or
 * payment screen to send the user to, and inventing one is not this chunk).
 */
export function moneyBannerTarget(content: Pick<MoneyBannerContent, 'type' | 'jobId'>): MoneyBannerTarget {
  if (content.jobId !== null) return { kind: 'job', jobId: content.jobId };
  return MONEY_REFRESH_TARGETS[content.type].includes('wallet') ? { kind: 'wallet' } : null;
}

/**
 * Build the banner for one event, or null for an undocumented type.
 *
 * The amount appears only when the payload carried BOTH an amount and a currency
 * (see moneyEventAmount) — the app never states money it cannot name.
 */
export function moneyBannerContent(
  type: string,
  data: unknown,
  sequence: number
): MoneyBannerContent | null {
  if (!isMoneyEventType(type)) return null;
  const copy = MONEY_BANNER_COPY[type];
  const ids = moneyEventIds(data);
  return {
    type,
    titleKey: copy.titleKey,
    tone: copy.tone,
    amount: moneyEventAmount(data),
    jobId: ids.jobId,
    key: `${type}:${ids.jobId ?? 0}:${sequence}`,
  };
}
