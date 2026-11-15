/**
 * bidTimes.ts
 *
 * The pilot's "Select your arrival time" rules, and the ONE module that carries
 * those times on the wire until the backend has a real field for them.
 *
 * ── WHY A MESSAGE LINE (decided with the product owner, 2026-10-22) ────────
 * The live schema (BidCreate / BidUpdate, re-read 2026-10-22) has exactly three
 * properties: `offered_price` (required), `eta_minutes` (required, 0..1440) and
 * `message` (optional, ≤1000 chars). There is NO proposed-start field and no
 * per-task structure. Option B was chosen: the times travel as ONE fixed-format
 * line appended to the bid message —
 *
 *     Proposed time: Task 1 9:30 AM; Task 2 3:00 PM
 *
 * — written, parsed and stripped HERE and nowhere else, so switching to a real
 * backend field later is a change to this file plus one call site. The client's
 * bid cards never show the raw line: they render the parsed times.
 *
 * `eta_minutes` is still REQUIRED, so it is derived: whole minutes from now
 * until the FIRST proposed start, clamped to 0..1440 (the schema's own bounds).
 *
 * ── ARRIVAL OPTIONS (fixed by the product owner) ───────────────────────────
 * For one client window the pilot may pick EVERY HALF-HOUR mark from the
 * window's start up to, but not including, its end — the start is offered, the
 * end never is (8-11 → 8:00, 8:30, 9:00, 9:30, 10:00, 10:30). A start between
 * marks opens at the next one (9:20 → 9:30). See lib/timeSlots.pilotTimesForSlot.
 * An Anytime task has a custom window: the same rule applies to it, and when
 * the window is too short for any mark the client's exact start is the only
 * choice (the product owner's answer Q2/A).
 *
 * Pure: no React, no axios, no Intl.
 */

import type { BidResponse, JobMilestoneResponse, JobResponse } from '@/types';
import { localDay } from '@/lib/jobBooking';
import { parseClockValue, parseTimeSlot } from '@/lib/apiTimeSlots';
import {
  type ClockTime,
  DAY_END_MINUTES,
  deriveSlotOf,
  formatTimeLabel,
  formatWindowLabel,
  localStartOf,
  minutesOf,
  parseScheduleSegments,
  pilotTimesForSlot,
  segmentsForTasks,
  slotByKey,
} from '@/lib/timeSlots';

/** Exact prefix of the line this module owns (fixed English, like the job's). */
export const PROPOSED_TIME_PREFIX = 'Proposed time:';

/** The schema's own message ceiling. */
export const BID_MESSAGE_LIMIT = 1000;

/** One task of the job, as the pilot sees it. */
export interface BidTaskSlot {
  code: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  arrivalMinutes: number[];
}

export interface BidTaskWindow {
  /** 1-based "Task N". */
  number: number;
  /** Server milestone id (needed by the structured BidCreate body). */
  milestoneId?: number | null;
  /** Local day of the task, or null when the job has no readable instant. */
  day: Date | null;
  /** Local minutes of the earliest allowed window start. */
  startMinutes: number;
  /** Local minutes of the latest allowed window end. */
  endMinutes: number;
  /** True when the client chose Anytime (a custom/legacy window). */
  anytime: boolean;
  /** Every allowed API slot for this ONE day/task. */
  slots: BidTaskSlot[];
  /** Duration sent as this milestone's eta_minutes (expected hours × 60). */
  durationMinutes: number;
}

/**
 * Every task a pilot must propose a time for: one per milestone, or a single
 * task built from the job's own `scheduled_at` when there are no milestones.
 * Each window comes from the stored schedule line first (an Anytime booking only
 * exists there) and falls back to the job's local start.
 */
function slotsOfMilestone(milestone: JobMilestoneResponse): BidTaskSlot[] {
  return (milestone.time_slots ?? [])
    .map((raw) => {
      const parsed = parseTimeSlot({ ...raw, id: milestone.id, sort_order: 0 });
      if (!parsed) return null;
      return {
        code: parsed.code,
        label: parsed.label,
        startMinutes: parsed.startMinutes,
        endMinutes: parsed.endMinutes,
        arrivalMinutes: parsed.arrivalMinutes,
      };
    })
    .filter((slot): slot is BidTaskSlot => slot !== null);
}

