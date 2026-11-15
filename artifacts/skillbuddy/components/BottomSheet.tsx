import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';

const POPUP_EASING_IN = Easing.out(Easing.quad);
const POPUP_EASING_OUT = Easing.in(Easing.quad);
const DISMISS_FRACTION = 0.25;

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
  /** Optional fixed height. Defaults to the shared 72%-of-window clamp. */
  height?: number;
}

/**
 * One bottom sheet for the whole app.
 *
 * Fade-in only on open (the app-wide motion rule), then:
 *  - drag the handle or the header down to dismiss,
 *  - release past ~25% of the sheet height or with downward velocity,
 *  - snap back otherwise,
 *  - the backdrop fades with the drag,
 *  - the Android back button closes it,
 *  - the sheet stays above the navigation bar with a safe-area pad,
 *  - the sheet resizes above the keyboard.
 *
 * The content owns its scrolling and is not part of the drag gesture, so a
 * scroll can never fight the dismiss.
 */
export default function BottomSheet({
  visible,
  onClose,
  title,
  header,
  body,
  footer,
  children,
  height,
}: Props) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);

  const sheetHeight = useMemo(() => {
    const maxHeight = Math.max(windowHeight - insets.top - 24, 240);
    const desired =
      height ?? Math.min(Math.max(windowHeight * 0.72, 340), maxHeight);
    return Math.round(Math.min(desired, maxHeight));
  }, [height, windowHeight, insets.top]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      dragY.value = 0;
      progress.value = withTiming(1, {
        duration: POPUP_FADE_IN_MS,
        easing: POPUP_EASING_IN,
      });
      return;
    }
    if (!rendered) return;
    progress.value = withTiming(
      0,
      { duration: POPUP_FADE_OUT_MS, easing: POPUP_EASING_OUT },
      (finished) => {
        'worklet';
        if (finished) runOnJS(setRendered)(false);
      }
    );
    // `rendered` is intentionally omitted: the close animation must not restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Let taps (the X button) reach their child; only a real downward move
        // starts the drag.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_evt, gesture) => {
          dragY.value = Math.max(0, gesture.dy);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const shouldDismiss =
            gesture.dy > sheetHeight * DISMISS_FRACTION || gesture.vy > 1.1;
          if (shouldDismiss) {
            dragY.value = withTiming(sheetHeight, { duration: 180 }, (finished) => {
              'worklet';
              if (finished) runOnJS(onClose)();
            });
          } else {
            dragY.value = withSpring(0, { damping: 22, stiffness: 240 });
          }
        },
        onPanResponderTerminate: () => {
          dragY.value = withSpring(0, { damping: 22, stiffness: 240 });
        },
      }),
    [dragY, onClose, sheetHeight]
  );

  const fadeStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * Math.max(0, 1 - dragY.value / Math.max(sheetHeight * 1.5, 1)),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: dragY.value }],
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
            style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={title}
          />
        </Animated.View>

        <KeyboardAvoidingView
          pointerEvents="box-none"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                height: sheetHeight,
                paddingBottom: Math.max(insets.bottom, 16),
                backgroundColor: c.surface,
                borderColor: c.border,
                shadowColor: c.shadowMd,
              },
              sheetStyle,
            ]}
          >
            <View {...panResponder.panHandlers} style={styles.dragArea}>
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
            </View>

            {header}
            {body}
            <View style={styles.body}>{children}</View>
            {footer}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  keyboardWrap: { flex: 1, justifyContent: 'flex-end' },
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
  dragArea: { paddingTop: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
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
