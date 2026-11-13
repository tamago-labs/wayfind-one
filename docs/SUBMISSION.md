# NEAR HACKATHON — submission draft (DO NOT SEND YET)

Status: draft. Submit only after the human confirms the exact payload
(`POST https://nearhackathon.com/api/applications`). One submission per
project — mistakes are fixed via request-changes, never by resubmitting.

Deadline: 2026-11-14T23:59:00Z. Request ID below is generated once and must
be reused verbatim on any retry after a network error or 503.

## Pre-submit checklist

- [ ] Repo is public at `projectUrl` (do NOT push/make-public without the human's explicit go-ahead)
- [ ] `pre-hackathon` and `hackathon-submission` tags cut locally; README diff link filled in
- [ ] LICENSE holder confirmed (currently: Tamago Labs)
- [ ] Demo post published on X (built at NEAR HACKATHON, tags @NEARProtocol + #NEARHackathon, demo video or screenshots attached)
- [ ] All `[NEED]` fields below filled in by the human (never guessed)
- [ ] Consent notice read to the human verbatim (done — agreed)
- [ ] Payload printed for the human and confirmed with an explicit yes

## Payload (draft)

```json
{
  "requestId": "d6a8873d-c1c0-4573-bfe9-81ce6c8a92c6",
  "projectName": "[NEED — e.g. Wayfind ONE, 2-80 chars]",
  "leadName": "[NEED — 2-80 chars]",
  "email": "[NEED — valid email, max 160 chars]",
  "size": "1",
  "tracks": ["privacy", "security"],
  "nearAddress": "[NEED — mainnet payout account, e.g. team.near]",
  "projectUrl": "[CONFIRM — https://github.com/tamago-labs/wayfind-one — must be public before the deadline]",
  "demoUrl": "[NEED — link to the published X demo post]",
  "idea": "Regulated teams can't send proprietary data to chatbots and can't self-host models. Wayfind ONE runs AI tasks in disposable microVMs with NEAR AI TEE inference — hardware attested before the first prompt, every response signed, sandbox sealed and killed after. Result plus independently verifiable evidence.",
  "consent": true
}
```

Agreed already: size `1`, tracks `privacy` + `security`, idea text as above, consent given.

## Send command (only on explicit human yes)

```sh
curl -sS -X POST https://nearhackathon.com/api/applications \
  -H 'Content-Type: application/json' \
  -d @- <<'EOF'
{ ...payload above, with [NEED] fields filled... }
EOF
```

Rules reminder: never add extra fields (`website` is a spam trap — any non-empty value rejects). On 400, fix listed fields and resend with the SAME requestId. On 409, stop — the repo was already submitted. On 403 outside the window, do not retry.
