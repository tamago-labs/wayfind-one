import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-herobg px-6 py-4 text-[13px] text-navy">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="font-medium hover:opacity-60 transition-opacity">
          © 2026 Tamago Labs
        </Link>
      </div>
    </footer>
  )
}
