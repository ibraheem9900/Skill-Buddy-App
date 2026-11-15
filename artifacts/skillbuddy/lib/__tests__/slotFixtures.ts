import { setClientSlots } from '../timeSlots';
import type { ApiTimeSlot } from '../apiTimeSlots';

/** The real five windows the live API returns, in the parsed app shape. */
export const TEST_API_SLOTS: ApiTimeSlot[] = [
  { id: 1, code: 'MORNING', label: '8:00 AM - 11:00 AM', startMinutes: 480, endMinutes: 660, window: '08:00-11:00', arrivalMinutes: [480, 510, 540, 570, 600, 630], arrivalOptions: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30'], sortOrder: 1 },
  { id: 2, code: 'MIDDAY', label: '11:00 AM - 2:00 PM', startMinutes: 660, endMinutes: 840, window: '11:00-14:00', arrivalMinutes: [660, 690, 720, 750, 780, 810], arrivalOptions: ['11:00', '11:30', '12:00', '12:30', '13:00', '13:30'], sortOrder: 2 },
  { id: 3, code: 'AFTERNOON', label: '2:00 PM - 5:00 PM', startMinutes: 840, endMinutes: 1020, window: '14:00-17:00', arrivalMinutes: [840, 870, 900, 930, 960, 990], arrivalOptions: ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30'], sortOrder: 3 },
  { id: 4, code: 'EVENING', label: '5:00 PM - 8:00 PM', startMinutes: 1020, endMinutes: 1200, window: '17:00-20:00', arrivalMinutes: [1020, 1050, 1080, 1110, 1140, 1170], arrivalOptions: ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30'], sortOrder: 4 },
  { id: 5, code: 'NIGHT', label: '8:00 PM - 11:00 PM', startMinutes: 1200, endMinutes: 1380, window: '20:00-23:00', arrivalMinutes: [1200, 1230, 1260, 1290, 1320, 1350], arrivalOptions: ['20:00', '20:30', '21:00', '21:30', '22:00', '22:30'], sortOrder: 5 },
];

/** Populate the shared registry before a test builds time choices. */
export function seedClientSlots(): void {
  setClientSlots(TEST_API_SLOTS);
}
