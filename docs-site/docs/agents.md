# Agent development

Agents in Setra are configuration, not code. An agent has a slug, a role, a
system-prompt template, a list of tools it can call, and a model/adapter
binding.

## Anatomy

```ts
{
  slug: "test-engineer",
  role: "engineer",
  description: "Writes unit and integration tests for the active repo.",
  systemPromptTemplate: "You are a senior test engineer ...",
  tools: ["read_file", "write_file", "run_tests", "recall_prior_runs"],
  adapter: "auto",          // or "claude" / "codex" / etc.
  company_id: "...",
}
```

## Built-in roles

CEO, engineer, designer, researcher, test-engineer, devops, security,
support, salesperson, project-manager, generalist.

## Lifecycle hooks

- `onRunStarted` — log + emit SSE; load profile.
- `onRunCompleted` — distill profile, write reflection, score skills,
  promote successful skills to the wiki.

## Tools

Each tool is a typed function with an input schema. The runner validates
inputs, executes the tool, and feeds the result back to the model.

### Cross-run memory

- `recall_prior_runs(query)` — search the memory store + reflections for
  past runs matching the query.
- `reflect_and_replan(reason)` — explicit replan trigger; opens a new
  plan record.

## Promotion to wiki

When a skill executes successfully N times with positive scores, the
wiki promoter pulls its tags and writes a `wiki/skills/<tag>.md` entry
linking the successful runs. Wikilinks + backlinks make the wiki
self-organizing.
