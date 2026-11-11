'use client';

import { Authenticator, ThemeProvider, Theme, useTheme, View, Text } from '@aws-amplify/ui-react';
import Link from 'next/link';
import { MODELS, SecurityNote } from './Catalog';

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

function PanelHeader() {
  const { tokens } = useTheme();
  return (
    <View textAlign="center" padding={tokens.space.large}>
      <Link href="/" className="text-lg font-bold text-navy">Wayfind ONE</Link>
      <Text color="#38506B" marginTop={tokens.space.small}>Sign in to run private AI.</Text>
    </View>
  );
}

export default function Landing() {
  return (
    <ThemeProvider theme={theme}>
      <main className="flex min-h-screen flex-col lg:flex-row">
        {/* Hero — ~65% */}
        <section className="flex flex-[65] flex-col justify-center bg-navy px-8 py-14 text-white lg:px-16">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/60">Wayfind ONE</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight lg:text-5xl">
            Ephemeral environments for verifiable private AI.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-white/80">
            Bring your data. Choose your AI. Verify where it runs.
          </p>
          <ul className="mt-8 max-w-xl space-y-3 text-white/85">
            <li><span className="font-semibold text-white">Private execution.</span> Your work runs in a disposable microVM — destroyed after, never retained.</li>
            <li><span className="font-semibold text-white">Verified inference.</span> NEAR AI hardware attestation, checked per request — not promised, proven.</li>
            <li><span className="font-semibold text-white">Evidence, not trust.</span> Every run ends with a signed receipt you can verify yourself.</li>
          </ul>
          <div className="mt-8 flex flex-wrap gap-2">
            {MODELS.map((m) => (
              <span key={m.id} className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80">
                {m.id} · {m.label}
              </span>
            ))}
          </div>
        </section>

        {/* Login — ~35% */}
        <section className="flex flex-[35] items-center justify-center bg-mist px-6 py-14">
          <div className="w-full max-w-sm">
            <Authenticator
              socialProviders={['google']}
              loginMechanisms={['email']}
              components={{ Header: PanelHeader }}
            />
            <div className="mt-6">
              <SecurityNote />
            </div>
            <p className="mt-4 text-center text-xs text-ink">Secured by AWS Cognito · same account as the Wayfind CLI</p>
          </div>
        </section>
      </main>
    </ThemeProvider>
  );
}
