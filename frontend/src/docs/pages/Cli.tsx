import { DocTable, P } from '../ui'

export default function DocsCli() {
  return (
    <article>
      <h1 className="font-brico text-4xl font-extrabold tracking-tight text-navy sm:text-5xl">CLI reference</h1>
      <P>Planned surface — kept small on purpose.</P>
      <DocTable
        head={['Command', 'What it does']}
        rows={[
          ['wayfind-one init --team <name>', 'Create node identity, team key and local store'],
          ['wayfind-one up [--port 7777] [--headless]', 'Start daemon, web UI and P2P (--headless skips UI, for VPS nodes)'],
          ['wayfind-one invite', 'Create a one-time invite code'],
          ['wayfind-one join <code>', 'Join a team from an invite'],
          ['wayfind-one bot create <name> --role <role>', 'Create a bot with a role prompt and policy'],
          ['wayfind-one verify', 'Run a full NEAR AI attestation check and print the result'],
          ['wayfind-one doctor', 'Check Docker, network, key and peer connectivity'],
          ['wayfind-one demo', 'Run the self-contained demo'],
        ]}
      />
    </article>
  )
}
