## Summary

<!-- One sentence: what does this PR do? -->

## Motivation

<!-- Why does this change exist? Link to an issue if there is one: Closes #N -->

## Changes

<!--
Bullet points, grouped by area if the diff is large.
Focus on *what* changed, not *how* (the diff shows that).
-->

-
-

## Test plan

<!--
How did you verify this works? "I ran pnpm test" is fine for small fixes.
For new features: describe what you added and how to manually exercise it.
-->

- [ ] `pnpm test:ci` passes locally
- [ ] `pnpm --filter @setra/server build` passes
- [ ] `pnpm --filter @setra/board build` passes
- [ ] Manually tested: <!-- describe steps -->

## Model used

<!--
Which AI agent or model authored or assisted this PR?
e.g. "Claude Opus 4.7 via Copilot CLI", "Codex CLI + manual edits", "human only".
-->

## Thinking path

<!--
A short narrative of how the change was reasoned through.
What alternatives were considered? Why this approach? Any trade-offs?
This box helps reviewers learn from each PR and is a Setra hallmark.
-->

## Screenshots / recordings

<!-- Delete this section if not applicable -->

## Checklist

- [ ] I kept the diff focused — one logical change per PR
- [ ] I didn't add new dependencies without discussion
- [ ] Commit messages follow Conventional Commits (`feat(scope): ...`)
- [ ] I updated `CHANGELOG.md` under `[Unreleased]` if user-visible
