/**
 * RemoteImage — the ONE image box for artwork that comes from the API.
 *
 * WHY (boss, Services list): service cards showed a bare gray box while the
 * picture was still downloading (or forever, when the row has no image), with
 * no sign that anything was happening and no way to recover from a failed
 * request. Every service image now goes through this component:
 *
 *   • while loading → a three-dot loader inside the box (theme colors);
 *   • on failure    → the placeholder glyph plus a tap-to-retry that re-requests
 *                     the same URL (a new key remounts the image);
 *   • no URL at all → the placeholder glyph, not tappable (nothing to retry);
 *   • success       → the image, with expo-image's short cross-fade.
 *
 * Built on expo-image, which already ships in the installed APK (package.json
 * and the r36 tag), so this adds no dependency and no native change.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';

type Status = 'loading' | 'ready' | 'error';

export interface RemoteImageProps {
  /** Remote URL (http/https). An empty value renders the placeholder. */
  uri?: string | null;
  /** The box: width/height/borderRadius live here, as with a plain Image. */
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  /** Glyph shown while the image is missing or failed. */
  fallbackIcon?: React.ComponentProps<typeof Feather>['name'];
  fallbackIconSize?: number;
  /** Overrides the theme's muted background (e.g. a colored banner). */
  backgroundColor?: string;
  accessibilityLabel?: string;
  testID?: string;
}

/** Three dots pulsing in sequence — no third-party loader, no layout shift. */
function DotsLoader({ color }: { color: string }) {
  const dots = [useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current, useRef(new Animated.Value(0.25)).current];

  useEffect(() => {
    const animations = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 140),
          Animated.timing(dot, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.25, duration: 320, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - index) * 140),
        ])
      )
    );
    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
    };
    // The dots are stable refs created once for this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.dotsRow} pointerEvents="none">
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: color, opacity: dot }]}
        />
      ))}
    </View>
  );
}

export default function RemoteImage({
  uri,
  style,
  contentFit = 'cover',
  fallbackIcon = 'image',
  fallbackIconSize = 22,
  backgroundColor,
  accessibilityLabel,
  testID,
}: RemoteImageProps) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const url = typeof uri === 'string' && uri.trim().length > 0 ? uri.trim() : null;
  const [status, setStatus] = useState<Status>(url ? 'loading' : 'error');
  // Remounting the Image is what actually re-requests a failed URL.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setStatus(url ? 'loading' : 'error');
    setAttempt(0);
  }, [url]);

  const retry = () => {
    if (!url) return;
    setStatus('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <View
      style={[styles.box, { backgroundColor: backgroundColor ?? c.muted }, style]}
      testID={testID}
    >
      {url ? (
        <Image
          key={`${url}#${attempt}`}
          source={{ uri: url }}
          style={styles.image}
          contentFit={contentFit}
          transition={150}
          onLoadStart={() => setStatus('loading')}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
          accessibilityLabel={accessibilityLabel}
        />
      ) : null}

      {status === 'loading' && url ? <DotsLoader color={c.mutedForeground} /> : null}

      {status === 'error' ? (
        <Pressable
          onPress={retry}
          disabled={!url}
          style={styles.fallback}
          accessibilityRole={url ? 'button' : 'image'}
          accessibilityLabel={
            url ? t('img_retry') : accessibilityLabel ?? t('img_missing')
          }
        >
          <Feather name={fallbackIcon} size={fallbackIconSize} color={c.mutedForeground} />
          {url ? (
            <View style={styles.retryRow}>
              <Feather name="refresh-cw" size={9} color={c.mutedForeground} />
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  dotsRow: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  fallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  retryRow: { flexDirection: 'row', alignItems: 'center' },
});
