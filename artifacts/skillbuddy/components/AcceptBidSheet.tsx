import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BottomSheet from '@/components/BottomSheet';
import {
  bidEtaParts,
  formatBidPriceLocale,
  milestoneScheduleRange,
  type BidLocale,
} from '@/lib/bid';
import { formatDateTime, parseIsoDate } from '@/lib/jobDetail';
import { formatScheduleLabel, splitTable } from '@/lib/jobSchedule';
import type { BidResponse, JobResponse } from '@/types';

interface Props {
  visible: boolean;
  /** The offer the client is about to accept (the one the dialog is showing). */
  bid: BidResponse | null;
  /** The job the offer belongs to — its title and dates are part of the summary. */
  job: JobResponse | null;
  locale: BidLocale;
  /**
   * The offer was EDITED (or replaced) while this dialog was open: the summary
   * below already shows the new values, and the client is told to review them
   * before confirming again.
   */
  changed: boolean;
  /** A confirm is in flight: every control is locked, no second submit. */
  confirming: boolean;
  onBack: () => void;
  onConfirm: () => void;
}

/**
 * The CLIENT's confirmation before an Accept Bid
 * (POST /api/v1/jobs/{job_id}/bids/{bid_id}/accept).
 *
 * It shows exactly what the client is committing to, all of it from the server's
 * own objects: the provider (photo/name/tier), the price and the expected time
 * from the bid, and the job's title plus its date/time from the job (with both
 * ends named for a MULTI_DAY job, which has several milestones).
 *
 * TWO things are stated in words because they are not visible in the numbers:
 *   - the choice is FINAL (accepting is irreversible without the cancellation
 *     module, a separate task), and
 *   - the next step is PAYMENT: the spec's post-accept state is "bidder
 *     finalized, payment not yet made", so the job is not assigned yet.
 * There is no Pay button here and no payment endpoint is called — payment is a
 * later task.
 *
 * Nothing is scored or ranked: no *_score field and no `is_recommended` is read
 * anywhere in this component.
 *
 * "Back" closes the dialog and sends NO request.
 */
