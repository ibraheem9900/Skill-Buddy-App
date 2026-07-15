import type { Category, Service, Offer, Notification, ChatThread, Booking, Review } from '@/types';

// ─── Current User (mock) ──────────────────────────────────────────────────────
export interface MockUser {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  creditPoints: number;
  pastBookingCategoryIds: string[];
}

export const CURRENT_USER: MockUser = {
  id: 'u1',
  name: 'Alex Johnson',
  firstName: 'Alex',
  lastName: 'Johnson',
  email: 'alex.johnson@example.com',
  creditPoints: 340,
  pastBookingCategoryIds: ['1', '6', '4'], // Cleaning, Laundry, Shifting — derived from MOCK_BOOKINGS
};

// ─── Categories ───────────────────────────────────────────────────────────────
export const CATEGORIES: Category[] = [
  { id: '1',  name: 'Cleaning',        iconLib: 'MaterialCommunityIcons', iconName: 'broom',                   color: '#3A9E8F' },
  { id: '2',  name: 'Repairing',       iconLib: 'MaterialCommunityIcons', iconName: 'tools',                   color: '#3A9E8F' },
  { id: '3',  name: 'Plumbing',        iconLib: 'MaterialCommunityIcons', iconName: 'pipe',                    color: '#3A9E8F' },
  { id: '4',  name: 'Shifting',        iconLib: 'MaterialCommunityIcons', iconName: 'truck-delivery',          color: '#3A9E8F' },
  { id: '5',  name: 'Painting',        iconLib: 'MaterialCommunityIcons', iconName: 'format-paint',            color: '#3A9E8F' },
  { id: '6',  name: 'Laundry',         iconLib: 'MaterialCommunityIcons', iconName: 'washing-machine',         color: '#3A9E8F' },
  { id: '7',  name: 'AC Repair',       iconLib: 'MaterialCommunityIcons', iconName: 'air-conditioner',         color: '#3A9E8F' },
  { id: '8',  name: 'Car Repair',      iconLib: 'MaterialCommunityIcons', iconName: 'car-wrench',              color: '#3A9E8F' },
  { id: '9',  name: 'Beauty',          iconLib: 'MaterialCommunityIcons', iconName: 'face-woman',              color: '#3A9E8F' },
  { id: '10', name: 'Pets',            iconLib: 'MaterialCommunityIcons', iconName: 'paw',                     color: '#3A9E8F' },
  { id: '11', name: 'Photography',     iconLib: 'MaterialCommunityIcons', iconName: 'camera',                  color: '#3A9E8F' },
  { id: '12', name: 'Babysitting',     iconLib: 'MaterialCommunityIcons', iconName: 'baby-face-outline',       color: '#3A9E8F' },
  { id: '13', name: 'Barbering',       iconLib: 'MaterialCommunityIcons', iconName: 'content-cut',             color: '#3A9E8F' },
  { id: '14', name: 'Dog Training',    iconLib: 'MaterialCommunityIcons', iconName: 'dog',                     color: '#3A9E8F' },
  { id: '15', name: 'Party',           iconLib: 'MaterialCommunityIcons', iconName: 'party-popper',            color: '#3A9E8F' },
  { id: '16', name: 'Gardening',       iconLib: 'MaterialCommunityIcons', iconName: 'flower',                  color: '#3A9E8F' },
  { id: '17', name: 'Pest Control',    iconLib: 'MaterialCommunityIcons', iconName: 'bug',                     color: '#3A9E8F' },
  { id: '18', name: 'Electrical',      iconLib: 'MaterialCommunityIcons', iconName: 'lightning-bolt',          color: '#3A9E8F' },
];

// ─── Subservices (for Task 6 follow-up) ───────────────────────────────────────
export interface Subservice {
  id: string;
  categoryId: string;
  name: string;
  description: string;
}

