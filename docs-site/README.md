# Setra documentation

This directory is the source for the Setra documentation site. The pages
are plain Markdown so they render on GitHub today; the directory is also
structured for a future static-site build (Docusaurus or Mintlify) without
moving files around.

## Layout

```
docs-site/
├── docs/
│   ├── intro.md
│   ├── quickstart.md
│   ├── architecture.md
│   ├── agents.md
│   ├── adapters.md
│   ├── governance.md
│   ├── cli.md
│   ├── api-reference.md
│   ├── security.md
│   └── faq.md
└── README.md (this file)
```

## Building a site

When we adopt a static-site generator we will:

1. `cd docs-site && npx create-docusaurus@latest . classic --skip-install --typescript`
   (or `npx mintlify-cli init`)
2. Wire the `docs/` directory above as the content source.
3. Add a GitHub Action that runs `docusaurus build` on every push to `dev`
   and deploys to GitHub Pages.

Until then the Markdown files here are the canonical source of truth.

## Contributing

- One topic per file. Use sentence case in titles.
- No emojis (per project standards).
- Cross-link with relative paths (`[See architecture](./architecture.md)`).
- Keep examples runnable.
