# Monorepo Structure

## Package Growth Strategy

Packages should be earned, not scaffolded on day one. Starting with a package per concern (`auth`, `handlers`, `logger`, `metrics`, `queue`, `database`, `config`, `shared`) looks organized, but it's easy to end up building "microservices architecture inside a monorepo" for code that only one app ever imports. Good architecture is clear boundaries, not maximum package count.

**Start with**:
```
apps/
├── api/
├── worker/
└── dashboard/

packages/
├── database/   # both api and worker need this from day one
├── queue/      # both api and worker need this from day one
├── shared/     # types used everywhere
└── config/     # env loading used everywhere
```

**Extract into a package only when a second consumer needs the identical code** — not preemptively:
- `auth/` — starts as `apps/api/src/auth/` (JWT + RBAC). Extract to `packages/auth` only if the worker or another service genuinely needs to verify tokens too.
- `handlers/` — starts as `apps/worker/src/handlers/`. Extract only if the API needs the same job-payload Zod schemas for pre-validation before enqueueing.
- `logger/`, `metrics/` — in this project both api and worker do need consistent structured logging and metrics from early on, so extracting these two is justified sooner than `auth`/`handlers`. The test either way is "does a second real consumer exist," not "does this feel like it should be reusable."

The tree below documents the **fully grown** structure — the end state once packages have actually been extracted for a real reason, not the recommended day-1 scaffold.

## Complete Project Structure

