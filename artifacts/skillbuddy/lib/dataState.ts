/**
 * ONE rule for "we have data" / "we have no data yet" / "the request failed".
 *
 * The bug this exists to prevent: a screen deciding its state from the VALUE
 * (`if (!summary) → error`, `count === 0 → error`) instead of from the REQUEST.
 * A 200 that carries zeros or an empty list is a normal, expected state and must
 * render real zeros — never a Retry button, never a warning colour. Only a
 * request that actually failed may offer Retry.
 *
 * The failure classifier is the app's existing one (lib/jobCreate), so this adds
 * no second taxonomy: it only recognises the backend's "Client profile not
 * found" 404 as its own case, because that is a DATA problem (the account has no
 * client profile — the API has no endpoint to create one) and must not read like
 * a connection or a generic server failure.
 */
import { classifyCreateJobFailure, type CreateJobFailureKind } from './jobCreate';
import { isClientProfileMissing } from './jobList';

export type DataFailureKind = CreateJobFailureKind | 'client-profile';

export interface DataFailure {
  kind: DataFailureKind;
  /** HTTP status when the server answered; null for transport failures. */
  status: number | null;
  /** The backend's own readable text, when it sent one. */
  message: string | null;
}

/** Classify a thrown request error. `client-profile` means "no client profile". */
export function classifyDataFailure(err: unknown): DataFailure {
  const classified = classifyCreateJobFailure(err);
  const status = (err as { response?: { status?: unknown } } | null | undefined)?.response?.status;
  const httpStatus = typeof status === 'number' ? status : null;

  if (httpStatus === 404 && isClientProfileMissing(classified.message)) {
    return { kind: 'client-profile', status: httpStatus, message: classified.message };
  }

  return { kind: classified.kind, status: httpStatus, message: classified.message };
}

/**
 * What a data section renders:
 *   loading      the request is in flight and there is nothing to show yet
 *   ready        the request succeeded AND returned real data
 *   empty        the request succeeded with zero / an empty list  → neutral "0"
 *   unavailable  the account has no client profile yet            → neutral "0" + note
 *   error        the request failed for a real reason             → Retry
 */
export type DataViewState = 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';

/**
 * The single decision a screen makes. `hasData` describes the SUCCESS payload
 * only (a loaded summary object, a non-empty list); it is ignored whenever a
 * failure was recorded, so "no data" can never be mistaken for "failed".
 */
export function resolveDataViewState(args: {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'none';
  hasData: boolean;
  failure: DataFailure | null;
}): DataViewState {
  const { status, hasData, failure } = args;
  if (failure) return failure.kind === 'client-profile' ? 'unavailable' : 'error';
  if (status === 'error') return 'error';
  if (status === 'idle' || status === 'loading') return 'loading';
  if (status === 'ready') return hasData ? 'ready' : 'empty';
  return 'empty';
}

/**
 * How a failure reads. Only 'network' may say "check your connection"; a
 * timeout is its own line, a 401 is a session line, everything else is generic.
 */
export type FailureCopyKind = 'network' | 'timeout' | 'server' | 'session' | 'generic';

export function failureCopyKind(failure: DataFailure | null): FailureCopyKind {
  if (!failure) return 'generic';
  switch (failure.kind) {
    case 'network':
      return 'network';
    case 'timeout':
      return 'timeout';
    case 'server':
      return 'server';
    case 'unauthorized':
      return 'session';
    default:
      return 'generic';
  }
}

/** True when a section should offer Retry: a real failure, never an empty result. */
export function showsRetry(state: DataViewState): boolean {
  return state === 'error';
}
