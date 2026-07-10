/**
 * LogoImage — renders the real SkillBuddy brand mark from the actual asset file.
 * The asset is a transparent-background PNG so we can tintColor it for any surface.
 *
 * Usage:
 *   <LogoImage variant="white" height={32} />   ← on green header
 *   <LogoImage variant="green" height={32} />   ← on light surface
 *   <LogoImage variant="light" height={32} />   ← on dark surface (light-green tint)
 */
import React from 'react';
import { Image, StyleSheet } from 'react-native';

type Variant = 'white' | 'green' | 'light';

interface Props {
  variant?: Variant;
  height?: number;
}

// Original aspect ratio of the brand mark: ~2.26 : 1
const ASPECT = 2.26;

const TINTS: Record<Variant, string> = {
  white: '#FFFFFF',
  green: '#2D6B55',
  light: '#6BBFAD',  // softer green for dark surfaces
};

export default function LogoImage({ variant = 'green', height = 32 }: Props) {
  const width = Math.round(height * ASPECT);
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('@/assets/images/logo-icon.png')}
      style={[styles.img, { width, height }]}
      tintColor={TINTS[variant]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  img: {},
});
