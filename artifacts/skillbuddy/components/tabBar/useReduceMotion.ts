import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "reduce motion" setting.
 *
 * When it is on, the pager keeps the direct 1:1 slide (the finger IS the
 * animation) but drops the decorative layer: page scale/fade/parallax and the
 * icon lift are switched off. The bar still tracks the swipe, because the pill
 * moving with the pages is orientation, not decoration.
 */
export default function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduced(enabled);
      })
      .catch(() => {
        /* not available on this platform — keep motion on */
      });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduced(enabled)
    );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduced;
}
