# Job Queue System

A distributed job queue system built with TypeScript, Fastify, BullMQ, PostgreSQL, and Redis. Supports job scheduling, retries with exponential backoff, dead-letter queues, audit trails, and real-time dashboards. Designed for learning and as a portfolio project demonstrating system design patterns at scale.

## Prerequisites

- Node.js 22+ (or use `nvm install` with `.nvmrc`)
- pnpm 10+ (`npm install -g pnpm`)
- Docker & Docker Compose (for local PostgreSQL, Redis, Mailpit)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start stateful services (Postgres, Redis, Mailpit)
docker compose up -d
```

The API, Worker, and Dashboard apps arrive in M3. For now, stateful services are ready at:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Mailpit: `http://localhost:8025` (email testing)

## Documentation

- **[Architecture Overview](docs/02-ARCHITECTURE-OVERVIEW.md)** — System design and data flow
- **[Project Overview](docs/01-PROJECT-OVERVIEW.md)** — Goals, scope, and features
- **[Local Development Setup](docs/DEPLOYMENT/01-Local-Development.md)** — Detailed setup and troubleshooting
- **[Architecture Decision Records (ADRs)](docs/adr/)** — Design decisions and rationale
- **[Full Documentation Index](docs/00-INDEX.md)** — All docs organized by topic

## Commands

**Workspace & Packages (available now):**

- `pnpm build` — Build all packages
- `pnpm test` — Run all tests
- `pnpm lint` — Lint all code
- `pnpm format` — Format all code

**Apps (available in M3):**

- `pnpm dev` — Run all apps in watch mode
- `pnpm dev:api` — Run API server with hot reload
- `pnpm dev:worker` — Run worker with hot reload
- `pnpm dev:dashboard` — Run dashboard with hot reload

## Project Structure

```
apps/
  api/           API service (Fastify)
  worker/        Worker service (job processing)

packages/
  shared/        Shared types and utilities
  config/        Configuration utilities

docs/
  00-INDEX.md    Documentation index
  adr/           Architecture decision records
  DEPLOYMENT/    Deployment guides
  DATABASE/      Database schema docs
  PATTERNS/      Implementation patterns
```

## Technologies

- **Runtime**: Node.js 22, TypeScript, ESM
- **API**: Fastify
- **Queue**: BullMQ (Redis-backed)
- **Database**: PostgreSQL + Prisma
- **Testing**: Vitest
- **Code Quality**: ESLint, Prettier, TypeScript strict mode
- **CI/CD**: GitHub Actions
- **Local Dev**: Docker Compose (Postgres, Redis, Mailpit)

## Development

See [Local Development Setup](docs/DEPLOYMENT/01-Local-Development.md) for detailed instructions on:

- Starting services with Docker Compose
- Running apps locally with hot reload
- Database migrations
- Testing
- Debugging

## License

This is a learning/portfolio project.
