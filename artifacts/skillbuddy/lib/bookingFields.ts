/**
 * Defensive field extraction for GET /api/v1/clients/bookings items.
 *
 * The endpoint's OpenAPI schema is OPAQUE (`bookings` items are bare objects
 * with `additionalProperties: true` — no named fields, per the live docs and
 * the task's warning not to guess). The web app already ships against this
 * endpoint using exactly this candidate-key strategy
 * (Skillbuddy-Web/src/hooks/use-client-bookings.ts) — mobile mirrors it so
 * both clients render whatever the backend actually sends.
 *
 * If/when the backend documents a concrete booking schema, replace these
 * helpers with direct typed access.
 */

/** Safely extract a displayable string field from an opaque booking object. */
export function getBookingField(booking: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = booking?.[key];
    if (typeof val === 'string' && val) return val;
    if (typeof val === 'number') return String(val);
  }
  return '';
}

export function getBookingStatus(booking: Record<string, unknown>): string {
  return getBookingField(booking, 'status', 'booking_status', 'state', 'order_status');
}

export function getBookingTitle(booking: Record<string, unknown>): string {
  return getBookingField(booking, 'title', 'service_name', 'service_title', 'name', 'description');
}

export function getBookingDate(booking: Record<string, unknown>): string {
  return getBookingField(booking, 'date', 'booking_date', 'scheduled_date', 'created_at', 'date_time');
}

export function getBookingPrice(booking: Record<string, unknown>): string {
  return getBookingField(booking, 'price', 'total_price', 'amount', 'total_amount', 'cost');
}

export function getBookingProvider(booking: Record<string, unknown>): string {
  return getBookingField(booking, 'provider_name', 'provider', 'professional_name', 'worker_name');
}

/** List key: prefer the id field, fall back to array index. */
export function getBookingKey(booking: Record<string, unknown>, index: number): string {
  const id = getBookingField(booking, 'id', 'booking_id', 'order_id');
  return id || `booking-${index}`;
}
