import type { Metadata } from 'next';
import ConfigureAmplify from '@/components/ConfigureAmplify';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayfind ONE — private AI execution you can verify',
  description: 'Ephemeral environments for verifiable private AI. Bring your data. Choose your AI. Verify where it runs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-mist text-navy antialiased">
        <ConfigureAmplify>{children}</ConfigureAmplify>
      </body>
    </html>
  );
}
