/**
 * Translation parity check for the Update Job Address keys.
 *
 * The canonical dictionary is en.ts; every key must exist in de/et/lv/lt with a
 * non-empty string, and the new update-specific keys must be present everywhere.
 * Run through the same harness as the other lib tests: `pnpm run test`.
 */
import en from '../../context/translations/en';
import de from '../../context/translations/de';
import et from '../../context/translations/et';
import lv from '../../context/translations/lv';
import lt from '../../context/translations/lt';

declare const console: { log: (msg: string) => void };

const NEW_UPDATE_KEYS = [
  'jobaddr_update_title',
  'jobaddr_update_exists',
  'jobaddr_update_exists_msg',
  'addr_u_lat',
  'addr_u_lng',
  'addr_u_map_pin',
  'addr_u_invalid_coords',
  'addr_u_err_network',
  'addr_u_err_session',
  'addr_u_err_generic',
  'addr_u_success_title',
  'addr_u_success_msg',
  'addr_u_save',
];

/** Keys added for the Restart Timer action (Job Details). */
const NEW_RESTART_KEYS = [
  'jobd_restart_confirm_title',
  'jobd_restart_confirm_msg',
  'jobd_restart_confirm_cta',
  'jobd_restart_busy',
  'jobd_restart_success_title',
  'jobd_restart_success_msg',
  'jobd_restart_limit_title',
  'jobd_restart_limit_msg',
  'jobd_restart_err_title',
  'jobd_restart_err_invalid',
  'jobd_restart_err_badrequest',
  'jobd_restart_err_forbidden',
  'jobd_restart_err_notfound',
  'jobd_restart_err_server',
  'jobd_restart_err_network',
];

/** Keys added for the Convert to Regular action (Job Details). */
const NEW_CONVERT_KEYS = [
  'jobd_convert_confirm_title',
  'jobd_convert_confirm_msg',
  'jobd_convert_confirm_cta',
  'jobd_convert_busy',
  'jobd_convert_success_title',
  'jobd_convert_success_msg',
  'jobd_convert_notallowed_title',
  'jobd_convert_notallowed_msg',
  'jobd_convert_err_title',
  'jobd_convert_err_invalid',
  'jobd_convert_err_notallowed',
  'jobd_convert_err_forbidden',
  'jobd_convert_err_notfound',
  'jobd_convert_err_server',
  'jobd_convert_err_network',
];

/** Keys added for the Convert to Urgent action (Job Details). */
const NEW_URGENT_KEYS = [
  'jobd_urgent_confirm_title',
  'jobd_urgent_confirm_msg',
  'jobd_urgent_confirm_cta',
  'jobd_urgent_busy',
  'jobd_urgent_success_title',
  'jobd_urgent_success_msg',
  'jobd_urgent_notallowed_title',
  'jobd_urgent_notallowed_msg',
  'jobd_urgent_err_title',
  'jobd_urgent_err_invalid',
  'jobd_urgent_err_notallowed',
  'jobd_urgent_err_forbidden',
  'jobd_urgent_err_notfound',
  'jobd_urgent_err_server',
  'jobd_urgent_err_network',
];

/** Keys added for the Assign Provider action (Job Details). */
const NEW_ASSIGN_KEYS = [
  'jobd_assign_provider',
  'jobd_assign_confirm_title',
  'jobd_assign_confirm_msg',
  'jobd_assign_confirm_cta',
  'jobd_assign_busy',
  'jobd_assign_success_title',
  'jobd_assign_success_msg',
  'jobd_assign_notallowed_title',
  'jobd_assign_notallowed_msg',
  'jobd_assign_err_title',
  'jobd_assign_err_invalid',
  'jobd_assign_err_notallowed',
  'jobd_assign_err_forbidden',
  'jobd_assign_err_notfound',
  'jobd_assign_err_server',
  'jobd_assign_err_network',
];

const NEW_PAY_KEYS = [
  'jobd_pay_confirm_payment',
  'jobd_pay_busy',
  'jobd_pay_confirm_title',
  'jobd_pay_confirm_msg',
  'jobd_pay_confirm_cta',
  'jobd_pay_success_title',
  'jobd_pay_success_msg',
  'jobd_pay_already_title',
  'jobd_pay_already_msg',
  'jobd_pay_notallowed_title',
  'jobd_pay_notallowed_msg',
  'jobd_pay_err_title',
  'jobd_pay_err_invalid',
  'jobd_pay_err_notallowed',
  'jobd_pay_err_forbidden',
  'jobd_pay_err_notfound',
  'jobd_pay_err_server',
  'jobd_pay_err_network',
];

