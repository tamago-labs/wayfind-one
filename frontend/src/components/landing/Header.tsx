import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import Mascot from '../Mascot'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-navy">
        <Mascot color="white" size="xs" motion="none" label="Wayfind mascot" />
      </span>
      <span className="font-brico text-lg font-bold text-navy">Wayfind ONE</span>
    </Link>
  )
}

export default function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-herobg">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />

        <nav className="hidden items-center gap-8 text-[15px] font-medium text-navy md:flex">
          <Link to="/" className="hover:opacity-60 transition-opacity">
            Login
          </Link>
          <Link to="/app/tasks" className="hover:opacity-60 transition-opacity">
            App
          </Link>
          <Link to="/docs" className="hover:opacity-60 transition-opacity">
            Docs
          </Link>
          <a
            href="https://www.wayfind.click"
            target="_blank"
            rel="noreferrer"
            className="hover:opacity-60 transition-opacity"
          >
            Cloud
          </a>
        </nav>

        <div className="hidden items-center gap-3 text-[15px] font-medium md:flex">
          <a
            href="/docs/quickstart"
            className="rounded-full bg-navy px-5 py-2.5 text-white hover:opacity-90 transition-opacity"
          >
            Run demo
          </a>
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden ml-auto text-navy/60 hover:text-navy transition-colors" aria-label="Menu">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="md:hidden border-t border-navy/10 bg-herobg px-6 py-4 space-y-3 overflow-hidden"
          >
            <Link to="/" onClick={() => setOpen(false)} className="block text-[15px] font-medium text-navy hover:opacity-60">
              Login
            </Link>
            <Link to="/app/tasks" onClick={() => setOpen(false)} className="block text-[15px] font-medium text-navy hover:opacity-60">
              App
            </Link>
            <Link to="/docs" onClick={() => setOpen(false)} className="block text-[15px] font-medium text-navy hover:opacity-60">
              Docs
            </Link>
            <a
              href="https://www.wayfind.click"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="block text-[15px] font-medium text-navy hover:opacity-60"
            >
              Cloud
            </a>
            <a href="/docs/quickstart" onClick={() => setOpen(false)} className="block mt-2 text-center rounded-full bg-navy px-5 py-2.5 text-[15px] font-medium text-white">
              Run demo
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
