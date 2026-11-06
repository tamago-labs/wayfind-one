import { Code, H2, P } from '../ui'

export default function DocsPolicy() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Policy &amp; approvals</h1>
      <P>
        Every tool call a bot makes passes the policy engine first. Sensitive actions create an
        approval request in the shared store; teammates approve or reject in the UI.
      </P>
      <Code title="policy.yaml">{`version: 1\n\ninference:\n  provider: near-ai-cloud\n  allowed_models: ["<model-id>"]\n  require_attestation: true\n  max_tokens_per_task: 20000\n\negress:\n  allow: []            # sandboxes reach only the inference proxy by default\n\nspend:                 # for bots that can prepare payments\n  max_per_tx_usd: 50\n  max_per_day_usd: 200\n\napprovals:\n  require_for: [payment, send_email, publish, delete_data]\n  approvers_needed: 1\n  expires_after_minutes: 60`}</Code>
      <H2 id="ui">Web UI pages</H2>
      <P>Team, Bots, Tasks, Approvals (pending, approve/reject, history), Privacy (attestation status, verify-now, per-reply proof), Audit (append-only log).</P>
    </article>
  )
}