function arrivalMinutesOf(milestone: JobMilestoneResponse): number[] {
  return Array.from(
    new Set(
      (milestone.arrival_options ?? [])
        .map(parseClockValue)
        .filter((minutes): minutes is number => minutes !== null)
    )
  ).sort((a, b) => a - b);
}

export function jobTaskWindows(job: JobResponse | null | undefined): BidTaskWindow[] {
  if (!job) return [];
  const milestones = [...(job.milestones ?? [])].sort(
    (a, b) => a.sequence - b.sequence || a.id - b.id
  );
  if (milestones.length > 0) {
    // Read the legacy schedule line ONCE for the whole list so task N always
    // gets segment N, never task 1's window repeated.
    const legacy = legacyTaskWindows(job, milestones);
    return milestones.map((milestone, index) => {
      const slots = slotsOfMilestone(milestone);
      if (slots.length > 0) {
        const start = Math.min(...slots.map((slot) => slot.startMinutes));
        const end = Math.max(...slots.map((slot) => slot.endMinutes));
        const hours = Number(milestone.expected_hours);
        return {
          number: index + 1,
          milestoneId: milestone.id,
          day: localStartOf(milestone.scheduled_at)?.day ?? (milestone.scheduled_date ? new Date(`${milestone.scheduled_date}T00:00:00`) : null),
          startMinutes: start,
          endMinutes: end,
          anytime: false,
          slots,
          durationMinutes: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 60,
        };
      }
      // Legacy milestone without time_slots: fall through to its own segment.
      return { ...legacy[index], milestoneId: milestone.id, slots: [], number: index + 1 };
    });
  }
  return legacyTaskWindows(job, []);
}

function legacyTaskWindows(job: JobResponse, milestones: JobMilestoneResponse[]): BidTaskWindow[] {
  const segments = segmentsForTasks(
    parseScheduleSegments(job.description),
    Math.max(1, milestones.length)
  );

  const starts: Array<{ scheduledAt: string | null | undefined; segment: ReturnType<typeof parseScheduleSegments>[number] | null }> =
    milestones.length > 0
      ? milestones.map((milestone, index) => ({
          scheduledAt: milestone.scheduled_at,
          segment: segments[index] ?? null,
        }))
      : [{ scheduledAt: job.scheduled_at, segment: segments[0] ?? null }];

  return starts.map((entry, index) => {
    const local = localStartOf(entry.scheduledAt);
    const derived = deriveSlotOf({ scheduledAt: entry.scheduledAt, segment: entry.segment });
    if (derived?.kind === 'slot') {
      const slot = slotByKey(derived.key);
      const start = slot?.startMinutes ?? local?.minutes ?? 9 * 60;
      const end = slot?.endMinutes ?? DAY_END_MINUTES;
      return {
        number: index + 1,
        day: local?.day ?? null,
        startMinutes: start,
        endMinutes: end,
        anytime: false,
        slots: slot ? [{ code: slot.key, label: slot.label, startMinutes: start, endMinutes: end, arrivalMinutes: slot.arrivalMinutes }] : [],
        durationMinutes: 60,
      };
    }
    if (derived?.kind === 'anytime') {
      const start = minutesOf(derived.start) ?? 9 * 60;
      const end = minutesOf(derived.end) ?? 10 * 60;
      return {
        number: index + 1,
        day: local?.day ?? null,
        startMinutes: start,
        endMinutes: end,
        anytime: true,
        slots: [],
        durationMinutes: 60,
      };
    }
    // Nothing readable: a neutral one-hour window keeps the form usable.
    return {
      number: index + 1,
      day: local?.day ?? localDay(new Date()),
      startMinutes: 9 * 60,
      endMinutes: 10 * 60,
      anytime: false,
      slots: [],
      durationMinutes: 60,
    };
  });
}

/**
 * The half-hour marks a pilot may choose for one task: every mark from the
 * client's window start up to, not including, its end. A window too short for
 * any mark offers its exact start, so a task can never end up with no choice.
 */
