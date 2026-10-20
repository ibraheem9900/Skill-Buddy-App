import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useBidResults } from '@/context/BidResultsContext';
import { bidResultBannerMessage } from '@/lib/bidResults';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';

/**
 * The provider's live bid result, announced app-wide.
 *
 * Rendered ONCE (app/_layout.tsx), driven entirely by context/BidResultsContext:
 * a `bid.accepted` / `bid.rejected` frame produces the banner, the context timer
 * dismisses it, and nothing here subscribes to the socket itself.
 *
 * WHY IT DOES NOT NAVIGATE: the provider may be typing a bid on another job when
 * the answer arrives, so the banner only OFFERS the job — the View action is the
 * provider's own choice. "You were selected for <job>" and the backend's own
 * rejection reason come from lib/bidResults; a null reason reads as the
 * translated default ("Another provider was selected.").
 *
 * It is positioned below the safe-area top inset and above the navigation bar, so
 * it is never hidden by a notch or the Android system bar, and it is dismissible
 * by tapping anywhere on it (the X is a visible affordance for the same action).
 */
export default function BidResultBanner() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { banner, dismissBanner } = useBidResults();

  if (!banner) return null;

  const accepted = banner.result.kind === 'accepted';
  const message = bidResultBannerMessage(banner.content, t);

  const open = () => {
    dismissBanner();
    router.push(`/job/${banner.jobId}` as any);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(POPUP_FADE_IN_MS)}
      exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
      style={[styles.wrap, { top: insets.top + 8 }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={[
          styles.card,
          {
            backgroundColor: c.card,
            borderColor: accepted ? c.success : c.destructive,
          },
        ]}
        onPress={dismissBanner}
        accessibilityRole="button"
        accessibilityLabel={t('mybids_result_dismiss')}
      >
        <View style={[styles.icon, { backgroundColor: accepted ? c.successLight : c.urgentLight }]}>
          <Feather
            name={accepted ? 'check-circle' : 'x-circle'}
            size={16}
            color={accepted ? c.success : c.destructive}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {banner.content.titleKey === 'mybids_result_accepted_title'
              ? t('mybids_result_accepted_title', {
                  title: banner.content.titleParams.title || t('mybids_result_this_job'),
                })
              : t('mybids_result_rejected_title')}
          </Text>
          {message ? (
            <Text style={[styles.message, { color: c.mutedForeground }]} numberOfLines={2}>
              {message}
            </Text>
          ) : null}
          <TouchableOpacity
            style={[styles.action, { backgroundColor: c.primary }]}
            onPress={open}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={[styles.actionText, { color: c.primaryForeground }]}>
              {t('mybids_result_view')}
            </Text>
          </TouchableOpacity>
        </View>

        <Feather name="x" size={14} color={c.mutedForeground} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, lineHeight: 18 },
  message: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17, marginTop: 2 },
  action: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  actionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
