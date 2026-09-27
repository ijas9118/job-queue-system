# Tech Stack Overview

## Stack at a Glance

> **Versioning note**: Use the current stable/LTS release of each tool at implementation time rather than pinning to whatever was current when this doc was written — pin exact versions in `package.json`, not in prose that will drift.

| Category | Technology | Why |
|----------|------------|-----|
| **Runtime** | Node.js (current LTS) | Modern, stable, performant |
| **Package Manager** | pnpm (current stable) | Fast, efficient, workspace support |
| **Language** | TypeScript (current stable) | Type safety, tooling, developer experience |
| **API Framework** | Fastify (current stable) | Low overhead, schema-based validation built-in, plugin architecture |
| **API Docs** | `@fastify/swagger` + `@fastify/swagger-ui` | OpenAPI spec + interactive docs generated from the same Zod schemas used for validation |
| **Queue/Broker** | BullMQ (current stable) | Production-grade, Redis-based, rich features |
| **Message Store** | Redis (current stable) | Fast, simple, pub/sub support |
| **Database** | PostgreSQL (current stable) | Relational, durable, powerful |
| **ORM** | Prisma (current stable) | Type-safe, migrations, DX — but treat PostgreSQL itself as the primary skill being demonstrated |
| **Validation** | Zod (current stable) | Single source of truth: runtime validation + TS types + compiled JSON Schema |
| **Auth** | Short-lived JWT access token + rotating refresh token | See [[API/01-Authentication]] — not "JWT in localStorage" |
| **Password Hashing** | Argon2id | Winner of the Password Hashing Competition; resists GPU/ASIC cracking better than bcrypt |
| **Real-time** | Socket.IO | Rooms, reconnection, fallback transport, ack support — justified over raw WebSocket by those needs |
| **Logging** | Pino (current stable) | Structured logs, fast, JSON friendly (also Fastify's built-in logger) |
| **Metrics** | Prometheus client (`prom-client`) | Counters/histograms for jobs, queue depth, HTTP latency |
| **Tracing (optional)** | OpenTelemetry | Distributed traces across API → queue → worker; nice-to-have, not day-1 |
| **Frontend** | Angular (current stable) | Batteries-included framework, strong TypeScript integration, standalone components |
| **Styling** | Tailwind CSS (current stable) | Utility-first, rapid development |
| **HTTP Client** | Angular HttpClient | Built-in, RxJS-based, interceptor support, no extra dependency |
| **State Management** | RxJS + Angular Signals | Reactive streams, fine-grained reactivity, no extra library needed |
| **Build Tool** | Angular CLI (esbuild) | Fast builds, integrated scaffolding |
| **Unit/Integration Testing** | Vitest + Supertest/`fastify.inject()` | Jest-compatible, fast, ESM-native |
| **E2E Testing** | Playwright | Real browser, drives the full login → submit → real-time-update flow |
| **Containerization** | Docker | Reproducible builds |
| **Orchestration** | Docker Compose | Local development |

## Tech Stack Decisions

### 1. Node.js + TypeScript

**Why**: 
- Single language for backend + frontend + scripts
- Type safety prevents bugs
- Growing ecosystem
- Excellent tooling

**Alternatives**: Java/Spring (heavier), Go (different paradigm), Python (slower)

---

### 2. Fastify

**Why**:
- Very low overhead, one of the fastest Node.js frameworks
- Built-in JSON schema validation (pairs with Zod via `fastify-type-provider-zod`)
- Plugin architecture encourages encapsulation (`fastify.register`)
- Built-in structured logging via Pino (no separate logging middleware needed)
- First-class OpenAPI generation via `@fastify/swagger`, driven off the same schemas used for validation

**API stays thin.** The API's job is: validate → create job row → enqueue → return job ID. It does not process jobs — that's the worker's job entirely (see [[02-ARCHITECTURE-OVERVIEW]]).

**Alternatives**: Express (larger ecosystem, more middleware examples), NestJS (more opinionated, heavier), Hapi (feature-rich but less popular now)

---

### 3. BullMQ + Redis

**Why**:
- BullMQ is production-grade wrapper around Redis
- Redis is fast and simple to understand
- Rich feature set (priorities, delays, retries)
- Teaches distributed patterns well: retries, exponential backoff, delayed jobs, concurrency, prioritization, dead-letter handling, worker failures, distributed processing

**Idempotency is the concept that ties this together.** A crashed worker + BullMQ's automatic retry means a job handler can run more than once for the same logical unit of work. The handler — not just the API layer — must be safe to execute twice (e.g. check "was the email actually sent?" before sending again, not just "was the job row already created?"). See [[PATTERNS/01-Idempotency]] for both the request-level and handler-level versions of this.

**Alternatives**: RabbitMQ (complex), AWS SQS (managed), Kafka (overkill)

---

### 4. PostgreSQL + Prisma

**Why**:
- PostgreSQL is powerful, standards-compliant
- Prisma provides a type-safe ORM with automatic migrations and good DX

**Prisma is a tool; PostgreSQL is the database system.** The documentation and any interview prep should emphasize the underlying PostgreSQL concepts — indexes, transactions, constraints, foreign keys, isolation levels, query planning, pagination, connection pooling — over "I used Prisma." See [[DATABASE/00-Schema-Overview]], which is written with this emphasis (explicit index rationale, immutability patterns, query patterns).

**Alternatives**: MongoDB (less structured), MySQL (similar), SQLAlchemy (Python)

---

### 5. Zod as the Single Source of Truth

**Why**:
- Runtime validation (catches real-world issues)
- TypeScript-first, composable schemas, good error messages

**One schema, three outputs** — avoid hand-maintaining a Zod schema, a JSON Schema, and a TypeScript interface separately for the same request:

```
Zod Schema
     │
     ├── z.infer<typeof schema>        → TypeScript type
     │
     └── zod-to-json-schema /          → JSON Schema
         fastify-type-provider-zod          │
                                             ▼
                                          Fastify route schema
                                          (validation + OpenAPI generation)
```

Define the Zod schema once per route/job type; derive the TS type and the Fastify/OpenAPI schema from it. Never write the same shape three times.

**Alternatives**: Joi, io-ts, class-validator

---

### 6. Testing: Vitest + Playwright, in layers

Testing is not "one test runner across the stack" as a goal in itself — it's three distinct layers with different jobs:

```
                    Tests
                      │
        ┌─────────────┼──────────────┐
        │             │              │
        ▼             ▼              ▼
      Unit        Integration       E2E
        │             │              │
     Vitest      Vitest + fastify   Playwright
                      .inject()
```

- **Unit (Vitest)**: handlers, backoff math, RBAC predicates, pure functions — in isolation.
- **Integration (Vitest + `fastify.inject()` / Supertest)**: real routes against a real test database.
- **E2E (Playwright)**: a real browser driving the full path — login → create job → job appears in dashboard → worker processes it → status changes → real-time notification appears. This is the layer that actually proves the system works end to end, not just its parts.

See [[TESTING/00-Strategy]] for the full breakdown and example E2E spec.

**Alternatives**: Jest (slower), Mocha (less integrated), Cypress (also viable for E2E, Playwright chosen for multi-browser + built-in test runner)

---

### 7. Angular + Tailwind

**Why**:
- Angular is a complete, opinionated framework (routing, DI, forms, HTTP client all built-in)
- Standalone components (current Angular) reduce boilerplate vs. NgModules
- RxJS is native to Angular — fits naturally with WebSocket event streams
- Tailwind still works great inside Angular templates for rapid styling
- Strong fit when you want structure/conventions enforced by the framework

**Alternatives**: React (larger ecosystem, more flexible), Vue (smaller, simpler)

---

### 8. Docker + Docker Compose

**Why**:
- Reproducible environments
- Easy local development
- Production-like setup
- Industry standard

**Alternatives**: K8s (overkill), Vagrant (heavier)

---

## Observability

The biggest thing missing from a "just add Prometheus" mindset is treating logs, metrics, and traces as one coherent story instead of an afterthought:

```
                    Application
                         │
             ┌───────────┼───────────┐
             │           │           │
             ▼           ▼           ▼
           Logs       Metrics       Traces
             │           │           │
           Pino      Prometheus    OpenTelemetry
                      (prom-client)   (optional)
```

**Logs** — Pino, structured JSON, request ID attached to every line (see [[API/00-Overview]]).

**Metrics** — Prometheus-compatible, minimum viable set:

```
jobs_total{type}
jobs_completed_total{type}
jobs_failed_total{type}
job_processing_duration_seconds{type}
queue_depth{queue}
worker_active_jobs
http_request_duration_seconds{route,method,status}
```

**Traces (optional stretch)** — OpenTelemetry spans across API → Redis/BullMQ → worker → DB, so a single job's lifecycle can be followed as one trace instead of correlated log lines. Worthwhile as a portfolio differentiator, not required for a working system.

See [[COMPONENTS/04-Shared-Packages]] for where the metrics package fits, and [[02-ARCHITECTURE-OVERVIEW]] for how it sits alongside the rest of the architecture.

---

## Dependency Tree

Packages are earned, not scaffolded upfront. Start minimal and extract only when a second consumer genuinely needs the same code — see [[ARCHITECTURE/02-Monorepo-Structure]] for the phased version of this tree.

```
job-queue-system/
│
├── apps/
│   ├── api/
│   │   ├── fastify
│   │   ├── @fastify/cors
│   │   ├── @fastify/swagger, @fastify/swagger-ui
│   │   ├── socket.io
│   │   ├── @job-queue/* (packages actually shared with worker)
│   │   └── auth/ (starts as local code inside apps/api — see Monorepo Structure)
│   │
│   ├── worker/
│   │   ├── bullmq
│   │   ├── redis
│   │   ├── @job-queue/* (packages)
│   │   └── handlers/ (starts as local code inside apps/worker)
│   │
│   └── dashboard/
│       ├── @angular/core
│       ├── @angular/common
│       ├── @angular/router
│       ├── socket.io-client
│       ├── tailwindcss
│       └── 20 other dependencies
│
├── packages/                          # Day-1: only what both api and worker need
│   ├── database/ (prisma)
│   ├── queue/ (bullmq wrapper)
│   ├── config/ (zod)
│   └── shared/ (types)
│   │
│   # Extracted later, once genuinely shared:
│   ├── logger/ (pino)     — extract once worker also needs identical setup
│   ├── metrics/ (prom-client) — extract once worker also exposes metrics
│   ├── auth/              — extract only if worker/dashboard-server-side ever needs JWT verification too
│   └── handlers/          — extract only if API needs the same job schemas for pre-validation
│
└── Root dependencies:
    ├── typescript
    ├── vitest
    ├── playwright
    ├── docker
    └── pnpm
```

## Development vs Production

### Development

```bash
pnpm install           # All packages, devDependencies
pnpm dev              # Run all services locally
npm test              # Run tests
npm run dev:api       # API only
npm run dev:worker    # Worker only
npm run dev:dashboard # Dashboard only
```

### Production

```bash
pnpm install --prod            # Only dependencies
pnpm build                     # Compile TypeScript / Angular AOT build
docker build -t job-queue .    # Build image
docker-compose up              # Run services
```

## Performance

Performance targets and benchmark results are documented **after** load testing in a controlled environment — not guessed upfront. Numbers like "Fastify latency ~2ms" or "Postgres query ~10ms" depend entirely on hardware, query shape, dataset size, indexing, connection pooling, and network conditions, so they don't belong in an architecture doc as facts.

What to actually measure once there's a running system (via the admin panel's load-test trigger, see [[API/00-Overview]]):

