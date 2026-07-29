export interface BlogPost {
  id: string;
  title: string;
  category: string;
  excerpt: string;
  body: string[];
  author: string;
  date: string;
  readTime: string;
  image: string;
}

export const BLOG_CATEGORIES = [
  'Home Services',
  'Client Guides',
  'Provider Growth',
  'Safety & Trust',
  'Platform Updates',
  'Business & Industry',
];

export const BLOG_POSTS: BlogPost[] = [
  {
    id: 'bl1',
    title: '5 Signs It\'s Time to Hire a Professional House Cleaner',
    category: 'Home Services',
    excerpt: 'Juggling work and home life? Here\'s how to know when a professional clean is worth it.',
    author: 'SkillBuddy Team',
    date: 'Jan 12, 2026',
    readTime: '4 min read',
    image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800',
    body: [
      'Between work, family, and everything in between, keeping a spotless home can feel like a full-time job on top of your actual full-time job. If you\'ve been putting off deep-cleaning the bathroom for the third week running, it might be time to bring in a professional.',
      'A professional SkillBuddy Pilot doesn\'t just tidy up — they deep clean areas that often get overlooked: baseboards, behind appliances, grout lines, and light fixtures. The difference between a quick surface wipe and a proper deep clean is night and day.',
      'One of the biggest signs is simply mental load. If cleaning has become a source of stress rather than a task, outsourcing it frees up hours every week for the things that actually matter to you.',
      'Booking through SkillBuddy also means you know exactly who is coming into your home — every Pilot is verified, rated, and reviewed by real clients before they ever pick up a job.',
    ],
  },
  {
    id: 'bl2',
    title: 'How to Write a Job Post That Gets Great Bids',
    category: 'Client Guides',
    excerpt: 'The details you include in your job post directly affect the quality of bids you receive.',
    author: 'SkillBuddy Team',
    date: 'Jan 8, 2026',
    readTime: '5 min read',
    image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800',
    body: [
      'A vague job post gets vague bids. If you want SkillBuddy Pilots to bid accurately and confidently, the details you provide upfront matter enormously.',
      'Start with a clear, specific title — "Deep clean 2-bedroom apartment" tells a Pilot far more than just "Cleaning needed." Follow with a description that covers scope, any access instructions, and what "done" looks like to you.',
      'Photos help enormously, especially for jobs like repairs or painting where the scale of the work isn\'t obvious from text alone. A few clear photos can mean the difference between an accurate bid and a lowball offer that gets renegotiated later.',
      'Finally, be realistic about your budget. Our recommendation algorithm surfaces Pilots based on distance, rating, and credibility — but a wildly underpriced job will attract fewer serious bids regardless of how well it\'s written.',
    ],
  },
  {
    id: 'bl3',
    title: 'Growing Your SkillBuddy Pilot Business: A Practical Guide',
    category: 'Provider Growth',
    excerpt: 'From your first job to a fully booked calendar — practical tips from top-rated Pilots.',
    author: 'SkillBuddy Team',
    date: 'Jan 3, 2026',
    readTime: '6 min read',
    image: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=800',
    body: [
      'Your rating and badge tier directly influence how often you\'re recommended to clients — our scoring system weighs star rating, credibility, response time, and job history. The fastest way to climb is consistency: respond quickly, show up on time, and follow through on what you bid.',
      'Response time carries more weight than most new Pilots expect. Bidding within the first few minutes of a job going live, especially for Urgent requests, significantly increases your chances of being shortlisted.',
      'Don\'t underprice just to win jobs early on. A string of low-margin jobs completed well builds the same credibility as higher-priced ones — and once your badge tier climbs, you\'ll naturally command better rates.',
      'Finally, invest in your profile: a clear photo, a specific primary skill, and certifications where relevant all feed into how clients perceive you before they even see your bid.',
    ],
  },
  {
    id: 'bl4',
    title: 'How SkillBuddy Verifies Every Pilot on the Platform',
    category: 'Safety & Trust',
    excerpt: 'A look behind the scenes at our documents, credibility, and rating system.',
    author: 'SkillBuddy Team',
    date: 'Dec 28, 2025',
    readTime: '4 min read',
    image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800',
    body: [
      'Trust is the foundation of any service marketplace, and SkillBuddy takes verification seriously at every stage. Every Pilot must complete face verification and, where applicable, provide residence permit documentation before they can bid on jobs.',
      'Beyond onboarding, our credibility score is a living number — it responds to job completion, cancellations, and client reviews in real time. A Pilot who cancels jobs frequently or receives poor reviews will see this reflected immediately in their score and, by extension, in how often they\'re recommended.',
      'If a Pilot\'s rating drops below 4.0 following a cancellation, their account is automatically suspended for 28 days — a firm but fair policy designed to protect clients without being permanently punitive.',
    ],
  },
  {
    id: 'bl5',
    title: 'What\'s New: Live Bidding and Smarter Recommendations',
    category: 'Platform Updates',
    excerpt: 'A rundown of the newest features shipped to the SkillBuddy app.',
    author: 'SkillBuddy Team',
    date: 'Dec 20, 2025',
    readTime: '3 min read',
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800',
    body: [
      'We\'ve rolled out a live bidding dashboard for both Urgent and Regular jobs — client-side, you\'ll now see bids arrive in real time as Pilots respond, with our Top 3 Recommended section automatically surfacing the best matches by score.',
      'On the Pilot side, we\'ve added the ability to modify a submitted bid and quick +/- price adjustment buttons when a client restarts a bidding timer without accepting an offer.',
      'We\'ve also overhauled the payment flow with clear VAT/fee breakdowns on both the client and Pilot sides, plus support for Pay Later and Instalment plans for eligible, established users.',
    ],
  },
  {
    id: 'bl6',
    title: 'The Gig Economy in the Baltics: Where Local Services Are Headed',
    category: 'Business & Industry',
    excerpt: 'A look at how on-demand local services are evolving across Latvia, Estonia, and Lithuania.',
    author: 'SkillBuddy Team',
    date: 'Dec 14, 2025',
    readTime: '5 min read',
    image: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800',
    body: [
      'The Baltic region has quietly become one of the more interesting testing grounds for local-services marketplaces — high smartphone penetration, dense urban centers, and a strong culture of independent contracting all play a part.',
      'Unlike larger Western European markets, demand here skews heavily toward flexible, short-notice bookings rather than recurring subscriptions — which is part of why our Urgent/Regular bidding model resonates so strongly with local users.',
      'As the platform grows across Riga, Tallinn, and Vilnius, we\'re seeing an increasing share of Pilots treating SkillBuddy as a primary income source rather than a side gig — a trend we expect to continue through 2026.',
    ],
  },
];
