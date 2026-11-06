import { Link } from 'react-router-dom'
import { Callout, DocTable, H2, P } from '../ui'

export default function DocsIntro() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Introduction</h1>
      <P>
        <strong>Wayfind ONE</strong> is a CLI for enterprises and teams that handle sensitive data.
        It spins up isolated sandbox computers on your own machines, lets your whole team share
        them over encrypted peer-to-peer sync, and sends AI inference only to{' '}
        <strong>NEAR AI Cloud</strong>, where it runs inside verified Trusted Execution
        Environments (TEEs).
      </P>
      <P>One team. One private computer. One AI workspace. No central server.</P>

      <H2 id="mental-model">The mental model</H2>
      <DocTable
        head={['Concept', 'Meaning']}
        rows={[
          ['Team', 'A set of members sharing one encrypted store, identified by a team key'],
          ['Node', 'One running daemon on one machine, with its own identity key'],
          ['Bot', 'An AI teammate: role prompt, memory, allowed tools, policy'],
          ['Sandbox', 'A Docker container where a bot\u2019s tools and code run, no direct internet'],
          ['Task', 'A unit of work for a bot, stored in the shared log'],
          ['Claim', 'A node\u2019s record that it is running a task (prevents duplicate runs)'],
          ['Policy', 'Rules for spending, tools, egress and approvals'],
          ['Approval', 'A teammate\u2019s sign-off required before a sensitive action'],
        ]}
      />

      <H2 id="cloud-vs-one">Cloud vs ONE</H2>
      <P>
        Wayfind Cloud is the hosted product from Tamago Labs. <strong>Wayfind ONE</strong> is a
        separate, self-hosted, P2P product: bots run on your team&apos;s own machines (Docker
        sandboxes), the team shares work over encrypted P2P with no central server, and inference
        runs on NEAR AI Cloud inside attested TEEs.
      </P>

      <Callout kind="tip">
        New here? The <Link to="/docs/quickstart" style={{ fontWeight: 700, color: '#2f7bff' }}>Quickstart</Link> takes
        you from install to a two-node team in minutes.
      </Callout>

      <H2 id="next">Where next</H2>
      <P>
        Quickstart for the five-minute path, Team store &amp; P2P for the sync layer, Inference
        &amp; attestation for the core privacy piece.
      </P>
    </article>
  )
}
