import { useCallback, useRef } from 'react';
import { useAppAlert } from '@/context/AlertModalContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import type { JobResponse } from '@/types';

/**
 * The mandatory notice in front of EVERY edit entry point (Edit Job and Edit
 * Job Address). It is shown once per attempt, BEFORE the edit screen opens, so
 * the client knows the job will be reposted and current bids removed.
 *
 * The bid count comes from the same read-only endpoint the Bids screen uses
 * (`total_bids`), fetched on demand. A failed count is not an error: the notice
 * still appears without the number, and nothing is blocked by it.
 *
 * Attachments cannot be carried by reference (JobCreate has no attachment
 * field and there is no copy endpoint), so their loss is warned about here,
 * before the user commits to the edit.
 */
export function useRepostNotice() {
  const showAlert = useAppAlert();
  const { t } = useLanguage();
  const fetching = useRef(false);

  return useCallback(
    (job: JobResponse, onContinue: () => void) => {
      if (fetching.current) return;
      fetching.current = true;

      void (async () => {
        let count: number | null = null;
        try {
          const { data } = await authApi.listJobBids(job.id);
          count = typeof data.total_bids === 'number' ? data.total_bids : null;
        } catch {
          // The notice must not depend on this read; show it without the count.
        } finally {
          fetching.current = false;
        }

        let message = t('repost_notice_msg');
        if (count !== null && count > 0) {
          message += ` ${t('repost_notice_bids', { n: count })}`;
        }
        if ((job.attachments?.length ?? 0) > 0) {
          message += `\n\n${t('repost_notice_files')}`;
        }

        showAlert({
          title: t('repost_notice_title'),
          message,
          icon: 'refresh-cw',
          buttons: [
            { text: t('repost_notice_cancel'), style: 'cancel' },
            { text: t('repost_notice_continue'), onPress: onContinue },
          ],
        });
      })();
    },
    [showAlert, t]
  );
}

export default useRepostNotice;
