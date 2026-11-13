'use client';

import Mascot from '@/components/Mascot';

/**
 * Empty workspace stage. Sandbox receipts live in the Sandboxes
 * panel; bots live in the sidebar; policy lives in Settings.
 */
export default function WorkspaceEmpty() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Mascot color="white" size="lg" motion="none" label="Wayfind mascot" />
      <h1 className="mt-6 font-brico text-3xl font-bold text-navy">Select a bot to start</h1>
      <p className="mt-2 max-w-md text-sm text-ink">
        Pick a bot on the left to start — ask in chat and your team spins up
        sandboxes, connects tools, and brings back verified results.
      </p>
    </div>
  );
}