```
job-queue-system/                    # Root monorepo
│
├── apps/                            # Applications (runnable services)
│   │
│   ├── api/                         # Fastify API service
│   │   ├── src/
│   │   │   ├── index.ts            # Server entry point
│   │   │   ├── app.ts              # Fastify instance setup
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts         # JWT verification (onRequest hook)
│   │   │   │   ├── errorHandler.ts # setErrorHandler
│   │   │   │   ├── swagger.ts      # OpenAPI + Swagger UI registration
│   │   │   │   └── logging.ts      # Fastify's built-in Pino logger config
│   │   │   ├── routes/
│   │   │   │   ├── jobs.ts         # Job endpoints
│   │   │   │   ├── admin.ts        # Admin endpoints
│   │   │   │   └── health.ts       # Health check
│   │   │   ├── handlers/
│   │   │   │   └── wsHandler.ts    # WebSocket handler
│   │   │   ├── services/
│   │   │   │   ├── jobService.ts   # Job business logic
│   │   │   │   ├── workerService.ts # Worker stats
│   │   │   │   └── metricsService.ts
│   │   │   ├── types.ts             # API types
│   │   │   └── config.ts            # Config loading
│   │   ├── __tests__/
│   │   │   ├── routes.test.ts
│   │   │   └── middleware.test.ts
│   │   ├── .env.example
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── worker/                      # Job processing worker
│   │   ├── src/
│   │   │   ├── index.ts            # Worker entry point
│   │   │   ├── processor.ts        # Main job processor
│   │   │   ├── retryStrategy.ts    # Retry logic
│   │   │   ├── gracefulShutdown.ts # SIGTERM handling
│   │   │   ├── handlers/           # Specific job handlers
│   │   │   │   ├── index.ts        # Handler registry
│   │   │   │   ├── sendEmail.ts    # Email job handler
│   │   │   │   ├── processVideo.ts # Video job handler
│   │   │   │   └── generateReport.ts
│   │   │   ├── types.ts
│   │   │   └── config.ts
│   │   ├── __tests__/
│   │   │   ├── processor.test.ts
│   │   │   └── retryStrategy.test.ts
│   │   ├── .env.example
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   └── dashboard/                   # Angular frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── pages/
│       │   │   │   ├── dashboard/       # Main dashboard
│       │   │   │   ├── job-detail/      # Job detail view
│       │   │   │   ├── workers/         # Worker monitoring
│       │   │   │   ├── dlq/             # Dead-letter queue
│       │   │   │   └── admin/           # Admin panel
│       │   │   ├── components/
│       │   │   │   ├── job-form/
│       │   │   │   ├── job-status-badge/
│       │   │   │   ├── progress-bar/
│       │   │   │   ├── worker-card/
│       │   │   │   ├── queue-stats/
│       │   │   │   └── log-viewer/
│       │   │   ├── services/
│       │   │   │   ├── jobs.service.ts    # Job queries (RxJS)
│       │   │   │   ├── socket.service.ts  # WebSocket connection
│       │   │   │   ├── auth.service.ts    # Auth state
│       │   │   │   └── metrics.service.ts
│       │   │   ├── interceptors/
│       │   │   │   ├── auth.interceptor.ts
│       │   │   │   └── error.interceptor.ts
│       │   │   ├── guards/
│       │   │   │   └── auth.guard.ts
│       │   │   ├── app.component.ts       # Root component
│       │   │   ├── app.routes.ts          # Lazy-loaded routes
│       │   │   └── app.config.ts          # App-wide providers
│       │   └── styles.scss                # Tailwind imports
│       ├── public/
│       │   └── index.html
│       ├── e2e/                     # Playwright specs
│       │   └── job-success.spec.ts
│       ├── .env.example
│       ├── package.json
│       ├── tsconfig.json
│       ├── angular.json             # Angular CLI config
│       └── tailwind.config.js       # Tailwind config
│
├── packages/                        # Shared libraries (not runnable)
│   │
│   ├── queue/                       # BullMQ wrapper
│   │   ├── src/
│   │   │   ├── index.ts            # Public exports
│   │   │   ├── queue.ts            # Queue class
│   │   │   ├── retry.ts            # Retry logic
│   │   │   ├── events.ts           # Event emission
│   │   │   └── types.ts
│   │   ├── __tests__/
│   │   │   └── queue.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── database/                    # Prisma ORM
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Database schema
│   │   │   ├── migrations/         # Migration files
│   │   │   │   └── migration_lock.toml
│   │   │   └── seed.ts             # Seed script (optional)
│   │   ├── src/
│   │   │   └── index.ts            # Prisma client export
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── auth/                        # Authentication & Authorization
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── jwt.ts              # Token generation/validation
│   │   │   ├── rbac.ts             # Permission checking
│   │   │   ├── plugin.ts           # Fastify plugin (onRequest/preHandler hooks)
│   │   │   ├── types.ts
│   │   │   └── config.ts
│   │   ├── __tests__/
│   │   │   ├── jwt.test.ts
│   │   │   └── rbac.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── handlers/                    # Job handler registry
│   │   ├── src/
│   │   │   ├── index.ts            # Public exports
│   │   │   ├── registry.ts         # Handler registry class
│   │   │   ├── types.ts            # Handler interface
│   │   │   ├── schema.ts           # Zod schemas
│   │   │   ├── handlers/           # Individual handlers
│   │   │   │   ├── index.ts        # Export all handlers
│   │   │   │   ├── sendEmail.ts
│   │   │   │   ├── processVideo.ts
│   │   │   │   └── generateReport.ts
│   │   │   └── config.ts
│   │   ├── __tests__/
│   │   │   └── registry.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── logger/                      # Pino logging
│   │   ├── src/
│   │   │   ├── index.ts            # Logger creation
│   │   │   ├── transports.ts       # Log transports
│   │   │   └── config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── metrics/                     # Observability metrics
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── collectors.ts       # Metric collectors
│   │   │   └── types.ts
│   │   ├── __tests__/
│   │   │   └── metrics.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── config/                      # Environment configuration
│   │   ├── src/
│   │   │   ├── index.ts            # Config loader
│   │   │   ├── schema.ts           # Zod validation schema
│   │   │   └── defaults.ts
│   │   ├── __tests__/
│   │   │   └── config.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                      # Common types & utilities
│       ├── src/
│       │   ├── index.ts            # Public exports
│       │   ├── types.ts            # Shared type definitions
│       │   ├── errors.ts           # Custom error classes
│       │   ├── utils.ts            # Utility functions
│       │   └── constants.ts        # Constants
│       ├── __tests__/
│       │   └── utils.test.ts
│       ├── package.json
│       └── tsconfig.json
│
├── Configuration Files
│   ├── docker-compose.yml           # Local dev environment
│   ├── package.json                 # Root workspace config
│   ├── pnpm-workspace.yaml          # pnpm workspace definition
│   ├── tsconfig.json                # Root TS config
│   ├── tsconfig.base.json           # Base TS config (references)
│   ├── vitest.config.ts             # Root Vitest config
│   └── .env.example                 # Example env vars
│
└── Documentation
    ├── 00-INDEX.md
    ├── 01-PROJECT-OVERVIEW.md
    ├── 02-ARCHITECTURE-OVERVIEW.md
    ├── ARCHITECTURE/
    ├── COMPONENTS/
    ├── DATABASE/
    ├── JOB-LIFECYCLE/
    ├── API/
    ├── WEBSOCKET/
    ├── PATTERNS/
    ├── TECH-STACK/
    ├── DEPLOYMENT/
    └── TESTING/
```