export function arrivalOptionsFor(task: BidTaskWindow): ClockTime[] {
  const marks = pilotTimesForSlot({
    key: 'custom',
    startMinutes: task.startMinutes,
    endMinutes: task.endMinutes,
    start: { hour: Math.floor(task.startMinutes / 60), minute: task.startMinutes % 60 },
    end: { hour: Math.floor(task.endMinutes / 60), minute: task.endMinutes % 60 },
    arrivalMinutes: [],
    label: '',
  });
  if (marks.length > 0) return marks;
  return [
    {
      hour: Math.floor(task.startMinutes / 60),
      minute: task.startMinutes % 60,
    },
  ];
}

/** One chosen arrival: task number, local minutes and the slot it belongs to. */
export interface ProposedArrival {
  taskNumber: number;
  minutes: number;
  slotCode?: string | null;
}

/** The server's arrival chips grouped by the client's allowed slot. */
export function arrivalGroupsFor(
  task: BidTaskWindow
): Array<{ slot: BidTaskSlot | null; options: ClockTime[] }> {
  if (task.slots.length === 0) return [{ slot: null, options: arrivalOptionsFor(task) }];
  return task.slots.map((slot) => ({
    slot,
    options: slot.arrivalMinutes.length > 0
      ? slot.arrivalMinutes.map((minutes) => ({
          hour: Math.floor(minutes / 60),
          minute: minutes % 60,
        }))
      : arrivalOptionsFor(task),
  }));
}

