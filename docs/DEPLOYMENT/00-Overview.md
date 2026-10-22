# Deployment Overview

## Local Development

### Quick Start

```bash
# Install dependencies
pnpm install

# Start all services (Docker Compose)
docker-compose up

# In another terminal, run migrations
pnpm --filter database run migrate:dev

# Access dashboard
open http://localhost:3001
```

### Manual Start (Without Docker)

```bash
# Terminal 1: PostgreSQL
postgres -D /usr/local/var/postgres

# Terminal 2: Redis
redis-server

# Terminal 3: API
pnpm --filter api run dev

# Terminal 4: Worker
pnpm --filter worker run dev

# Terminal 5: Dashboard
pnpm --filter dashboard run dev
```

---

## Docker Compose (Local)

File: `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: job_queue
      POSTGRES_PASSWORD: postgres
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'

  api:
    build: ./apps/api
    ports:
      - '3000:3000'
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/job_queue
      REDIS_URL: redis://redis:6379

  worker:
    build: ./apps/worker
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/job_queue
      REDIS_URL: redis://redis:6379

  dashboard:
    build: ./apps/dashboard
    ports:
      - '3001:3000'

volumes:
  postgres_data:
```

---

## Production Deployment

### Architecture

```
Internet
    ↓
Load Balancer (nginx/HAProxy)
    ├── API Server 1
    ├── API Server 2
    └── API Server 3
         ↓
    PostgreSQL (Primary)
    PostgreSQL (Replica)
         ↓
    Redis Sentinel
    ├── Redis (Primary)
    ├── Redis (Replica 1)
    └── Redis (Replica 2)
         ↓
    Worker 1
    Worker 2
    ...
    Worker N
```

### Deployment Steps

1. **Build Docker Images**

```bash
docker build -t my-registry/job-queue-api:1.0.0 ./apps/api
docker build -t my-registry/job-queue-worker:1.0.0 ./apps/worker
docker build -t my-registry/job-queue-dashboard:1.0.0 ./apps/dashboard

docker push my-registry/job-queue-api:1.0.0
docker push my-registry/job-queue-worker:1.0.0
docker push my-registry/job-queue-dashboard:1.0.0
```

2. **Set Up Infrastructure** (Managed Services)

- PostgreSQL: AWS RDS / Google Cloud SQL
- Redis: AWS ElastiCache / Redis Cloud
- Load Balancer: AWS ALB / GCP Load Balancer

3. **Deploy Services**

```bash
# Using Kubernetes
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml
kubectl apply -f k8s/dashboard-deployment.yaml

# Or using Docker Swarm
docker stack deploy -c docker-stack.yml job-queue
```

4. **Database Migration**

```bash
# Run migrations before deploying
pnpm --filter database run migrate:prod
```

5. **Health Checks**

```bash
# API health
curl http://api:3000/health

# Worker health (heartbeat in DB)
SELECT COUNT(*) FROM workers WHERE lastHeartbeat > NOW() - INTERVAL '5 minutes'
```

---

## Kubernetes Deployment

### API Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-queue-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: job-queue-api
  template:
    metadata:
      labels:
        app: job-queue-api
    spec:
      containers:
        - name: api
          image: my-registry/job-queue-api:1.0.0
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: job-queue-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: job-queue-secrets
                  key: redis-url
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
```

### Worker Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-queue-worker
spec:
  replicas: 10
  selector:
    matchLabels:
      app: job-queue-worker
  template:
    metadata:
      labels:
        app: job-queue-worker
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: worker
          image: my-registry/job-queue-worker:1.0.0
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: job-queue-secrets
                  key: database-url
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: job-queue-secrets
                  key: redis-url
          lifecycle:
            preStop:
              exec:
                command: ['/bin/sh', '-c', 'sleep 5']
```

---

## Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/job_queue

# Redis
REDIS_URL=redis://host:6379

# Auth
JWT_SECRET=your-secret-key-here
JWT_ACCESS_EXPIRY=900              # 15 minutes
JWT_REFRESH_EXPIRY=604800          # 7 days

# API
API_PORT=3000
API_WORKERS=4

# Worker
WORKER_CONCURRENCY=5
WORKER_ID=worker-1

# Logging
LOG_LEVEL=info
```

### Optional

```bash
# CORS
WS_CORS_ORIGIN=https://dashboard.example.com

# Rate Limiting
RATE_LIMIT_WINDOW=15m
RATE_LIMIT_MAX_REQUESTS=1000

# Performance
DATABASE_POOL_SIZE=20
REDIS_TIMEOUT=5000
```

---

## Monitoring

### Metrics to Track

```
- Jobs per minute
- Success rate (%)
- Avg processing time
- Error rate by type
- Queue depth
- Worker utilization
- Database connection pool
- Redis memory usage
```

### Logging

All services log to stdout (JSON format):

```json
{
  "timestamp": "2026-07-02T10:00:00Z",
  "level": "info",
  "service": "api",
  "message": "Job submitted",
  "jobId": "job-123",
  "userId": "user-456",
  "duration": 45
}
```

Aggregate logs with ELK Stack, Datadog, or CloudWatch.

---

## Scaling Strategy

### Horizontal Scaling

```
Load increases
    ↓
Add more API instances (behind load balancer)
Add more worker instances
    ↓
Both read from same PostgreSQL
Both read from same Redis
    ↓
System handles more jobs
```

### Vertical Scaling

```
Single instance bottleneck?
    ↓
Increase instance size (CPU, memory)
Increase database connection pool
Increase Redis memory
    ↓
Better performance
```

---

## Backup & Recovery

### Database Backups

```bash
# Daily backup
pg_dump job_queue > backup_$(date +%Y%m%d).sql

# Or use managed backup (AWS RDS automatic backups)
```

### Redis Persistence

```
appendonly yes          # Append-only file
save 900 1             # RDB snapshot
```

---

## Related Documentation

- [[DEPLOYMENT/01-Local-Development]] - Local setup
- [[DEPLOYMENT/02-Docker-Compose]] - Compose configuration
- [[DEPLOYMENT/03-Environment-Variables]] - Env config
- [[DEPLOYMENT/04-Monitoring]] - Observability
- [[PATTERNS/10-Graceful-Shutdown]] - Shutdown strategy
