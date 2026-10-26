/**
 * colorStops.ts
 *
 * Pure RGB interpolation between two hex colors — the one place that decides
 * how a gradient fades from one theme token into another.
 *
 * WHY THIS EXISTS: React Native's LinearGradient treats the keyword
 * `'transparent'` as rgba(0,0,0,0), so a fade written as
 * `colors={[green, 'transparent']}` blends green through BLACK and lands on a
 * muddy gray band. The fix is always the same: interpolate OPAQUE stops
 * between the two real colors, so every step is a real mix of green and the
 * page background — never a pass through black and never an alpha hole.
 *
 * No React, no axios: fully unit-testable (lib/__tests__/colorStops.test.ts).
 */

/** Parse #RGB or #RRGGBB (case-insensitive) into [r, g, b] 0..255. */
export function parseHexColor(color: string): [number, number, number] | null {
  if (typeof color !== 'string') return null;
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

/** [r, g, b] → '#rrggbb' (always 6 digits, lowercase). */
export function toHexColor(rgb: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    rgb
      .map((n) => clamp(n).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Linear RGB interpolation from `from` to `to` producing exactly `steps`
 * OPAQUE stops. First stop is `from`, last stop is `to`, so a gradient that
 * starts with `from` (the hero green) has no seam and ends on the exact page
 * background color.
 *
 * Falls back to `[from, to]` when either color is not a hex string (e.g. an
 * rgba() token) — LinearGradient can always render those two, and it is safer
 * than silently emitting garbage stops.
 */
export function interpolateColorStops(
  from: string,
  to: string,
  steps = 6
): [string, string, ...string[]] {
  const count = Math.max(2, Math.trunc(steps));
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  if (!a || !b) return [from, to];

  const stops: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    stops.push(
      toHexColor([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ])
    );
  }
  // `count` is clamped to >= 2 above, so the tuple always has its two stops —
  // this is the shape LinearGradient's `colors` prop requires.
  return stops as [string, string, ...string[]];
}
