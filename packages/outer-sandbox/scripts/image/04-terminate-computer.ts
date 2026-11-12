// Step 4: terminate the manual computer VM (stops all charges).
// Run: npx tsx packages/computer/scripts/image/04-terminate-computer.ts [--delete-image]
// --delete-image also deletes the golden image afterwards.
import { DeleteMicrovmImageCommand, GetMicrovmCommand, GetMicrovmImageCommand, TerminateMicrovmCommand } from '@aws-sdk/client-lambda-microvms';
import { loadState, mv, saveState, waitFor } from './config';

async function main(): Promise<void> {
  const { microvmId, imageArn } = loadState();
  const deleteImage = process.argv.includes('--delete-image');

  if (microvmId) {
    await mv.send(new TerminateMicrovmCommand({ microvmIdentifier: microvmId }));
    await waitFor(
      'terminate to TERMINATED',
      async () => {
        try {
          const res = await mv.send(new GetMicrovmCommand({ microvmIdentifier: microvmId }));
          console.log(`  ... state=${res.state}`);
          return res.state === 'TERMINATED' ? res : null;
        } catch (err) {
          if (err instanceof Error && /not found|ResourceNotFound/i.test(`${err.name} ${err.message}`)) {
            console.log('  ... microvm no longer returned (treated as terminated)');
            return {} as never;
          }
          throw err;
        }
      },
      { intervalMs: 10_000, timeoutMs: 10 * 60_000 },
    );
    saveState({ microvmId: undefined, endpoint: undefined });
    console.log(`Terminated ${microvmId}`);
  } else {
    console.log('No microvmId in state — nothing to terminate.');
  }

  if (deleteImage && imageArn) {
    await mv.send(new DeleteMicrovmImageCommand({ imageIdentifier: imageArn }));
    await waitFor(
      'image to DELETED',
      async () => {
        try {
          const res = await mv.send(new GetMicrovmImageCommand({ imageIdentifier: imageArn }));
          console.log(`  ... state=${res.state}`);
          return res.state === 'DELETED' ? res : null;
        } catch (err) {
          if (err instanceof Error && /not found|ResourceNotFound/i.test(`${err.name} ${err.message}`)) {
            console.log('  ... image no longer returned (treated as deleted)');
            return {} as never;
          }
          throw err;
        }
      },
      { intervalMs: 15_000, timeoutMs: 10 * 60_000 },
    );
    saveState({ imageArn: undefined, imageVersion: undefined });
    console.log(`Deleted image ${imageArn}`);
  }
}

main().catch((err) => {
  console.error('Terminate failed:', err);
  process.exit(1);
});
