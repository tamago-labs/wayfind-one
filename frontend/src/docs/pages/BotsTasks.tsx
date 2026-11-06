import { H2, P, Step, Steps } from '../ui'

export default function DocsBots() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Bots &amp; tasks</h1>
      <P>Demo scenario: private expense reconciliation between two teammates.</P>
      <H2 id="demo">Demo script</H2>
      <Steps>
        <Step title="1">Node A and B join one team on different machines.</Step>
        <Step title="2">A uploads a bank export + receipts (never leave the team&apos;s machines).</Step>
        <Step title="3">A creates a task: match transactions with receipts, list what&apos;s missing.</Step>
        <Step title="4">Node B claims it and runs the bot in a Docker sandbox; UI shows who runs it.</Step>
        <Step title="5">The bot calls the model via the inference proxy; UI shows the verified TEE badge.</Step>
        <Step title="6">The bot proposes a payment for a missing invoice — policy requires approval on A&apos;s screen.</Step>
        <Step title="7">A approves; audit log records call + attestation + approval.</Step>
        <Step title="8">Proof: network view shows no connection except NEAR AI Cloud; sandbox has no direct internet.</Step>
      </Steps>
    </article>
  )
}
