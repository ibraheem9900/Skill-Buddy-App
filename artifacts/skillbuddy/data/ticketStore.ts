import type { Ticket } from '@/types';

// No support-ticket backend exists yet (the live API exposes no /tickets
// endpoints), so the store is honestly empty until one ships. The previous
// fixtures and the local-only `createTicket`/`generateTicketId` helpers were
// removed: a ticket that only ever existed in device memory — and vanished on
// reinstall — was mock data pretending to be a real support request.
export const TICKETS: Ticket[] = [];
