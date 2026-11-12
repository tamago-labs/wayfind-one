import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0E1B2C',
        ink: '#38506B',
        heroslate: '#38506B',
        ice: '#E9F1FA',
        cta: '#2F7BFF',
        ctahover: '#1F63DA',
        mist: '#F4F7FB',
        // Mascot blob palette (same as v1)
        bamber: '#F5A524',
        bmoss: '#7BA05B',
        blagoon: '#2BB3B1',
        bash: '#9AA3AE',
        bcoral: '#E26D5A',
        bgrape: '#8B5CF6',
      },
      fontFamily: {
        brico: ['var(--font-brico)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
