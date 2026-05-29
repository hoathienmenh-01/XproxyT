/**
 * XproxyT Premium Design Tokens v3
 * Synced with public/styles.css design system
 * Inspired by Linear × Vercel × Raycast × Cursor
 */
export const tokens = {
  font: {
    familyPrimary: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    familyMono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    size: {
      '2xs': '0.6rem',
      xs: '0.68rem',
      sm: '0.75rem',
      base: '0.82rem',
      md: '0.88rem',
      lg: '0.95rem',
      xl: '1.1rem',
      '2xl': '1.5rem',
      '3xl': '2rem',
    },
    weightLight: 300,
    weightRegular: 400,
    weightMedium: 500,
    weightSemiBold: 600,
    weightBold: 700,
    weightExtraBold: 800,
    lineHeightBase: 1.6,
  },
  color: {
    // Background layers (dark → light)
    bgVoid: '#06070b',
    bgBase: '#0a0c14',
    bgSurface: '#0f1219',
    bgRaised: '#151923',
    bgOverlay: '#1b2030',
    bgHover: '#222838',
    bgActive: '#2a3245',
    // Glass
    glassBg: 'rgba(12, 14, 22, 0.78)',
    glassBgHeavy: 'rgba(8, 10, 16, 0.88)',
    glassBorder: 'rgba(255, 255, 255, 0.06)',
    // Borders
    border1: 'rgba(255,255,255,0.04)',
    border2: 'rgba(255,255,255,0.07)',
    border3: 'rgba(255,255,255,0.10)',
    border4: 'rgba(255,255,255,0.16)',
    borderFocus: 'rgba(99,102,241,0.5)',
    // Accent — Indigo
    accent: '#818cf8',
    accentSoft: 'rgba(129,140,248,0.10)',
    accentMid: 'rgba(129,140,248,0.20)',
    accentGlow: 'rgba(129,140,248,0.35)',
    accentBright: '#a5b4fc',
    accentDim: 'rgba(129,140,248,0.06)',
    // Semantic
    ok: '#34d399',
    okSoft: 'rgba(52,211,153,0.10)',
    warn: '#fbbf24',
    warnSoft: 'rgba(251,191,36,0.10)',
    danger: '#f87171',
    dangerSoft: 'rgba(248,113,113,0.10)',
    info: '#818cf8',
    infoSoft: 'rgba(129,140,248,0.10)',
    // Text
    text1: '#f1f5f9',
    text2: '#cbd5e1',
    text3: '#94a3b8',
    text4: '#64748b',
    text5: '#475569',
  },
  space: {
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '5': '20px',
    '6': '24px',
    '8': '32px',
    '10': '40px',
    '12': '48px',
    '16': '64px',
  },
  radius: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '20px',
    full: '9999px',
  },
  motion: {
    durationFast: '100ms',
    durationNormal: '180ms',
    durationSlow: '300ms',
    durationPage: '400ms',
    easeOut: 'cubic-bezier(0.16,1,0.3,1)',
    easeIn: 'cubic-bezier(0.4,0,1,1)',
    easeSpring: 'cubic-bezier(0.34,1.56,0.64,1)',
    easeSmooth: 'cubic-bezier(0.4,0,0.2,1)',
  },
  shadow: {
    sm: '0 1px 2px rgba(0,0,0,0.4)',
    md: '0 2px 8px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)',
    lg: '0 4px 16px rgba(0,0,0,0.4), 0 8px 32px rgba(0,0,0,0.3)',
    xl: '0 8px 32px rgba(0,0,0,0.5), 0 16px 64px rgba(0,0,0,0.4)',
    card: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.03)',
  },
};

export default tokens;