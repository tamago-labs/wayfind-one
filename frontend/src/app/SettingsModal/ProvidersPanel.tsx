import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { inputCls } from '../forms'

interface CatalogModel {
  id: string
  group?: string
}

interface CatalogProvider {
  label: string
  baseURL: string
  keyEnv?: string
  models?: CatalogModel[]
}

const CUSTOM_VALUE = '__custom__'

interface ProvidersData {
  selected: { provider: string; model: string; label: string; baseURL: string; keyEnv: string | null }
  catalog: { defaults: { provider: string; model: string }; providers: Record<string, CatalogProvider> }
  keysPresent: string[]
  keySource: 'env' | 'shared' | 'default' | null
  sources: { env: boolean; shared: boolean }
}

function groups(models: CatalogModel[]): string[] {
  const out: string[] = []
  for (const m of models) {
    const g = m.group ?? 'Other'
    if (!out.includes(g)) out.push(g)
  }
  return out
}

function sourceLabel(s: 'env' | 'shared' | 'default'): string {
  if (s === 'env') return 'from environment'
  if (s === 'shared') return 'shared with team'
  return 'built-in default'
}

function keyBadge(data: ProvidersData | null): string {
  if (!data) return '—'
  const present = (['env', 'shared'] as const).filter((s) => data.sources?.[s])
  if (present.length === 0) return data.keySource === 'default' ? 'built-in default' : 'missing'
  const using = data.keySource && data.keySource !== 'default' ? ` (using ${sourceLabel(data.keySource)})` : ''
  return present.map(sourceLabel).join(' + ') + using
}

