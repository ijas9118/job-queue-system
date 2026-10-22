# Project Overview

## What Are We Building?

A **distributed job queue system** that enables users to submit background tasks, track their progress, handle failures gracefully, and monitor worker health through a real-time dashboard.

This is a **learning project** designed to teach modern backend engineering patterns, not an extreme-scale system.

## Project Goals

### Primary Goals

1. **Learn Distributed Patterns**: Understand how message brokers, job queues, and worker pools work
2. **Production-Inspired Design**: Build something that mirrors real-world systems
3. **Portfolio Quality**: Create a project you can discuss confidently in interviews
4. **Educational Depth**: Implement all major job queue patterns (retries, DLQ, idempotency, backpressure)

### Secondary Goals

1. **Modern Tech Stack**: Use current JavaScript ecosystem tools (Angular, Fastify, Node.js, BullMQ)
2. **Clean Architecture**: Demonstrate separation of concerns and monorepo structure
3. **Security First**: Implement RBAC, authentication, and audit trails
4. **Observability**: Add logging, metrics, and real-time monitoring

## Scope

### In Scope ✅

- Multi-worker distributed job processing
- Redis-based message broker (via BullMQ)
- PostgreSQL for persistent history and audit
- Retry logic with exponential backoff
- Dead-letter queue for failed jobs
- Idempotent job processing
- Real-time WebSocket updates
- RBAC (admin vs user roles)
- Angular dashboard for monitoring
- Docker Compose for local development

### Out of Scope ❌

- Kubernetes / advanced container orchestration
- Horizontal scaling to millions of jobs/second
- Multi-region deployment
- Advanced consensus algorithms
- Custom protocol implementations

## Learning Objectives

After building this system, you'll understand:

| Pattern                 | What You'll Learn                                      |
| ----------------------- | ------------------------------------------------------ |
| **Message Brokers**     | How Redis queues work, pub/sub patterns                |
| **Job Scheduling**      | Priority queues, delayed jobs, recurring jobs          |
| **Reliability**         | Retries, exponential backoff, idempotency              |
| **Failure Handling**    | Dead-letter queues, poison pills, graceful degradation |
| **Concurrency**         | Worker pools, backpressure, resource management        |
| **State Management**    | Explicit state machines, preventing ambiguous states   |
| **Distributed Systems** | Async communication, eventual consistency              |
| **Observability**       | Logging, metrics, tracing, audit trails                |
| **Security**            | RBAC, JWT authentication, permission checking          |
| **Architecture**        | Monorepo patterns, separation of concerns              |

## Scale

### Reasonable But Not Extreme

- **Target Throughput**: ~100-1000 jobs/minute (not millions/second)
- **Job Duration**: Seconds to minutes (not hours)
- **Worker Count**: 1-10 workers locally (not 1000s)
- **Storage**: Weeks to months of history (not years)

This allows us to focus on patterns rather than infrastructure.

## Use Cases (Examples)

The system should handle job types like:

1. **Email Sending**: Send welcome email to new users
2. **Video Processing**: Convert/compress uploaded videos
3. **Report Generation**: Generate PDF reports on demand
4. **Data Export**: Export user data as CSV
5. **Webhook Delivery**: Deliver webhooks to third parties
6. **Image Processing**: Resize/optimize images
7. **Batch Operations**: Process data in batches

## Key Features

### Job Management

- Submit jobs with payload and priority
- Track job status in real-time
- View execution history and logs
- Retry failed jobs manually
- Cancel running jobs

### Worker Management

- Multiple workers processing jobs in parallel
- Worker health monitoring
- Graceful shutdown and restart
- Automatic job reassignment on worker failure

### Failure Handling

- Automatic retries with exponential backoff
- Dead-letter queue for permanently failed jobs
- Manual inspection and replay of failed jobs
- Error logging and debugging information

### Security & Access Control

- JWT authentication
- Role-based permissions (admin vs user)
- Audit trail of all actions
- User isolation (users see only their jobs)

### Observability

- Real-time job status updates via WebSocket
- Queue metrics and stats
- Worker health dashboard
- Structured logging
- Execution history and analytics

## Technology Stack at a Glance

| Layer               | Technology               |
| ------------------- | ------------------------ |
| **Runtime**         | Node.js (current LTS)    |
| **API**             | Fastify                  |
| **Queue**           | BullMQ (Redis-based)     |
| **Database**        | PostgreSQL               |
| **ORM**             | Prisma                   |
| **Frontend**        | Angular (current stable) |
| **Styling**         | Tailwind CSS             |
| **Real-time**       | Socket.IO                |
| **Testing**         | Vitest                   |
| **Package Manager** | pnpm                     |

See [[TECH-STACK/00-Overview]] for full details.

## Architecture at a Glance

```
Dashboard (Angular)
    ↓
API Service (Fastify)
    ↓
PostgreSQL + Redis
    ↓
Worker Service (Node.js) × N
```

Three separate processes:

1. **API**: HTTP server for user requests
2. **Worker**: Job processor (multiple instances)
3. **Dashboard**: Angular frontend

See [[02-ARCHITECTURE-OVERVIEW]] for details.

## Project Phases

### Phase 1: Documentation (Current) ✅

- Complete architecture documentation
- Define all components, APIs, patterns
- Create Obsidian vault structure

### Phase 2: Implementation

- Set up monorepo and packages
- Build API service
- Build worker service
- Build dashboard
- Integrate all components

### Phase 3: Testing

- Unit tests for each module
- Integration tests for APIs
- End-to-end testing
- Load testing

### Phase 4: Polish

- Error handling refinements
- Performance optimization
- Documentation and comments
- Ready for deployment

## Success Criteria

- ✅ System runs locally with `docker-compose up`
- ✅ Users can submit jobs and track progress
- ✅ Workers process jobs with retries and DLQ
- ✅ Dashboard shows real-time job status
- ✅ All 10 design patterns are implemented
- ✅ Comprehensive test coverage
- ✅ Clear documentation and code comments
- ✅ Interview-ready code quality

## Links

- [[00-INDEX]] - Documentation index
- [[02-ARCHITECTURE-OVERVIEW]] - Architecture overview
- [[PATTERNS/00-Overview]] - Design patterns
- [[TECH-STACK/00-Overview]] - Technology choices
