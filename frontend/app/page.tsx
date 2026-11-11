'use client';

import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import Landing from '@/components/Landing';
import OneShell from '@/components/OneShell';

export default function Home() {
  return (
    <Authenticator.Provider>
      <HomeInner />
    </Authenticator.Provider>
  );
}

function HomeInner() {
  const { user, authStatus } = useAuthenticator((c) => [c.user, c.authStatus]);
  if (authStatus === 'authenticated' && user) {
    return <OneShell email={user?.signInDetails?.loginId} />;
  }
  // Signed out: landing page with the login panel (its own Authenticator).
  return <Landing />;
}
