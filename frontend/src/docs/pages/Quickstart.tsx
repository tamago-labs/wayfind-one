import { Link } from 'react-router-dom'
import { Callout, Code, H2, P, Step, Steps } from '../ui'

export default function DocsQuickstart() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Quickstart</h1>
      <P>Requirements: Node.js 20+, Docker, and a NEAR AI Cloud API key from cloud.near.ai.</P>
      <Steps>
        <Step title="1"><strong>Start your first node and create a team.</strong> Run the init command with your team name.</Step>
        <Step title="2"><strong>Run the daemon and open the UI.</strong> The web UI serves on localhost:7777.</Step>
        <Step title="3"><strong>Invite a teammate.</strong> Print a one-time invite code.</Step>
        <Step title="4"><strong>Join from the teammate&apos;s machine</strong> with the invite code, then run the daemon there too.</Step>
        <Step title="5"><strong>Or try demo mode</strong> — two simulated nodes, a sample bot task, an attestation check and an approval prompt.</Step>
      </Steps>
      <Code title="Terminal">{`npx wayfind-one init --team "Acme Finance"\nnpx wayfind-one up\n# -> http://localhost:7777\n\nnpx wayfind-one invite\n\n# on the teammate's machine\nnpx wayfind-one join <invite-code>\nnpx wayfind-one up`}</Code>
      <Code title="Demo (no setup)">{`npx wayfind-one demo`}</Code>
      <H2 id="two-nodes">Testing P2P on one machine</H2>
      <P>Run two nodes with different data directories and ports:</P>
      <Code title="Terminal">{`WAYFIND_HOME=.node-a npx wayfind-one up --port 7777\nWAYFIND_HOME=.node-b npx wayfind-one up --port 7778`}</Code>
      <Callout kind="tip">
        Demo uses a recorded NEAR AI response if no API key is present, clearly labelled as such
        in the UI. See <Link to="/docs/inference" style={{ fontWeight: 700, color: '#2f7bff' }}>Inference &amp; attestation</Link> for
        what gets verified in live mode.
      </Callout>
    </article>
  )
}
