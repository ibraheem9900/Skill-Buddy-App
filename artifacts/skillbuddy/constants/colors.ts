const palette = {
  primary: '#2b795c', // web light theme primary — oklch(0.52 0.09 165)
  primaryDark: '#076246', // web --tree — oklch(0.44 0.09 165), pressed/dark green
  primaryLight: '#e0f9ed', // web --accent — oklch(0.96 0.03 165)
  rating: '#FFB800',
  destructive: '#E74C3C',
  destructiveForeground: '#FFFFFF',
  success: '#27AE60',
  successLight: '#E8F8EE',
  warning: '#F39C12',
  /**
   * The URGENT palette — the web app's amber, resolved to hex.
   *
   * Web sources (Skillbuddy-Web/Skill-buddy):
   *   • `src/styles.css` defines `--warning: oklch(0.78 0.16 75)` (= #F2A618)
   *     and exposes it as the Tailwind `warning` color;
   *   • the web's attention chips (client dashboard pending badge, provider
   *     application status, careers filters) use Tailwind's amber scale:
   *     `bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`,
   *     i.e. #FEF3C7 / #B45309 on light and a translucent amber on dark.
   * The mobile "Urgent" badge used to be red/pink (the `urgent` token was the
   * destructive red) — that is what the boss rejected. These three tokens are
   * now the ONE source for every Urgent surface (job cards, job details type
   * chip, bid screens, provider cards). Red stays for Expired / Cancelled /
   * Cancel Job only (destructive + destructiveLight).
   */
  urgentBg: '#FEF3C7', // Tailwind amber-100, the web chip background
  urgentText: '#B45309', // Tailwind amber-700, the web chip label
  urgentBorder: '#FDE68A', // Tailwind amber-200, the web chip border
  destructiveLight: '#FFF0EF',
  goldBgDark: 'rgba(251, 191, 36, 0.16)', // amber-900/30 over a dark surface
  urgentTextDark: '#FBBF24', // Tailwind amber-400
  urgentBorderDark: 'rgba(251, 191, 36, 0.35)',
  /**
   * The web app's gold/"warning" token, verbatim: `--warning: oklch(0.78 0.16 75)`
   * in Skillbuddy-Web/Skill-buddy/src/styles.css, converted to sRGB = #F2A618.
   * Used ONLY by the Post-a-Job "Urgent" card (see c.gold in each theme) —
   * everything else that means "urgent" keeps the red `urgent` token below.
   */
  gold: '#F2A618',
};

