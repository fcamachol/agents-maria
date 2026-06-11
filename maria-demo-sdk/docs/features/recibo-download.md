# Feature: Recibo (Receipt PDF) Download

How customers receive their CEA water bill PDF through Maria.

> When this breaks, see [`../runbooks/recibo-invalid-token.md`](../runbooks/recibo-invalid-token.md).

---

## What it does

A customer messages Maria (via WhatsApp / Chatwoot) something like *"mándame mi recibo"* or *"quiero el recibo de febrero"*. Maria replies with a short-lived signed URL. The customer taps the URL, the PDF streams back from the CEA's SOAP backend through a Cloudflare proxy.

Two reasons we can't just paste a CEA URL directly:

1. **The CEA's PDF endpoint is SOAP** (`Comercial/services/InterfazGenericaContratacionWS`), returns the PDF as base64 embedded in XML, and requires whitelisted server-to-server access. A customer's browser can't hit it.
2. **No authentication on our side.** We've never identified the customer with a password. The contrato number alone isn't a secret (it's printed on every bill). So the link itself has to be the credential — an HMAC-signed, time-bounded URL that we hand out only after Maria has determined the right factura.

---

## End-to-end flow

```
┌──────────┐          ┌───────────┐          ┌──────────────┐          ┌──────────────────┐          ┌─────────────┐
│ Customer │──msg────▶│   Maria   │──SOAP───▶│  CEA SOAP    │          │  Cloudflare      │          │   CEA SOAP  │
│ (WhatsApp│          │  (agent)  │ getFact. │  AquaCIS     │          │  Worker          │          │  AquaCIS    │
│  Chatwoot│          │           │◀─list────│              │          │  info-cea        │          │             │
│          │          │           │          └──────────────┘          └──────────────────┘          └─────────────┘
│          │          │ get_recibo│                                          ▲                              ▲
│          │          │ _link tool│                                          │                              │
│          │          │  ┌────────┴─ generates URL ──────────────────────────┘                              │
│          │◀─URL─────│  │ HMAC(contrato:expiresAt, SECRET)                                                 │
│          │          │  │ + expires + factura number                                                      │
│          │          └──┘                                                                                 │
│          │                                                                                               │
│          │──opens URL──────────────────────────────────────────▶┌────────────────┐                       │
│          │                                                      │ CF Worker TCP- │──HTTP─▶┌────────┐     │
│          │                                                      │ proxies to     │        │ Express│──SOAP──▶
│          │                                                      │ :3006 origin   │        │ /recibo│  getPdfFactura
│          │                                                      └────────────────┘        │ verify │◀─base64 PDF
│          │◀─PDF stream─────────────────────────────────────────────────────────────────── │ HMAC + │
└──────────┘                                                                                │ stream │
                                                                                            └────────┘
```

Two server hops, two SOAP calls, one HMAC verify, one base64 decode.

---

## Components

### 1. Tool: `get_recibo_link` (URL generation)

**File:** `maria-cea-sdk-v2/src/tools/cea-api.ts` (~line 454)

The LLM calls this tool when the user asks for their bill. It does **not** fetch the PDF — only the link.

1. Resolve the contrato (handles aliases / typo correction via `resolveContract`).
2. Call CEA's `InterfazOficinaVirtualClientesWS.getFacturas` with the contrato. Tries `explotacion=1` first, falls back to `explotacion=12` (different CEA service variants). Returns a list of invoices.
3. Pick the target invoice:
   - Default: most recent (`parsed.facturas[0]`).
   - If user mentioned a period ("enero", "febrero 2025"): fuzzy match against `periodoTexto` (accent-insensitive, substring both directions).
   - No match → return friendly error listing available periods.
4. Sign the URL:
   ```ts
   const expiresAt = Date.now() + 48 * 60 * 60 * 1000;       // 48h
   const token = generateReciboToken(contrato, expiresAt);
   const url = `${SERVER_BASE_URL}/recibo/${contrato}?token=${token}&expires=${expiresAt}&factura=${factura.numero}`;
   ```
5. Return a `formatted_response` containing the URL with Spanish copy that Maria sends to the customer verbatim.

### 2. Signer / Verifier

**File:** `maria-cea-sdk-v2/src/services/recibo-token.ts`

```ts
// sign
HMAC-SHA256( key=RECIBO_TOKEN_SECRET, message=`${contrato}:${expiresAt}` ).hex()

// verify
- Reject if expiresAt < now (expired).
- Recompute the HMAC.
- crypto.timingSafeEqual against the supplied token.
```

The HMAC binds three things together: the contrato in the path, the expiry in the query, and the server's secret. Tampering with any of them invalidates the signature.

**Critical:** the secret must be **identical across every process that signs or verifies**. If unset, the code falls back to `crypto.randomBytes(32)` per startup — fine in isolation, fatal across processes. This is the failure mode the runbook addresses.

### 3. Express endpoint: `GET /recibo/:contrato`

**File:** `maria-cea-sdk-v2/src/server.ts:60`

1. Pull `token`, `expires`, `factura` from query.
2. `verifyReciboToken(contrato, token, expires)` — 403 on failure.
3. `fetchReciboPdf(contrato, factura)` — 404 if SOAP returns nothing.
4. Respond with `Content-Type: application/pdf` + `Content-Disposition: inline; filename="recibo-${contrato}.pdf"`. Browsers render it; WhatsApp's preview tile picks it up.

Note: this endpoint doesn't trust the `factura` query parameter beyond passing it through — the customer can't enumerate other invoices because the HMAC is bound to `contrato:expiresAt`, not to factura. The factura param is convenience, not authorization. (Customers can substitute a different factura number in their own URL and pull a different invoice for the same contrato — which is acceptable since Maria already determined the contrato is theirs.)

### 4. Cloudflare Worker: `info-cea`

**File:** `info-cea/src/index.js`
**Public URL:** `https://info-cea.cea-info.workers.dev`

Pure TCP proxy. Hard-codes `ORIGIN_HOST = 34.122.65.54` and `ORIGIN_PORT = 3006`. Opens a raw socket via `cloudflare:sockets`, writes an HTTP/1.1 request, parses the response (including chunked transfer decoding), returns it as a Workers `Response`.

Reasons we proxy at all:
- The origin (gcp-cea) doesn't have a TLS cert / public hostname suitable for customer-facing URLs.
- Cloudflare gives us DDoS protection, edge caching headers, and a clean `*.workers.dev` domain.
- A WhatsApp preview crawler accepting an arbitrary GCP IP would look phishy; a `workers.dev` domain previews cleanly.

Reasons it's a TCP proxy (not just a fetch passthrough): legacy decision when the origin lacked TLS. A `fetch()` rewrite is on the table but not blocking anything.

**Implication:** changing the origin port = changing `info-cea/src/index.js` and redeploying the Worker. Wrangler config lives in `info-cea/wrangler.toml`.

### 5. PDF fetcher: `fetchReciboPdf`

**File:** `maria-cea-sdk-v2/src/services/soap-client.ts:583`

1. If `numFactura` not supplied, re-runs `getFacturas` to find the latest (defensive — the tool always supplies one, but the endpoint accepts links missing the `factura` param).
2. Builds `getPdfFactura` SOAP envelope (`buildGetPdfFacturaSOAP` in the same file).
3. POSTs to `InterfazGenericaContratacionWS`.
4. Parses the response with a regex matching `<pdf>...</pdf>` (new format) or `<return>...</return>` (legacy CEA response shape).
5. Base64-decodes to a `Buffer`.

Returns `null` on any failure → endpoint replies 404 with friendly Spanish copy.

---

## Security model

| Property | Mechanism |
|---|---|
| **Authenticity** — only Maria can mint valid URLs | HMAC-SHA256 with server-side `RECIBO_TOKEN_SECRET`. |
| **Integrity** — token covers contrato + expiry | Message is `${contrato}:${expiresAt}`. Tampering either breaks the MAC. |
| **Expiry** — links die after 48h | `expires` query param checked against `Date.now()` before MAC verify. |
| **Timing-safe comparison** | `crypto.timingSafeEqual` to avoid byte-by-byte timing oracles. |
| **No PII in URL** | Only the contrato number, which is already on the printed bill. No name, address, phone. |

### What this model does **not** protect against

- **URL forwarding.** Anyone with the link can open it during the 48h window. We accept this — recibos are not sensitive enough to warrant per-session auth, and WhatsApp link-previewing means we can't bind to a session anyway.
- **Per-factura authorization.** As noted above, the MAC binds the contrato, not the specific invoice. Mostly intentional; if it ever matters, extend the message to `${contrato}:${factura}:${expiresAt}` and add the factura into the HMAC.
- **Rate limiting.** None on the endpoint. CEA's SOAP backend is the real bottleneck.

---

## Configuration

| Env var | Default | Who sets it | Notes |
|---|---|---|---|
| `RECIBO_TOKEN_SECRET` | random 32 bytes (per startup, **insecure across processes**) | `.env` on gcp-cea (and `maria-cea-aws/ecosystem.config.cjs`) | Must match across maria-cea-aws, maria-cea-sdk, maria-cea-sdk-v2. Canonical value in the runbook. |
| `SERVER_BASE_URL` | `https://info-cea.cea-info.workers.dev` | optional override | What gets prepended to the URL handed to customers. Must point at the Worker (or a future replacement). |
| `PORT` | `3000` | per-app `.env` (3004 aws, 3006 sdk, 3014 sdk-v2) | The Worker forwards to whichever port it's hard-coded to. |
| `CEA_PROXY_URL` | none | optional | Used by `fetchWithRetry` for whitelisted-IP routing if needed. |

---

## Where this lives in production

| Component | Host | Port | Process |
|---|---|---|---|
| CF Worker `info-cea` | Cloudflare edge | n/a | deployed via `wrangler` from `info-cea/` |
| Origin (today) | gcp-cea (`34.122.65.54`) | 3006 | pm2 `maria-cea-sdk` (v1) |
| Other agents that can also *sign* URLs | gcp-cea | 3004 / 3014 | pm2 `maria-cea-aws`, `maria-cea-sdk-v2` |
| CEA SOAP backend | `aquacis-cf.ceaqueretaro.gob.mx` | 443 | external |

During the v1 → v2 cutover, **all three Maria processes sign URLs, only v1 (the :3006 origin) verifies and serves them.** This works as long as `RECIBO_TOKEN_SECRET` is identical across the three — which is the fix the runbook captures.

---

## Future-fit notes

A few sharp edges worth tracking:

- **Fail loud on missing secret.** `services/recibo-token.ts:9` silently falls back to a random secret. Replace with `throw` so a missing env breaks startup instead of customer links.
- **Move secret out of `.env`.** It belongs in a vault and is propagated to processes via `ecosystem.config.cjs` (already true for aws, not for sdk/sdk-v2). 1Password entry + ecosystem reference = no per-host drift.
- **Bind factura into the MAC** if/when invoice authorization becomes a concern.
- **CF Worker `fetch()` rewrite.** The TCP-socket proxy is more code than it needs to be — the origin now has a sensible HTTP listener.
- **Per-version Workers** (e.g., `info-cea-v2.workers.dev` → `:3014`) if we ever want sdk-v2 to *serve* PDFs, not just sign URLs. Cheap to add; not needed today.
