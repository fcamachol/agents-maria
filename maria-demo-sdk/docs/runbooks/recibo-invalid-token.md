# Runbook: Recibo URL returns `Invalid or expired token`

**Last incident:** 2026-05-14 — sdk-v2 deploy, see `Incident log` below.
**Severity:** Customer-facing — recibo download links are broken.
**Time to fix:** ~5 minutes once diagnosed.

> For how the feature itself works (architecture, security model, components), see [`../features/recibo-download.md`](../features/recibo-download.md).

---

## Symptom

Customer (or internal tester) opens a recibo URL like:

```
https://info-cea.cea-info.workers.dev/recibo/<contrato>?token=<hex>&expires=<ms>&factura=<n>
```

…and gets:

```json
HTTP/2 403
{"error":"Invalid or expired token"}
```

The 403 is raised by `maria-cea-sdk-v2/src/server.ts:69` (and the equivalent in sdk-v1 / aws). It only happens when HMAC verification fails or `expires` is in the past.

---

## Architecture (why this happens)

```
Maria agent (any of v1 / v2 / aws)
   │ generateReciboToken(contrato, expiresAt)  ── HMAC-SHA256, key = RECIBO_TOKEN_SECRET
   ▼
URL handed to customer
   │
   ▼
Cloudflare Worker (info-cea.cea-info.workers.dev)
   └── hard-codes origin = 34.122.65.54:3006   (info-cea/src/index.js)
        │
        ▼
gcp-cea process listening on :3006 ── currently `maria-cea-sdk` (v1)
        │ verifyReciboToken(contrato, token, expires)  ── HMAC-SHA256, key = RECIBO_TOKEN_SECRET
        ▼
SOAP fetch → PDF
```

**Key invariant:** every process that *signs* a token and every process that *verifies* one must use the **same** `RECIBO_TOKEN_SECRET`. If unset, the code falls back to `crypto.randomBytes(32)` per process — see `services/recibo-token.ts:9`. Different process = different random key = signature mismatch.

**Canonical secret (production):**

```
RECIBO_TOKEN_SECRET=ce983fa48ee73949da8b06dc8b0ca2d8e3f5d3457707da6af4ac8bb66672dce9
```

Source of truth: `maria-cea-aws/ecosystem.config.cjs` on gcp-cea (used by `maria-cea-aws` pm2 app).

---

## Diagnose (60 seconds)

SSH to gcp-cea, then:

```bash
# 1. Which process owns port 3006? (= the verifier the worker hits)
sudo ss -tlnp | grep -E ":3004|:3006|:3014"

# 2. What pm2 apps exist + their PIDs
pm2 list

# 3. Is RECIBO_TOKEN_SECRET set in pm2's env snapshot for the suspect process?
#    NOTE: this only catches pm2-supplied env. Apps using dotenv inject from .env
#    AFTER startup, so /proc/<pid>/environ may not show the var even when it's loaded.
sudo cat /proc/<PID>/environ | tr '\0' '\n' | grep RECIBO

# 4. Confirm it's in the .env (definitive)
grep RECIBO /home/fcamacholombardo/maria-cea-sdk/.env
grep RECIBO /home/fcamacholombardo/maria-cea-sdk-v2/.env

# 5. End-to-end signature check — proves the verifier loaded the expected secret.
#    A 403 means mismatch. A 404/500 means token OK but downstream failed (= fixed).
SECRET="ce983fa48ee73949da8b06dc8b0ca2d8e3f5d3457707da6af4ac8bb66672dce9"
EXPIRES=$(( $(date +%s) * 1000 + 3600000 ))
TOKEN=$(printf "%s:%s" "000000" "$EXPIRES" | openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}')
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://info-cea.cea-info.workers.dev/recibo/000000?token=${TOKEN}&expires=${EXPIRES}&factura=test"
# 403 → secret on the :3006 process is wrong
# 404 → secret OK (SOAP failed on fake contrato, which is expected)
```

---

## Fix

The fix is to ensure every process in the loop shares the canonical secret.

```bash
# On gcp-cea
SECRET="ce983fa48ee73949da8b06dc8b0ca2d8e3f5d3457707da6af4ac8bb66672dce9"

# Backup first
cp /home/fcamacholombardo/maria-cea-sdk/.env    /home/fcamacholombardo/maria-cea-sdk/.env.bak-$(date +%Y%m%d-%H%M%S)
cp /home/fcamacholombardo/maria-cea-sdk-v2/.env /home/fcamacholombardo/maria-cea-sdk-v2/.env.bak-$(date +%Y%m%d-%H%M%S)

# Append (only if not already present)
grep -q '^RECIBO_TOKEN_SECRET=' /home/fcamacholombardo/maria-cea-sdk/.env    || echo "RECIBO_TOKEN_SECRET=$SECRET" >> /home/fcamacholombardo/maria-cea-sdk/.env
grep -q '^RECIBO_TOKEN_SECRET=' /home/fcamacholombardo/maria-cea-sdk-v2/.env || echo "RECIBO_TOKEN_SECRET=$SECRET" >> /home/fcamacholombardo/maria-cea-sdk-v2/.env

# Restart so dotenv re-reads
pm2 restart maria-cea-sdk maria-cea-sdk-v2 --update-env

# Verify with the curl from step 5 above. Expect 404 (not 403).
```