const colors = {
  light: {
    text: '#1A1A1A',
    tint: palette.primary,
    background: '#F8F8F8',
    surface: '#FFFFFF',
    foreground: '#1A1A1A',
    card: '#FFFFFF',
    cardForeground: '#1A1A1A',
    primary: palette.primary,
    primaryForeground: '#FFFFFF',
    primaryLight: palette.primaryLight,
    primaryDark: palette.primaryDark,
    secondary: '#F5F5F5',
    secondaryForeground: '#1A1A1A',
    muted: '#F5F5F5',
    mutedForeground: '#737373',
    // A slightly darker grey for the summary/info labels — the plain muted
    // grey read too light on Job Details (token, not a hardcoded color on
    // individual screens).
    mutedStrong: '#595959',
    accent: palette.primaryLight,
    accentForeground: palette.primary,
    destructive: palette.destructive,
    destructiveForeground: palette.destructiveForeground,
    border: '#E8E8E8',
    input: '#F5F5F5',
    rating: palette.rating,
    // URGENT → the web's amber (see palette.urgent*). NOT red: red is reserved
    // for Expired / Cancelled / Cancel Job, which read destructive/destructiveLight.
    urgent: palette.urgentText,
    urgentLight: palette.urgentBg,
    urgentBg: palette.urgentBg,
    urgentText: palette.urgentText,
    urgentBorder: palette.urgentBorder,
    /** Soft red tint for destructive chips/cards (the old `urgentLight` value). */
    destructiveLight: palette.destructiveLight,
    // Gold used by the Post-a-Job Urgent card (web token, see palette.gold).
    gold: palette.gold,
    goldLight: '#FFF4DC',
    // Content that sits ON the gold fill: dark brown reads at 8:1, white does not.
    goldForeground: '#3A2A00',
    success: palette.success,
    successLight: palette.successLight,
    warning: palette.warning,
    // Hero/summary card (balance, credit points): solid brand green in light,
    // plain dark charcoal in dark so green stays an accent only.
    heroCard: palette.primary,
    shadow: 'rgba(0, 0, 0, 0.08)',
    shadowMd: 'rgba(0, 0, 0, 0.12)',
    overlay: 'rgba(0, 0, 0, 0.5)',
    headerBg: palette.primary,
    tabBarActive: palette.primary,
    tabBarInactive: '#9E9E9E',
    tabBarBg: '#FFFFFF',
    skeletonBase: '#F0F0F0',
    skeletonHighlight: '#FAFAFA',
  },
  dark: {
    // Dark theme matches the approved web app: near-black backgrounds with
    // dark charcoal-navy cards. Green is used ONLY as an accent (buttons,
    // category icons, prices, ratings, small labels) — never as a screen fill.
    text: '#EDF2F2',
    tint: '#4DBFAD',
    background: '#0A0D0D', // near-black (web: ~#0A0D0D)
    surface: '#101414',
    foreground: '#EDF2F2',
    card: '#151A1A', // dark charcoal-navy (NOT green-tinted)
    cardForeground: '#EDF2F2',
    // Green accent — slightly brighter so it pops on dark surfaces
    primary: '#4DBFAD',
    primaryForeground: '#FFFFFF',
    primaryLight: 'rgba(77, 191, 173, 0.14)',
    // Frozen: the dark theme keeps its approved accent for pressed states —
    // palette.primary now tracks the LIGHT theme's darker web green.
    primaryDark: '#2E9E7A',
    secondary: '#131818',
    secondaryForeground: '#EDF2F2',
    muted: '#131818',
    mutedForeground: '#7E8C8C',
    mutedStrong: '#AEBBBB',
    accent: 'rgba(77, 191, 173, 0.12)',
    accentForeground: '#4DBFAD',
    destructive: '#E74C3C',
    destructiveForeground: '#FFFFFF',
    border: '#202626',
    input: '#131818',
    rating: palette.rating,
    // URGENT → the web's amber (amber-400 text on a translucent amber fill).
    urgent: palette.urgentTextDark,
    urgentLight: palette.goldBgDark,
    urgentBg: palette.goldBgDark,
    urgentText: palette.urgentTextDark,
    urgentBorder: palette.urgentBorderDark,
    destructiveLight: 'rgba(231, 76, 60, 0.14)',
    gold: palette.gold,
    goldLight: 'rgba(242, 166, 24, 0.16)',
    goldForeground: '#1A1200',
    success: '#2FBF71',
    successLight: 'rgba(47, 191, 113, 0.14)',
    warning: palette.warning,
    // Hero/summary card in dark mode — charcoal, NOT green (green = accent only)
    heroCard: '#151A1A',
    shadow: 'rgba(0, 0, 0, 0.5)',
    shadowMd: 'rgba(0, 0, 0, 0.6)',
    overlay: 'rgba(0, 0, 0, 0.75)',
    // Headers are near-black in dark mode — the ONLY green glow allowed is
    // the subtle hero gradient on the Home header (applied in the Home screen).
    headerBg: '#0C1111',
    tabBarActive: '#4DBFAD',
    tabBarInactive: '#5F6C6C',
    tabBarBg: '#0C1111',
    skeletonBase: '#151A1A',
    skeletonHighlight: '#1D2424',
  },
  radius: 12,
};

export default colors;
