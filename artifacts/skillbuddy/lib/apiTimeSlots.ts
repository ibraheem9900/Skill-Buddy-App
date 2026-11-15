/**
 * API time slots — the ONE adapter from GET /api/v1/time-slots to the app.
 *
 * Live response (2026-11-12):
 *   { id:1, code:"MORNING", label:"8:00 AM - 11:00 AM",
 *     start_time:"08:00", end_time:"11:00", window:"08:00-11:00",
 *     arrival_options:["08:00","08:30",...], sort_order:1 }
 *
 * The server is the source of truth. Nothing here invents a slot: a malformed
 * row is dropped, and a row with no usable arrival options still renders its
 * window but offers no pilot chips.
 */
export interface ApiTimeSlot {
  id: number;
  code: string;
  label: string;
  /** Local (Europe/Tallinn wall clock) minutes since midnight. */
  startMinutes: number;
  endMinutes: number;
  window: string;
  /** Raw server strings, e.g. "08:30". */
  arrivalOptions: string[];
  /** Parsed arrival minutes, sorted, inside [start, end). */
  arrivalMinutes: number[];
  sortOrder: number;
}

/** Parse "08:00", "08:00:00", "2026-11-12T08:00:00" or "8:00 AM". */
export function parseClockValue(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const ampm = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i.exec(text);
  if (ampm) {
    const hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const base = hour % 12;
    return ((ampm[3].toLowerCase() === 'pm' ? base + 12 : base) * 60 + minute);
  }

  const clock = /(?:^|T)(\d{1,2}):(\d{2})(?::\d{2})?/.exec(text);
  if (!clock) return null;
  const hour = Number(clock[1]);
  const minute = Number(clock[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeWindow(start: number, end: number): string {
  const fmt = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

/** One raw response item -> app shape, or null when unusable. */
export function parseTimeSlot(raw: unknown): ApiTimeSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = Number(row.id);
  const code = typeof row.code === 'string' ? row.code.trim() : '';
  const startMinutes = parseClockValue(row.start_time);
  const endMinutes = parseClockValue(row.end_time);
  if (!Number.isSafeInteger(id) || id <= 0 || !code) return null;
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;

  const rawOptions = Array.isArray(row.arrival_options) ? row.arrival_options : [];
  const arrivalOptions = rawOptions
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  const arrivalMinutes = Array.from(
    new Set(
      arrivalOptions
        .map(parseClockValue)
        .filter((m): m is number => m !== null && m >= startMinutes && m < endMinutes)
    )
  ).sort((a, b) => a - b);

  const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : normalizeWindow(startMinutes, endMinutes);
  const window = typeof row.window === 'string' && row.window.trim() ? row.window.trim() : normalizeWindow(startMinutes, endMinutes);
  const sortOrder = Number(row.sort_order);

  return {
    id,
    code,
    label,
    startMinutes,
    endMinutes,
    window,
    arrivalOptions,
    arrivalMinutes,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
  };
}

/** Every usable row, sorted by the server's sort_order then start time. */
export function normalizeTimeSlots(raw: unknown): ApiTimeSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseTimeSlot)
    .filter((slot): slot is ApiTimeSlot => slot !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.startMinutes - b.startMinutes || a.id - b.id);
}

/** The code array a milestone carries; Anytime means every server slot. */
export function codesForSelection(slots: ApiTimeSlot[], codes: string[]): string[] {
  const wanted = new Set(codes);
  return slots.filter((slot) => wanted.has(slot.code)).map((slot) => slot.code);
}

/** True when the server itself ships an Anytime-style slot. */
export function hasAnytimeSlot(slots: ApiTimeSlot[]): boolean {
  return slots.some((slot) => /anytime/i.test(`${slot.code} ${slot.label}`));
}
