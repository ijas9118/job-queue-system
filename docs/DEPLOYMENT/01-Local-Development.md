# Local Development Setup

## Quick Start (Docker Compose)

Fastest way to get the entire system running locally with production-like services.

### Prerequisites

```bash
# macOS
brew install docker docker-compose nodejs pnpm

# Linux
sudo apt-get install docker.io docker-compose nodejs npm
npm install -g pnpm

# Verify
docker --version    # Should be 24+
pnpm --version      # Should be 8+
node --version      # Should be 20+
```

### Quick Start (5 minutes)

```bash
# 1. Clone and install
git clone <repo>
cd job-queue-system
pnpm install

# 2. Start services (includes PostgreSQL, Redis, API, Worker)
docker-compose up

# 3. In another terminal, run migrations
pnpm --filter database run migrate:dev

# 4. Open dashboard
open http://localhost:3001

# That's it! System is running locally
```

### What's Running?

```
PostgreSQL:3432     Data storage
Redis:6379          Queue broker
API:3000            Job submission & management
Worker:             Processing jobs
Dashboard:3001      Web UI
```

## Manual Start (Without Docker)

For development without Docker containers.

### Terminal 1: PostgreSQL

```bash
# macOS (using Homebrew)
brew services start postgresql@15

# Or start manually
postgres -D /usr/local/var/postgres

# Verify running
psql --version
```

### Terminal 2: Redis

```bash
# macOS
brew services start redis

# Or start manually
redis-server

# Verify
redis-cli ping  # Should respond with PONG
```

### Terminal 3: Database Setup

```bash
pnpm --filter database run migrate:dev

# Seed sample data (optional)
pnpm --filter database run seed:dev
```

### Terminal 4: API Server

```bash
pnpm --filter api run dev

# Running on http://localhost:3000
# API ready for requests
```

### Terminal 5: Worker Process

```bash
pnpm --filter worker run dev

# Worker connected and ready
# Consumes jobs from Redis queue
```

### Terminal 6: Dashboard (Angular)

```bash
pnpm --filter dashboard run dev

# Running on http://localhost:3001
# Hot reload enabled
```

## Environment Variables

Create `.env.local` in each app:

### `apps/api/.env.local`

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_queue

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=dev-secret-key-change-in-prod
JWT_ACCESS_EXPIRY=900              # 15 minutes
JWT_REFRESH_EXPIRY=604800          # 7 days

# Server
API_PORT=3000
NODE_ENV=development

# Logging
LOG_LEVEL=debug
```

### `apps/worker/.env.local`

```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/job_queue

# Redis
REDIS_URL=redis://localhost:6379

# Worker
WORKER_ID=worker-dev-1
WORKER_CONCURRENCY=5
NODE_ENV=development

# Logging
LOG_LEVEL=debug
```

### `apps/dashboard/src/environments/environment.ts`

Angular doesn't read `.env` files — config is baked in at build time (see [[DEPLOYMENT/03-Environment-Variables]]):

```typescript
export const environment = {
  apiUrl: 'http://localhost:3000',
  wsUrl: 'ws://localhost:3000'
};
```

## Development Workflow

### 1. Making Code Changes

All apps have hot reload enabled:

```bash
# Terminal 4 (API)
# Edit apps/api/src/routes/jobs.ts
# Changes auto-reload

# Terminal 6 (Dashboard)
# Edit apps/dashboard/src/components/JobCard.tsx
# Changes hot-reload in browser
```

### 2. Database Migrations

When you add a new migration:

```bash
# Create migration
pnpm --filter database run migrate:dev --name add_new_field

# Runs automatically on startup
```

### 3. Type Safety

TypeScript watches all packages:

```bash
# All packages watched in dev mode
# Type errors shown immediately in terminal
```

### 4. Testing

Run tests in watch mode:

```bash
# Terminal 7: Run all tests
pnpm test --watch

# Or specific package
pnpm --filter api test --watch
pnpm --filter worker test --watch
```

## Troubleshooting

### PostgreSQL Won't Start

```bash
# macOS - stuck postgres process
killall postgres
rm /usr/local/var/postgres/postmaster.pid
brew services start postgresql@15

# Linux - check logs
sudo journalctl -u postgresql
```

### Redis Connection Error

```bash
# Check Redis running
redis-cli ping

# Restart
redis-cli shutdown
redis-server

# Or via Homebrew
brew services restart redis
```

### Port Already in Use

```bash
# Find process using port 3000
lsof -i :3000

# Kill it
kill -9 <PID>

# Or change port in .env
API_PORT=3001
```

### Database Migration Failed

```bash
# Reset database (WARNING: deletes all data)
pnpm --filter database run migrate:reset

# Re-run migrations
pnpm --filter database run migrate:dev
```

## Development Tips

### 1. Use Docker Compose for Services

```bash
# Let Docker handle PostgreSQL + Redis
docker-compose up

# Run API + Worker + Dashboard locally (better for debugging)
pnpm --filter api run dev
pnpm --filter worker run dev
pnpm --filter dashboard run dev
```

### 2. Inspect Database

```bash
# Connect to PostgreSQL
psql postgresql://postgres:postgres@localhost:5432/job_queue

# Useful queries
\dt                    # List tables
SELECT * FROM jobs;   # View jobs
SELECT * FROM users;  # View users
```

### 3. Monitor Redis

```bash
# Open Redis monitor
redis-cli monitor

# Watch all Redis commands in real-time
# Useful for debugging queue operations
```

### 4. Frontend Debugging

```bash
# Dashboard runs on http://localhost:3001
# Open DevTools (F12)
# Real-time WebSocket events visible in Console

# See all Socket.IO events
localStorage.debug = '*'

# Reload page to see verbose logging
```

### 5. Backend Debugging

```typescript
// Add debug logging
import { logger } from '@job-queue/logger';

logger.debug('Processing job', { jobId, attempt, payload });

// See in terminal where API/Worker is running
// LOG_LEVEL=debug shows all debug statements
```

## Performance Testing (Locally)

### Generate Test Jobs

```bash
# In one terminal
pnpm --filter api run dev

# In another, load test
curl -X POST http://localhost:3000/api/v1/admin/load-test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "jobCount": 100,
    "jobType": "send-email",
    "concurrency": 5
  }'
```

### Monitor Performance

```bash
# Watch job processing in real-time
redis-cli

# In Redis CLI
WATCH job:queue  # See job count
WATCH job:active # See active jobs

# Or via Dashboard UI
# Open http://localhost:3001
# Watch queue stats update in real-time
```

## Related Documentation

- [[DEPLOYMENT/00-Overview]] - Overview & architecture
- [[DEPLOYMENT/02-AWS-Portfolio-Setup]] - AWS portfolio deployment
- [[TECH-STACK/00-Overview]] - Tech choices and rationale
- [[COMPONENTS/01-API-Service]] - API details
- [[COMPONENTS/02-Worker-Service]] - Worker details
