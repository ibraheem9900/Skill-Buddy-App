import { useCallback, useRef, useState } from 'react';
import { authApi } from '@/services/api';
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
 *  - error     network/timeout/401-after-refresh — retryable
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

/* ── Credit wallet (client) ──────────────────────────────────────────────── */

let creditCache: { wallet: CreditWalletResponse; transactions: CreditTransactionResponse[] } | null = null;
let creditStatus: WalletStatus = 'idle';

export function useCreditWallet() {
  const [status, setStatus] = useState<WalletStatus>(creditStatus);
  const [data, setData] = useState(creditCache);
  const inFlight = useRef(false);

  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (!force && creditStatus === 'ready') return; // cached — no re-fetch
    inFlight.current = true;
    setStatus('loading');
    try {
      const { data: res } = await authApi.getWalletCredits();
      creditCache = {
        wallet: res?.wallet ?? { id: 0, client_id: 0, balance: 0 },
        transactions: Array.isArray(res?.transactions) ? res.transactions : [],
      };
      creditStatus = 'ready';
      setData(creditCache);
      setStatus('ready');
    } catch (err: any) {
      console.log(
        '[useCreditWallet] GET /api/v1/wallet/credits failed',
        err?.response?.status,
        err?.response?.data ?? err?.message
      );
      creditStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** Whole-number point balance — 0 when the wallet has not loaded. */
  const balance = data?.wallet?.balance ?? 0;
  const transactions = data?.transactions ?? [];

  return { status, balance, transactions, load, refresh: () => load(true) };
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
    } catch (err: any) {
      console.log(
        '[useProviderWallet] GET /api/v1/wallet/provider failed',
        err?.response?.status,
        err?.response?.data ?? err?.message
      );
      providerStatus = 'error';
      setStatus('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  /** Decimal STRING per the live schema — callers format before display. */
  const balance = data?.wallet?.balance ?? '0';
  const transactions = data?.transactions ?? [];

  return { status, balance, transactions, load, refresh: () => load(true) };
}
