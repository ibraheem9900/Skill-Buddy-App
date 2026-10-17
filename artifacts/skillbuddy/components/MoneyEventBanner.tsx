import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useMoneyEvents } from '@/context/MoneyEventsContext';
import { formatMoneyAmount, moneyBannerTarget, type MoneyBannerTone } from '@/lib/moneyEvents';

/**
 * A money event, announced app-wide.
 *
 * Rendered ONCE (app/_layout.tsx) and driven entirely by
 * context/MoneyEventsContext: a `payment.*` / `invoice.*` / `escrow.*` /
 * `wallet.credit_earned` frame produces the banner, the context timer dismisses
 * it, and nothing here subscribes to the socket itself.
 *
 * FACTS ONLY. The line is the event's own translated name — "Payment completed",
 * "Funds release scheduled" — and it never claims more than that: the real status
 * of the job is whatever the refetched REST read says, and the app does not
 * restate it here. An amount appears ONLY when the payload carried both an amount
 * and a currency, formatted in the current language, and the screen re-formats on
 * a language switch.
 *
 * IT DOES NOT NAVIGATE ON ITS OWN. The action opens an existing screen — the job
 * when the event named one, otherwise the wallet for the events that move wallet
 * money — and events with neither just dismiss.
 */

const TONE_ICON: Record<MoneyBannerTone, React.ComponentProps<typeof Feather>['name']> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/**
 * `topOffset` lifts this banner so it never sits under another global banner
 * (the bid-result banner occupies the same corner). Kept as a prop so this
 * component stays unaware of what else the layout renders.
 */
export default function MoneyEventBanner({ topOffset = 0 }: { topOffset?: number }) {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { banner, dismissBanner } = useMoneyEvents();

  if (!banner) return null;

  const { content } = banner;
  const target = moneyBannerTarget(content);
  const amountText = formatMoneyAmount(content.amount, language);

  const toneColor =
    content.tone === 'success'
      ? c.success
      : content.tone === 'warning'
        ? c.urgent
        : content.tone === 'danger'
          ? c.destructive
          : c.primary;
  const toneBackground =
    content.tone === 'success'
      ? c.successLight
      : content.tone === 'warning' || content.tone === 'danger'
        ? c.urgentLight
        : c.surface;

  const open = () => {
    dismissBanner();
    if (!target) return;
    if (target.kind === 'job') router.push(`/job/${target.jobId}` as any);
    else router.push('/profile/wallet' as any);
  };

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { top: insets.top + 8 + topOffset }]}
      pointerEvents="box-none"
    >
      <Pressable
        style={[styles.card, { backgroundColor: c.card, borderColor: toneColor }]}
        onPress={dismissBanner}
        accessibilityRole="button"
        accessibilityLabel={t('mybids_result_dismiss')}
      >
        <View style={[styles.icon, { backgroundColor: toneBackground }]}>
          <Feather name={TONE_ICON[content.tone]} size={16} color={toneColor} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {t(content.titleKey)}
          </Text>
          {amountText ? (
            <Text style={[styles.message, { color: c.mutedForeground }]} numberOfLines={1}>
              {amountText}
            </Text>
          ) : null}
          {target ? (
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
          ) : null}
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
