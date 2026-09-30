import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

/**
 * MediaVideo — renders a VIDEO media item with the app's video player.
 *
 * WHY NOT EXPO-IMAGE: `media_url` may point at a video for entries whose
 * `media_type` contains "video"; handing that URL to <Image> renders nothing
 * (a blank box at best). Videos therefore always go through expo-video.
 *
 * This mirrors the guarded pattern already used by the onboarding splash
 * (app/(auth)/onboarding.tsx): expo-video is required ONCE at module scope, so
 * a device where the native module failed to link degrades to an icon
 * placeholder instead of crashing the screen. The player hooks live in their
 * own child component so they are never called conditionally.
 *
 * Props are deliberately small: `cover` crops like the app's images
 * (contentFit="cover") so a tile never distorts or leaves blank space, and
 * `controls` defaults to true so a gallery tile is tappable-to-play instead of
 * auto-playing a grid of videos.
 */

let VideoView: any = null;
let useVideoPlayer: any = null;
let videoAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-video');
  VideoView = mod.VideoView;
  useVideoPlayer = mod.useVideoPlayer;
  videoAvailable = true;
} catch {
  videoAvailable = false;
}

export interface MediaVideoProps {
  url: string;
  style?: StyleProp<ViewStyle>;
  /** Crop to fill the box (same as the app's image handling). */
  cover?: boolean;
  /** Show native play/pause controls. Default true. */
  controls?: boolean;
  /** Start playing immediately (muted) — used for the hero cover only. */
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}

function MediaVideoPlayer({
  url,
  style,
  cover = true,
  controls = true,
  autoplay = false,
  muted = true,
  loop = false,
}: MediaVideoProps) {
  const player = useVideoPlayer(url, (p: any) => {
    p.muted = muted;
    p.loop = loop;
    if (autoplay) p.play();
  });

  return (
    <VideoView
      style={style}
      player={player}
      contentFit={cover ? 'cover' : 'contain'}
      nativeControls={controls}
      allowsPictureInPicture={false}
    />
  );
}

/** Shown when expo-video is not available on this build/device. */
function MediaVideoFallback({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors: c } = useTheme();

  return (
    <View
      style={[
        styles.fallback,
        { backgroundColor: c.muted, borderColor: c.border },
        style,
      ]}
    >
      <Feather name="video" size={26} color={c.mutedForeground} />
    </View>
  );
}

export function MediaVideo(props: MediaVideoProps) {
  if (!videoAvailable) return <MediaVideoFallback style={props.style} />;
  return <MediaVideoPlayer {...props} />;
}

export default MediaVideo;

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
