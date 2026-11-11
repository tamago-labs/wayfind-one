import { redirect } from 'next/navigation';

// OAuth landing: Cognito redirects here after Google sign-in
// (redirect_sign_in_uri). Hand off to the home route, which renders
// the shell once Amplify picks up the session.
export default function AppOAuthLanding() {
  redirect('/');
}
