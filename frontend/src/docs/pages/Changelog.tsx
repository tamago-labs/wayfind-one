import { H2, P } from '../ui'

export default function DocsChangelog() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Changelog &amp; roadmap</h1>
      <H2 id="plan">Build plan (6–14 Nov)</H2>
      <P>Ends 14 Nov 2026, 23:59 UTC. Cut scope early: 6–7 Nov repo/CLI/daemon/UI shell; 7–8 Nov P2P store + invite/join; 9–10 Nov sandbox + proxy + one bot answering; 11 Nov attestation badge; 12 Nov policy + approvals; 13 Nov demo mode + video; 14 Nov publish + submit.</P>
      <H2 id="now">Now (hackathon)</H2>
      <P>P2P team store, Docker sandboxes, NEAR AI proxy with attestation, policy and approvals, web UI.</P>
      <H2 id="next">Next</H2>
      <P>Member removal with team key rotation; headless nodes for 24/7 bots; run a node inside a TEE; Firecracker sandboxes; NEAR Intents / stablecoin tools with on-chain approvals; desktop app; SSO and audit export.</P>
      <H2 id="cut">Cut list if time runs short</H2>
      <P>Firecracker, key rotation, headless mode, multiple bots per team, fancy UI.</P>
    </article>
  )
}
