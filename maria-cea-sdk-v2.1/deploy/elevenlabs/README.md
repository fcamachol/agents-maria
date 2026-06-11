# ElevenLabs — Maria CEA voice (Option B: EL Conversational AI)

Turnkey push for a **TEST** agent (clone). The live `Maria CEA` agent
(`agent_7301kg0z72effkvtqghs2hx58bpt`) is never touched by this.

## Prerequisites (the gated bits)

1. **Voice server deployed & reachable** at a URL ElevenLabs can hit, e.g.
   `https://<host>:3017` (the v2.1 `dist/voice/server.js`, PM2 app
   `maria-cea-v21-voice`). It must have a `.env` with CEA/AGORA/PG creds.
   Side-by-side with `maria-voz:3003`. Open port 3017 in the GCP firewall.
   **Redis is NOT installed on gcp-cea** — without it the voice server uses an
   in-memory session (fine to validate voice tools + the identity gate). The
   cross-channel WhatsApp-mid-call pull additionally needs Redis (`REDIS_URL`)
   AND the v2.1 text server running off the same Redis — a later step.
2. **ElevenLabs API key** with Conversational AI (agents + tools) **write**
   access. From elevenlabs.io → profile → API Keys, or GCP Secret Manager
   (`gcloud secrets versions access latest --secret=elevenlabs-api-key`).
3. **Project built**: `npm run build` (so `dist/voice/system-prompt.js` exists).

## Push

```bash
cd maria-cea-sdk-v2.1
npm run build
ELEVENLABS_API_KEY=xi-... \
VOICE_SERVER_URL=https://<host>:3004 \
node deploy/elevenlabs/push-test-agent.mjs
```

This creates the 13 webhook tools + a TEST agent with the derived voice prompt
and Cristina Campos voice, tools attached. Validate via the dashboard's
**Test AI agent** widget (don't bind the live SIP number to the test agent).

## What's in here

- `push-test-agent.mjs` — creates tools + test agent via the EL REST API.
  Tool list + the voice prompt are the single source of truth (prompt imported
  from `dist/voice/system-prompt.js`).

## Remaining deploy-time unknowns to confirm on first live test

- **System dynamic variables**: each tool sends `system__conversation_id` and
  `system__caller_id` (our `voice/tools.ts` reads them to key the shared session).
  Confirm EL fills these on a real call; if the field shape differs in your EL
  version, set them on the tools in the dashboard.
- **AGORA find/create-conversation** in `core/notify.ts` (`enviar_recibo`):
  verify the contact's WhatsApp conversation is found and the outbound message
  delivers on the WhatsApp channel.

## Cutover (later, separate, user-initiated)

Once the test agent is validated: point the production `Maria CEA` agent (and the
`mariacea` SIP number) at the new tools/server, and retire old `maria-voz`.
