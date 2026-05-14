# Security

See also: [SECURITY.md](../../SECURITY.md) for disclosure policy.

## Threat model

Setra runs untrusted-ish CLI subprocesses on the operator's machine. The
threats we model:

1. A malicious or compromised adapter modifies files outside the active project.
2. A malicious adapter exfiltrates secrets from the operator's home directory.
3. A malicious goal description tricks an agent into running destructive
   tool calls.
4. Cross-tenant data leakage in a multi-company deployment.

## Mitigations

### Sandbox

Adapter spawns are wrapped with the host sandbox when
`SETRA_SANDBOX_ENFORCE` is `warn` or `strict`. See
[adapter-sandbox.md](../../docs/security/adapter-sandbox.md) for the
profile and platform support matrix.

### Profile secret scrubbing

`profile.ts`'s save path scrubs anything matching common secret patterns
(API keys, tokens, JWTs, AWS keys) before writing to disk.

### Tenant scoping

`authorizeRunAccess` joins `runs` to `agent_roster` on `company_id` and
returns `404` on mismatch. We return 404 (not 403) so attackers can't
enumerate IDs.

### Hire-agent gate

By default agents cannot hire other agents without board approval. The
202 status code makes this distinction explicit; the UI shows an amber
"awaiting approval" pill.

### Migrations are forward-only

We never re-run a migration. The schema in `@setra/db/migrations` is
append-only. Self-referencing tables use the rename-old-then-create-final
pattern to avoid ON DELETE SET NULL side-effects during FK rebuilds.

## Reporting issues

Email security disclosures to the address listed in [SECURITY.md](../../SECURITY.md).
We commit to a 90-day disclosure window for fixed issues.