### Side effect (always communicate this)

Restarting the verifier process invalidates any recibo URL it had signed with its previous (random) secret. Customer impact window = the recibo URL expiry (currently **48h**, see `tools/cea-api.ts:521`). Tell the support channel; customers who reopen a stale link must ask Maria for a fresh one.

---

## Rollback

```bash
# Restore the .env backups created above (timestamped):
ls /home/fcamacholombardo/maria-cea-sdk/.env.bak-*
ls /home/fcamacholombardo/maria-cea-sdk-v2/.env.bak-*

cp <backup> /home/fcamacholombardo/maria-cea-sdk/.env
cp <backup> /home/fcamacholombardo/maria-cea-sdk-v2/.env
pm2 restart maria-cea-sdk maria-cea-sdk-v2 --update-env
```

Rolling back returns each process to a random per-startup secret — recibo URLs will only work within the same process (current behavior pre-fix). Only roll back if the new secret was wrong.

---

## How this gets re-triggered

Any of these brings the bug back:

1. **New deploy of sdk/sdk-v2** that ships without `RECIBO_TOKEN_SECRET` in its `.env` (or `ecosystem.config.cjs`).
2. **Repointing the Cloudflare worker** (`info-cea/src/index.js`) to a new origin port whose process doesn't carry the secret.
3. **Rotating the secret on one process** but not the others.
4. **Replacing the worker** with a per-version host (e.g., `info-cea-v2.workers.dev` → `:3014`) without propagating the secret.

### Permanent prevention (not yet done)

- Move `RECIBO_TOKEN_SECRET` from `.env` into each app's `ecosystem.config.cjs` `env` block so a fresh `pm2 start` from scratch carries it. Today only `maria-cea-aws/ecosystem.config.cjs` does this.
- Remove the silent random fallback in `services/recibo-token.ts:9`. Replace with `throw new Error("RECIBO_TOKEN_SECRET required")` so a missing env fails loud at startup instead of silently breaking links.
- Document the canonical secret in 1Password / shared vault, not just in this runbook.

---

## Reference: files touched by this system

| File | Purpose |
|---|---|
| `maria-cea-sdk-v2/src/services/recibo-token.ts` | HMAC sign/verify + default `SERVER_BASE_URL`. Same shape in sdk v1 + aws. |
| `maria-cea-sdk-v2/src/server.ts` (`GET /recibo/:contrato`) | Verifier endpoint. Returns 403 on mismatch. |
| `maria-cea-sdk-v2/src/tools/cea-api.ts` (~line 520) | URL generation (`generateReciboToken` + 48h expiry). |
| `info-cea/src/index.js` | Cloudflare Worker proxy. `ORIGIN_HOST/PORT` hard-coded. |
| `maria-cea-aws/ecosystem.config.cjs` | Canonical secret source. |
| `/home/fcamacholombardo/maria-cea-sdk/.env` (gcp-cea) | sdk v1 runtime env. |
| `/home/fcamacholombardo/maria-cea-sdk-v2/.env` (gcp-cea) | sdk-v2 runtime env. |

| Port | Process | Role |
|---|---|---|
| 3004 | `maria-cea-aws` | Production agent (current customer traffic). |
| 3006 | `maria-cea-sdk` | v1 agent. **Cloudflare worker forwards `/recibo/*` here.** |
| 3014 | `maria-cea-sdk-v2` | v2 agent (migration target). Generates URLs but doesn't yet receive recibo traffic. |

---

## Incident log

### 2026-05-14 — sdk-v2 URLs returning 403

- **Symptom:** Users got recibo links from sdk-v2 (port 3014); opening them returned `403 Invalid or expired token`.
- **Root cause:** Neither sdk nor sdk-v2 had `RECIBO_TOKEN_SECRET` set on gcp-cea. Each process used a random per-startup secret. sdk-v2 signed → Cloudflare → sdk v1 verified with a different random key → mismatch.
- **Fix:** Appended canonical secret to both `.env` files on gcp-cea + `pm2 restart --update-env`. Verified end-to-end with the openssl-signed curl above (response went from 403 → 404).
- **Outstanding:** Permanent prevention items above. Worker still hard-coded to `:3006`, so sdk-v2's recibo HTTP path is never exercised — fine while v1 is the canonical verifier; revisit during cutover.