export const SUBSERVICES: Subservice[] = [
  // Cleaning (1)
  { id: 'ss1',  categoryId: '1',  name: 'House Cleaning',    description: 'Full home deep clean' },
  { id: 'ss2',  categoryId: '1',  name: 'Floor Cleaning',    description: 'All floor types' },
  { id: 'ss3',  categoryId: '1',  name: 'Office Cleaning',   description: 'Commercial spaces' },
  { id: 'ss4',  categoryId: '1',  name: 'Carpet Cleaning',   description: 'Steam & dry clean' },
  // Repairing (2)
  { id: 'ss5',  categoryId: '2',  name: 'Appliance Repair',  description: 'All home appliances' },
  { id: 'ss6',  categoryId: '2',  name: 'Handyman Service',  description: 'General fixes' },
  { id: 'ss7',  categoryId: '2',  name: 'Furniture Repair',  description: 'Wood, upholstery, frames' },
  // Plumbing (3)
  { id: 'ss8',  categoryId: '3',  name: 'Pipe Repair',       description: 'Leak fixes & pipe replacement' },
  { id: 'ss9',  categoryId: '3',  name: 'Drain Cleaning',    description: 'Blockage removal' },
  { id: 'ss10', categoryId: '3',  name: 'Fixture Install',   description: 'Taps, toilets, showers' },
  // Shifting (4)
  { id: 'ss11', categoryId: '4',  name: 'Home Moving',       description: 'Residential relocation' },
  { id: 'ss12', categoryId: '4',  name: 'Office Moving',     description: 'Commercial relocation' },
  { id: 'ss13', categoryId: '4',  name: 'Furniture Assembly',description: 'Flat-pack assembly' },
  { id: 'ss14', categoryId: '4',  name: 'Packing Service',   description: 'Box & wrap items' },
  // Painting (5)
  { id: 'ss15', categoryId: '5',  name: 'Interior Painting', description: 'Walls & ceilings' },
  { id: 'ss16', categoryId: '5',  name: 'Exterior Painting', description: 'Facades & fences' },
  { id: 'ss17', categoryId: '5',  name: 'Furniture Painting',description: 'Refinish & paint' },
  // Laundry (6)
  { id: 'ss18', categoryId: '6',  name: 'Cloth Ironing',     description: 'All garment types' },
  { id: 'ss19', categoryId: '6',  name: 'Wash & Fold',       description: 'Full laundry service' },
  { id: 'ss20', categoryId: '6',  name: 'Dry Cleaning',      description: 'Delicate items' },
  // AC Repair (7)
  { id: 'ss21', categoryId: '7',  name: 'AC Installation',   description: 'New unit setup' },
  { id: 'ss22', categoryId: '7',  name: 'AC Servicing',      description: 'Filter & coil clean' },
  { id: 'ss23', categoryId: '7',  name: 'Gas Refill',        description: 'Refrigerant recharge' },
  // Car Repair (8)
  { id: 'ss24', categoryId: '8',  name: 'Oil Change',        description: 'Engine oil & filter' },
  { id: 'ss25', categoryId: '8',  name: 'Tyre Service',      description: 'Change, balance, align' },
  { id: 'ss26', categoryId: '8',  name: 'Car Wash',          description: 'Interior & exterior detail' },
  // Beauty (9)
  { id: 'ss27', categoryId: '9',  name: 'Makeup',            description: 'Event & bridal makeup' },
  { id: 'ss28', categoryId: '9',  name: 'Facial',            description: 'Skincare treatments' },
  { id: 'ss29', categoryId: '9',  name: 'Nail Art',          description: 'Manicure & pedicure' },
  // Pets (10)
  { id: 'ss30', categoryId: '10', name: 'Pet Grooming',      description: 'Bath, trim, styling' },
  { id: 'ss31', categoryId: '10', name: 'Pet Sitting',       description: 'In-home pet care' },
  { id: 'ss32', categoryId: '10', name: 'Vet Visit',         description: 'Mobile vet service' },
  // Photography (11)
  { id: 'ss33', categoryId: '11', name: 'Event Photography', description: 'Weddings & parties' },
  { id: 'ss34', categoryId: '11', name: 'Portrait Session',  description: 'Personal & family' },
  { id: 'ss35', categoryId: '11', name: 'Product Photography',description: 'E-commerce photos' },
  // Babysitting (12)
  { id: 'ss36', categoryId: '12', name: 'Hourly Babysit',    description: 'Flexible hourly care' },
  { id: 'ss37', categoryId: '12', name: 'After School Care', description: 'Pickup & supervision' },
  { id: 'ss38', categoryId: '12', name: 'Overnight Care',    description: 'Overnight supervision' },
  // Barbering (13)
  { id: 'ss39', categoryId: '13', name: 'Haircut',           description: 'Men & children cuts' },
  { id: 'ss40', categoryId: '13', name: 'Beard Trim',        description: 'Shape & style' },
  { id: 'ss41', categoryId: '13', name: 'Hair Colouring',    description: 'Dye & highlights' },
  // Dog Training (14)
  { id: 'ss42', categoryId: '14', name: 'Basic Obedience',   description: 'Sit, stay, recall' },
  { id: 'ss43', categoryId: '14', name: 'Puppy Training',    description: 'Foundation skills' },
  { id: 'ss44', categoryId: '14', name: 'Behavioural Fix',   description: 'Aggression & anxiety' },
  // Party Organizing (15)
  { id: 'ss45', categoryId: '15', name: 'Birthday Party',    description: 'Full event setup' },
  { id: 'ss46', categoryId: '15', name: 'Decoration',        description: 'Balloons, banners, themes' },
  { id: 'ss47', categoryId: '15', name: 'Catering Coord.',   description: 'Food & drinks planning' },
  // Gardening (16)
  { id: 'ss48', categoryId: '16', name: 'Lawn Mowing',       description: 'Regular grass cut' },
  { id: 'ss49', categoryId: '16', name: 'Hedge Trimming',    description: 'Shape & prune' },
  { id: 'ss50', categoryId: '16', name: 'Garden Design',     description: 'Landscape planting' },
  // Pest Control (17)
  { id: 'ss51', categoryId: '17', name: 'Insect Control',    description: 'Ants, cockroaches, flies' },
  { id: 'ss52', categoryId: '17', name: 'Rodent Control',    description: 'Mice & rat removal' },
  { id: 'ss53', categoryId: '17', name: 'Termite Treatment', description: 'Wood protection' },
  // Electrical (18)
  { id: 'ss54', categoryId: '18', name: 'Wiring & Rewiring', description: 'Safe installation' },
  { id: 'ss55', categoryId: '18', name: 'Socket & Switch',   description: 'Replace & install' },
  { id: 'ss56', categoryId: '18', name: 'Lighting Install',  description: 'Fixtures & LEDs' },
];

