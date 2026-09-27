# Environment Variables

All environment variables for every service in the monorepo. Copy `.env.example` at the root of each app and fill in values before starting.

---

## Quick Reference

| Variable | Service | Required | Default |
|----------|---------|----------|---------|
| `DATABASE_URL` | API, Worker | Yes | — |
| `REDIS_URL` | API, Worker | Yes | — |
| `JWT_SECRET` | API | Yes | — |
| `NODE_ENV` | All | Yes | `development` |
| `API_PORT` | API | No | `3000` |
| `JWT_ACCESS_EXPIRY` | API | No | `900` |
| `JWT_REFRESH_EXPIRY` | API | No | `604800` |
| `ARGON2_MEMORY_COST` | API | No | `19456` (19 MiB) |
| `ARGON2_TIME_COST` | API | No | `2` |
| `ARGON2_PARALLELISM` | API | No | `1` |
| `RATE_LIMIT_MAX_REQUESTS` | API | No | `1000` |
| `RATE_LIMIT_WINDOW` | API | No | `900` |
| `WS_CORS_ORIGIN` | API | No | `http://localhost:3001` |
| `LOG_LEVEL` | API, Worker | No | `info` |
| `WORKER_CONCURRENCY` | Worker | No | `5` |
| `WORKER_HEARTBEAT_TIMEOUT_MS` | API, Worker | No | `60000` |
| `GRACEFUL_SHUTDOWN_TIMEOUT` | Worker | No | `30000` |

> **Dashboard config is not env vars.** Angular bakes `apiUrl`/`wsUrl` into the build via `src/environments/environment.ts` (dev) and `environment.prod.ts` (prod) — see the Angular Frontend section below.

---

## `apps/api` — API Service

### `.env.example`

```bash
# ── Infrastructure ────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/jobqueue
REDIS_URL=redis://localhost:6379

# ── Server ────────────────────────────────────────────────────
NODE_ENV=development
API_PORT=3000

# ── Auth ──────────────────────────────────────────────────────
JWT_SECRET=                        # REQUIRED — min 32 chars, see below
JWT_ACCESS_EXPIRY=900              # seconds — 15 minutes
JWT_REFRESH_EXPIRY=604800          # seconds — 7 days

# ── Security ──────────────────────────────────────────────────
ARGON2_MEMORY_COST=19456           # KiB — OWASP minimum recommendation (19 MiB)
ARGON2_TIME_COST=2
ARGON2_PARALLELISM=1
WS_CORS_ORIGIN=http://localhost:3001

# ── Rate Limiting ─────────────────────────────────────────────
RATE_LIMIT_MAX_REQUESTS=1000       # requests per window
RATE_LIMIT_WINDOW=900              # seconds — 15 minutes

# ── Workers ───────────────────────────────────────────────────
WORKER_HEARTBEAT_TIMEOUT_MS=60000  # ms — stale threshold for GET /admin/workers

# ── Logging ───────────────────────────────────────────────────
LOG_LEVEL=info
```

### Variable Descriptions

#### `DATABASE_URL`

PostgreSQL connection string. Format: `postgresql://<user>:<password>@<host>:<port>/<dbname>`

```bash
# Local
DATABASE_URL=postgresql://postgres:password@localhost:5432/jobqueue

# Production (RDS example)
DATABASE_URL=postgresql://appuser:secret@db.internal:5432/jobqueue?sslmode=require
```

Add `?sslmode=require` in production. Never use the root `postgres` user in production — create a dedicated app user with restricted permissions.

---

#### `REDIS_URL`

Redis connection string. Format: `redis://<host>:<port>` or `rediss://` for TLS.

```bash
# Local
REDIS_URL=redis://localhost:6379

# Production (ElastiCache example)
REDIS_URL=rediss://clustercfg.jobqueue.abc123.use1.cache.amazonaws.com:6379
```