const NEW_START_KEYS = [
  'jobd_start_job',
  'jobd_start_busy',
  'jobd_start_confirm_title',
  'jobd_start_confirm_msg',
  'jobd_start_confirm_cta',
  'jobd_start_success_title',
  'jobd_start_success_msg',
  'jobd_start_moved_title',
  'jobd_start_moved_msg',
  'jobd_start_notallowed_title',
  'jobd_start_notallowed_msg',
  'jobd_start_err_title',
  'jobd_start_err_invalid',
  'jobd_start_err_notallowed',
  'jobd_start_err_forbidden',
  'jobd_start_err_notfound',
  'jobd_start_err_server',
  'jobd_start_err_network',
];

const NEW_COMPLETE_KEYS = [
  'jobd_complete_job',
  'jobd_complete_busy',
  'jobd_complete_confirm_title',
  'jobd_complete_confirm_msg',
  'jobd_complete_confirm_cta',
  'jobd_complete_success_title',
  'jobd_complete_success_msg',
  'jobd_complete_moved_title',
  'jobd_complete_moved_msg',
  'jobd_complete_notallowed_title',
  'jobd_complete_notallowed_msg',
  'jobd_complete_err_title',
  'jobd_complete_err_invalid',
  'jobd_complete_err_notallowed',
  'jobd_complete_err_forbidden',
  'jobd_complete_err_notfound',
  'jobd_complete_err_server',
  'jobd_complete_err_network',
];

const NEW_CANCEL_KEYS = [
  'jobd_cancel_warning',
  'jobd_cancel_reason_label',
  'jobd_cancel_reason_ph',
  'jobd_cancel_reason_hint',
  'jobd_cancel_notes_label',
  'jobd_cancel_notes_ph',
  'jobd_cancel_submit',
  'jobd_cancel_busy',
  'jobd_cancel_confirm_title',
  'jobd_cancel_confirm_msg',
  'jobd_cancel_confirm_cta',
  'jobd_cancel_success_title',
  'jobd_cancel_success_msg',
  'jobd_cancel_moved_title',
  'jobd_cancel_moved_msg',
  'jobd_cancel_blocked_title',
  'jobd_cancel_blocked_msg',
  'jobd_cancel_err_reason_required',
  'jobd_cancel_err_reason_short',
  'jobd_cancel_err_reason_long',
  'jobd_cancel_err_invalid',
  'jobd_cancel_err_notallowed',
  'jobd_cancel_err_forbidden',
  'jobd_cancel_err_notfound',
  'jobd_cancel_err_server',
  'jobd_cancel_err_network',
];

const NEW_PCANCEL_KEYS = [
  'jobd_pcancel_action',
  'jobd_pcancel_busy',
  'jobd_pcancel_confirm_title',
  'jobd_pcancel_confirm_msg',
  'jobd_pcancel_confirm_cta',
  'jobd_pcancel_success_title',
  'jobd_pcancel_success_msg',
  'jobd_pcancel_moved_title',
  'jobd_pcancel_moved_msg',
  'jobd_pcancel_notallowed_title',
  'jobd_pcancel_err_title',
  'jobd_pcancel_err_invalid',
  'jobd_pcancel_err_notallowed',
  'jobd_pcancel_err_forbidden',
  'jobd_pcancel_err_notfound',
  'jobd_pcancel_err_server',
  'jobd_pcancel_err_network',
];

const NEW_DECLINE_KEYS = [
  'jobd_decline_action',
  'jobd_decline_screen_title',
  'jobd_decline_warning',
  'jobd_decline_details_label',
  'jobd_decline_details_ph',
  'jobd_decline_details_hint',
  'jobd_decline_submit',
  'jobd_decline_busy',
  'jobd_decline_confirm_title',
  'jobd_decline_confirm_msg',
  'jobd_decline_confirm_cta',
  'jobd_decline_success_title',
  'jobd_decline_success_msg',
  'jobd_decline_moved_title',
  'jobd_decline_moved_msg',
  'jobd_decline_blocked_title',
  'jobd_decline_blocked_msg',
  'jobd_decline_err_details_required',
  'jobd_decline_err_details_short',
  'jobd_decline_err_details_long',
  'jobd_decline_err_invalid',
  'jobd_decline_err_notallowed',
  'jobd_decline_err_forbidden',
  'jobd_decline_err_notfound',
  'jobd_decline_err_server',
  'jobd_decline_err_network',
];

const NEW_PAUSE_KEYS = [
  'jobd_pause_action',
  'jobd_pause_screen_title',
  'jobd_pause_warning',
  'jobd_pause_details_label',
  'jobd_pause_details_ph',
  'jobd_pause_details_hint',
  'jobd_pause_submit',
  'jobd_pause_busy',
  'jobd_pause_confirm_title',
  'jobd_pause_confirm_msg',
  'jobd_pause_confirm_cta',
  'jobd_pause_success_title',
  'jobd_pause_success_msg',
  'jobd_pause_moved_title',
  'jobd_pause_moved_msg',
  'jobd_pause_blocked_title',
  'jobd_pause_blocked_msg',
  'jobd_pause_err_details_required',
  'jobd_pause_err_details_short',
  'jobd_pause_err_details_long',
  'jobd_pause_err_invalid',
  'jobd_pause_err_notallowed',
  'jobd_pause_err_forbidden',
  'jobd_pause_err_notfound',
  'jobd_pause_err_server',
  'jobd_pause_err_network',
  'jobd_paused_notice_title',
  'jobd_paused_notice_msg',
];

