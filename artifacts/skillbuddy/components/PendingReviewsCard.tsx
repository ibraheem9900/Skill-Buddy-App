import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { POPUP_FADE_IN_MS, POPUP_FADE_OUT_MS } from '@/lib/motion';
import { pendingCountKey, urgencyLevel, timeLeft } from '@/lib/reviews';
import { usePendingReviews } from '@/hooks/usePendingReviews';
import { useRole } from '@/context/RoleContext';

/**
 * The Home reminder: one compact, dismissible card, never a modal.
 *
 * Non-blocking by design (lib/reviews PENDING_REVIEW_IS_BLOCKING = false): it
 * only offers a way in, it never stops the user from using the app.
 *
 *  • hidden entirely when nothing is pending, while loading, or when the call
 *    fails (a failed pending call must never break Home — no error UI here)
 *  • gold accent + "Less than 24 hours left" when the soonest deadline is ≤24h
 *  • the "x" hides it for THIS session only: it returns on the next launch, or
 *    immediately when a NEW pending job appears (the dismissed signature is the
 *    sorted job-id list)
 *  • "Review now" opens the single review screen when exactly one job is
 *    pending, otherwise the "Reviews to write" list
 */
let dismissedSignature: string | null = null;

function signatureOf(jobIds: number[]): string {
  return [...jobIds].sort((a, b) => a - b).join(',');
}

export default function PendingReviewsCard() {
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const router = useRouter();
  const { items, count, soonest, status } = usePendingReviews();
  const { activeRole } = useRole();

  const dismiss = useCallback(() => {
    dismissedSignature = signatureOf(items.map((item) => item.job_id));
  }, [items]);

  const open = useCallback(() => {
    if (count === 1) {
      // Exactly one job → straight into the existing review screen. Its own
      // guard (GET /jobs/{id}/reviews) still decides whether the form opens.
      const context = activeRole === 'PROVIDER' ? 'PROVIDER_REVIEW' : 'CLIENT_REVIEW';
      router.push(`/feedback/${context}?jobId=${items[0].job_id}&role=${activeRole}` as any);
      return;
    }
    router.push('/reviews/pending' as any);
  }, [activeRole, count, items, router]);

  if (status !== 'ready' || count === 0) return null;
  if (dismissedSignature === signatureOf(items.map((item) => item.job_id))) return null;

  const level = urgencyLevel(soonest?.review_deadline);
  const left = timeLeft(soonest?.review_deadline);
  const urgent = level === 'SOON';

  return (
    <Animated.View
      entering={FadeIn.duration(POPUP_FADE_IN_MS)}
      exiting={FadeOut.duration(POPUP_FADE_OUT_MS)}
      style={[
        styles.wrap,
        {
          backgroundColor: urgent ? c.goldLight : c.card,
          borderColor: urgent ? c.gold : c.border,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: urgent ? c.goldLight : c.primaryLight }]}>
        <Feather name="star" size={16} color={urgent ? c.gold : c.primary} />
      </View>

      <View style={styles.body}>
        <Text style={[styles.title, { color: c.text }]}>
          {t(pendingCountKey(count, language), { n: count })}
        </Text>
        {soonest ? (
          <Text style={[styles.hint, { color: urgent ? c.gold : c.mutedForeground }]}>
            {urgent
              ? t('fb_pending_less_24')
              : left.known
                ? t('fb_pending_soonest_days', { n: Math.max(1, left.days) })
                : ''}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.action, { borderColor: urgent ? c.gold : c.primary }]}
          onPress={open}
          activeOpacity={0.85}
        >
          <Text style={[styles.actionText, { color: urgent ? c.gold : c.primary }]}>
            {t('fb_pending_review_now')}
          </Text>
          <Feather name="chevron-right" size={14} color={urgent ? c.gold : c.primary} />
        </TouchableOpacity>
      </View>

      {/* Session-only dismiss — it is NOT persisted, so nothing is lost. */}
      <TouchableOpacity
        onPress={dismiss}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={t('fb_pending_dismiss')}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Feather name="x" size={16} color={c.mutedForeground} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 6 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, lineHeight: 19 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 2,
  },
  actionText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  close: { padding: 2 },
});