export default function AcceptBidSheet({
  visible,
  bid,
  job,
  locale,
  changed,
  confirming,
  onBack,
  onConfirm,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [photoFailed, setPhotoFailed] = useState(false);

  const row = (label: string, value: string | null) =>
    value === null ? null : (
      <View key={label} style={[styles.row, { borderTopColor: c.border }]}>
        <Text style={[styles.rowLabel, { color: c.mutedForeground }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: c.text }]}>{value}</Text>
      </View>
    );

  const price = bid ? formatBidPriceLocale(bid.offered_price, locale) : null;
  const eta = bid ? bidEtaParts(bid.eta_minutes) : null;
  const etaText = eta
    ? eta.kind === 'now'
      ? t('jobd_bid_eta_now')
      : eta.kind === 'minutes'
        ? t('jobd_bid_eta_min', { n: eta.minutes })
        : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })
    : null;

  // The job's date/time in the app's own translated tables (no Intl, no English
  // hardcoded): `scheduled_at` is the job's own field, and the milestones give
  // the first and last day when the booking spans more than one.
  const months = splitTable(t('post_sched_months'));
  const weekdays = splitTable(t('post_sched_weekdays'));
  const range = milestoneScheduleRange(job);
  const scheduledIso = job?.scheduled_at ?? range?.first ?? null;
  const scheduled = parseIsoDate(scheduledIso);
  const whenText = scheduled
    ? formatScheduleLabel(scheduled, months, weekdays)
    : formatDateTime(scheduledIso);
  const firstDay = range ? parseIsoDate(range.first) : null;
  const lastDay = range ? parseIsoDate(range.last) : null;
  const multiDay =
    !!firstDay && !!lastDay && firstDay.getTime() !== lastDay.getTime();
  const spanText = multiDay
    ? `${formatScheduleLabel(firstDay!, months, weekdays)} – ${formatScheduleLabel(
        lastDay!,
        months,
        weekdays
      )}`
    : null;

  const provider = bid?.provider ?? null;
  const photo = provider?.profile_photo_url ?? null;
  const showPhoto = !!photo && !photoFailed;
  const initial = provider?.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <BottomSheet
      visible={visible}
      onClose={onBack}
      title={t('cbids_accept_title')}
      footer={
        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.back, { borderColor: c.border }]}
              onPress={onBack}
              disabled={confirming}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={[styles.backText, { color: c.text }]}>{t('cbids_accept_back')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirm,
                { backgroundColor: c.primary },
                confirming && styles.confirmBusy,
              ]}
              onPress={onConfirm}
              disabled={confirming}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              {confirming ? (
                <ActivityIndicator size="small" color={c.primaryForeground} />
              ) : (
                <Feather name="check" size={16} color={c.primaryForeground} />
              )}
              <Text style={[styles.confirmText, { color: c.primaryForeground }]}>
                {confirming ? t('cbids_accept_working') : t('cbids_accept_confirm')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
    >
      {bid ? (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {changed ? (
            <View style={[styles.notice, { borderColor: c.primary, backgroundColor: c.muted }]}>
              <Feather name="alert-circle" size={14} color={c.primary} />
              <Text style={[styles.noticeText, { color: c.text }]}>
                {t('cbids_accept_changed')}
              </Text>
            </View>
          ) : null}

          <View style={styles.head}>
            {showPhoto ? (
              <Image
                source={{ uri: photo as string }}
                style={styles.avatar}
                contentFit="cover"
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: c.muted }]}>
                <Text style={[styles.avatarInitial, { color: c.primary }]}>{initial}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                {provider?.name ?? ''}
              </Text>
              {provider?.badge_tier ? (
                <Text style={[styles.tier, { color: c.primary }]}>{provider.badge_tier}</Text>
              ) : null}
            </View>
          </View>

          <View style={[styles.priceBlock, { borderColor: c.border, backgroundColor: c.muted }]}>
            <Text style={[styles.priceLabel, { color: c.mutedForeground }]}>
              {t('cbids_accept_price')}
            </Text>
            {price ? <Text style={[styles.price, { color: c.primary }]}>{price}</Text> : null}
            <Text style={[styles.priceHint, { color: c.mutedForeground }]}>
              {t('cbids_accept_price_hint')}
            </Text>
          </View>

          {row(t('cbids_accept_job'), job?.title ?? null)}
          {row(t('cbids_accept_when'), whenText)}
          {row(t('cbids_accept_span'), spanText)}
          {row(t('jobd_bid_summary_eta'), etaText)}

          <View style={[styles.noteBlock, { borderTopColor: c.border }]}>
            <Feather name="lock" size={14} color={c.mutedForeground} />
            <Text style={[styles.noteText, { color: c.mutedForeground }]}>
              {t('cbids_accept_final_note')}
            </Text>
          </View>
          <View style={[styles.noteBlock, { borderTopColor: c.border }]}>
            <Feather name="credit-card" size={14} color={c.mutedForeground} />
            <Text style={[styles.noteText, { color: c.mutedForeground }]}>
              {t('cbids_accept_payment_note')}
            </Text>
          </View>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  name: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  tier: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 2 },
  priceBlock: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  priceLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  priceHint: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  row: { borderTopWidth: 1, paddingVertical: 10, gap: 3 },
  rowLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  rowValue: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  noteBlock: { borderTopWidth: 1, paddingTop: 12, marginTop: 4, flexDirection: 'row', gap: 8 },
  noteText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18, flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  noticeText: { fontFamily: 'Manrope_500Medium', fontSize: 12, flex: 1, lineHeight: 17 },
  footer: { borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  back: { flex: 1, borderWidth: 1, borderRadius: 24, paddingVertical: 12, alignItems: 'center' },
  backText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  confirm: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    paddingVertical: 12,
  },
  confirmBusy: { opacity: 0.75 },
  confirmText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
