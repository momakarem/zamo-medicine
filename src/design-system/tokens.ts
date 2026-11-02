/**
 * ZAMO-DS-005 — design-system tokens (TypeScript export).
 *
 * These tokens are the single source of truth for the approved brand identity
 * (A-55 → A-64). Every component and page must use these values rather than
 * hard-coding colours, fonts, or spacing.
 *
 * The CSS version lives in `tokens.css` and is generated from these same values.
 */

// ---------------------------------------------------------------------------
// Colours (approved brand palette — A-55 → A-60)
// ---------------------------------------------------------------------------
export const COLORS = {
  /** كحلي نيلي — الثقة والأساس */
  navy: '#243B6B',
  /** فيروزي — الذكاء والإجراء */
  teal: '#16A7A0',
  /** ذهبي هادئ — العروض والتنبيه */
  gold: '#E6B566',
  /** نعناعي — الخلفيات المطمئنة */
  mint: '#E9F7F5',

  // Semantic aliases
  primary: '#243B6B',
  accent: '#16A7A0',
  warning: '#E6B566',
  background: '#E9F7F5',

  // Neutrals
  white: '#FFFFFF',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',
  black: '#000000',

  // Status
  success: '#059669',
  error: '#DC2626',
  info: '#2563EB',
} as const;

// ---------------------------------------------------------------------------
// Typography (A-61, A-62)
// ---------------------------------------------------------------------------
export const FONTS = {
  /** Arabic text — IBM Plex Sans Arabic */
  arabic: "'IBM Plex Sans Arabic', sans-serif",
  /** English/Latin text — Inter */
  latin: "'Inter', sans-serif",
  /** Monospace (code, IDs) */
  mono: "'IBM Plex Mono', monospace",
} as const;

export const FONT_SIZES = {
  xs: '0.75rem',    // 12px
  sm: '0.875rem',   // 14px
  base: '1rem',     // 16px
  lg: '1.125rem',   // 18px
  xl: '1.25rem',    // 20px
  '2xl': '1.5rem',  // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
} as const;

// ---------------------------------------------------------------------------
// Spacing (4px grid)
// ---------------------------------------------------------------------------
export const SPACING = {
  0: '0',
  1: '0.25rem',  // 4px
  2: '0.5rem',   // 8px
  3: '0.75rem',  // 12px
  4: '1rem',     // 16px
  5: '1.25rem',  // 20px
  6: '1.5rem',   // 24px
  8: '2rem',     // 32px
  10: '2.5rem',  // 40px
  12: '3rem',    // 48px
  16: '4rem',    // 64px
} as const;

// ---------------------------------------------------------------------------
// Radii & Shadows
// ---------------------------------------------------------------------------
export const RADII = {
  none: '0',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const;

export const SHADOWS = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
} as const;

// ---------------------------------------------------------------------------
// Breakpoints — Mobile First (A-63)
// ---------------------------------------------------------------------------
export const BREAKPOINTS = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

// ---------------------------------------------------------------------------
// Z-Index
// ---------------------------------------------------------------------------
export const Z_INDEX = {
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  overlay: 40,
  modal: 50,
  popover: 60,
  toast: 70,
} as const;

// ---------------------------------------------------------------------------
// Icons — Lucide (A-64)
// ---------------------------------------------------------------------------
export const ICON_PROVIDER = 'lucide' as const;
