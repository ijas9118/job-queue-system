# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repo.

## What this is

A distributed job queue system (learning/portfolio project). Full design docs live in
`docs/` (Obsidian vault) — start at `docs/00-INDEX.md`. Key docs:

- `docs/01-PROJECT-OVERVIEW.md` — goals, scope, scale
- `docs/02-ARCHITECTURE-OVERVIEW.md` — system design
- `docs/ARCHITECTURE/02-Monorepo-Structure.md` — package layout and growth strategy
- `docs/DOCUMENTATION-STATUS.md` — what's decided, latest stack revisions

Docs are the source of truth for architecture/design decisions. Don't re-derive
decisions already made there; read the relevant doc first.

Note: `docs/.superpowers/`, `docs/.obsidian/` are Obsidian vault internals, not part
of this project's spec — ignore them.

## Stack

- pnpm workspace monorepo: `apps/*` (runnable services), `packages/*` (shared libs)
- TypeScript, ESM (`"type": "module"`), Node >=20
- API: Fastify, `tsx` for dev, `tsc` for build, Vitest for tests
- Full stack (as apps are added): BullMQ/Redis (queue), PostgreSQL + Prisma (db),
  Angular (dashboard) — see `docs/TECH-STACK/00-Overview.md`

Packages are earned, not scaffolded upfront — extract a `packages/*` only when a
second consumer genuinely needs the same code (see the monorepo structure doc).

## Commands

```bash
pnpm install          # install everything
pnpm dev:api          # run apps/api in watch mode
pnpm --filter api run test
pnpm --filter api run build
```

## Conventions

- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/),
  **all lowercase** (including the subject), no trailing period.
  Example: `feat: scaffold pnpm workspace and fastify api app`
- **Never add a `Co-Authored-By` trailer** to commit messages in this repo.
- Follow existing patterns in `apps/api` when adding new apps/packages
  (factory function for app setup, routes as Fastify plugins, tests in `__tests__/`).
