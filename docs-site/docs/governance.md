# Governance

Setra is enterprise-shaped. Anything that costs money, hires people, or
modifies the org chart is **gated** — either by an explicit board approval
record or by a deterministic policy check.

## Hire approval

When an agent calls the `hire_agent` tool:

- If the company's `auto_approve_hires` policy is `true`, the hire goes
  through immediately and the API returns `200`.
- Otherwise, a `hire_request` record is created with status `pending` and
  the API returns `202`. The board's Approvals tab surfaces these.

The HireAgentModal distinguishes 200 vs 202 and shows the operator an
amber "Awaiting board approval" notice for the 202 path. This fixed the
"CEO cannot hire agents" complaint from the CLI-only pivot.

## Sandbox

Adapter spawns can be wrapped with the host's process sandbox. See
[../docs/security/adapter-sandbox.md](../../docs/security/adapter-sandbox.md)
for the SETRA_SANDBOX_ENFORCE flag.

## Profile distillation

After every successful run, `distillProfileFromRun` scans the agent
output for stable operator facts and updates `~/.setra/profile.json`.
Secrets are scrubbed before persistence.

## Loop detector and reflection

`LoopDetector` watches the live tool-call stream; when it detects N
repeated calls or an error streak, it injects a "you appear stuck —
consider replan" hint and calls `reflect_and_replan` which writes a
new plan record.
