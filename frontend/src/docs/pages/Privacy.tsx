import { DocTable, H2, P } from '../ui'

export default function DocsPrivacy() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Privacy &amp; threat model</h1>
      <H2 id="stays">What stays private</H2>
      <P>Team data, tasks, chat history and bot memory are encrypted with a team key and only synced between members&apos; machines. The only network call that leaves for AI is inference to NEAR AI Cloud, inside Intel TDX confidential VMs with NVIDIA TEE GPUs. Attestation and response signatures are verified before trusting a reply. API keys live in the host process — sandboxes never see them.</P>
      <H2 id="not">What is NOT protected</H2>
      <P>The sandbox runs on a teammate&apos;s laptop or server — not a TEE. Root there can read its memory. You still trust Intel/NVIDIA and the attestation chain. A TEE does not stop prompt injection (policy + approvals do). P2P availability: no online node that can run it means the task waits.</P>
      <H2 id="threats">Threat model</H2>
      <DocTable
        head={['Threat', 'Mitigation', 'Remaining risk']}
        rows={[
          ['Central server compromise', 'No central server', 'None for this layer'],
          ['Network eavesdropping', 'HyperDHT encryption, HTTPS to NEAR AI', 'Metadata (who connects to whom)'],
          ['Inference provider sees prompts', 'TEE inference + verified attestation', 'Trust in Intel/NVIDIA hardware'],
          ['Prompt injection leak/spend', 'No secrets in sandbox, egress allow-list, approvals, spend limits', 'Trickery inside allowed scope'],
          ['Malicious tool in sandbox', 'Container isolation, no direct internet, limits', 'Container escape (Firecracker later)'],
          ['Stolen laptop', 'Disk encryption, encrypted local store', 'Team key rotation is manual'],
          ['Removed member keeps key', 'Roadmap: rotation', 'Real gap today'],
          ['Two nodes run same task', 'Claims with leases', 'Brief overlap on lease expiry'],
        ]}
      />
    </article>
  )
}
