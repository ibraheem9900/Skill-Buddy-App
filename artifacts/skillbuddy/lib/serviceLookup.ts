/**
 * serviceLookup.ts
 * Maps subservice IDs → representative Service objects.
 * If an existing SERVICES entry matches the subservice's categoryId, it is used
 * (cycling through matches). Otherwise a synthesised Service is returned that
 * is fully compatible with the Service type so app/service/[id].tsx renders fine.
 */
import { SERVICES, SUBSERVICES, CATEGORIES } from '@/data/mockData';
import type { Service } from '@/types';

const DEFAULT_PROVIDER: Service['provider'] = {
  id: 'p_default',
  name: 'SkillBuddy Expert',
  rating: 4.7,
  reviewCount: 120,
  jobsDone: 80,
  badge: 2,
  credibility: 93,
  specialty: 'Professional Services',
  location: 'Riga, Latvia',
  isOnline: true,
};

const PLACEHOLDER_IMAGES: Record<string, string> = {
  '1':  'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80',
  '2':  'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80',
  '3':  'https://images.unsplash.com/photo-1607400201515-c2c41c07d307?w=400&q=80',
  '4':  'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400&q=80',
  '5':  'https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=400&q=80',
  '6':  'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&q=80',
  '7':  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
  '8':  'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=400&q=80',
  '9':  'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80',
  '10': 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?w=400&q=80',
  '11': 'https://images.unsplash.com/photo-1519741497674-611481863552?w=400&q=80',
  '12': 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?w=400&q=80',
  '13': 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=400&q=80',
  '14': 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400&q=80',
  '15': 'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=400&q=80',
  '16': 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
  '17': 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=400&q=80',
  '18': 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400&q=80',
};

/** Returns all services matching a categoryId, cycling if fewer than needed */
function getServicesForCategory(categoryId: string): Service[] {
  return SERVICES.filter((s) => s.categoryId === categoryId);
}

/**
 * For a given subservice id, returns the best matching Service.
 * Priority: existing SERVICES with same categoryId (round-robin by subservice index).
 * Fallback: synthesised Service object.
 */
export function getServiceForSubservice(subserviceId: string): Service {
  const subservice = SUBSERVICES.find((ss) => ss.id === subserviceId);
  if (!subservice) return SERVICES[0];

  const catServices = getServicesForCategory(subservice.categoryId);
  if (catServices.length > 0) {
    // Find the index of this subservice among siblings to cycle through services
    const siblings = SUBSERVICES.filter((ss) => ss.categoryId === subservice.categoryId);
    const idx = siblings.findIndex((ss) => ss.id === subserviceId);
    return catServices[idx % catServices.length];
  }

  // Synthesise a service
  const category = CATEGORIES.find((c) => c.id === subservice.categoryId);
  const categoryName = category?.name ?? 'Service';
  const image = PLACEHOLDER_IMAGES[subservice.categoryId] ??
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80';
  const price = 80;

  const synthesised: Service = {
    id: `synth_${subserviceId}`,
    title: subservice.name,
    category: categoryName,
    categoryId: subservice.categoryId,
    provider: DEFAULT_PROVIDER,
    price,
    rating: 4.5,
    reviewCount: 60,
    image,
    images: [image],
    location: 'Riga, Latvia',
    description: subservice.description,
    avgPriceMin: Math.round(price * 0.8),
    avgPriceMax: Math.round(price * 1.5),
  };

  return synthesised;
}

/** Merges synthesised services into SERVICES array at runtime for detail lookup */
export function getServiceById(id: string): Service | undefined {
  // Check real services first
  const real = SERVICES.find((s) => s.id === id);
  if (real) return real;

  // Check synthesised (id = synth_<subserviceId>)
  if (id.startsWith('synth_')) {
    const subserviceId = id.replace('synth_', '');
    const subservice = SUBSERVICES.find((ss) => ss.id === subserviceId);
    if (subservice) return getServiceForSubservice(subserviceId);
  }

  return undefined;
}
