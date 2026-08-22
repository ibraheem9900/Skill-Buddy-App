import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import Animated, {
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { useLanguage } from '@/context/LanguageContext';

// Full-screen looping brand intro (logo + wordmark reveal, baked into the
// video itself — see assets/videos/splash-intro.mp4). This replaces the
// previous static-logo "breathing" animation.
const SPLASH_VIDEO = require('@/assets/videos/splash-intro.mp4');

export default function OnboardingSplash() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useLanguage();

  // Button visibility (appears after ~2.5s, same timing as before)
  const [showButton, setShowButton] = React.useState(false);

  const player = useVideoPlayer(SPLASH_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    // Show button after 2.5 seconds — video keeps looping behind it.
    const timer = setTimeout(() => setShowButton(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: '#0A0D0D' }]}>
      {/* Full-screen looping intro video */}
      <VideoView
        style={StyleSheet.absoluteFillObject}
        player={player}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />

      {/* Get Started button — fades in + slides up, same as before */}
      {showButton && (
        <Animated.View
          entering={FadeInUp.delay(100).duration(500)}
          style={[styles.btnWrap, { bottom: insets.bottom + 40 }]}
        >
          <Animated.View
            entering={FadeInDown.delay(200).duration(400)}
          >
            <Text
              style={styles.btnText}
              onPress={() => router.replace('/(auth)/about' as any)}
            >
              {t('onb_splash_get_started')}
            </Text>
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
  btnWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 17,
    color: '#FFFFFF',
    backgroundColor: '#2E9E7A',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    overflow: 'hidden',
    textAlign: 'center',
    minWidth: 200,
    textAlignVertical: 'center',
  },
});
