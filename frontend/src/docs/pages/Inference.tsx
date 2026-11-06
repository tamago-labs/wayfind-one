import { Callout, Code, H2, P, Step, Steps } from '../ui'

export default function DocsInference() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Inference &amp; attestation</h1>
      <P>
        The sandbox talks to the host inference proxy; the proxy talks to NEAR AI Cloud. It holds
        the API key (the sandbox never receives it), checks attestation, applies policy, and
        writes an audit record per call. It refuses to forward traffic if attestation fails.
      </P>
      <Code title="Endpoints">{`OpenAI-compatible base: https://cloud-api.near.ai/v1\nDirect completions (preferred): https://<model>.completions.near.ai\nAttestation report: GET /v1/attestation/report?signing_algo=ecdsa&nonce=<nonce>`}</Code>
      <H2 id="verify">Verification flow</H2>
      <Steps>
        <Step title="1">Generate a random nonce.</Step>
        <Step title="2">Request the attestation report with the nonce.</Step>
        <Step title="3">Verify the GPU evidence (nvidia_payload) with NVIDIA&apos;s Remote Attestation Service.</Step>
        <Step title="4">Verify the Intel TDX quote; check the report data carries your nonce + signing address.</Step>
        <Step title="5">Verify response signatures against the attested signing address.</Step>
        <Step title="6">For the strongest check, enable TLS attestation binding the connection to the TEE.</Step>
        <Step title="7">Show the result as a verified badge with details on click; cache with expiry.</Step>
      </Steps>
      <Callout kind="tip">
        Pin expected measurements (e.g. approved compose hash / workload identity) so you accept
        only the legitimate model deployment — not just any genuine TEE.
      </Callout>
    </article>
  )
}
