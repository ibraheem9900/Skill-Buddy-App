import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface LogoMarkProps {
  color?: string;
  size?: number;
}

/**
 * SkillBuddy icon mark — traced from the brand asset.
 * A wave with a backward left-curl start and two person-dot heads above the peaks.
 * Accepts any color so it works white-on-green (header) or green-on-white (splash).
 *
 * Usage:
 *   <LogoMark color="#FFFFFF" size={34} />   ← header
 *   <LogoMark color="#2D7A6E" size={34} />   ← light bg
 */
export default function LogoMark({ color = '#2D6B55', size = 34 }: LogoMarkProps) {
  // Aspect ratio ≈ 2.4 : 1  (matches the real brand mark width:height)
  const W = size * 2.4;
  const H = size;
  return (
    <Svg width={W} height={H} viewBox="0 0 240 100" fill="none">
      {/*
        Wave path:
          • Starts lower-left, curls BACK left before rising  (the distinctive tail)
          • Rises to left peak  (~x 80)
          • Dips to centre
          • Rises to right peak (~x 175) — slightly higher
          • Trails off down-right
      */}
      <Path
        d="M24,82 C4,88 -2,54 20,34 C40,14 64,16 80,36 C95,54 110,54 124,38 C140,16 162,14 178,34 C194,52 210,54 222,44"
        stroke={color}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Left person head — above the left peak */}
      <Circle cx="80" cy="13" r="11" fill={color} />
      {/* Right person head — above the right peak */}
      <Circle cx="178" cy="11" r="11" fill={color} />
    </Svg>
  );
}