/** `HH:MM` for a `HH:MM:SS`-tolerant stored arrival. */
export function hhmm(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour < 10 ? '0' : ''}${hour}:${minute < 10 ? '0' : ''}${minute}`;
}

/** Structured arrivals from the server, or the legacy message line. */
export function arrivalsFromBid(bid: BidResponse | null | undefined): ProposedArrival[] {
  if (!bid) return [];
  if (bid.milestones && bid.milestones.length > 0) {
    return bid.milestones
      .map((milestone): ProposedArrival | null => {
        const minutes = parseClockValue(milestone.arrival_time);
        return minutes === null
          ? null
          : { taskNumber: milestone.sequence, minutes, slotCode: null };
      })
      .filter((entry): entry is ProposedArrival => entry !== null)
      .sort((a, b) => a.taskNumber - b.taskNumber);
  }
  return parseProposedTimeLine(bid.message).arrivals;
}

/** BidCreate.milestones[] from the pilot's one-arrival-per-task choices. */
export function buildBidMilestones(
  arrivals: ProposedArrival[],
  tasks: BidTaskWindow[]
): Array<{ milestone_id: number; arrival_time: string; eta_minutes: number }> {
  return tasks
    .filter((task) => task.milestoneId != null)
    .map((task) => {
      const chosen = arrivals.find((entry) => entry.taskNumber === task.number);
      if (!chosen) return null;
      return {
        milestone_id: task.milestoneId as number,
        arrival_time: hhmm(chosen.minutes),
        eta_minutes: Math.max(1, task.durationMinutes || 60),
      };
    })
    .filter((entry): entry is { milestone_id: number; arrival_time: string; eta_minutes: number } => entry !== null);
}

/** `Proposed time: Task 1 9:30 AM; Task 2 3:00 PM` (null when nothing chosen). */
export function buildProposedTimeLine(
  arrivals: ProposedArrival[],
  meridiem: { am: string; pm: string }
): string | null {
  const parts = arrivals
    .filter((entry) => Number.isFinite(entry.minutes))
    .sort((a, b) => a.taskNumber - b.taskNumber)
    .map((entry) => {
      const clock: ClockTime = {
        hour: Math.floor(entry.minutes / 60),
        minute: entry.minutes % 60,
      };
      return `Task ${entry.taskNumber} ${formatTimeLabel(clock, meridiem)}`;
    })
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  return `${PROPOSED_TIME_PREFIX} ${parts.join('; ')}`;
}

/** What was found in a stored bid message. */
export interface ParsedBidMessage {
  /** The provider's own words, with the line removed. */
  userMessage: string;
  /** The parsed arrivals (empty when the line is absent or unreadable). */
  arrivals: ProposedArrival[];
  /** The raw line, or null. */
  line: string | null;
}

const LINE_RE = /(?:task\s*(\d+)\s*:?\s*)?(\d{1,2}):(\d{2})\s*(am|pm)/gi;

function parseArrivals(line: string): ProposedArrival[] {
  const out: ProposedArrival[] = [];
  LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE_RE.exec(line)) !== null) {
    const hour = Number(match[2]);
    const minute = Number(match[3]);
    if (hour > 12 || minute > 59) continue;
    const base = hour % 12;
    const minutes = (match[4].toLowerCase() === 'pm' ? base + 12 : base) * 60 + minute;
    out.push({ taskNumber: match[1] ? Number(match[1]) : out.length + 1, minutes });
  }
  return out;
}

/**
 * Split a stored bid message into the provider's words and the proposed-time
 * line. A message without the line is returned untouched, so bids saved before
 * this feature keep reading exactly as they did.
 */
export function parseProposedTimeLine(
  message: string | null | undefined
): ParsedBidMessage {
  const text = typeof message === 'string' ? message : '';
  const marker = text.lastIndexOf(PROPOSED_TIME_PREFIX);
  if (marker < 0) return { userMessage: text.trim(), arrivals: [], line: null };
  const tail = text.slice(marker).split('\n')[0];
  const arrivals = parseArrivals(tail.slice(PROPOSED_TIME_PREFIX.length));
  const before = text.slice(0, marker).replace(/\s+$/, '');
  return { userMessage: before, arrivals, line: tail.trim() };
}

/** Just the provider's own words (what every client-facing view shows). */
export function stripProposedTimeLine(message: string | null | undefined): string {
  return parseProposedTimeLine(message).userMessage;
}

/**
 * Append the line to the user's message, keeping the COMBINED text inside the
 * schema's 1000 characters. The line is never truncated (a half-written time is
 * worse than no time); the user's part is shortened instead.
 */
export function appendProposedTimeLine(
  userMessage: string | null | undefined,
  line: string | null,
  limit: number = BID_MESSAGE_LIMIT
): string | null {
  const body = stripProposedTimeLine(userMessage).trim();
  if (!line) return body.length > 0 ? body : null;
  const room = Math.max(0, limit - line.length - (body.length > 0 ? 1 : 0));
  const clipped = body.length > room ? body.slice(0, room).trimEnd() : body;
  if (clipped.length === 0) return line;
  return `${clipped}\n${line}`;
}

/**
 * `eta_minutes` from the arrivals: minutes until the FIRST proposed start, in
 * the schema's 0..1440 window. A start today in the past is 0; anything more
 * than a day away is 1440 (the ceiling the field allows).
 */
export function etaMinutesForFirstArrival(
  arrivals: ProposedArrival[],
  tasks: BidTaskWindow[],
  now: Date = new Date()
): number {
  const first = [...arrivals].sort(
    (a, b) => a.taskNumber - b.taskNumber || a.minutes - b.minutes
  )[0];
  if (!first) return 0;
  const task = tasks.find((entry) => entry.number === first.taskNumber);
  if (!task?.day) return 1440;
  const at = new Date(
    task.day.getFullYear(),
    task.day.getMonth(),
    task.day.getDate(),
    Math.floor(first.minutes / 60),
    first.minutes % 60,
    0,
    0
  );
  const diff = Math.round((at.getTime() - now.getTime()) / 60_000);
  return Math.max(0, Math.min(1440, diff));
}

/** Is there exactly one chosen arrival per task? */
export function hasEveryArrival(
  arrivals: ProposedArrival[],
  tasks: BidTaskWindow[]
): boolean {
  if (tasks.length === 0) return false;
  return tasks.every((task) =>
    arrivals.some((entry) => entry.taskNumber === task.number && Number.isFinite(entry.minutes))
  );
}

/**
 * The exact wire message: the provider's own words plus the proposed-time line
 * (null when both are empty). This is what POST/PUT sends — the screen never
 * builds the text itself, so the format cannot drift between the two flows.
 */
export function composeBidMessage(
  userMessage: string | null | undefined,
  arrivals: ProposedArrival[],
  meridiem: { am: string; pm: string }
): string | null {
  return appendProposedTimeLine(
    userMessage,
    buildProposedTimeLine(arrivals, meridiem)
  );
}

/**
 * How many characters the message FIELD may hold: the schema's 1000 minus the
 * line that will be appended. The provider's own words are counted against what
 * will really be sent, so nothing is silently clipped on the way out.
 */
export function messageRoomFor(
  arrivals: ProposedArrival[],
  meridiem: { am: string; pm: string },
  limit: number = BID_MESSAGE_LIMIT
): number {
  const line = buildProposedTimeLine(arrivals, meridiem);
  if (!line) return limit;
  return Math.max(0, limit - line.length - 1);
}

/**
 * Whether the message the server stored differs from what would be sent now.
 * Compared as WHOLE wire messages (line included), so an untouched bid whose
 * arrivals are unchanged is not offered a pointless Save, while a bid saved
 * before this feature (no line) counts as changed the moment a time is picked.
 */
export function hasBidMessageChanged(
  storedMessage: string | null | undefined,
  userMessage: string | null | undefined,
  arrivals: ProposedArrival[],
  meridiem: { am: string; pm: string }
): boolean {
  const stored = typeof storedMessage === 'string' ? storedMessage.trim() : '';
  const next = composeBidMessage(userMessage, arrivals, meridiem) ?? '';
  return stored !== next.trim();
}

/** The first missing task number, or null when all are chosen. */
export function firstMissingArrival(
  arrivals: ProposedArrival[],
  tasks: BidTaskWindow[]
): number | null {
  for (const task of tasks) {
    if (!arrivals.some((entry) => entry.taskNumber === task.number && Number.isFinite(entry.minutes))) {
      return task.number;
    }
  }
  return null;
}

/** Readable window for one task row (`8:00 AM - 11:00 AM`, or Anytime's own). */
export function taskWindowLabel(
  task: BidTaskWindow,
  meridiem: { am: string; pm: string }
): string {
  return formatWindowLabel(
    { hour: Math.floor(task.startMinutes / 60), minute: task.startMinutes % 60 },
    { hour: Math.floor(task.endMinutes / 60), minute: task.endMinutes % 60 },
    meridiem
  );
}

/**
 * The client-visible list of chosen times, for a view that has no job loaded:
 * one time stays bare (the caller adds "Starts"), several are labelled per task
 * so a multi-day offer can never be read as a single start.
 */
export function proposedTimesSummary(
  arrivals: ProposedArrival[],
  meridiem: { am: string; pm: string },
  options: {
    /** The job's task windows, used only to add the real task DATE. */
    tasks?: BidTaskWindow[];
    /** Localized "Task N" label (the summary itself never hardcodes English). */
    taskLabel?: (taskNumber: number) => string;
    /** Localized day label for a task's date. */
    dayLabel?: (day: Date) => string;
  } = {}
): { single: boolean; text: string } | null {
  const sorted = [...arrivals]
    .filter((entry) => Number.isFinite(entry.minutes))
    .sort((a, b) => a.taskNumber - b.taskNumber);
  if (sorted.length === 0) return null;
  const rows = sorted.map((entry) => {
    const clock = formatTimeLabel(
      { hour: Math.floor(entry.minutes / 60), minute: entry.minutes % 60 },
      meridiem
    );
    const task = options.tasks?.find((item) => item.number === entry.taskNumber);
    const day = task?.day && options.dayLabel ? options.dayLabel(task.day) : null;
    return {
      label: options.taskLabel ? options.taskLabel(entry.taskNumber) : `Task ${entry.taskNumber}`,
      time: day ? `${day}, ${clock}` : clock,
      clock,
    };
  });
  if (rows.length === 1) return { single: true, text: rows[0].time };
  return {
    single: false,
    text: rows
      .map((row) =>
        options.taskLabel ? `${row.label} · ${row.time}` : `${row.label} ${row.clock}`
      )
      .join(' · '),
  };
}

/** The client-visible summary of the chosen times (`Starts 9:30 AM · 3:00 PM`). */
export function arrivalsSummary(
  arrivals: ProposedArrival[],
  tasks: BidTaskWindow[],
  meridiem: { am: string; pm: string }
): string {
  return [...arrivals]
    .sort((a, b) => a.taskNumber - b.taskNumber)
    .map((entry) => {
      const task = tasks.find((item) => item.number === entry.taskNumber);
      const clock = formatTimeLabel(
        { hour: Math.floor(entry.minutes / 60), minute: entry.minutes % 60 },
        meridiem
      );
      return tasks.length > 1 && task ? `Task ${task.number} ${clock}` : clock;
    })
    .join(' · ');
}