## Workspace Configuration

### Root package.json

```json
{
  "name": "job-queue-system",
  "version": "1.0.0",
  "private": true,
  "description": "Distributed job queue system",
  "packageManager": "pnpm@<current stable>",
  "pnpm": {
    "workspaces": [
      "apps/*",
      "packages/*"
    ]
  },
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "dev:api": "pnpm --filter api run dev",
    "dev:worker": "pnpm --filter worker run dev",
    "dev:dashboard": "pnpm --filter dashboard run dev",
    "dev:services": "pnpm -r --filter './apps/**' --parallel run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "test:watch": "pnpm -r run test:watch",
    "lint": "pnpm -r run lint",
    "db:migrate": "pnpm --filter database run migrate",
    "db:reset": "pnpm --filter database run reset",
    "db:seed": "pnpm --filter database run seed"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'

catalogs:
  default:
    # Pin to whatever the current stable release is at implementation time —
    # exact numbers belong in the lockfile, not hardcoded in docs.
    fastify: ^<current>
    "@angular/core": ^<current>
    redis: ^<current>
    bullmq: ^<current>
    prisma: ^<current>
    pino: ^<current>
    zod: ^<current>
    vitest: ^<current>
    "@playwright/test": ^<current>
```

## Dependency Structure

```
apps/api/
  ├── depends on: packages/auth
  ├── depends on: packages/database
  ├── depends on: packages/queue
  ├── depends on: packages/logger
  ├── depends on: packages/metrics
  ├── depends on: packages/config
  └── depends on: packages/shared

apps/worker/
  ├── depends on: packages/queue
  ├── depends on: packages/database
  ├── depends on: packages/handlers
  ├── depends on: packages/logger
  ├── depends on: packages/metrics
  ├── depends on: packages/config
  └── depends on: packages/shared

apps/dashboard/
  ├── depends on: packages/config (frontend config)
  └── depends on: packages/shared (types)

packages/queue/
  ├── depends on: packages/logger
  └── depends on: packages/config

packages/auth/
  ├── depends on: packages/shared
  └── depends on: packages/config

packages/handlers/
  ├── depends on: packages/shared
  └── depends on: packages/config

packages/database/
  └── depends on: packages/shared

Other packages/ have minimal external dependencies
```

## Development Workflow

### Install Dependencies

```bash
# Install all dependencies across workspace
pnpm install

# Install in specific package
pnpm --filter api install axios
```

### Development

```bash
# Start all services
pnpm dev

# Start individual service
pnpm dev:api
pnpm dev:worker
pnpm dev:dashboard

# Run in watch mode
pnpm test:watch
```

### Building

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter api run build
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Test specific package
pnpm --filter api run test
```

## File Naming Conventions

- **Angular components/services**: kebab-case with type suffix (`job-form.component.ts`, `jobs.service.ts`) — Angular CLI convention
- **Backend utilities**: camelCase (`jobService.ts`)
- **Types**: PascalCase or interfaces (Job, JobConfig)
- **Constants**: UPPER_SNAKE_CASE (MAX_RETRIES)
- **Test files**: `*.test.ts` (Vitest), `*.spec.ts` (Playwright E2E)

## Import Paths

Use workspace imports:

```typescript
// ✅ Good
import { JobQueue } from '@job-queue/queue';
import { PrismaClient } from '@job-queue/database';
import { authorize } from '@job-queue/auth';
import { logger } from '@job-queue/logger';

// ❌ Avoid
import { JobQueue } from '../../../packages/queue/src/queue';
```

Configure in tsconfig.json:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@job-queue/queue": ["packages/queue/src"],
      "@job-queue/database": ["packages/database/src"],
      "@job-queue/auth": ["packages/auth/src"],
      "@job-queue/handlers": ["packages/handlers/src"],
      "@job-queue/logger": ["packages/logger/src"],
      "@job-queue/metrics": ["packages/metrics/src"],
      "@job-queue/config": ["packages/config/src"],
      "@job-queue/shared": ["packages/shared/src"]
    }
  }
}
```

## Related Documentation

- [[02-ARCHITECTURE-OVERVIEW]] - System architecture
- [[ARCHITECTURE/01-HLD]] - High-level design
- [[COMPONENTS]] - Component details
- [[DEPLOYMENT/02-Docker-Compose]] - Docker setup
