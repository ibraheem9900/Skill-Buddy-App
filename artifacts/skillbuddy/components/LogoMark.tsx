import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface LogoMarkProps {
  color?: string;
  size?: number;
}

/**
 * SkillBuddy icon mark — the wave/two-person symbol — rendered as SVG
 * so it can be any color at any size without a separate image asset per variant.
 *
 * Usage:
 *   <LogoMark color="#FFFFFF" size={36} />   ← white on green header
 *   <LogoMark color="#2D7A6E" size={36} />   ← dark-green on light background
 */
export default function LogoMark({ color = '#3A9E8F', size = 36 }: LogoMarkProps) {
  // viewBox: 0 0 100 56 — a landscape rectangle that matches the icon's proportions
  return (
    <Svg width={size} height={size * 0.56} viewBox="0 0 100 56" fill="none">
      {/* Main swoosh path: left figure curves down then the right figure curves up */}
      <Path
        d="M4,46 C4,46 10,4 24,22 C32,32 36,32 42,22 C50,8 58,8 64,20 C70,32 78,32 84,22 C90,12 96,18 96,18"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Left person head dot — sits above the left peak */}
      <Circle cx="23" cy="10" r="6" fill={color} />
      {/* Right person head dot — sits above the right descending arc */}
      <Circle cx="76" cy="10" r="6" fill={color} />
    </Svg>
  );
}
