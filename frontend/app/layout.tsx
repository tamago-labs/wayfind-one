import type { Metadata } from 'next';
import { Bricolage_Grotesque, Sora } from 'next/font/google';
import ConfigureAmplify from '@/components/ConfigureAmplify';
import './globals.css';

const brico = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '700', '800'],
  variable: '--font-brico',
});

const display = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Wayfind ONE — Verifiable AI Workforce',
  description:
    'AI teammates. Ephemeral by design. Verifiable by default. Run AI workloads in isolated environments with confidential inference and verifiable security evidence.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${brico.variable} ${display.variable} bg-mist text-navy antialiased`}>
        <ConfigureAmplify>{children}</ConfigureAmplify>
      </body>
    </html>
  );
}
