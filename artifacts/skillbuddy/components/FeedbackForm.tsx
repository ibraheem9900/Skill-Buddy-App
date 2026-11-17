import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import DotsLoader from '@/components/DotsLoader';
import ImageAttachmentPicker from '@/components/ImageAttachmentPicker';
import ReviewPhotoEditor from '@/components/ReviewPhotoEditor';
import { useImageAttachmentUploader } from '@/hooks/useImageAttachmentUploader';
import { useReviewPhotos } from '@/hooks/useReviewPhotos';
import { useSubmitReview } from '@/hooks/useSubmitReview';
import {
  feedbackKind,
  feedbackOptionsAsChips,
  feedbackProblem,
  feedbackShowsImages,
  feedbackShowsRating,
  selectedFeedbackOption,
  type FeedbackContext,
  type FeedbackFailureKind,
  type FeedbackOption,
  type FeedbackProblem,
} from '@/lib/feedback';
import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_COMMENT_MAX,
  buildReviewPayload,
  isReviewDraftEmpty,
  ratingLabelIndex,
  reviewProblem,
  selectedOtherOption,
  toggleReviewOption,
  type ReviewFailureKind,
  type ReviewProblem,
} from '@/lib/reviews';
import { useFeedbackOptions } from '@/hooks/useFeedbackOptions';
import {
  isFeedbackEndpointNotAvailable,
  submitFeedback,
  uploadDisputeImage,
  type FeedbackSubmissionDraft,
  type JobReview,
  type TaskFeedback,
} from '@/services/feedback';

/**
 * FeedbackForm — ONE form for all seven feedback contexts AND the job review.
 *
 * Everything context-specific comes from lib/feedback (which fields a context
 * shows) plus the translation keys below; the layout, colours and states are
 * shared, so the client and the pilot get the same design with different copy.
 *
 * REVIEW MODE (CLIENT_REVIEW / PROVIDER_REVIEW): the real
 * POST /api/v1/jobs/{job_id}/reviews is wired here through
 * hooks/useSubmitReview — 1–5 stars with a label, multi-select option chips,
 * an optional comment (with the `is_other` text merged into it, because the API
 * has no separate field), the show_publicly switch and a per-field 422 error
 * under the matching input.
 *
 * Option labels are rendered exactly as the backend sends them (admins manage
 * them, so they are never translated client-side). The list is shown in
 * sort_order ascending and comes from the cached useFeedbackOptions hook; a
 * failed options read does NOT block a review — it can still be sent with a
 * rating and a comment, and option_ids just stays empty.
 *
 * The remaining contexts (denial / dispute / cancellation) have no submit
 * endpoint yet: services/feedback.submitFeedback throws a clearly marked stub,
 * which becomes a neutral "not available yet" notice here — never a fake
 * success. TODO(feedback-submit): replace that stub when the API is published.
 */

const OPTION_LABEL_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_options_review',
  PROVIDER_REVIEW: 'fb_options_review',
  MILESTONE_DENIAL: 'fb_options_denial',
  DISPUTE_BY_CLIENT: 'fb_options_dispute',
  DISPUTE_BY_PROVIDER: 'fb_options_dispute',
  CLIENT_CANCELLATION: 'fb_options_cancel',
  PROVIDER_CANCELLATION: 'fb_options_cancel',
};

const COMMENT_LABEL_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_comment_label',
  PROVIDER_REVIEW: 'fb_comment_label',
  MILESTONE_DENIAL: 'fb_comment_label',
  DISPUTE_BY_CLIENT: 'fb_desc_label',
  DISPUTE_BY_PROVIDER: 'fb_desc_label',
  CLIENT_CANCELLATION: 'fb_comment_label',
  PROVIDER_CANCELLATION: 'fb_comment_label',
};

const COMMENT_PLACEHOLDER_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_comment_ph',
  PROVIDER_REVIEW: 'fb_comment_ph',
  MILESTONE_DENIAL: 'fb_comment_ph',
  DISPUTE_BY_CLIENT: 'fb_desc_ph',
  DISPUTE_BY_PROVIDER: 'fb_desc_ph',
  CLIENT_CANCELLATION: 'fb_comment_ph',
  PROVIDER_CANCELLATION: 'fb_comment_ph',
};

