/**
 * Regression tests for a DIRECT/COLD certification detail open.
 *
 * The screen used to render only the header (and stay on its loader) because
 * the detail loader answered null without fetching whenever the list cache was
 * `ready` but did not contain the route id. These tests pin the cold-open
 * contract: an empty/stale cache MUST produce one server read, and a successful
 * read MUST produce a row that renders both actions.
 */
import {
  hasCertificationActions,
  loadCertificationDetail,
  normalizeCertification,
  parseCertificationId,
  type CertificationDetailResult,
} from '../certificationDetail';
import type { CertificationResponse } from '@/types';

declare const console: { log: (msg: string) => void };

let passed = 0;
export const failures: string[] = [];

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

const cert: CertificationResponse = {
  id: 1,
  provider_id: 2,
  certification_url: 'https://cdn.example.com/certificates/first-aid.pdf',
  created_at: '2026-11-01T10:00:00Z',
};

/* --------------------------------------------------------------- route param */
eq('a numeric route param parses', parseCertificationId('1'), 1);
eq('the first value of an array param parses', parseCertificationId(['7', '8']), 7);
eq('a padded numeric param parses', parseCertificationId(' 12 '), 12);
eq('zero is not a valid id', parseCertificationId('0'), null);
eq('a negative id is invalid', parseCertificationId('-1'), null);
eq('a float id is invalid', parseCertificationId('1.5'), null);
eq('a non-numeric id is invalid', parseCertificationId('cert-1'), null);
eq('a missing param is invalid', parseCertificationId(undefined), null);
eq('an empty param is invalid', parseCertificationId(''), null);
eq('Number.MAX_SAFE_INTEGER + 1 is rejected', parseCertificationId('9007199254740992'), null);

/* --------------------------------------------------------------- rows/wrapper */
eq('the documented bare row normalizes', normalizeCertification(cert)?.id, 1);
eq(
  'a wrapped certification row normalizes',
  normalizeCertification({ certification: cert })?.certification_url,
  cert.certification_url
);
eq('a mismatched id is rejected', normalizeCertification(cert, 2), null);
eq('a row without a url is rejected', normalizeCertification({ ...cert, certification_url: '' }), null);
eq('a row without an id is rejected', normalizeCertification({ ...cert, id: undefined }), null);
eq('null is rejected', normalizeCertification(null), null);

/* ---------------------------------------------------------------- cold open */
(async () => {
  const calls: number[] = [];
  const cold = await loadCertificationDetail(1, {
    cached: [], // fresh process / direct link: list never loaded
    fetchOne: async (id) => {
      calls.push(id);
      return cert;
    },
  });
  eq('cold open performs exactly one server read', calls.length, 1);
  eq('cold open passes the route id', calls[0], 1);
  eq('cold open becomes ready', cold.status, 'ready');
  eq(
    'cold open carries the certificate',
    cold.status === 'ready' ? cold.cert.certification_url : null,
    cert.certification_url
  );
  eq(
    'cold open can render both actions',
    cold.status === 'ready' ? hasCertificationActions(cold.cert) : false,
    true
  );

  /* The precise regression: list cache says ready but row is missing. */
  const staleCalls: number[] = [];
  const stale = await loadCertificationDetail(1, {
    cached: [{ ...cert, id: 99 }],
    fetchOne: async (id) => {
      staleCalls.push(id);
      return cert;
    },
  });
  eq('a ready-but-missing list cache still fetches', staleCalls.length, 1);
  eq('a ready-but-missing list cache becomes ready', stale.status, 'ready');

  const cachedCalls: number[] = [];
  const hit = await loadCertificationDetail(1, {
    cached: [cert],
    fetchOne: async (id) => {
      cachedCalls.push(id);
      return null;
    },
  });
  eq('a valid cached row needs no request', cachedCalls.length, 0);
  eq('a valid cached row is ready', hit.status, 'ready');

  const missing = await loadCertificationDetail(1, {
    cached: [],
    fetchOne: async () => null,
  });
  eq('a 404/null becomes not-found', missing.status, 'notfound');

  const failed = await loadCertificationDetail(1, {
    cached: [],
    fetchOne: async () => {
      throw new Error('offline');
    },
  });
  eq('a rejected read becomes a retryable error', failed.status, 'error');

  const malformed = await loadCertificationDetail(1, {
    cached: [],
    fetchOne: async () => ({ ...cert, certification_url: '' } as CertificationResponse),
  });
  eq('an incomplete fetched row is not rendered as ready', malformed.status, 'notfound');

  const weirdId = await loadCertificationDetail(0, {
    cached: [],
    fetchOne: async () => cert,
  });
  eq('an invalid id is not fetched', weirdId.status, 'notfound');

  /* ------------------------------------------------------------------ report */
  const summary = { passed, total: passed + failures.length };
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  console.log(`certificationDetail: ${summary.passed}/${summary.total} assertions passed`);
})();
