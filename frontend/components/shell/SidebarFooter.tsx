'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, History, LogOut, Pencil, Settings, ShieldCheck } from 'lucide-react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { getMyProfile } from '@/lib/data';
import { requestComputer } from '@/lib/computer';
import ProfileModal from './ProfileModal';
import ConnectorsModal from '../app/Connectors/ConnectorsModal';
import ModelsModal from './ModelsModal';

/**
 * Sidebar bottom (mirrors wayfind-cloud RosterFooter footer):
 * display-name row + avatar/menu popup (Settings, Sandboxes, Activity,
 * Models, sign out) + Connectors pill opening the import modal.
 */
export default function SidebarFooter({ email, onSettings, onSandboxes, onActivity }: { email?: string; onSettings: () => void; onSandboxes: () => void; onActivity: () => void }) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [nameOpen, setNameOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [computerReady, setComputerReady] = useState(false);
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
                  onClick={() => {
                    setMenuOpen(false);
                    onSandboxes();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice"
                >
                  <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
                  Sandboxes
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onActivity();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice"
                >
                  <History className="h-4 w-4" strokeWidth={2.2} />
                  Activity
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setModelsOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-navy hover:bg-ice"
                >
                  <Cpu className="h-4 w-4" strokeWidth={2.2} />
                  Models
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
        {/* Connectors — opens the import modal (mirrors cloud RosterFooter). */}
        <button
          onClick={() => {
            setConnectorsOpen(true);
            void requestComputer('one_outer')
              .then(({ data }) => {
                setComputerReady(data.provisionStatus === 'running' || data.provisionStatus === 'suspended');
              })
              .catch(() => setComputerReady(false));
          }}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-white py-2.5 font-semibold text-navy shadow-sm hover:bg-slate-50"
        >
          Connectors
          <span className="flex -space-x-1.5" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/stripe.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/hubspot.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/connectors/mailchimp.png" alt="" className="h-5 w-5 rounded-full bg-white object-contain ring-2 ring-white" loading="lazy" />
          </span>
        </button>
      </div>
      <ProfileModal
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        profileId={profileId}
        initialName={displayName}
        onSaved={setDisplayName}
      />
      <ConnectorsModal
        open={connectorsOpen}
        onClose={() => setConnectorsOpen(false)}
        computerReady={computerReady}
      />
      <ModelsModal open={modelsOpen} onClose={() => setModelsOpen(false)} />
    </div>
  );
}