const SUBMIT_LABEL_KEY: Record<FeedbackContext, TranslationKey> = {
  CLIENT_REVIEW: 'fb_submit_review',
  PROVIDER_REVIEW: 'fb_submit_review',
  MILESTONE_DENIAL: 'fb_submit_submit',
  DISPUTE_BY_CLIENT: 'fb_submit_dispute',
  DISPUTE_BY_PROVIDER: 'fb_submit_dispute',
  CLIENT_CANCELLATION: 'fb_submit_cancel',
  PROVIDER_CANCELLATION: 'fb_submit_cancel',
};

const PROBLEM_KEY: Record<FeedbackProblem, TranslationKey> = {
  rating: 'fb_err_rating',
  option: 'fb_err_option',
  other: 'fb_err_other',
};

const REVIEW_PROBLEM_KEY: Record<ReviewProblem, TranslationKey> = {
  rating: 'fb_err_rating',
  other: 'fb_err_other',
  comment: 'fb_rev_err_comment',
};

/** Rating → the label under the stars (1..5). */
const RATING_LABEL_KEYS: readonly TranslationKey[] = [
  'fb_rating_poor',
  'fb_rating_fair',
  'fb_rating_good',
  'fb_rating_verygood',
  'fb_rating_excellent',
];

/** Reviews: one friendly sentence per server rejection. */
const REVIEW_FAILURE_KEY: Record<ReviewFailureKind, TranslationKey> = {
  network: 'fb_err_network',
  unauthorized: 'fb_err_unauthorized',
  forbidden: 'fb_rev_err_unavailable',
  notfound: 'fb_rev_err_unavailable',
  notclosed: 'fb_rev_err_notclosed',
  window: 'fb_rev_err_window',
  already: 'fb_rev_err_already',
  validation: 'fb_err_generic',
  server: 'fb_err_server',
  rejected: 'fb_rev_err_rejected',
  unknown: 'fb_err_generic',
};

const LOAD_FAILURE_KEY: Record<FeedbackFailureKind, TranslationKey> = {
  unauthorized: 'fb_err_unauthorized',
  validation: 'fb_err_generic',
  network: 'fb_err_network',
  forbidden: 'fb_err_generic',
  notfound: 'fb_err_generic',
  server: 'fb_err_server',
  unknown: 'fb_err_generic',
};

const COMMENT_MAX = REVIEW_COMMENT_MAX;

/** One star: subtle press-scale, then it settles back. */
function StarButton({
  value,
  filled,
  selected,
  label,
  color,
  emptyColor,
  onPress,
  disabled,
}: {
  value: number;
  filled: boolean;
  selected: boolean;
  label: string;
  color: string;
  emptyColor: string;
  onPress: (value: number) => void;
  disabled: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const press = useCallback(() => {
    scale.stopAnimation();
    scale.setValue(1);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.16, useNativeDriver: true, speed: 40, bounciness: 6 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 4 }),
    ]).start();
    onPress(value);
  }, [onPress, scale, value]);

  return (
    <TouchableOpacity
      onPress={press}
      activeOpacity={0.8}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <MaterialIcons name={filled ? 'star' : 'star-border'} size={40} color={filled ? color : emptyColor} />
      </Animated.View>
    </TouchableOpacity>
  );
}

interface Props {
  context: FeedbackContext;
  jobId: number | null;
  milestoneId: number | null;
  /** Called from the success view's button. */
  onDone: () => void;
  /** Review only: the created review (job details refetch, analytics). */
  onSubmitted?: (review: JobReview) => void;
  /** Review only: reports whether there is unsent input (discard dialog). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Reports whether Submit is enabled / in flight (the screen's sticky button). */
  onStateChange?: (state: { canSubmit: boolean; busy: boolean }) => void;
  /**
   * When set, the form does NOT render its own Submit button; the screen renders
   * a sticky one and calls `submitAction.current()`. Used by the review route.
   */
  submitAction?: React.MutableRefObject<(() => void) | null>;
}