```
Load testing
    ↓
Measure
    ├── RPS (requests/sec)
    ├── p50 / p95 / p99 latency
    ├── CPU and memory per service
    ├── DB connection pool utilization
    └── queue latency (enqueue → pickup → completion)
```

Feed those numbers into the `http_request_duration_seconds` and `job_processing_duration_seconds` metrics described in [Observability](#observability) above, and record actual results here once benchmarked.

## Security

| Aspect | Implementation |
|--------|-----------------|
| **Authentication** | Short-lived (15 min) JWT access token + rotating refresh token with reuse detection — see [[API/01-Authentication]] |
| **Refresh token storage** | HttpOnly, Secure, SameSite=Lax cookie (default recommendation — avoids exposing it to XSS via JS-readable storage) |
| **Password** | Argon2id hashing |
| **Authorization** | RBAC (admin/user roles) |
| **Input Validation** | Zod schemas on all inputs (compiled to Fastify route schemas) |
| **SQL Injection** | Prisma parameterized queries |
| **XSS** | Angular sanitizes bindings by default (built-in DomSanitizer); refresh token never exposed to JS |
| **CSRF** | Mitigated via `SameSite=Lax` on the refresh cookie + custom header requirement on state-changing requests |
| **CORS** | Configured for dashboard origin (`@fastify/cors`) |
| **Rate Limiting** | 1000 req/15min per IP globally; stricter limits on `/auth/login` and `/auth/refresh` (`@fastify/rate-limit`) |
| **Token revocation** | Redis blacklist (access tokens) + DB-revoked refresh tokens, with reuse detection |
| **HTTPS** | TLS termination (reverse proxy) |

## Scaling

There's no universal formula mapping request rate to instance count — that depends on what's actually CPU-bound vs I/O-bound in your handlers, your DB's connection limits, and your box sizes. Determine scaling needs empirically:

```
Load testing
    ↓
Measure
    ├── RPS at target latency (p95/p99 within SLA)
    ├── CPU / memory headroom per instance
    ├── DB connection pool saturation
    └── queue depth under sustained load
    ↓
Scale the bottleneck, re-test, repeat
```

Directionally: the API is I/O-bound (mostly waiting on DB/Redis) and scales horizontally with load balancing; workers are the CPU/IO-bound component and scale by adding instances and/or raising `WORKER_CONCURRENCY`; Redis and PostgreSQL are usually the last things to need scaling (replication/Sentinel/sharding) and only once actually measured as the bottleneck.

## Related Documentation

- [[TECH-STACK/01-Backend]] - Node.js, Fastify, BullMQ details
- [[TECH-STACK/02-Frontend]] - Angular, Tailwind details
- [[TECH-STACK/03-Database]] - PostgreSQL, Prisma details
- [[TECH-STACK/04-Queue]] - Redis, BullMQ details
- [[TECH-STACK/05-Testing]] - Vitest + Playwright strategy
- [[TECH-STACK/06-Package-Manager]] - pnpm workspaces
