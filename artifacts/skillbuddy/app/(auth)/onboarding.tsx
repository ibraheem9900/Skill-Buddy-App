import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
} from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import LogoImage from '@/components/LogoImage';

const SPLASH_VIDEO = require('@/assets/videos/splash-intro.mp4');

// ── Module-level check: is expo-video available? ─────────────────────────────
// We try to require it once at module scope. If the native module isn't
// linked (or fails to load on some Android devices), the whole require
// throws and we fall back to the static logo background.
let VideoView: any = null;
let useVideoPlayer: any = null;
let videoAvailable = false;

try {
  const mod = require('expo-video');
  VideoView = mod.VideoView;
  useVideoPlayer = mod.useVideoPlayer;
  videoAvailable = true;
} catch {
  videoAvailable = false;
}

// ── Video background (its own component so hooks are unconditional) ───────────
function VideoBackground() {
  const player = useVideoPlayer(SPLASH_VIDEO, (p: any) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      style={StyleSheet.absoluteFillObject}
      player={player}
      contentFit="cover"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

// ── Static fallback when expo-video is unavailable ────────────────────────────
function StaticBackground() {
  return (
    <Animated.View
      entering={FadeIn.duration(600)}
      style={[StyleSheet.absoluteFillObject, styles.fallbackBg]}
    >
      <View style={styles.fallbackLogo}>
        <LogoImage variant="white" height={64} animateOnMount={false} />
      </View>
      <View style={styles.fallbackGlow} />
    </Animated.View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function OnboardingSplash() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowButton(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const goNext = useCallback(() => {
    router.replace('/(auth)/about');
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: '#0A0D0D' }]}>
      {/* Video background or static fallback */}
      {videoAvailable ? <VideoBackground /> : <StaticBackground />}

      {/* Get Started button — fades in after 2.5 s */}
      {showButton && (
        <Animated.View
          entering={FadeInUp.delay(100).duration(500)}
          exiting={FadeOut.duration(200)}
          style={[styles.btnWrap, { bottom: insets.bottom + 40 }]}
        >
          <Animated.View
            entering={FadeInDown.delay(200).duration(400)}
          >
            <TouchableOpacity
              style={styles.btnTouch}
              onPress={goNext}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>
                {t('onb_splash_get_started')}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBg: {
    backgroundColor: '#111916',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackLogo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackGlow: {
    position: 'absolute',
    top: '30%',
    alignSelf: 'center',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(46, 158, 122, 0.08)',
  },
  btnWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  btnTouch: {
    backgroundColor: '#2E9E7A',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    minWidth: 200,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#FFFFFF',
    textAlign: 'center',
  },
});