export default function FeedbackForm({
  context,
  jobId,
  milestoneId,
  onDone,
  onSubmitted,
  onDirtyChange,
  onStateChange,
  submitAction,
}: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { options, status, failure, refetch } = useFeedbackOptions(context);

  const kind = feedbackKind(context);
  const isReview = kind === 'review';
  const withRating = feedbackShowsRating(context);
  const withImages = feedbackShowsImages(context);
  const asChips = feedbackOptionsAsChips(context);

  const review = useSubmitReview(isReview ? jobId : null);

  const [rating, setRating] = useState(0);
  const [optionId, setOptionId] = useState<number | null>(null);
  const [optionIds, setOptionIds] = useState<number[]>([]);
  const [otherText, setOtherText] = useState('');
  const [comment, setComment] = useState('');
  const [showPublicly, setShowPublicly] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<'pending' | 'failed' | null>(null);

  // Dispute photos. `ownerId` is null because the create-dispute endpoint is
  // still undocumented, so the queue holds the photos locally.
  // TODO(dispute-create → upload chain): once submit returns the new feedback
  // id, pass it here and the queue uploads by itself (and the Task history list
  // must be invalidated — see hooks/useTaskFeedback.invalidateTaskFeedback).
  const disputeImages = useImageAttachmentUploader<TaskFeedback>(
    null,
    0,
    uploadDisputeImage
  );

  // Review photos. The review id is null until Submit returns it; the queue then
  // survives that null → id transition and uploads the prepared photos in order.
  const reviewPhotos = useReviewPhotos(review.review?.id ?? null, 0, jobId);

  const selected = useMemo(() => selectedFeedbackOption(options, optionId), [options, optionId]);
  const otherOption = useMemo(
    () => (isReview ? selectedOtherOption(options, optionIds) : null),
    [isReview, optionIds, options]
  );

  const reviewDraft = useMemo(
    () => ({ rating, optionIds, comment, otherText, showPublicly }),
    [comment, optionIds, otherText, rating, showPublicly]
  );

  const draft = useMemo(
    () => ({ context, optionId, rating, otherText }),
    [context, optionId, rating, otherText]
  );

  const problem = feedbackProblem(draft, options);
  const reviewIssue = reviewProblem(reviewDraft, options);
  // A photo that is still uploading (or has failed) blocks Submit: the dispute
  // would otherwise be created without the picture the user is waiting on.
  const canSubmit = isReview
    ? reviewIssue === null && !review.submitting && !review.submitted
    : problem === null &&
      !submitting &&
      !submitted &&
      status === 'ready' &&
      !disputeImages.uploading &&
      disputeImages.failedCount === 0;

  const succeeded = isReview ? review.submitted : submitted;
  const busy = isReview ? review.submitting : submitting;

  /* Unsent input → the screen can ask before leaving. */
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(!succeeded && !isReviewDraftEmpty(reviewDraft));
  }, [onDirtyChange, reviewDraft, succeeded]);

  useEffect(() => {
    if (!onStateChange) return;
    onStateChange({ canSubmit, busy });
  }, [busy, canSubmit, onStateChange]);

  const pickOption = useCallback((id: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOptionId(id);
    setOtherText('');
    setNotice(null);
  }, []);

  const toggleOption = useCallback((id: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOptionIds((current) => toggleReviewOption(current, id));
    setNotice(null);
  }, []);

  const pickRating = useCallback((value: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRating(value);
    setNotice(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setTouched(true);
    if (isReview) {
      if (!jobId || review.submitting || review.submitted) return;
      if (reviewProblem(reviewDraft, options) !== null) return;
      const created = await review.submit(buildReviewPayload(reviewDraft));
      if (created) onSubmitted?.(created);
      return;
    }
    if (feedbackProblem(draft, options) !== null) return;
    if (submitting) return;
    setNotice(null);
    setSubmitting(true);
    const payload: FeedbackSubmissionDraft = {
      context,
      jobId,
      milestoneId,
      optionId,
      rating: withRating ? rating : null,
      comment: comment.trim(),
      otherText: otherText.trim(),
      images: disputeImages.images.map((image) => image.uri),
    };
    try {
      await submitFeedback(payload);
      // TODO(feedback-submit): reachable once the submit endpoint is wired.
      setSubmitted(true);
    } catch (error) {
      setNotice(isFeedbackEndpointNotAvailable(error) ? 'pending' : 'failed');
    } finally {
      setSubmitting(false);
    }
  }, [
    comment,
    context,
    disputeImages.images,
    draft,
    isReview,
    jobId,
    milestoneId,
    onSubmitted,
    optionId,
    options,
    otherText,
    rating,
    review,
    reviewDraft,
    submitting,
    withRating,
  ]);

  /* The screen's sticky button needs the same handler. */
  useEffect(() => {
    if (!submitAction) return;
    submitAction.current = () => {
      void handleSubmit();
    };
    return () => {
      submitAction.current = null;
    };
  }, [handleSubmit, submitAction]);

  const retryOptions = useCallback(() => {
    void refetch();
  }, [refetch]);

  /* ------------------------------------------------------------- success */

  if (succeeded) {
    return (
      <View style={[styles.successWrap, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[styles.successIcon, { backgroundColor: c.successLight }]}>
          <Feather name="check" size={26} color={c.success} />
        </View>
        <Text style={[styles.successTitle, { color: c.text }]}>
          {isReview ? t('fb_rev_success_title') : t('fb_success_title')}
        </Text>
        <Text style={[styles.successMsg, { color: c.mutedForeground }]}>
          {isReview ? t('fb_rev_success_msg') : t('fb_success_msg')}
        </Text>
        {/* Photos queued before Submit are already uploading by now; keep the
            exact same grid here so progress and partial failures stay visible
            (and retryable) until Done. */}
        {isReview && reviewPhotos.images.length > 0 ? (
          <View style={styles.successPhotos}>
            <ImageAttachmentPicker
              uploader={reviewPhotos}
              existingCount={0}
              labelKey="fb_rev_photos_label"
              addKey="fb_rev_photos_add"
              pendingNoteKey="fb_rev_photos_pending"
              failedNoteKey="fb_rev_photos_failed"
              namePrefix="review"
              canAdd={false}
              showHint={false}
            />
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: c.primary }]}
          onPress={onDone}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, { color: c.primaryForeground }]}>
            {isReview ? t('fb_rev_success_done') : t('fb_success_done')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const loadingOptions = status === 'idle' || status === 'loading';
  const failedOptions = status === 'error';
  const empty = !loadingOptions && !failedOptions && options.length === 0;
  const ratingLabel = ratingLabelIndex(rating);
  const showsOther = isReview ? otherOption !== null : selected?.is_other === true;
  const showFieldError = (field: 'rating' | 'comment') =>
    isReview && review.fieldErrors.includes(field);

  return (
    <View style={styles.form}>
      {/* Rating — review contexts only. */}
      {withRating ? (
        <View style={styles.block}>
          <Text style={[styles.label, { color: c.text }]}>{t('fb_rating_label')}</Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((value) => (
              <StarButton
                key={value}
                value={value}
                filled={value <= rating}
                selected={value === rating}
                label={t('fb_rating_value', { n: value })}
                color={c.rating}
                emptyColor={c.border}
                onPress={pickRating}
                disabled={busy}
              />
            ))}
          </View>
          {ratingLabel >= 0 ? (
            <Text style={[styles.ratingLabel, { color: c.text }]}>
              {t(RATING_LABEL_KEYS[ratingLabel])}
            </Text>
          ) : null}
          {touched && (isReview ? reviewIssue === 'rating' : problem === 'rating') ? (
            <Text style={[styles.errorText, { color: c.destructive }]}>{t(PROBLEM_KEY.rating)}</Text>
          ) : showFieldError('rating') ? (
            <Text style={[styles.errorText, { color: c.destructive }]}>{t(PROBLEM_KEY.rating)}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Options — sort_order, multi-select chips for reviews, rows otherwise. */}
      <View style={styles.block}>
        <Text style={[styles.label, { color: c.text }]}>{t(OPTION_LABEL_KEY[context])}</Text>

        {loadingOptions ? (
          <View style={styles.chipWrap}>
            {[0, 1, 2, 3].map((key) => (
              <View
                key={key}
                style={[
                  styles.chipSkeleton,
                  { backgroundColor: c.muted, borderColor: c.border },
                  key % 2 === 0 ? styles.chipSkeletonWide : null,
                ]}
              />
            ))}
          </View>
        ) : failedOptions ? (
          <View style={[styles.inlineNotice, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="alert-circle" size={16} color={c.destructive} />
            <View style={styles.inlineNoticeBody}>
              <Text style={[styles.inlineNoticeText, { color: c.mutedForeground }]}>
                {isReview
                  ? t('fb_rev_options_error')
                  : t(LOAD_FAILURE_KEY[failure ?? 'unknown'])}
              </Text>
              <TouchableOpacity onPress={retryOptions} activeOpacity={0.8} style={styles.inlineRetry}>
                <Feather name="refresh-cw" size={13} color={c.primary} />
                <Text style={[styles.inlineRetryText, { color: c.primary }]}>
                  {t('fb_try_again')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : empty ? (
          <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Feather name="inbox" size={20} color={c.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: c.text }]}>{t('fb_empty_title')}</Text>
            <Text style={[styles.emptyMsg, { color: c.mutedForeground }]}>{t('fb_empty_msg')}</Text>
          </View>
        ) : asChips ? (
          <View style={styles.chipWrap}>
            {options.map((option) => (
              <ReviewChip
                key={option.id}
                option={option}
                active={optionIds.includes(option.id)}
                disabled={busy}
                onPress={toggleOption}
              />
            ))}
          </View>
        ) : (
          <View style={styles.optionList}>
            {options.map((option) => {
              const active = option.id === optionId;
              return (
                <TouchableOpacity
                  key={option.id}
                  onPress={() => pickOption(option.id)}
                  activeOpacity={0.85}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={[
                    styles.optionRow,
                    {
                      backgroundColor: active ? c.primaryLight : c.card,
                      borderColor: active ? c.primary : c.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.radio,
                      { borderColor: active ? c.primary : c.mutedForeground },
                    ]}
                  >
                    {active ? (
                      <View style={[styles.radioDot, { backgroundColor: c.primary }]} />
                    ) : null}
                  </View>
                  <Text style={[styles.optionText, { color: c.text }]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {touched && !isReview && problem === 'option' && !empty ? (
          <Text style={[styles.errorText, { color: c.destructive }]}>{t(PROBLEM_KEY.option)}</Text>
        ) : null}
        {isReview && review.fieldErrors.includes('option_ids') ? (
          <Text style={[styles.errorText, { color: c.destructive }]}>{t('fb_err_option')}</Text>
        ) : null}
      </View>

      {/* "Other" → free text. In a review it becomes part of the comment. */}
      {showsOther ? (
        <View style={styles.block}>
          <Text style={[styles.label, { color: c.text }]}>{t('fb_other_label')}</Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              {
                backgroundColor: c.input,
                color: c.text,
                borderColor: touched && reviewIssue === 'other' ? c.destructive : c.border,
              },
            ]}
            value={otherText}
            onChangeText={(value) => {
              setOtherText(value);
              setNotice(null);
            }}
            placeholder={t('fb_other_ph')}
            placeholderTextColor={c.mutedForeground}
            multiline
            textAlignVertical="top"
            maxLength={COMMENT_MAX}
            editable={!busy}
          />
          {/* In a review the sticky Submit stays disabled until this text exists,
              so the reason is shown as soon as the "other" chip is picked. */}
          {(touched || (isReview && showsOther)) && otherText.trim().length === 0 ? (
            <Text style={[styles.errorText, { color: c.destructive }]}>{t(PROBLEM_KEY.other)}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Comment (reviews/denial/cancellation) or description (disputes). */}
      <View style={styles.block}>
        <Text style={[styles.label, { color: c.text }]}>{t(COMMENT_LABEL_KEY[context])}</Text>
        <TextInput
          style={[
            styles.input,
            styles.textarea,
            {
              backgroundColor: c.input,
              color: c.text,
              borderColor: showFieldError('comment') ? c.destructive : c.border,
            },
          ]}
          value={comment}
          onChangeText={(value) => {
            setComment(value);
            setNotice(null);
          }}
          placeholder={t(COMMENT_PLACEHOLDER_KEY[context])}
          placeholderTextColor={c.mutedForeground}
          multiline
          textAlignVertical="top"
          maxLength={COMMENT_MAX}
          editable={!busy}
        />
        <Text style={[styles.counter, { color: c.mutedForeground }]}>
          {comment.length}/{COMMENT_MAX}
        </Text>
        {touched && reviewIssue === 'comment' ? (
          <Text style={[styles.errorText, { color: c.destructive }]}>
            {t(REVIEW_PROBLEM_KEY.comment)}
          </Text>
        ) : null}
      </View>

      {/* Visibility — the only documented product rule, stated plainly. */}
      {isReview ? (
        <>
          <View style={[styles.switchRow, { borderColor: c.border, backgroundColor: c.card }]}>
            <View style={styles.switchBody}>
              <Text style={[styles.switchLabel, { color: c.text }]}>{t('fb_rev_public')}</Text>
              <Text style={[styles.hint, { color: c.mutedForeground }]}>
                {t('fb_rev_public_hint')}
              </Text>
            </View>
            <Switch
              value={showPublicly}
              onValueChange={(value) => setShowPublicly(value)}
              disabled={busy}
              trackColor={{ false: c.border, true: c.primary }}
              thumbColor={c.card}
              ios_backgroundColor={c.border}
            />
          </View>

          <View style={[styles.banner, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Feather name="eye-off" size={15} color={c.mutedForeground} />
            <Text style={[styles.bannerText, { color: c.mutedForeground }]}>
              {t('fb_rev_visibility')}
            </Text>
          </View>
        </>
      ) : null}

      {/* Photos — disputes use the local-only queue; reviews use the same queue
          but start uploading as soon as Submit returns the review id. */}
      {withImages ? (
        <View style={styles.block}>
          <ImageAttachmentPicker
            uploader={disputeImages}
            existingCount={0}
            namePrefix="dispute"
          />
        </View>
      ) : null}
      {isReview ? (
        <View style={styles.block}>
          <ReviewPhotoEditor uploader={reviewPhotos} />
        </View>
      ) : null}

      {/* Submit result — never a raw server body. */}
      {isReview && review.failure ? (
        <View style={[styles.noticeCard, { backgroundColor: c.card, borderColor: c.destructive }]}>
          <Feather name="alert-circle" size={16} color={c.destructive} />
          <Text style={[styles.noticeText, { color: c.destructive }]}>
            {review.failure === 'rejected' && review.serverMessage
              ? review.serverMessage
              : t(REVIEW_FAILURE_KEY[review.failure])}
          </Text>
        </View>
      ) : null}
      {notice === 'pending' ? (
        <View style={[styles.noticeCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Feather name="clock" size={16} color={c.primary} />
          <Text style={[styles.noticeText, { color: c.mutedForeground }]}>
            {t('fb_pending_msg')}
          </Text>
        </View>
      ) : null}
      {notice === 'failed' ? (
        <View style={[styles.noticeCard, { backgroundColor: c.card, borderColor: c.destructive }]}>
          <Feather name="alert-circle" size={16} color={c.destructive} />
          <Text style={[styles.noticeText, { color: c.destructive }]}>{t('fb_err_generic')}</Text>
        </View>
      ) : null}

      {/* The review route renders this button in its sticky footer instead. */}
      {submitAction ? null : (
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: c.primary },
            (!canSubmit || busy) && styles.btnDisabled,
          ]}
          onPress={() => void handleSubmit()}
          disabled={!canSubmit || busy}
          activeOpacity={0.85}
          accessibilityState={{ disabled: !canSubmit || busy }}
        >
          {busy ? (
            <DotsLoader color={c.primaryForeground} />
          ) : (
            <>
              <Feather
                name={kind === 'cancellation' ? 'check-circle' : 'send'}
                size={16}
                color={c.primaryForeground}
              />
              <Text style={[styles.primaryBtnText, { color: c.primaryForeground }]}>
                {t(SUBMIT_LABEL_KEY[context])}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

/** One multi-select option chip (review contexts). */
function ReviewChip({
  option,
  active,
  disabled,
  onPress,
}: {
  option: FeedbackOption;
  active: boolean;
  disabled: boolean;
  onPress: (id: number) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <TouchableOpacity
      onPress={() => onPress(option.id)}
      activeOpacity={0.85}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? c.primary : c.card,
          borderColor: active ? c.primary : c.border,
        },
      ]}
    >
      {active ? <Feather name="check" size={13} color={c.primaryForeground} /> : null}
      <Text
        style={[styles.chipText, { color: active ? c.primaryForeground : c.text }]}
        numberOfLines={3}
      >
        {option.label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  form: { gap: 18 },
  block: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  count: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  starRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  ratingLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  chipText: { fontFamily: 'Manrope_500Medium', fontSize: 13, flexShrink: 1 },
  chipSkeleton: { height: 38, borderRadius: 999, borderWidth: 1, minWidth: 96, opacity: 0.6 },
  chipSkeletonWide: { minWidth: 138 },
  optionList: { gap: 8 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  optionText: { fontFamily: 'Manrope_500Medium', fontSize: 14, flex: 1, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
  },
  textarea: { minHeight: 96 },
  counter: { fontFamily: 'Manrope_500Medium', fontSize: 11, alignSelf: 'flex-end' },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 17 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  inlineNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  inlineNoticeBody: { flex: 1, gap: 6 },
  inlineNoticeText: { fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  inlineRetry: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  inlineRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchBody: { flex: 1, gap: 2 },
  switchLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bannerText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 12, lineHeight: 18 },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, textAlign: 'center' },
  emptyMsg: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center', lineHeight: 18 },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  noticeText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    minHeight: 52,
  },
  primaryBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  successWrap: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontFamily: 'Manrope_700Bold', fontSize: 17, textAlign: 'center' },
  successMsg: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 6,
  },
  successPhotos: { alignSelf: 'stretch', marginTop: 2, marginBottom: 4 },
});
