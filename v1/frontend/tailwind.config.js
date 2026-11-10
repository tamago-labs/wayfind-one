/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Wayfind Cloud light theme (brand accents unchanged)
        paper: '#FAF7F1',
        cream: '#FFFDF8',
        ink: '#131316',
        inksoft: '#55555e',
        line: '#E7E0D2',
        // brand (kept from dark scaffold)
        dark: '#0B0B0F',
        surface: '#141419',
        border3: '#2A2A35',
        accent: '#6C5CE7',
        accent2: '#00D2A0',
        warn2: '#FF6B6B',
        zenblue: '#3B82F6',
        zenpurple: '#8B5CF6',
        // Finder colours
        famber: '#FFB020',
        fmoss: '#5FBF3F',
        flagoon: '#2EC4D6',
        fash: '#9AA0A6',
        // Option-E hero palette (wayfind-hero-design.html)
        herobg: '#DDE9F7',
        ice: '#E9F1FA',
        thread: '#F7FDFA',
        navy: '#0E1B2C',
        cta: '#2F7BFF',
        ctahover: '#1F63DA',
        heroslate: '#38506B',
        bamber: '#F5A524',
        bmoss: '#7BA05B',
        blagoon: '#2BB3B1',
        bash: '#9AA3AE',
        bcoral: '#E26D5A',
        bgrape: '#8B5CF6',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        brand: ['Zen Tokyo Zoo', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        brico: ['"Bricolage Grotesque"', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(19,19,22,0.05), 0 12px 32px -16px rgba(19,19,22,0.18)',
        glow: '0 0 60px -20px rgba(108, 92, 231, 0.3)',
        'glow-blue': '0 0 80px -20px rgba(59, 130, 246, 0.25)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
