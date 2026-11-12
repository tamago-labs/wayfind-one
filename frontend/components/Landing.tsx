'use client';

import { Authenticator, ThemeProvider, Theme } from '@aws-amplify/ui-react';
import Mascot from './Mascot';

const theme: Theme = {
  name: 'Wayfind ONE',
  tokens: {
    colors: {
      brand: {
        primary: {
          10: { value: '#DDE9F7' },
          80: { value: '#2F7BFF' },
          90: { value: '#1F63DA' },
          100: { value: '#0E1B2C' },
        },
      },
    },
    components: {
      button: {
        primary: { backgroundColor: { value: '#2F7BFF' }, _hover: { backgroundColor: { value: '#1F63DA' } } },
        link: { color: { value: '#2F7BFF' } },
      },
    },
  },
};

export default function Landing() {
  return (
    <ThemeProvider theme={theme}>
      <main className="flex min-h-screen flex-col lg:flex-row">
        {/* Hero — 55% left, aurora animated gradient */}
        <section className="aurora relative flex w-full flex-col overflow-hidden px-8 pb-6 pt-6 text-white lg:w-[55%] lg:px-16">
          <div className="orb left-[10%] top-[15%] h-40 w-40 bg-cta/60"></div>
          <div className="orb right-[12%] top-[55%] h-32 w-32 bg-violet-500/50" style={{ animationDelay: '-4s' }}></div>
          <div className="relative flex items-center gap-2.5">
            <Mascot color="white" size="sm" motion="none" label="Wayfind mascot" />
            <span className="font-brico text-lg font-bold text-white">Wayfind ONE</span>
          </div>
          <div className="relative flex flex-1 flex-col justify-center">
            <h1 className="mt-8 max-w-2xl font-display text-4xl font-bold leading-[1.05] lg:text-6xl">
              Ephemeral environments for a verifiable AI workforce.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-white/80">
              Built for organizations that need AI to work with sensitive data.
            </p>
          </div>
          <p className="relative mt-10 text-xs text-white/50">© 2026 Tamago Labs</p>
        </section>

        {/* Login — 50% right */}
        <section className="flex w-full items-center justify-center bg-mist px-6 py-6 lg:w-[45%]">
          <div className="w-full max-w-md">
            <Authenticator
              socialProviders={['google']}
              loginMechanisms={['email']}
            />
            <p className="mt-4 text-center text-xs text-ink">Secured by AWS Cognito</p>
          </div>
        </section>
      </main>
    </ThemeProvider>
  );
}
