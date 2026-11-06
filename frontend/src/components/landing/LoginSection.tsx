import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Mascot from '../Mascot'

export default function LoginSection() {
  const navigate = useNavigate()
  const [team, setTeam] = useState('')

  function cont(e: React.FormEvent) {
    e.preventDefault()
    if (team.trim()) localStorage.setItem('wf-team', team.trim())
    navigate('/docs/quickstart')
  }

  return (
    <section className="grid flex-1 place-items-center bg-herobg px-6 pb-6 pt-6 text-navy">
      <div className="mx-auto w-full max-w-[420px] rounded-3xl bg-white p-10 text-center shadow-card">
        <div className="mb-4 flex justify-center -space-x-2">
          {(['amber', 'moss', 'lagoon', 'ash'] as const).map((color, i) => (
            <Mascot key={color} color={color} size="sm" motion="none" blinkDelay={`-${i * 1.4}s`} className="ring-[3px] ring-white" />
          ))}
        </div>
        <h1 className="mt-4 font-brico text-3xl font-extrabold tracking-tight text-navy">Welcome back</h1>
        <p className="mt-2 text-heroslate">Your team&apos;s private AI workspace. No accounts, no central server.</p>
        <form onSubmit={cont} className="mt-6 grid gap-3 text-left">
          <label className="grid gap-1.5 text-sm font-bold">
            Team name
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Acme Finance"
              className="rounded-lg border border-navy/15 px-3 py-2.5 text-[15px] font-normal"
            />
          </label>
          <button
            type="submit"
            disabled={!team.trim()}
            className="rounded-full bg-cta px-8 py-3 font-semibold text-white hover:bg-ctahover transition-colors disabled:opacity-40"
          >
            Continue
          </button>
        </form>
        <p className="mt-4 text-[13px] text-heroslate">Demo without setup: npx wayfind-one demo</p>
      </div>
    </section>
  )
}