const JENNY: Service['provider'] = {
  id: 'p1',
  name: 'Jenny Wilson',
  rating: 4.8,
  reviewCount: 365,
  jobsDone: 142,
  badge: 3,
  credibility: 97,
  specialty: 'Home Cleaning',
  location: 'Riga, Latvia',
  isOnline: true,
};

const WADE: Service['provider'] = {
  id: 'p2',
  name: 'Wade Warren',
  rating: 4.9,
  reviewCount: 210,
  jobsDone: 89,
  badge: 2,
  credibility: 94,
  specialty: 'Ironing & Laundry',
  location: 'Riga, Latvia',
  isOnline: false,
};

const ESTHER: Service['provider'] = {
  id: 'p3',
  name: 'Esther Howard',
  rating: 4.7,
  reviewCount: 178,
  jobsDone: 67,
  badge: 2,
  credibility: 91,
  specialty: 'Repairing',
  location: 'Riga, Latvia',
  isOnline: true,
};

const MARCUS: Service['provider'] = {
  id: 'p4',
  name: 'Marcus Lee',
  rating: 4.9,
  reviewCount: 320,
  jobsDone: 210,
  badge: 3,
  credibility: 98,
  specialty: 'Photography',
  location: 'Riga, Latvia',
  isOnline: true,
};

