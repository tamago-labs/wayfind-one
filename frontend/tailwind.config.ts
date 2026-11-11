import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0E1B2C',
        ink: '#38506B',
        cta: '#2F7BFF',
        ctahover: '#1F63DA',
        mist: '#F4F7FB',
      },
    },
  },
  plugins: [],
};

export default config;
