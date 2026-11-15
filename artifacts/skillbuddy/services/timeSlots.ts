import { api } from '@/services/api';
import type { ApiTimeSlot } from '@/lib/apiTimeSlots';
import { normalizeTimeSlots } from '@/lib/apiTimeSlots';

/** GET /api/v1/time-slots — authenticated (client and provider both get 200). */
export async function fetchTimeSlots(): Promise<ApiTimeSlot[]> {
  const { data } = await api.get<unknown>('/api/v1/time-slots');
  return normalizeTimeSlots(data);
}
