'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, Pencil, RotateCcw, Settings, ShieldCheck } from 'lucide-react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { restartOuterComputer, computerAction } from '@/lib/computer';
import { getMyProfile } from '@/lib/data';
import ProfileModal from './ProfileModal';

/**
 * Sidebar bottom (mirrors wayfind-cloud RosterFooter footer block):
 * display-name row + avatar/menu popup + Trust center pill (placeholder).
 * Cloud-only pieces (computer lifecycle, Usage, Connectors, seed bot)
 * are intentionally not ported.
 */
export default function SidebarFooter({ email, onSettings, onTrustCenter }: { email?: string; onSettings: () => void; onTrustCenter: () => void }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [nameOpen, setNameOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { userId } = await getCurrentUser();
        const profile = await getMyProfile(userId);
        if (!alive) return;
        if (profile) {
          setProfileId(profile.id);
          setDisplayName(profile.displayName ?? '');
        }
      } catch {
        // profile stays unavailable; footer falls back to email
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const initial = (displayName || email)?.charAt(0).toUpperCase() || '?';

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    router.push('/');
  };

  // Fresh boot from the current golden image: suspend flushes the team to
  // S3 first (terminate alone would drop unsynced changes), terminate drops
  // the stale VM, reload re-provisions. Needed whenever a new image ships —
  // suspend/resume otherwise keeps the old code.
  const handleRestart = async () => {
    setMenuOpen(false);
    if (
      !window.confirm(
        'Restart your computer? Your team is saved first, then it reboots fresh from the latest image (about a minute).',
      )
    )
      return;
    setRestarting(true);
    try {
      try {
        await restartOuterComputer();
      } catch (e) {
        // Suspend failed (VM unreachable?) — the flush may not have
        // happened. Terminate directly only with explicit consent.
        if (
          !window.confirm(
            `Could not save the workspace first (${e instanceof Error ? e.message : String(e)}). Terminate anyway? Unsaved changes may be lost.`,
          )
        ) {
          setRestarting(false);
          return;
        }
        await computerAction('terminate', 'one_outer');
      }
      window.location.reload();
    } catch (e) {
      window.alert(`Restart failed: ${e instanceof Error ? e.message : String(e)}`);
      setRestarting(false);
    }
  };

  return (
    <div className="relative mt-auto border-t border-navy/10 p-4" ref={menuRef}>
      <p className="mb-2 flex items-center gap-1.5 text-sm text-heroslate">
        {displayName || 'Enter your name'}
        <button
          onClick={() => setNameOpen(true)}
          disabled={!profileId}
          title={profileId ? 'Set profile name' : 'No profile yet'}
          aria-label="Set profile name"
          className="hover:text-navy disabled:opacity-40"
        >
          <Pencil className="h-3 w-3" strokeWidth={2} />
        </button>
      </p>
      <div className="flex items-center gap-2.5">
        <span className="relative shrink-0">
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                role="menu"
                aria-label="Profile menu"
                initial={{ opacity: 0, y: 6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 mb-1 w-52 overflow-hidden rounded-2xl border border-navy/10 bg-white py-1.5 shadow-xl shadow-navy/10"
              >
                <div className="flex items-center gap-2.5 px-4 pb-2 pt-1.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ice font-bold text-navy">
                    {initial}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-navy">
                      {displayName || email || 'Your profile'}
                    </span>
                    {displayName && email ? (
                      <span className="block truncate text-xs text-heroslate">{email}</span>
                    ) : null}
                  </span>
                </div>
                <div className="mx-4 my-1 border-t border-navy/10" aria-hidden="true" />
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onSettings();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice"
                >
                  <Settings className="h-4 w-4" strokeWidth={2.2} />
                  Settings
                </button>
                <button
                  role="menuitem"
                  onClick={handleRestart}
                  disabled={restarting}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2.2} />
                  {restarting ? 'Restarting…' : 'Restart computer'}
                </button>
                <div className="mx-4 my-1 border-t border-navy/10" aria-hidden="true" />
                <button
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice"
                >
                  <LogOut className="h-4 w-4" strokeWidth={2.2} />
                  Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Profile menu"
            title={email || 'Profile menu'}
            className="grid h-10 w-10 place-items-center rounded-full bg-white font-bold text-navy shadow-sm hover:bg-slate-50"
          >
            {initial}
          </button>
        </span>
        {/* Trust center — opens the evidence slide-in panel. */}
        <button
          onClick={onTrustCenter}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-white py-2.5 font-semibold text-navy shadow-sm hover:bg-slate-50"
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
          Trust center
        </button>
      </div>
      <ProfileModal
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        profileId={profileId}
        initialName={displayName}
        onSaved={setDisplayName}
      />
    </div>
  );
}
