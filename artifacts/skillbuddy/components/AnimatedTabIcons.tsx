import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The five bottom-tab icons, drawn as ONE family:
 *
 *   • 24×24 viewBox, 1.7 stroke, round caps/joins, outline in the tab's tint;
 *   • each icon has exactly ONE solid element (door, tiles, latch, dots, head)
 *     whose `fill` opacity is passed in, so the bar can cross-fade the outline
 *     copy into the filled copy progressively as a swipe moves the tab;
 *   • the shapes are deliberately distinct at a glance: a house, a 2×2 grid, a
 *     briefcase with a visible handle and seam, a speech bubble, a person.
 *
 * These are pure presentational SVGs: no animation state, no effects. The tab
 * bar owns the timing (see `components/tabBar/TabPagerBar.tsx`).
 */
export interface TabIconProps {
  /** Matches RN's `ColorValue` and react-native-svg's fill/stroke types. */
  color: ColorValue;
  /** Opacity (0–1) of the icon's single solid element. */
  fill?: number;
  size?: number;
}

/** Home — a house whose door fills in when selected. */
export function HomeTabIcon({ color, fill = 0, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 10.4 12 3.5l8.5 6.9V20a.9.9 0 0 1-.9.9H4.4a.9.9 0 0 1-.9-.9v-9.6Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Rect
        x={9.2}
        y={13}
        width={5.6}
        height={7.9}
        rx={1}
        fill={color}
        fillOpacity={0.15 + fill * 0.85}
      />
      <Path d="M9.2 13h5.6" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  );
}

/** Services — a 2×2 grid of tiles that fills in when selected. */
export function ServicesTabIcon({ color, fill = 0, size = 24 }: TabIconProps) {
  const tiles: [number, number][] = [
    [3.5, 3.5],
    [13.5, 3.5],
    [3.5, 13.5],
    [13.5, 13.5],
  ];

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {tiles.map(([x, y]) => (
        <React.Fragment key={`${x}-${y}`}>
          <Rect x={x} y={y} width={7} height={7} rx={1.8} stroke={color} strokeWidth={1.7} />
          <Rect
            x={x}
            y={y}
            width={7}
            height={7}
            rx={1.8}
            fill={color}
            fillOpacity={fill * 0.95}
          />
        </React.Fragment>
      ))}
    </Svg>
  );
}

/** Jobs — a briefcase: handle, body and centre latch; the latch fills in. */
export function JobsTabIcon({ color, fill = 0, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* handle */}
      <Path
        d="M9 6.6V5.4c0-.8.6-1.4 1.4-1.4h3.2c.8 0 1.4.6 1.4 1.4v1.2"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      {/* body */}
      <Rect x={3} y={6.6} width={18} height={13.4} rx={2.2} stroke={color} strokeWidth={1.7} />
      {/* seam — what makes it read as a briefcase rather than a box */}
      <Path d="M3 11.4h18" stroke={color} strokeWidth={1.7} />
      {/* latch */}
      <Rect
        x={10.1}
        y={9.9}
        width={3.8}
        height={3}
        rx={0.9}
        fill={color}
        fillOpacity={0.2 + fill * 0.8}
      />
    </Svg>
  );
}

/** Inbox — a speech bubble whose three dots appear when selected. */
export function InboxTabIcon({ color, fill = 0, size = 24 }: TabIconProps) {
  const dotOpacity = 0.15 + fill * 0.85;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20.5 12.2c0 3.7-3.6 6.7-8 6.7-1 0-2-.2-2.9-.5l-4.6 2 1.2-3.5c-1.3-1.2-2.1-2.8-2.1-4.7 0-3.7 3.6-6.7 8-6.7s8.4 3 8.4 6.7Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={7.6} cy={11.9} r={1.25} fill={color} fillOpacity={dotOpacity} />
      <Circle cx={12} cy={11.9} r={1.25} fill={color} fillOpacity={dotOpacity} />
      <Circle cx={16.4} cy={11.9} r={1.25} fill={color} fillOpacity={dotOpacity} />
    </Svg>
  );
}

/** Profile — head and shoulders; the head fills in when selected. */
export function ProfileTabIcon({ color, fill = 0, size = 24 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4.1} fill={color} fillOpacity={fill * 0.95} />
      <Circle cx={12} cy={8} r={4.1} stroke={color} strokeWidth={1.7} />
      <Path
        d="M4 20.5c0-3.9 3.6-6.4 8-6.4s8 2.5 8 6.4"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
    </Svg>
  );
}
