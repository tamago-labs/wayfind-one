'use client';

import type { ReactNode } from 'react';

/** Shared settings-tab header: title + sub copy, optional right-side action
 * (Refresh, counts). Keeps every tab opening the same way. */
export default function TabHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="font-brico text-base font-bold text-navy">{title}</h4>
        {sub ? <p className="mt-0.5 text-sm text-navy/50">{sub}</p> : null}
      </div>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
