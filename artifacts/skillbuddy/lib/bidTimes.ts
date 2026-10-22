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

import type { JobResponse } from '@/types';
import { localDay } from '@/lib/jobBooking';
import {
  CLIENT_SLOTS,
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
export interface BidTaskWindow {
  /** 1-based "Task N". */
  number: number;
  /** Local day of the task, or null when the job has no readable instant. */
  day: Date | null;
  /** Local minutes of the client's window start. */
  startMinutes: number;
  /** Local minutes of the client's window end. */
  endMinutes: number;
  /** True when the client chose Anytime (a custom window). */
  anytime: boolean;
}

/**
 * Every task a pilot must propose a time for: one per milestone, or a single
 * task built from the job's own `scheduled_at` when there are no milestones.
 * Each window comes from the stored schedule line first (an Anytime booking only
 * exists there) and falls back to the job's local start.
 */
export function jobTaskWindows(job: JobResponse | null | undefined): BidTaskWindow[] {
  if (!job) return [];
  const milestones = [...(job.milestones ?? [])].sort(
    (a, b) => a.sequence - b.sequence || a.id - b.id
  );
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
      return {
        number: index + 1,
        day: local?.day ?? null,
        startMinutes: slot?.startMinutes ?? local?.minutes ?? 9 * 60,
        endMinutes: slot?.endMinutes ?? DAY_END_MINUTES,
        anytime: false,
      };
    }
    if (derived?.kind === 'anytime') {
      return {
        number: index + 1,
        day: local?.day ?? null,
        startMinutes: minutesOf(derived.start) ?? 9 * 60,
        endMinutes: minutesOf(derived.end) ?? 10 * 60,
        anytime: true,
      };
    }
    // Nothing readable: offer the first client window so the form is usable.
    return {
      number: index + 1,
      day: local?.day ?? localDay(new Date()),
      startMinutes: CLIENT_SLOTS[0].startMinutes,
      endMinutes: CLIENT_SLOTS[0].endMinutes,
      anytime: false,
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
  });
  if (marks.length > 0) return marks;
  return [
    {
      hour: Math.floor(task.startMinutes / 60),
      minute: task.startMinutes % 60,
    },
  ];
}

/** One chosen arrival: task number + local minutes. */
export interface ProposedArrival {
  taskNumber: number;
  minutes: number;
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
  meridiem: { am: string; pm: string }
): { single: boolean; text: string } | null {
  const sorted = [...arrivals]
    .filter((entry) => Number.isFinite(entry.minutes))
    .sort((a, b) => a.taskNumber - b.taskNumber);
  if (sorted.length === 0) return null;
  const clocks = sorted.map((entry) =>
    formatTimeLabel(
      { hour: Math.floor(entry.minutes / 60), minute: entry.minutes % 60 },
      meridiem
    )
  );
  if (clocks.length === 1) return { single: true, text: clocks[0] };
  return {
    single: false,
    text: clocks.map((clock, index) => `Task ${sorted[index].taskNumber} ${clock}`).join(' · '),
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
