'use client';

import Mascot from '@/components/Mascot';

/**
 * Empty workspace stage. All lists and states live in the Trust center
 * panel; the bot-team interface takes over this space separately.
 */
export default function WorkspaceEmpty() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <Mascot color="white" size="lg" motion="none" label="Wayfind mascot" />
      <h1 className="mt-6 font-brico text-3xl font-bold text-navy">Select a bot to start</h1>
      <p className="mt-2 max-w-md text-sm text-ink">
        Your conversations, bots, and settings live in the Trust center for now — the bot-team
        interface takes over this space separately.
      </p>
    </div>
  );
}
