import { Callout, H2, P } from '../ui'

export default function DocsSandbox() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Sandbox runner</h1>
      <P>Default: Docker, one container per bot (or per task).</P>
      <H2 id="defaults">Defaults</H2>
      <P>Non-root, read-only root filesystem, CPU/memory/time limits, a scratch volume. Team files are mounted into the sandbox only for the task that needs them.</P>
      <H2 id="network">Network</H2>
      <P>
        No default route to the internet. The only reachable endpoint is the inference proxy on
        the host (dedicated Docker network + per-sandbox token). Any other outbound access must
        be listed in policy and goes through the proxy.
      </P>
      <Callout kind="info">
        Optional on Linux with KVM: Firecracker for stronger isolation. Not required for the
        hackathon — cut-listed if time runs short.
      </Callout>
    </article>
  )
}
