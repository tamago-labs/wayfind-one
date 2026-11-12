// Step 2: create the golden computer image from the uploaded zip, poll to CREATED.
// Run: npx tsx packages/computer/scripts/image/02-create-image.ts [--replace]
// --replace deletes the existing image first (needed when server code changed;
// otherwise CreateMicrovmImage conflicts and we would poll the stale build).
import { CreateMicrovmImageCommand, DeleteMicrovmImageCommand, GetMicrovmImageCommand, HookState } from '@aws-sdk/client-lambda-microvms';
import { BUCKET, IMAGE_NAME, REGION, ZIP_KEY, mv, need, saveState, waitFor } from './config';

async function main(): Promise<void> {
  const buildRoleArn = need('MICROVM_BUILD_ROLE_ARN');
  const baseImageArn = need('MICROVM_BASE_IMAGE_ARN');

  if (process.argv.includes('--replace')) {
    const accountId = buildRoleArn.split(':')[4];
    const existing = `arn:aws:lambda:${REGION}:${accountId}:microvm-image:${IMAGE_NAME}`;
    console.log(`--replace: deleting existing image ${existing}...`);
    try {
      await mv.send(new DeleteMicrovmImageCommand({ imageIdentifier: existing }));
      await waitFor(
        'image to DELETED',
        async () => {
          try {
            await mv.send(new GetMicrovmImageCommand({ imageIdentifier: existing }));
            return null;
          } catch (err) {
            if (err instanceof Error && /not found|ResourceNotFound/i.test(`${err.name} ${err.message}`)) {
              return {} as never;
            }
            throw err;
          }
        },
        { intervalMs: 15_000, timeoutMs: 10 * 60_000 },
      );
      console.log('Old image deleted.');
    } catch (err) {
      if (err instanceof Error && /not found|ResourceNotFound/i.test(`${err.name} ${err.message}`)) {
        console.log('No existing image — creating fresh.');
      } else {
        throw err;
      }
    }
  }

  let imageArn: string | undefined;
  try {
    const created = await mv.send(
      new CreateMicrovmImageCommand({
        name: IMAGE_NAME,
        codeArtifact: { uri: `s3://${BUCKET}/${ZIP_KEY}` },
        baseImageArn,
        buildRoleArn,
        description: 'Wayfind computer golden image: agent server + workspace seed, no keys',
        tags: { Project: 'wayfind-cloud', Purpose: 'computer-golden-image' },
        // Hook wiring: the agent server listens on 8080. Declaring the run
        // hook is what allows runHookPayload at RunMicrovm time; the ready
        // hook gates the snapshot on the server actually booting.
        hooks: {
          port: 8080,
          microvmHooks: {
            run: HookState.ENABLED,
            resume: HookState.ENABLED,
            suspend: HookState.ENABLED,
            terminate: HookState.ENABLED,
          },
          microvmImageHooks: { ready: HookState.ENABLED, validate: HookState.ENABLED },
        },
      }),
    );
    console.log(`Build started: ${created.imageArn} (state ${created.state})`);
    imageArn = created.imageArn;
  } catch (err) {
    // Image name already exists (e.g. a previous attempt is still building)
    // — fall through to polling the existing build.
    if (err instanceof Error && err.name === 'ConflictException') {
      const accountId = buildRoleArn.split(':')[4];
      imageArn = `arn:aws:lambda:${REGION}:${accountId}:microvm-image:${IMAGE_NAME}`;
      console.log(`Image ${IMAGE_NAME} already exists — polling existing build ${imageArn}`);
    } else {
      throw err;
    }
  }
  if (!imageArn) throw new Error('create-microvm-image returned no imageArn');

  const built = await waitFor(
    'image build',
    async () => {
      // NOTE: GetMicrovmImage requires the full ARN, not the bare name.
      const res = await mv.send(new GetMicrovmImageCommand({ imageIdentifier: imageArn }));
      console.log(`  ... state=${res.state} version=${res.latestActiveImageVersion ?? '-'}`);
      if (res.state === 'CREATED') return res;
      if (res.state === 'CREATE_FAILED') {
        throw new Error(
          `Build FAILED — check CloudWatch log group /aws/lambda-microvms/${IMAGE_NAME} for the Dockerfile output.`,
        );
      }
      return null;
    },
    { intervalMs: 15_000, timeoutMs: 30 * 60_000 },
  );

  saveState({ imageArn, imageVersion: built.latestActiveImageVersion ?? undefined });
  console.log(`Golden image ready: ${imageArn} version=${built.latestActiveImageVersion ?? '-'}`);
  console.log('Next: Phase 2 server hooks (/run identity), then manual 03-run.');
}

main().catch((err) => {
  console.error('Create-image failed:', err);
  process.exit(1);
});
