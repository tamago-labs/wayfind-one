import { Callout, Code, H2, P } from '../ui'

export default function DocsP2p() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">Team store &amp; P2P</h1>
      <P>
        Stack (Holepunch): <strong>Hyperswarm / HyperDHT</strong> for peer discovery and encrypted
        connections, <strong>Hypercore + Autobase</strong> for multi-writer append-only logs,{' '}
        <strong>Hyperbee</strong> for key-value views.
      </P>
      <H2 id="keys">Suggested key layout</H2>
      <Code title="team store">{`team/meta                  team name, created-at, policy version\nmembers/<nodeId>           public key, display name, role, status\nbots/<botId>               role, tool list, policy ref\ntasks/<taskId>             description, bot, status, created-by\nclaims/<taskId>            nodeId, lease-expires-at\napprovals/<approvalId>     task, action, requested-by, decisions[]\naudit/<seq>                append-only event log\npolicy                     team policy (versioned)`}</Code>
      <H2 id="encryption">Encryption</H2>
      <P>
        Transport is already encrypted by HyperDHT. In addition, every stored value is encrypted
        with the team key (e.g. XChaCha20-Poly1305 via libsodium) so a stray peer or backup never
        holds plaintext.
      </P>
      <H2 id="invites">Invites</H2>
      <P>
        An invite contains the swarm topic and the team key wrapped for one-time use. After a
        successful join, the invite is marked as spent in the store.
      </P>
      <H2 id="claims">Task claiming (no double runs)</H2>
      <P>
        A node appends <code>claims/&lt;taskId&gt;</code> with a lease (e.g. 60 s). After Autobase
        orders writes, the first claim wins and other nodes back off. The owner renews the lease
        with a heartbeat; on expiry another node may claim.
      </P>
      <Callout kind="warning">
        Member removal means rotating the team key and re-encrypting — documented as roadmap for
        the hackathon, stated plainly.
      </Callout>
    </article>
  )
}
