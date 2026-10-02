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

// No blog backend exists yet (the live API exposes no /blog endpoints), so
// both exports are honestly empty until one ships. The previous fixture
// content — six locally authored posts with Unsplash images — was removed:
// it never came from a server, so it was mock data pretending to be a blog.
export const BLOG_CATEGORIES: string[] = [];

export const BLOG_POSTS: BlogPost[] = [];
