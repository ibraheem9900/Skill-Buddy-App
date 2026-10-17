import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { formatDateTime } from '@/lib/jobDetail';
import { bidEtaParts, formatBidPriceLocale, type BidLocale } from '@/lib/bid';
import { myBidsCardMeta, myBidsRelativeTime } from '@/lib/myBids';
import type { BidResponse, BidStatus } from '@/types';

interface Props {
  bid: BidResponse;
  /** The job's title, once the lazy read has answered (null until then). */
  title: string | null;
  /** The title read failed: the card shows the "Job #id" fallback instead. */
  titleFailed?: boolean;
  onPress: () => void;
}

/**
 * One row of the provider's My Bids list.
 *
 * WHAT IT SHOWS, AND WHERE EACH VALUE COMES FROM
 *   - the job's title — a SECOND request, since /bids/mine carries no job info
 *     (hooks/useMyBids asks for the visible cards' titles through a three-at-a-
 *     time limiter and caches them). Until it answers, and when it fails, the
 *     row names the job as "Job #<id>" — never blank and never a spinner where a
 *     title belongs.
 *   - the offered price, locale-formatted from the wire's decimal STRING
 *     (formatBidPriceLocale); a value that cannot be parsed renders nothing
 *     rather than NaN.
 *   - the ETA with the SAME label decision as the bid screens (bidEtaParts).
 *   - the translated status badge and the provider's own submission time.
 *   - the outcome timestamp ONLY when the status is the outcome it belongs to
 *     (myBidsCardMeta → lib/bid.bidStatusStamp), because the docs' example fills
 *     accepted_at/rejected_at on a PENDING bid.
 *   - the client's reason ONLY on a REJECTED bid (lib/bid.bidRejectionReason).
 *
 * NO SCORES: distance_score … total_score and is_recommended are never read here
 * or anywhere downstream — they are the backend's ranking data.
 */
export default function MyBidsCard({ bid, title, titleFailed = false, onPress }: Props) {
  const { colors: c } = useTheme();
  const { language, t } = useLanguage();

  const locale = language as BidLocale;
  const price = formatBidPriceLocale(bid.offered_price, locale);
  const eta = bidEtaParts(bid.eta_minutes);
  const meta = myBidsCardMeta(bid, price, eta);

  const etaText = eta
    ? eta.kind === 'now'
      ? t('jobd_bid_eta_now')
      : eta.kind === 'minutes'
        ? t('jobd_bid_eta_min', { n: eta.minutes })
        : t('jobd_bid_eta_hm', { h: eta.hours, m: eta.minutes })
    : null;

  const statusKey = meta.statusKey;
  const relative = myBidsRelativeTime(meta.submittedAt, Date.now());
  const submittedText = relative ? t(relative.key, relative.params) : formatDateTime(meta.submittedAt);

  /** The badge's accent: existing theme tokens only, per status. */
  const badge = (status: BidStatus): { bg: string; fg: string } => {
    switch (status) {
      case 'ACCEPTED':
        return { bg: c.successLight, fg: c.success };
      case 'REJECTED':
        // `urgentLight` is the palette's destructive tint (constants/colors.ts).
        return { bg: c.urgentLight, fg: c.destructive };
      case 'PENDING':
        return { bg: c.primaryLight, fg: c.primary };
      default:
        // WITHDRAWN / EXPIRED: a decided, shaded-out state.
        return { bg: c.muted, fg: c.mutedForeground };
    }
  };
  const tone = badge(bid.status);

  const jobTitle =
    title && title.trim().length > 0 ? title : t('mybids_job_fallback', { id: bid.job_id });

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={jobTitle}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {jobTitle}
        </Text>
        {statusKey ? (
          <View style={[styles.badge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.badgeText, { color: tone.fg }]}>{t(statusKey)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        {meta.price ? <Text style={[styles.price, { color: c.text }]}>{meta.price}</Text> : null}
        {etaText ? (
          <View style={styles.etaRow}>
            <Feather name="clock" size={12} color={c.mutedForeground} />
            <Text style={[styles.eta, { color: c.mutedForeground }]}>{etaText}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footRow}>
        {submittedText ? (
          <Text style={[styles.time, { color: c.mutedForeground }]} numberOfLines={1}>
            {submittedText}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {titleFailed && !title ? (
          <Feather name="help-circle" size={12} color={c.mutedForeground} />
        ) : null}
      </View>

      {meta.stamp ? (
        <View style={[styles.stampRow, { borderTopColor: c.border }]}>
          <Text style={[styles.stampLabel, { color: c.mutedForeground }]}>{t(meta.stamp.labelKey)}</Text>
          <Text style={[styles.stampValue, { color: c.text }]}>
            {formatDateTime(meta.stamp.value) ?? ''}
          </Text>
        </View>
      ) : null}

      {meta.reason ? (
        <View style={[styles.reasonBlock, { borderTopColor: c.border }]}>
          <Feather name="message-square" size={12} color={c.mutedForeground} />
          <Text style={[styles.reason, { color: c.mutedForeground }]}>{meta.reason}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  price: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eta: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 11 },
  stampRow: { borderTopWidth: 1, paddingTop: 8, flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  stampLabel: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  stampValue: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  reasonBlock: { borderTopWidth: 1, paddingTop: 8, flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  reason: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
});
