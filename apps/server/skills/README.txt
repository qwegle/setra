Local skills catalog for Setra.

- catalog.json is a checked-in snapshot generated from public skills.sh sources.
- The server seeds this catalog into the local DB as global skills on startup.
- Runtime skill library reads from local DB only; no live fetch from skills.sh.

Regenerate:
  node apps/server/scripts/import-skills-catalog.mjs