export const SERVICES: Service[] = [
  {
    id: 's1',
    title: 'Deep House Cleaning',
    category: 'Home Cleaning',
    categoryId: '1',
    provider: JENNY,
    price: 180,
    rating: 4.5,
    reviewCount: 365,
    image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80',
    images: [
      'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&q=80',
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
      'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?w=400&q=80',
      'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
    ],
    location: '1012 Ocean Avenue, Riga, Latvia',
    description: 'Professional deep cleaning service for your entire home. Our trained specialists use eco-friendly products to ensure every corner of your house is spotless. Service includes kitchen, bathrooms, bedrooms, and living areas.',
    avgPriceMin: 150,
    avgPriceMax: 220,
  },
  {
    id: 's2',
    title: 'Floor Cleaning',
    category: 'Home Cleaning',
    categoryId: '1',
    provider: JENNY,
    price: 60,
    rating: 4.7,
    reviewCount: 128,
    image: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Expert floor cleaning for all types of flooring including hardwood, tile, and carpet. We use professional-grade equipment for streak-free results.',
    avgPriceMin: 50,
    avgPriceMax: 90,
  },
  {
    id: 's3',
    title: 'Glass Cleaning',
    category: 'Home Cleaning',
    categoryId: '1',
    provider: JENNY,
    price: 60,
    rating: 4.9,
    reviewCount: 200,
    image: 'https://images.unsplash.com/photo-1527515673510-8aa78ce21f9b?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Crystal clear glass and window cleaning service. Streak-free shine guaranteed on all windows, mirrors, and glass surfaces.',
    avgPriceMin: 45,
    avgPriceMax: 80,
  },
  {
    id: 's4',
    title: 'Kitchen Cleaning',
    category: 'Home Cleaning',
    categoryId: '1',
    provider: JENNY,
    price: 40,
    rating: 4.6,
    reviewCount: 88,
    image: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Deep kitchen cleaning including appliances, cabinets, countertops, and sink. All cooking surfaces degreased and sanitized.',
    avgPriceMin: 35,
    avgPriceMax: 65,
  },
  {
    id: 's5',
    title: 'Cloth Ironing',
    category: 'Laundry',
    categoryId: '6',
    provider: WADE,
    price: 120,
    rating: 4.8,
    reviewCount: 154,
    image: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Professional ironing service for all types of clothing. We handle everything from shirts to delicate garments with care.',
    avgPriceMin: 80,
    avgPriceMax: 160,
  },
  {
    id: 's6',
    title: 'Furniture Assembly',
    category: 'Shifting',
    categoryId: '4',
    provider: ESTHER,
    price: 90,
    rating: 4.7,
    reviewCount: 97,
    image: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Expert furniture assembly service. We assemble flat-pack furniture of all brands quickly and correctly.',
    avgPriceMin: 55,
    avgPriceMax: 141,
  },
  {
    id: 's7',
    title: 'Event Photography',
    category: 'Photography',
    categoryId: '11',
    provider: MARCUS,
    price: 350,
    rating: 4.9,
    reviewCount: 320,
    image: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Professional event photography for weddings, birthdays, and corporate events. High-res delivery within 48 hours.',
    avgPriceMin: 250,
    avgPriceMax: 600,
  },
  {
    id: 's8',
    title: 'Pet Grooming',
    category: 'Pets',
    categoryId: '10',
    provider: ESTHER,
    price: 55,
    rating: 4.6,
    reviewCount: 112,
    image: 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?w=400&q=80',
    location: 'Riga, Latvia',
    description: 'Full grooming service for dogs and cats. Bath, trim, nail clip, and styling included.',
    avgPriceMin: 40,
    avgPriceMax: 90,
  },
];

export const OFFERS: Offer[] = [
  {
    id: 'o1',
    title: 'Get Special Offer',
    subtitle: 'All Services Available | T&C Applied',
    discount: 40,
    bg: '#1A4A35',
    bgImage: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&q=80',
  },
  {
    id: 'o2',
    title: 'First Booking Deal',
    subtitle: 'New users only | Limited time',
    discount: 25,
    bg: '#1A3A4A',
    bgImage: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?w=600&q=80',
  },
  {
    id: 'o3',
    title: 'Weekend Savings',
    subtitle: 'Book Sat–Sun and save big',
    discount: 20,
    bg: '#3A1A4A',
    bgImage: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=600&q=80',
  },
];