const NEW_PPROVIDER_PAUSE_KEYS = [
  'jobd_ppause_action',
  'jobd_ppause_screen_title',
  'jobd_ppause_warning',
  'jobd_ppause_details_label',
  'jobd_ppause_details_ph',
  'jobd_ppause_details_hint',
  'jobd_ppause_submit',
  'jobd_ppause_busy',
  'jobd_ppause_confirm_title',
  'jobd_ppause_confirm_msg',
  'jobd_ppause_confirm_cta',
  'jobd_ppause_success_title',
  'jobd_ppause_success_msg',
  'jobd_ppause_moved_title',
  'jobd_ppause_moved_msg',
  'jobd_ppause_blocked_title',
  'jobd_ppause_blocked_msg',
  'jobd_ppause_err_details_required',
  'jobd_ppause_err_details_short',
  'jobd_ppause_err_details_long',
  'jobd_ppause_err_invalid',
  'jobd_ppause_err_notallowed',
  'jobd_ppause_err_forbidden',
  'jobd_ppause_err_notfound',
  'jobd_ppause_err_server',
  'jobd_ppause_err_network',
];

/** Keys added for the Report Blocker action (Job Details → Report an Issue). */
const NEW_BLOCKER_KEYS = [
  'jobd_blocker_action',
  'jobd_blocker_screen_title',
  'jobd_blocker_warning',
  'jobd_blocker_details_label',
  'jobd_blocker_details_ph',
  'jobd_blocker_details_hint',
  'jobd_blocker_submit',
  'jobd_blocker_busy',
  'jobd_blocker_confirm_title',
  'jobd_blocker_confirm_msg',
  'jobd_blocker_confirm_cta',
  'jobd_blocker_success_title',
  'jobd_blocker_success_msg',
  'jobd_blocker_moved_title',
  'jobd_blocker_moved_msg',
  'jobd_blocker_blocked_title',
  'jobd_blocker_blocked_msg',
  'jobd_blocker_err_details_required',
  'jobd_blocker_err_details_short',
  'jobd_blocker_err_details_long',
  'jobd_blocker_err_invalid',
  'jobd_blocker_err_notallowed',
  'jobd_blocker_err_forbidden',
  'jobd_blocker_err_notfound',
  'jobd_blocker_err_server',
  'jobd_blocker_err_network',
];

/** Keys added for the Add Attachment action (Job Details → Add Attachment). */
const NEW_ATTACH_KEYS = [
  'jobd_attach_action',
  'jobd_attach_screen_title',
  'jobd_attach_warning',
  'jobd_attach_existing',
  'jobd_attach_none_yet',
  'jobd_attach_pick',
  'jobd_attach_repick',
  'jobd_attach_hint',
  'jobd_attach_submit',
  'jobd_attach_busy',
  'jobd_attach_progress',
  'jobd_attach_confirm_title',
  'jobd_attach_confirm_msg',
  'jobd_attach_confirm_cta',
  'jobd_attach_success_title',
  'jobd_attach_success_msg',
  'jobd_attach_moved_title',
  'jobd_attach_moved_msg',
  'jobd_attach_blocked_title',
  'jobd_attach_blocked_msg',
  'jobd_attach_err_nofile',
  'jobd_attach_err_type',
  'jobd_attach_err_size',
  'jobd_attach_err_permission',
  'jobd_attach_err_pick',
  'jobd_attach_err_invalid',
  'jobd_attach_err_notallowed',
  'jobd_attach_err_forbidden',
  'jobd_attach_err_notfound',
  'jobd_attach_err_server',
  'jobd_attach_err_network',
];

/** Keys added for the Remove Attachment action (Job Details → an attachment row). */
const NEW_ATTACH_RM_KEYS = [
  'jobd_attach_rm_action',
  'jobd_attach_rm_confirm_title',
  'jobd_attach_rm_confirm_msg',
  'jobd_attach_rm_confirm_cta',
  'jobd_attach_rm_busy',
  'jobd_attach_rm_success_title',
  'jobd_attach_rm_success_msg',
  'jobd_attach_rm_gone_title',
  'jobd_attach_rm_gone_msg',
  'jobd_attach_rm_err_title',
  'jobd_attach_rm_err_invalid',
  'jobd_attach_rm_err_notallowed',
  'jobd_attach_rm_err_forbidden',
  'jobd_attach_rm_err_server',
  'jobd_attach_rm_err_network',
];

