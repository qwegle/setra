# setra Enterprise Cloud Setup (Cloud-only SaaS)

This setup is for **private enterprise web deployment** with **cloud model providers only**.

## 1. What this mode does

- Uses setra API + cloud infrastructure services
- Disables local-LLM dependency in deployment architecture
- Supports private web portal access control
- Uses better-auth endpoints for session/API-key auth

## 2. Prerequisites

- Docker + Docker Compose
- Domain and TLS reverse proxy (recommended: NGINX/Traefik)
- Cloud model provider keys (Anthropic/OpenAI/GCP Vertex/Azure/Bedrock)

## 3. Environment setup

```bash
cp infra/.env.example infra/.env.enterprise
```

Set required secrets in `infra/.env.enterprise`:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `NATS_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `BETTER_AUTH_SECRET`
- `JWT_RS256_PRIVATE_KEY`
- `JWT_RS256_PUBLIC_KEY`
- `SETRA_BASE_URL`
- `INTERNAL_API_SECRET`
- `RUNNER_API_SECRET`

Recommended private web settings:

```env
SETRA_PRIVATE_PORTAL=true
SETRA_PORTAL_ACCESS_KEY=<long-random-secret>
```

## 4. Deploy

```bash
bash scripts/deploy-enterprise-cloud.sh infra/.env.enterprise
```

## 5. Private portal access

- Landing page: `https://<your-domain>/`
- Enterprise app: `https://<your-domain>/app`
- If private mode is enabled, send header:
  - `x-setra-access-key: <SETRA_PORTAL_ACCESS_KEY>`

## 6. Auth model

setra API uses better-auth:

- session-based auth via `/api/auth/*`
- API-key access for service automation
- tRPC procedures protected by role/org/plan middleware

Recommended enterprise auth pattern:

1. Use SSO (SAML/OIDC) through better-auth provider config
2. Restrict user provisioning to approved domains
3. Enforce org-role mapping (`owner/admin/member`)
4. Keep API keys scoped and rotated

## 7. Cloud-only policy guidance

Enforce cloud-only providers in policy/governance config:

- allow: Anthropic/OpenAI/GCP/Azure/AWS Bedrock
- disallow: Ollama/local providers in enterprise web mode

Operational controls:

- outbound network allow-list for approved provider endpoints
- audit logs for model selection and tool usage
- budget caps for org/team usage

## 8. Make deployment private (not public internet)

Recommended:

- put API behind VPN or private network
- lock ingress by IP allow-list
- require SSO at reverse proxy layer
- keep `/app` protected with portal key + SSO
- disable unauthenticated signup routes

## 9. Post-deploy checks

```bash
bash scripts/verify-platform.sh
curl -f https://<your-domain>/health
curl -f https://<your-domain>/api/health
```

## 10. Landing page/live links

Landing page includes:

- GitHub repo link
- Download/install instructions
- Enterprise web portal entry