export const NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    title: 'Service Booked Successfully',
    message: 'Your Deep House Cleaning service has been confirmed for tomorrow at 11 AM.',
    type: 'booking',
    time: '1h',
    isRead: false,
  },
  {
    id: 'n2',
    title: '50% Off on Home Cleaning',
    message: 'Limited time offer! Book any cleaning service today and get 50% off on your total bill.',
    type: 'offer',
    time: '1h',
    isRead: false,
  },
  {
    id: 'n3',
    title: 'Service Review Request',
    message: 'How was your experience with Jenny Wilson? Rate the service and share your feedback with us.',
    type: 'review',
    time: '1h',
    isRead: true,
  },
  {
    id: 'n4',
    title: 'Service Booked Successfully',
    message: 'Your Floor Cleaning service has been assigned to Jenny Wilson.',
    type: 'booking',
    time: '1d',
    isRead: true,
  },
  {
    id: 'n5',
    title: 'New Payment Method Added',
    message: 'Your PayPal account has been linked successfully to your SkillBuddy wallet.',
    type: 'payment',
    time: '1d',
    isRead: true,
  },
  {
    id: 'n6',
    title: 'Service Booked Successfully',
    message: 'Your Glass Cleaning service is confirmed for Friday.',
    type: 'booking',
    time: '2d',
    isRead: true,
  },
];

export const CHAT_THREADS: ChatThread[] = [
  {
    id: 'c1',
    participant: { id: 'p1', name: 'Jenny Wilson', specialty: 'Home Cleaning', isOnline: true },
    lastMessage: 'I will be there at 11 AM sharp.',
    lastTime: '08:04 pm',
    unreadCount: 2,
    jobTitle: 'Deep House Cleaning',
  },
  {
    id: 'c2',
    participant: { id: 'p2', name: 'Wade Warren', specialty: 'Ironing & Laundry', isOnline: false },
    lastMessage: 'Thank you for the booking!',
    lastTime: '6:15 pm',
    unreadCount: 0,
    jobTitle: 'Cloth Ironing',
  },
  {
    id: 'c3',
    participant: { id: 'p3', name: 'Esther Howard', specialty: 'Repairing', isOnline: true },
    lastMessage: 'The parts are ordered, should arrive tomorrow.',
    lastTime: 'Yesterday',
    unreadCount: 1,
    jobTitle: 'Furniture Assembly',
  },
];

export const MOCK_BOOKINGS: Booking[] = [
  {
    id: 'b1',
    service: SERVICES[0],
    provider: JENNY,
    status: 'assigned',
    date: 'Tomorrow',
    time: '11:00 AM',
    price: 180,
    address: '1012 Ocean Avenue, Riga',
    isUrgent: false,
  },
  {
    id: 'b2',
    service: SERVICES[1],
    provider: JENNY,
    status: 'completed',
    date: 'Jan 10, 2025',
    time: '2:00 PM',
    price: 60,
    address: '205 W 54th St, Riga',
  },
  {
    id: 'b3',
    service: SERVICES[4],
    provider: WADE,
    status: 'in_progress',
    date: 'Today',
    time: '3:00 PM',
    price: 120,
    address: '415 Madison Ave, Riga',
    isUrgent: true,
  },
];

export const MOCK_REVIEWS: Review[] = [
  {
    id: 'r1',
    reviewer: { name: 'Martin Luther' },
    rating: 4.0,
    comment: 'Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry\'s standard dummy text ever since the 1500s.',
    date: '2 days ago',
  },
  {
    id: 'r2',
    reviewer: { name: 'Johan Smith Jeo' },
    rating: 3.0,
    comment: 'Good service overall. Would recommend for regular cleaning tasks.',
    date: '3 days ago',
  },
  {
    id: 'r3',
    reviewer: { name: 'Sarah Connor' },
    rating: 5.0,
    comment: 'Absolutely fantastic! The team was professional, punctual, and thorough. My house has never been this clean.',
    date: '1 week ago',
  },
];
