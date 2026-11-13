// Client-side port of the backend verification-report builder
// (wayfind-cloud amplify/functions/wayfind-api/lib/reports.ts).
// Same honesty mapping: the viewer checks structure, never evidence —
// model scope is 'partial' (no dcap-qvl here), gateway 'partial' with an
// unattested TLS binding, unattributable entries become 'failed'.
export interface WidgetSigner {
  signingAlgo: 'ecdsa';
  signingAddress: string;
}

export interface WidgetReport {
  schemaVersion: 1;
  kind: 'model' | 'response';
  model?: string;
  scope: 'model' | 'gateway' | 'unknown';
  status: 'verified' | 'partial' | 'failed' | 'unverifiable';
  completionId?: string;
  signature?: {
    kind: 'provider_tee' | 'gateway';
    signer: WidgetSigner;
    signedText: string;
    signature: string;
  };
  attestation?: {
    signer: WidgetSigner;
    tcbStatus: 'Unknown';
    advisoryIds: string[];
    deploymentProvenance: 'not_checked';
    deployment: { runtimeMeasurements: Record<string, never> };
    gpuEvidence?: 'verified' | 'not_provided';
    tlsBinding?: { kind: 'none' } | { kind: 'attested'; spkiFingerprint: string };
  };
  error?: { message: string };
}

interface EvidenceMessage {
  seq?: number;
  chatId?: string | null;
  checked?: boolean;
  kind?: string;
  valid?: boolean;
  signer?: string | null;
  signedText?: string | null;
  signature?: string | null;
}

export interface EvidenceForWidget {
  preflight?: {
    nonce?: string;
    model?: string;
    nodes?: number;
    nonceEchoed?: boolean;
    modelTee?: string[];
    gateway?: string[];
    nvidia?: { overall?: boolean; nonceMatch?: boolean | null; gpus?: number } | null;
  } | null;
  messages?: EvidenceMessage[];
}

function modelSigner(preflight: NonNullable<EvidenceForWidget['preflight']>): WidgetSigner | null {
  const addr = preflight.modelTee?.[0];
  return addr ? { signingAlgo: 'ecdsa', signingAddress: addr } : null;
}

function gatewaySigner(preflight: NonNullable<EvidenceForWidget['preflight']>): WidgetSigner | null {
  const addr = preflight.gateway?.[0];
  return addr ? { signingAlgo: 'ecdsa', signingAddress: addr } : null;
}

export function toVerificationReports(model: string, evidence: EvidenceForWidget | null, chatId?: string): WidgetReport[] {
  if (!evidence?.preflight) {
    return [
      {
        schemaVersion: 1,
        kind: 'model',
        model,
        scope: 'unknown',
        status: 'unverifiable',
        error: { message: 'no attestation evidence retained for this sandbox run' },
      },
    ];
  }
  const pre = evidence.preflight;
  const reports: WidgetReport[] = [];
  const mSigner = modelSigner(pre);
  const gSigner = gatewaySigner(pre);

  if (mSigner) {
    const gpuOk = pre.nvidia?.overall === true && pre.nvidia?.nonceMatch === true;
    reports.push({
      schemaVersion: 1,
      kind: 'model',
      model: pre.model ?? model,
      scope: 'model',
      status: pre.nonceEchoed && gpuOk ? 'partial' : 'failed',
      ...(pre.nonceEchoed && gpuOk
        ? {}
        : { error: { message: 'model attestation evidence incomplete (nonce echo or NVIDIA verdict missing)' } }),
      attestation: {
        signer: mSigner,
        tcbStatus: 'Unknown',
        advisoryIds: [],
        deploymentProvenance: 'not_checked',
        deployment: { runtimeMeasurements: {} },
        gpuEvidence: pre.nvidia?.overall === true ? 'verified' : 'not_provided',
      },
    });
  }
  if (gSigner) {
    reports.push({
      schemaVersion: 1,
      kind: 'model',
      model: pre.model ?? model,
      scope: 'gateway',
      status: 'partial',
      attestation: {
        signer: gSigner,
        tcbStatus: 'Unknown',
        advisoryIds: [],
        deploymentProvenance: 'not_checked',
        deployment: { runtimeMeasurements: {} },
        tlsBinding: { kind: 'none' },
      },
    });
  }

  const msgs = (evidence.messages ?? []).filter(
    (m): m is EvidenceMessage & { chatId: string; signedText: string; signature: string; signer: string } =>
      !!m?.checked && !!m.chatId && !!m.signedText && !!m.signature && !!m.signer &&
      (m.kind === 'provider_tee' || m.kind === 'gateway'),
  );
  const picked = chatId
    ? msgs.find((m) => m.chatId === chatId) ?? null
    : [...msgs].reverse().find((m) => m.valid) ?? null;
  if (picked && mSigner && gSigner) {
    const scope = picked.kind === 'provider_tee' ? 'model' : 'gateway';
    const signer = scope === 'model' ? mSigner : gSigner;
    const signerMatches = signer.signingAddress.toLowerCase() === picked.signer.toLowerCase();
    reports.push({
      schemaVersion: 1,
      kind: 'response',
      completionId: picked.chatId,
      model: pre.model ?? model,
      scope,
      status: picked.valid && signerMatches ? 'partial' : 'failed',
      ...(picked.valid && signerMatches
        ? {}
        : { error: { message: 'response signature did not verify against the retained attestation' } }),
      signature: {
        kind: picked.kind as 'provider_tee' | 'gateway',
        signer,
        signedText: picked.signedText,
        signature: picked.signature,
      },
      attestation: {
        signer,
        tcbStatus: 'Unknown',
        advisoryIds: [],
        deploymentProvenance: 'not_checked',
        deployment: { runtimeMeasurements: {} },
        ...(scope === 'model'
          ? { gpuEvidence: pre.nvidia?.overall === true ? ('verified' as const) : ('not_provided' as const) }
          : { tlsBinding: { kind: 'none' as const } }),
      },
    });
  }
  return reports;
}