/** Keys the update screen reuses from the create/shared dictionaries. */
/** Keys added for the in-app update banner (Home → "Update available"). */
const NEW_UPDATE_BANNER_KEYS = [
  'update_available_title',
  'update_available_body',
  'update_download',
  'update_later',
];

const REUSED_KEYS = [
  'addr_c_country',
  'addr_c_county',
  'addr_c_city',
  'addr_c_house',
  'addr_c_street',
  'addr_c_postal',
  'addr_c_landmark',
  'addr_c_formatted',
  'addr_c_formatted_hint',
  'addr_c_pick',
  'addr_c_placeholder',
  'addr_c_geo_empty',
  'addr_c_err_geo',
  'addr_c_err_required',
  'addr_c_err_generic',
  'addr_c_err_network',
  'addr_c_err_session',
  'jobd_unavailable_title',
  'jobd_unavailable_msg',
  'jobd_load_error',
  'jobd_load_error_sub',
  'jobd_back_to_jobs',
  'editjob_not_editable_title',
  'editjob_not_editable_msg',
  'editjob_saving',
  'jobs_retry',
  'post_view_job',
  'action_cancel',
  'job_restart_timer',
  'jobd_action_soon',
];

const dictionaries: Array<[string, Record<string, string>]> = [
  ['en', en as unknown as Record<string, string>],
  ['de', de as unknown as Record<string, string>],
  ['et', et as unknown as Record<string, string>],
  ['lv', lv as unknown as Record<string, string>],
  ['lt', lt as unknown as Record<string, string>],
];

let passed = 0;
export const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(label);
}

const canonical = new Set(Object.keys(en as unknown as Record<string, string>));

for (const [lang, dict] of dictionaries) {
  const keys = new Set(Object.keys(dict));

  // Full parity with the canonical dictionary, both directions.
  for (const key of canonical) {
    if (!keys.has(key)) failures.push(`${lang} is MISSING canonical key "${key}"`);
  }
  for (const key of keys) {
    if (!canonical.has(key)) failures.push(`${lang} has EXTRA key "${key}" not in en`);
  }
  passed += 1; // the parity comparison ran for this locale

  for (const key of [
    ...NEW_UPDATE_KEYS,
    ...NEW_RESTART_KEYS,
    ...NEW_CONVERT_KEYS,
    ...NEW_URGENT_KEYS,
    ...NEW_ASSIGN_KEYS,
    ...NEW_PAY_KEYS,
    ...NEW_START_KEYS,
    ...NEW_COMPLETE_KEYS,
    ...NEW_CANCEL_KEYS,
    ...NEW_PCANCEL_KEYS,
    ...NEW_DECLINE_KEYS,
    ...NEW_PAUSE_KEYS,
    ...NEW_PPROVIDER_PAUSE_KEYS,
    ...NEW_BLOCKER_KEYS,
    ...NEW_ATTACH_KEYS,
    ...NEW_ATTACH_RM_KEYS,
    ...NEW_UPDATE_BANNER_KEYS,
    ...REUSED_KEYS,
  ]) {
    const value = dict[key];
    check(
      `${lang}.${key} present and non-empty`,
      typeof value === 'string' && value.trim().length > 0
    );
  }
}

const enDict = dictionaries[0][1];
const allNewKeys = [
  ...NEW_UPDATE_KEYS,
  ...NEW_RESTART_KEYS,
  ...NEW_CONVERT_KEYS,
  ...NEW_URGENT_KEYS,
  ...NEW_ASSIGN_KEYS,
  ...NEW_PAY_KEYS,
  ...NEW_START_KEYS,
  ...NEW_COMPLETE_KEYS,
  ...NEW_CANCEL_KEYS,
  ...NEW_PCANCEL_KEYS,
  ...NEW_DECLINE_KEYS,
  ...NEW_PAUSE_KEYS,
  ...NEW_PPROVIDER_PAUSE_KEYS,
  ...NEW_BLOCKER_KEYS,
  ...NEW_ATTACH_KEYS,
  ...NEW_ATTACH_RM_KEYS,
  ...NEW_UPDATE_BANNER_KEYS,
];
const translatedCount = dictionaries
  .slice(1)
  .reduce(
    (min, [, dict]) => Math.min(min, allNewKeys.filter((k) => dict[k] !== enDict[k]).length),
    allNewKeys.length
  );
check(
  'every non-English locale actually translates the new keys (not English copies)',
  translatedCount >= allNewKeys.length - 2
);

console.log(
  `translations: ${passed} checks, ${failures.length} failure(s) — locale sizes: ` +
    dictionaries.map(([l, d]) => `${l}=${Object.keys(d).length}`).join(' ')
);
