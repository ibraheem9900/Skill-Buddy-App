import { useCallback, useEffect, useRef, useState } from 'react';
import { authApi } from '@/services/api';
import { classifyDataFailure, type DataFailure } from '@/lib/dataState';
import type {
  CreditTransactionResponse,
  CreditWalletResponse,
  ProviderWalletResponse,
  ProviderWalletTransactionResponse,
} from '@/types';

/**
 * Wallet state (GET /api/v1/wallet/credits + GET /api/v1/wallet/provider):
 *  - idle      not started
 *  - loading   fetch in flight
 *  - ready     response loaded (a missing wallet is a real state — zeros)
 *  - error     the request FAILED — retryable; `failure` says why (a real 0 is
 *              NEVER an error: it arrives as 'ready' with balance 0)
 *
 * TWO wallets, two hooks, ONE module each owns its cache:
 *   useCreditWallet()   → CLIENT credit points (balance is an INTEGER count)
 *   useProviderWallet() → PROVIDER money wallet (decimal STRING amounts)
 *
 * The endpoints are PROTECTED; the shared axios client attaches the Bearer
 * token and refreshes it once on 401. Callers gate on auth/role before
 * loading (a signed-out user has no wallet to read).
 *
 * Cache discipline mirrors useCategories/useServices: fetched once per
 * session into a module-level cache, shared across screens; refresh() exists
 * for pull-to-refresh / retry.
 */

export type WalletStatus = 'idle' | 'loading' | 'ready' | 'error';

/* ── Module-level invalidation ────────────────────────────────────────────── */

type WalletInvalidateListener = () => void;
const walletListeners = new Set<WalletInvalidateListener>();

/**
 * Tell every mounted wallet view to re-read now.
 *
 * The same shape as hooks/useJobList.invalidateJobList: wallet money changes
 * from the SERVER's side too (`escrow.released` credits the provider wallet,
 * `payment.refunded` / `wallet.credit_earned` move the client's), and the events
 * carry no amounts to patch the screen with — only the refetch is truthful, and
 * it is what context/MoneyEventsContext calls.
 */
export function refreshWallets(): void {
  for (const listener of Array.from(walletListeners)) listener();
}

function subscribeWallets(listener: WalletInvalidateListener): () => void {
  walletListeners.add(listener);
  return () => {
    walletListeners.delete(listener);
  };
}

/* ── Credit wallet (client) ──────────────────────────────────────────────── */

let creditCache: { wallet: CreditWalletResponse; transactions: CreditTransactionResponse[] } | null = null;
let creditStatus: WalletStatus = 'idle';

export function useCreditWallet() {
  const [status, setStatus] = useState<WalletStatus>(creditStatus);
  const [data, setData] = useState(creditCache);
  const [failure, setFailure] = useState<DataFailure | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && creditStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    setFailure(null);
    try {
      const { data: res } = await authApi.getWalletCredits();
      creditCache = {
        wallet: res?.wallet ?? { id: 0, client_id: 0, balance: 0 },
        transactions: Array.isArray(res?.transactions) ? res.transactions : [],
      };
      creditStatus = 'ready';
      setData(creditCache);
      setStatus('ready');
    } catch (err) {
      creditCache = null;
      creditStatus = 'error';
      setData(null);
      setFailure(classifyDataFailure(err));
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  // A money event on the socket re-reads this wallet while its screen is open.
  useEffect(() => subscribeWallets(() => { void load(true); }), [load]);

  /** Whole-number point balance — 0 when the wallet has not loaded. */
  const balance = data?.wallet?.balance ?? 0;
  const transactions = data?.transactions ?? [];

  return { status, balance, transactions, failure, load, refresh: () => load(true) };
}

/* ── Provider wallet (money) ─────────────────────────────────────────────── */

let providerCache: { wallet: ProviderWalletResponse; transactions: ProviderWalletTransactionResponse[] } | null = null;
let providerStatus: WalletStatus = 'idle';

export function useProviderWallet() {
  const [status, setStatus] = useState<WalletStatus>(providerStatus);
  const [data, setData] = useState(providerCache);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && providerStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data: res } = await authApi.getProviderWallet();
      providerCache = {
        wallet: res?.wallet ?? { id: 0, provider_id: 0, balance: '0' },
        transactions: Array.isArray(res?.transactions) ? res.transactions : [],
      };
      providerStatus = 'ready';
      setData(providerCache);
      setStatus('ready');
    } catch {
      providerStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  // A money event on the socket re-reads this wallet while its screen is open.
  useEffect(() => subscribeWallets(() => { void load(true); }), [load]);

  /** Decimal STRING per the live schema — callers format before display. */
  const balance = data?.wallet?.balance ?? '0';
  const transactions = data?.transactions ?? [];

  return { status, balance, transactions, load, refresh: () => load(true) };
}
