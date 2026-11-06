import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { DOC_NAV } from './docsNav'

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Docs" className="space-y-6">
      {DOC_NAV.map((section) => (
        <div key={section.title}>
          <p className="px-3 text-xs font-extrabold uppercase tracking-wider text-heroslate">{section.title}</p>
          <ul className="mt-1.5 space-y-0.5">
            {section.links.map((l) => (
              <li key={l.href}>
                <NavLink
                  to={l.href}
                  end={l.href === '/docs'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-1.5 text-[15px] font-medium transition-colors ${
                      isActive ? 'bg-navy font-bold text-white' : 'text-navy/75 hover:bg-ice hover:text-navy'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile: collapsible section list */}
      <div className="mb-6 lg:hidden">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-xl border border-navy/15 bg-white px-4 py-2.5 text-sm font-bold text-navy"
        >
          Docs menu
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <div className="mt-2 rounded-xl border border-navy/10 bg-white p-4"><NavList onNavigate={() => setOpen(false)} /></div>}
      </div>
      {/* Desktop: sticky sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pb-8"><NavList /></div>
      </aside>
    </>
  )
}

export function BackToTop() {
  return (
    <p className="mt-8">
      <Link to="/docs" className="font-bold text-cta hover:underline">
        ← Back to Docs
      </Link>
    </p>
  )
}
