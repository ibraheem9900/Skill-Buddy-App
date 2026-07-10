---
name: SkillBuddy logo implementation
description: How the real brand mark PNG is used and themed across light/dark/header surfaces.
---

# SkillBuddy Logo

**Rule:** Use the actual brand asset `assets/images/logo-icon.png` (transparent background, removed via removeImageBackground). Never redraw in SVG/code.

**Why:** Previous SVG attempts didn't match the brand mark closely enough. The real PNG with background removed can be tinted to any color exactly.

**How to apply:**
- Component: `components/LogoImage.tsx`
- Props: `variant` ("white" | "green" | "light") + `height`
- Use `tintColor` as an Image **prop** (not style) — `style.tintColor` is deprecated in RN.
  - `white` → on green header bg (light mode)
  - `green` → on light surface bg
  - `light` → on dark surface bg (softer teal `#6BBFAD`)
- In dark mode, ThemeContext passes `variant="white"` automatically since header is still green-dark.