Use `rediss://` (double-s) for TLS connections in production.

---

#### `JWT_SECRET`

Signs and verifies access tokens. Must be at least 32 characters. Treat like a password — never commit to source control, never log.

Generate a secure value:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Rotating this value invalidates **all existing access tokens immediately** — every user is logged out. Plan rotations with `JWT_SECRET_LEGACY` support if needed (not implemented by default).

---

#### `JWT_ACCESS_EXPIRY`

Access token lifetime in **seconds**. Default `900` (15 minutes).

Shorter = more secure, more refresh calls. Longer = fewer refreshes, longer exposure window if a token is stolen. 15 minutes is the industry standard for most web apps.

---

#### `JWT_REFRESH_EXPIRY`

Refresh token lifetime in **seconds**. Default `604800` (7 days).

After this period the user must log in again with email + password. Stored as `expiresAt` in the `refresh_tokens` table — expired rows are cleaned up daily by the worker cron job.

---

#### `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`

Argon2id cost parameters for password hashing. Defaults (`19456` KiB memory, `2` iterations, `1` thread) follow OWASP's minimum recommendation for Argon2id.

Higher memory cost = more resistant to GPU/ASIC brute-forcing (Argon2id's whole point, unlike bcrypt which is compute-only) but more RAM used per concurrent login. Do not go below the OWASP minimums in production.

---

#### `WS_CORS_ORIGIN`

Allowed origin for WebSocket (Socket.IO) connections. Default `http://localhost:3001`.

In production, set to your dashboard domain: `https://dashboard.yourdomain.com`. Accepts a comma-separated list for multiple origins.

---

#### `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_WINDOW`

Global rate limit applied to all API routes. Default: 1000 requests per 900 seconds (15 minutes) per IP.

Auth endpoints have stricter per-route limits applied in code regardless of these values — see [[API/01-Authentication]].

---

#### `WORKER_HEARTBEAT_TIMEOUT_MS`

How long without a heartbeat before a worker is marked `healthy: false` in `GET /admin/workers`. Default `60000` (60 seconds).

The worker sends a heartbeat at half this interval (`WORKER_HEARTBEAT_TIMEOUT_MS / 2`) to avoid false positives at the boundary. Both the API and the worker must use the same value.

---

#### `LOG_LEVEL`

Controls log verbosity. Accepted values: `error`, `warn`, `info`, `debug`.

| Level | Use in |
|-------|--------|
| `error` | Production — only errors and critical events |
| `warn` | Staging — errors + warnings |
| `info` | Default — errors, warnings, and request lifecycle |
| `debug` | Local development — verbose, includes SQL queries |

Never use `debug` in production — it logs request payloads and can leak sensitive data.

---

## `apps/worker` — Worker Service

### `.env.example`

```bash
# ── Infrastructure ────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/jobqueue
REDIS_URL=redis://localhost:6379

# ── Worker ────────────────────────────────────────────────────
NODE_ENV=development
WORKER_CONCURRENCY=5
WORKER_HEARTBEAT_TIMEOUT_MS=60000  # must match API value
GRACEFUL_SHUTDOWN_TIMEOUT=30000    # ms — time to finish active jobs on SIGTERM

# ── Logging ───────────────────────────────────────────────────
LOG_LEVEL=info
```

### Variable Descriptions

#### `WORKER_CONCURRENCY`

How many jobs this worker instance processes in parallel. Default `5`.

Higher concurrency increases throughput but also memory and CPU usage. Each worker instance is independent — running 3 workers with `WORKER_CONCURRENCY=5` gives an effective concurrency of 15.

Tune based on job type:
- I/O-bound jobs (SMTP, HTTP calls): higher concurrency (10–20) is fine
- CPU-bound jobs (image processing, encryption): keep at or below CPU core count

---

#### `GRACEFUL_SHUTDOWN_TIMEOUT`

How long (in ms) the worker waits for active jobs to finish after receiving `SIGTERM` before forcefully exiting. Default `30000` (30 seconds).

If a job exceeds this timeout, the worker exits mid-job. The job stays `active` in the DB and will be picked up again by another worker instance after the stale detection window passes.

Set this to be longer than your longest expected job duration.

---

## `apps/dashboard` — Angular Frontend

### `.env.example` / `environment.ts`

Angular doesn't read `.env` files at runtime — configuration is baked in per build via `src/environments/environment.ts` (dev) and `environment.prod.ts` (prod), selected by the Angular CLI's file replacement at build time.

```typescript
// src/environments/environment.ts
export const environment = {
  apiUrl: 'http://localhost:3000/api/v1',
  wsUrl: 'http://localhost:3000'
};
```

These are embedded at **build time** by the Angular CLI (esbuild) — they are not runtime env vars. Changing them requires a rebuild.

### Variable Descriptions

#### `apiUrl`

Base URL for all REST API calls. The dashboard appends endpoint paths to this.

```typescript
// Local
apiUrl: 'http://localhost:3000/api/v1'

// Production
apiUrl: 'https://api.yourdomain.com/api/v1'
```

---

#### `wsUrl`

Socket.IO server URL. Points to the same host as the API — Socket.IO is mounted on the same Fastify server.

```typescript
// Local
wsUrl: 'http://localhost:3000'

// Production
wsUrl: 'https://api.yourdomain.com'
```

---

## Security Rules

1. **Never commit `.env` files.** `.env` and `.env.local` must be in `.gitignore`. Only `.env.example` (with placeholder values, no secrets) is committed.

2. **Never log env vars.** Don't log `process.env` at startup — it exposes secrets to anyone with log access.

3. **`JWT_SECRET` is a hard failure.** The API must refuse to start if `JWT_SECRET` is missing or shorter than 32 characters.

4. **Separate secrets per environment.** Development, staging, and production must have different `JWT_SECRET`, `DATABASE_URL`, and `REDIS_URL` values. Never reuse production secrets locally.

5. **Use a secrets manager in production.** AWS Secrets Manager, Doppler, or Vault — inject values at runtime rather than putting them in `.env` files on the server.

---

## Startup Validation

The API and Worker should validate required env vars at startup and exit with a clear error rather than failing silently mid-request.

```typescript
// apps/api/src/config.ts
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL:               z.string().url(),
  REDIS_URL:                  z.string().url(),
  JWT_SECRET:                 z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  NODE_ENV:                   z.enum(['development', 'test', 'production']).default('development'),
  API_PORT:                   z.coerce.number().default(3000),
  JWT_ACCESS_EXPIRY:          z.coerce.number().default(900),
  JWT_REFRESH_EXPIRY:         z.coerce.number().default(604800),
  ARGON2_MEMORY_COST:         z.coerce.number().min(19456).default(19456),
  ARGON2_TIME_COST:           z.coerce.number().min(2).default(2),
  ARGON2_PARALLELISM:         z.coerce.number().default(1),
  WS_CORS_ORIGIN:             z.string().default('http://localhost:3001'),
  RATE_LIMIT_MAX_REQUESTS:    z.coerce.number().default(1000),
  RATE_LIMIT_WINDOW:          z.coerce.number().default(900),
  WORKER_HEARTBEAT_TIMEOUT_MS:z.coerce.number().default(60000),
  LOG_LEVEL:                  z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:\n', result.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = result.data;
```

Zod parses and coerces at startup. If any required variable is missing or invalid, the process exits with a human-readable message before serving any traffic.

---

## Related Documentation

- [[API/01-Authentication]] - JWT_SECRET usage and token lifecycle
- [[API/03-Admin-Endpoints]] - WORKER_HEARTBEAT_TIMEOUT_MS usage
- [[DEPLOYMENT/01-Local-Development]] - How to run services locally
- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - Production secret management
