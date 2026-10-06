import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Optional pinned block under the title (e.g. the search field). */
  header?: React.ReactNode;
  /** Optional non-scrolling content, rendered under the scrollable body. */
  body?: React.ReactNode;
  /** Optional pinned footer (e.g. the confirm button of a picker). */
  footer?: React.ReactNode;
  /** Scrollable content. */
  children?: React.ReactNode;
}

const WINDOW = Dimensions.get('window');

/**
 * One sheet, used by EVERY picker on the Post-a-Job screen (country, county,
 * city, category, service, custom date & time) so all of them are positioned
 * and styled identically.
 *
 * Positioning contract:
 *  - the sheet has a FIXED height (a fraction of the window, clamped), so its
 *    top edge always lands in the same place and its header + search field are
 *    immediately visible — it can never be pushed off the bottom of the screen
 *    by a long list. The list itself scrolls INSIDE the sheet.
 *  - the bottom safe-area inset is padded, so the last row is never hidden
 *    behind the Android/iOS navigation bar.
 *
 * Animation: the backdrop fades while the sheet slides up (open) and down
 * (close); the close animation finishes before the modal unmounts, so it is
 * smooth in both directions instead of snapping shut.
 */
export default function BottomSheet({
  visible,
  onClose,
  title,
  header,
  body,
  footer,
  children,
}: Props) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();

  // Kept mounted while the close animation plays.
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(0);

  const sheetHeight = Math.round(
    Math.min(Math.max(WINDOW.height * 0.72, 340), Math.max(WINDOW.height - insets.top - 24, 340))
  );

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.value = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
      return;
    }
    if (!rendered) return;
    progress.value = withTiming(
      0,
      { duration: 190, easing: Easing.in(Easing.cubic) },
      (finished) => {
        'worklet';
        if (finished) runOnJS(setRendered)(false);
      }
    );
    // `rendered` is intentionally not a dependency: it must not restart the
    // animation when the close callback flips it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (sheetHeight + 60) }],
  }));

  if (!rendered) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: c.overlay }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={title}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: c.surface,
              borderColor: c.border,
              shadowColor: c.shadowMd,
            },
            sheetStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={[styles.head, { borderBottomColor: c.border }]}>
            <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
              {title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={title}
            >
              <Feather name="x" size={20} color={c.mutedForeground} />
            </TouchableOpacity>
          </View>

          {header}
          {body}
          <View style={styles.body}>{children}</View>
          {footer}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {},
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 18,
    shadowOpacity: 1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -6 },
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: 10 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 16, flex: 1, marginRight: 12 },
  body: { flex: 1 },
});
