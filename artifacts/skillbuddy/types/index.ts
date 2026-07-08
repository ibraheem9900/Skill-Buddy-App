export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  username?: string;
  phone?: string;
  profile_picture?: string;
  personal_code?: string;
  role?: 'CLIENT' | 'PROVIDER';
  active_role?: 'CLIENT' | 'PROVIDER';
  address?: Address;
  is_verified?: boolean;
  is_active?: boolean;
  credit_points?: number;
  jobs_done?: number;
  active_jobs?: number;
  rating?: number;
}

export interface Address {
  street?: string;
  city?: string;
  county?: string;
  postal_code?: string;
  country?: string;
  house_number?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Category {
  id: string;
  name: string;
  iconLib: 'MaterialCommunityIcons' | 'Ionicons' | 'Feather';
  iconName: string;
  color: string;
}

export interface Provider {
  id: string;
  name: string;
  avatar?: string;
  rating?: number;
  reviewCount?: number;
  jobsDone?: number;
  badge?: number;
  credibility?: number;
  specialty?: string;
  location?: string;
  isOnline?: boolean;
}

export interface Service {
  id: string;
  title: string;
  category: string;
  categoryId: string;
  provider: Provider;
  price: number;
  rating: number;
  reviewCount: number;
  image: string;
  images?: string[];
  location: string;
  description?: string;
  isBookmarked?: boolean;
  avgPriceMin?: number;
  avgPriceMax?: number;
}

export type BookingStatus =
  | 'draft'
  | 'open'
  | 'shortlisted'
  | 'assigned'
  | 'arrived'
  | 'in_progress'
  | 'revision_requested'
  | 'completed'
  | 'approved'
  | 'closed'
  | 'cancelled'
  | 'disputed'
  | 'expired'
  | 'paused';

export interface Booking {
  id: string;
  service: Service;
  provider: Provider;
  status: BookingStatus;
  date: string;
  time: string;
  price: number;
  address?: string;
  description?: string;
  isUrgent?: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'booking' | 'offer' | 'review' | 'payment' | 'system';
  time: string;
  isRead: boolean;
}

export interface ChatMessage {
  id: string;
  text?: string;
  image?: string;
  voice?: string;
  voiceDuration?: number;
  sender: 'me' | 'other';
  timestamp: string;
  senderName?: string;
  senderAvatar?: string;
}

export interface ChatThread {
  id: string;
  participant: Provider;
  lastMessage: string;
  lastTime: string;
  unreadCount: number;
  jobTitle?: string;
}

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  discount: number;
  description?: string;
  bg: string;
}

export interface Review {
  id: string;
  reviewer: {
    name: string;
    avatar?: string;
  };
  rating: number;
  comment: string;
  date: string;
}