export default function ProvidersPanel() {
  const [data, setData] = useState<ProvidersData | null>(null)
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [customModel, setCustomModel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Dropdown value: a listed id, CUSTOM_VALUE, or '' (none).
  function applySelection(providerId: string, modelId: string, d: ProvidersData) {
    setProvider(providerId)
    const ids = new Set((d.catalog.providers[providerId]?.models ?? []).map((m) => m.id))
    if (modelId && ids.has(modelId)) {
      setModel(modelId)
      setCustomModel('')
    } else if (modelId) {
      setModel(CUSTOM_VALUE)
      setCustomModel(modelId)
    } else {
      setModel('')
      setCustomModel('')
    }
  }

  useEffect(() => {
    let stop = false
    api<ProvidersData>('/api/providers')
      .then((d) => {
        if (stop) return
        setData(d)
        applySelection(d.selected.provider, d.selected.model, d)
      })
      .catch((e) => {
        if (!stop) setError(e instanceof Error ? e.message : 'Failed to load providers.')
      })
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(null), 2000)
    return () => clearTimeout(t)
  }, [saved])

  const onProviderChange = (id: string) => {
    if (!data) return
    applySelection(id, '', data)
  }

  const effectiveModel = model === CUSTOM_VALUE ? customModel.trim() : model
  // Presence mark: the value never comes back from the API, but we know
  // a team-shared key exists for the selected provider.
  const hasKey = (data?.keysPresent ?? []).includes(provider)
  const selectionDirty =
    data !== null && (provider !== data.selected.provider || effectiveModel !== data.selected.model)

  const run = async (label: string, fn: () => Promise<ProvidersData>) => {
    setBusy(label)
    setError(null)
    setTestResult(null)
    try {
      const d = await fn()
      setData(d)
      applySelection(d.selected.provider, d.selected.model, d)
      setSaved(label)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setBusy(null)
    }
  }

  const saveKey = async () => {
    setBusy('key')
    setError(null)
    setTestResult(null)
    try {
      const d = await api<ProvidersData>('/api/providers/keys', { id: provider, key })
      setData(d)
      applySelection(d.selected.provider, d.selected.model, d)
      setKey('')
      setSaved('key')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    setTestResult(null)
    try {
      // Tests the current fields (test-before-save) — only Save persists.
      const d = await api<{ text: string }>('/api/providers/test', { provider, model: effectiveModel })
      setTestResult(d.text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed.')
    } finally {
      setBusy(null)
    }
  }

  const providers = data ? Object.entries(data.catalog.providers) : []
  const listedModels = data?.catalog.providers[provider]?.models ?? []

  return (
    <div className="mt-4">
      <h3 className="font-brico text-base font-bold">AI provider</h3>
      <p className="mt-1 text-sm text-heroslate">
        {data ? (
          <>
            Using <span className="font-semibold text-navy">{data.selected.label}</span>
            {data.selected.model ? (
              <> · <code className="font-mono text-xs">{data.selected.model}</code></>
            ) : (
              ' · no model selected'
            )}{' '}
            · key: {keyBadge(data)}
          </>
        ) : (
          'Loading…'
        )}
      </p>

      <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-heroslate">Provider</label>
      <select
        value={provider}
        onChange={(e) => onProviderChange(e.target.value)}
        disabled={busy !== null}
        className={inputCls}
      >
        {providers.map(([id, p]) => (
          <option key={id} value={id}>
            {p.label}
          </option>
        ))}
      </select>

      <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-heroslate">Model</label>
      {listedModels.length > 0 ? (
        <>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy !== null}
            className={inputCls}
          >
            <option value="">Pick a model…</option>
            {groups(listedModels).map((g) => (
              <optgroup key={g} label={g}>
                {listedModels
                  .filter((m) => (m.group ?? 'Other') === g)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
              </optgroup>
            ))}
            <option value={CUSTOM_VALUE}>Custom name…</option>
          </select>
          {model === CUSTOM_VALUE && (
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              disabled={busy !== null}
              placeholder="type exact model id"
              spellCheck={false}
              autoComplete="off"
              className={`${inputCls} mt-2`}
            />
          )}
        </>
      ) : (
        <input
          value={customModel}
          onChange={(e) => setCustomModel(e.target.value)}
          disabled={busy !== null}
          placeholder="e.g. llama-3.3-70b-versatile"
          spellCheck={false}
          autoComplete="off"
          className={inputCls}
        />
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void run('selection', () => api<ProvidersData>('/api/providers/select', { provider, model: effectiveModel }))}
          disabled={busy !== null || !effectiveModel}
          className="rounded-xl bg-cta px-5 py-2.5 font-bold text-white hover:bg-ctahover disabled:opacity-50"
        >
          {busy === 'selection' ? 'Saving…' : 'Save selection'}
        </button>
        {saved === 'selection' && !busy && <span className="text-sm font-bold text-bmoss">Saved ✓</span>}
        {selectionDirty && !busy && (
          <span className="text-sm font-semibold text-bamber">unsaved — chat and Test use the saved one until you save</span>
        )}
      </div>

      <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-heroslate">
        API key {hasKey && <span className="font-bold text-bmoss">✓ saved — shared with team</span>}
      </label>
      <input
        type="password"
        value={key}
        onChange={(e) => {
          setKey(e.target.value)
          setSaved(null)
        }}
        disabled={busy !== null}
        placeholder={
          hasKey
            ? '•••••••• (saved — type to replace)'
            : data?.selected.keyEnv
              ? `or set ${data.selected.keyEnv} where the daemon runs`
              : 'paste key'
        }
        spellCheck={false}
        autoComplete="off"
        className={inputCls}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void saveKey()}
          disabled={busy !== null || !key}
          className="rounded-xl bg-cta px-5 py-2.5 font-bold text-white hover:bg-ctahover disabled:opacity-50"
        >
          {busy === 'key' ? 'Saving…' : 'Save key'}
        </button>
        {saved === 'key' && !busy && <span className="text-sm font-bold text-bmoss">Saved ✓</span>}
        <button
          onClick={() => void test()}
          disabled={busy !== null || !effectiveModel}
          className="rounded-xl border border-navy/15 px-5 py-2.5 font-bold text-navy hover:bg-ice disabled:opacity-50"
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
      </div>

      {testResult && (
        <p className="mt-4 rounded-xl bg-bmoss/15 px-4 py-3 text-sm font-semibold text-navy">
          Test reply: {testResult}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-bcoral">{error}</p>}
    </div>
  )
}
