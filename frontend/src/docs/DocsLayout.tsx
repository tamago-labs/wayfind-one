import { Link, Outlet, useLocation } from 'react-router-dom'
import Header from '../components/landing/Header'
import Footer from '../components/landing/Footer'
import { Sidebar } from './Sidebar'
import { docNeighbors } from './docsNav'

export default function DocsLayout() {
  const { pathname } = useLocation()
  const { prev, next } = docNeighbors(pathname)
  return (
    <div className="min-h-screen bg-herobg font-brico text-navy">
      <Header />
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-12">
          <Sidebar />
          <main className="min-w-0 max-w-3xl font-sans">
            <Outlet />
            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              <div>
                {prev && (
                  <Link to={prev.href} className="block rounded-xl border border-navy/10 bg-white px-4 py-3 hover:border-cta">
                    <span className="block text-xs font-bold uppercase tracking-wider text-heroslate">Previous</span>
                    <span className="font-bold">← {prev.label}</span>
                  </Link>
                )}
              </div>
              <div>
                {next && (
                  <Link to={next.href} className="block rounded-xl border border-navy/10 bg-white px-4 py-3 text-right hover:border-cta">
                    <span className="block text-xs font-bold uppercase tracking-wider text-heroslate">Next</span>
                    <span className="font-bold">{next.label} →</span>
                  </Link>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
      <Footer />
    </div>
  )
}
