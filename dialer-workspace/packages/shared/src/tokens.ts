/**
 * DESIGN TOKENS.
 *
 * Three platforms ship from one codebase and differ only by these values. Keep colour
 * out of component code: components reference CSS custom properties, never literals.
 */
export interface BrandTokens {
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentBorder: string;
  /** rgba triplet used by the focus ring. */
  accentRing: string;
}

export const BASE_TOKENS = {
  ink: '#1f2937',
  inkMuted: '#374151',
  textMuted: '#6b7280',
  label: '#6b7280',
  hint: '#9ca3af',
  placeholder: '#9ca3af',
  border: '#e5e7eb',
  borderInput: '#d1d5db',
  divider: '#f3f4f6',
  surface: '#ffffff',
  canvas: '#f8fafc',
  inputSubtle: '#f9fafb',
  success: '#16a34a',
  successText: '#15803d',
  successBg: '#f0fdf4',
  successBorder: '#bbf7d0',
  danger: '#dc2626',
  dangerText: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  dangerInput: '#f87171',
  warmBg: '#f8fafc',
  warmBorder: '#e2e8f0',
  warmNote: '#64748b',
  warmLabel: '#475569',
  warmInput: '#cbd5e1',
  thead: '#f9fafb',
};

export type BrandId = 'smartflo' | 'acefone-in' | 'acefone-uk';

/**
 * The three platforms. Only the accent ramp differs; everything structural is shared.
 */
export const BRANDS: Record<BrandId, { label: string; tokens: BrandTokens }> = {
  smartflo: {
    label: 'Smartflo',
    tokens: {
      accent: '#1d4ed8',
      accentDark: '#1e40af',
      accentSoft: '#eff4ff',
      accentBorder: '#dbe4fe',
      accentRing: 'rgba(29,78,216,.1)',
    },
  },
  'acefone-in': {
    label: 'Acefone IN',
    tokens: {
      accent: '#1d4ed8',
      accentDark: '#1e40af',
      accentSoft: '#eff4ff',
      accentBorder: '#dbe4fe',
      accentRing: 'rgba(29,78,216,.1)',
    },
  },
  'acefone-uk': {
    label: 'Acefone UK',
    tokens: {
      accent: '#0f766e',
      accentDark: '#115e59',
      accentSoft: '#effcfa',
      accentBorder: '#ccfbf1',
      accentRing: 'rgba(15,118,110,.12)',
    },
  },
};

export const RADII = {
  card: '14px',
  control: '8px',
  controlLarge: '9px',
  pill: '20px',
};

export const FONTS = {
  ui: "'Poppins', system-ui, sans-serif",
  /** Ids, codes, counts and numerics. */
  mono: "'IBM Plex Mono', monospace",
};
