/**
 * cityPrecisionNotice.ts — the "we only found your city" hint.
 *
 * The flag itself lives in lib/coordinates, next to the resolver that sets it,
 * so EVERY coordinate flow records it without a per-screen call. This module is
 * the stable import for the screens, and clears the flag with the rest of the
 * session state on logout.
 */

import {
  clearCityPrecisionNotice,
  consumeCityPrecisionNotice,
  peekCityPrecisionNotice,
} from '@/lib/coordinates';
import { registerSessionReset } from '@/lib/sessionReset';

export { clearCityPrecisionNotice, consumeCityPrecisionNotice, peekCityPrecisionNotice };

registerSessionReset(() => {
  clearCityPrecisionNotice();
});
