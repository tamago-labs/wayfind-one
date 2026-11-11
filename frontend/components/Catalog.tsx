export const MODELS = [
  { id: 'Qwen/Qwen3.8-27B', via: 'NEAR AI', label: 'Attestation verified', tone: 'green' as const },
];

export function SecurityNote() {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-4 text-sm text-ink">
      <p className="font-semibold text-navy">How verification works</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Your work runs in a disposable Firecracker microVM — destroyed after.</li>
        <li>Files travel sealed (AES-256-GCM); the relay sees ciphertext only.</li>
        <li>NEAR inference is hardware-attested per request; responses are signed.</li>
        <li>Every run ends with a receipt you can verify independently.</li>
      </ul>
    </div>
  );
}
