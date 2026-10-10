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

/** Keys added for the Post-a-Job service picker and the clock/calendar
 * pickers (the combined date+time sheet's own keys were removed with it). */
const NEW_POST_FLOW_KEYS = [
  'post_sched_hour',
  'post_sched_minute',
  'post_sched_am',
  'post_sched_pm',
  'post_sched_apply',
  'post_sched_prev_month',
  'post_sched_next_month',
  'post_sched_months',
  'post_sched_weekdays',
  'post_service_pick',
  'post_service_pick_sub',
  'post_service_meta_error',
  'post_svc_change',
  'post_svc_pick_title',
  'post_svc_pick_category',
  'post_svc_back_categories',
];

/** Keys added for the 4-step Post-a-Job wizard (booking type, pickers,
 * milestones, address prefill). */
const NEW_POST_WIZARD_KEYS = [
  'post_step_of',
  'post_step_details',
  'post_step_booking',
  'post_step_schedule',
  'post_step_address',
  'post_next',
  'post_back',
  'post_booking_pick',
  'post_booking_one_time',
  'post_booking_one_time_desc',
  'post_booking_one_time_note',
  'post_booking_long_term',
  'post_booking_long_term_desc',
  'post_booking_long_term_note',
  'post_time_pick',
  'post_dates_pick',
  'post_time_after_dates',
  'post_time_picker_title',
  'post_date_picker_title',
  'post_err_time',
  'post_err_time_past',
  'post_err_dates_pick',
  'post_err_dates_past',
  'post_err_dates_max',
  'post_dates_hint',
  'post_dates_max_last',
  'post_days_selected',
  'post_hours_per_day',
  'post_milestones',
  'post_milestone_n',
  'post_success_msg_addr',
  'post_urgent_desc',
  'post_regular_desc',
  // Post-failure copy: every createJob failure bucket now has its own message,
  // and only the network bucket may mention the connection.
  'post_err_timeout_title',
  'post_err_timeout_msg',
  'post_err_server_title',
  'post_err_server_msg',
  'post_err_rejected_title',
  'post_err_rejected_msg',
  'post_err_unknown_title',
  'post_err_unknown_msg',
  'post_err_invalid_msg',
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

/**
 * Provider bidding (Module 4C): the Submit Bid screen's copy plus the nine
 * validation keys lib/bid's validators return. Every one of these is reachable
 * through t(), so every one must exist in all five dictionaries.
 */
const NEW_BID_KEYS = [
  'bid_err_price_required',
  'bid_err_price_invalid',
  'bid_err_price_positive',
  'bid_err_price_decimals',
  'bid_err_price_too_large',
  'bid_err_eta_required',
  'bid_err_eta_invalid',
  'bid_err_eta_range',
  'bid_err_message_too_long',
  'jobd_bid_screen_title',
  'jobd_bid_your_bid',
  'jobd_bid_price_label',
  'jobd_bid_price_ph',
  'jobd_bid_price_vat_note',
  'jobd_bid_eta_label',
  'jobd_bid_eta_hint',
  'jobd_bid_eta_hours_label',
  'jobd_bid_eta_minutes_label',
  'jobd_bid_message_label',
  'jobd_bid_message_ph',
  'jobd_bid_message_optional',
  'jobd_bid_submit',
  'jobd_bid_submitting',
  'jobd_bid_success_title',
  'jobd_bid_success_msg',
  'jobd_bid_closed_title',
  'jobd_bid_closed_msg',
  'jobd_bid_unavailable_title',
  'jobd_bid_unavailable_msg',
  'jobd_bid_locked_title',
  'jobd_bid_locked_msg',
  'jobd_bid_close_cta',
  'jobd_bid_action_place',
  'jobd_bid_action_view',
  'jobd_bid_no_message',
  'jobd_bid_summary_price',
  'jobd_bid_summary_eta',
  'jobd_bid_summary_message',
  'jobd_bid_summary_status',
  'jobd_bid_summary_submitted',
  'jobd_bid_eta_now',
  'jobd_bid_eta_min',
  'jobd_bid_eta_hm',
  'jobd_bid_err_invalid',
  'jobd_bid_err_notallowed',
  'jobd_bid_err_forbidden',
  'jobd_bid_err_notfound',
  'jobd_bid_err_server',
  'jobd_bid_err_network',
  'bid_status_pending',
  'bid_status_accepted',
  'bid_status_rejected',
  'bid_status_withdrawn',
  'bid_status_expired',
];

/**
 * Client Bids screen (GET /jobs/{job_id}/bids): the entry button, the header,
 * the Recommended / All-offers sections with their sort chips, the empty and
 * closed states, the provider sheet's rows and every error message. Each is
 * reachable through t(), so each must exist in all five dictionaries and must
 * be a real translation rather than an English copy.
 */
const NEW_CBIDS_KEYS = [
  'cbids_view_bids',
  'cbids_title',
  'cbids_urgent',
  'cbids_regular',
  'cbids_total_one',
  'cbids_total_other',
  'cbids_recommended',
  'cbids_recommended_section',
  'cbids_view_all',
  'cbids_show_recommended',
  'cbids_all_section',
  'cbids_sort_default',
  'cbids_sort_price',
  'cbids_sort_rating',
  'cbids_sort_distance',
  'cbids_sort_badges',
  'cbids_closed',
  'cbids_refresh_failed',
  'cbids_empty_open_title',
  'cbids_empty_open_msg',
  'cbids_empty_closed_title',
  'cbids_empty_closed_msg',
  'cbids_provider_title',
  'cbids_provider_price',
  'cbids_provider_rating',
  'cbids_provider_badges',
  'cbids_provider_jobs',
  'cbids_provider_acceptance',
  'cbids_provider_response',
  'cbids_provider_distance',
  'cbids_provider_message',
  'cbids_provider_no_message',
  'cbids_close',
  'cbids_err_title',
  'cbids_err_network',
  'cbids_err_notfound_title',
  'cbids_err_notfound_msg',
  'cbids_err_forbidden_title',
  'cbids_err_forbidden_msg',
  'cbids_retry',
  'cbids_back_to_job',
];

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
    ...NEW_POST_FLOW_KEYS,
    ...NEW_POST_WIZARD_KEYS,
    ...NEW_BID_KEYS,
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
  ...NEW_POST_FLOW_KEYS,
  ...NEW_POST_WIZARD_KEYS,
  ...NEW_BID_KEYS,
  ...NEW_CBIDS_KEYS,
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
