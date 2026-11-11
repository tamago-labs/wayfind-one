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
        {/* Hero — 50% left */}
        <section className="flex w-full flex-col bg-navy px-8 pb-6 pt-6 text-white lg:w-[55%] lg:px-16">
          <div className="flex flex-1 flex-col "> 
          <div className="flex items-center gap-2.5 mt-6">
            <Mascot color="white" size="sm" motion="none" label="Wayfind mascot" />
            <span className="font-brico text-lg font-bold text-white">Wayfind ONE</span>
          </div>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight lg:text-5xl">
            Ephemeral environments for a verifiable AI workforce.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white/80">
            Built for organizations that need AI to work with sensitive data.
          </p>
          <ul className="mt-8 max-w-xl space-y-3 text-white/85">
            <li><span className="font-semibold text-white">Ephemeral execution.</span> Every task runs in an isolated microVM that is terminated when the session ends.</li>
            <li><span className="font-semibold text-white">Verified inference.</span> NEAR AI attestation verifies the inference environment and model identity, with verification evidence recorded per request.</li>
            <li><span className="font-semibold text-white">Verifiable evidence.</span> Every execution produces a signed receipt documenting its security checks and execution history.</li>
          </ul>
          </div>
          <p className="mt-auto text-xs text-white/50">© 2026 Tamago Labs Japan</p>
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
