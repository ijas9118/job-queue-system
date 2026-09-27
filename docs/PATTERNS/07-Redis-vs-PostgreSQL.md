# Pattern 7: Redis vs PostgreSQL (Separation of Concerns)

## The Problem

**Single database choice**:
- Fast database (Redis): Can't persist reliably
- Durable database (PostgreSQL): Too slow for queue

**Using only one forces trade-offs**:
- Only Redis: Lose data on crash
- Only PostgreSQL: Queries too slow

## The Solution: Separate Concerns

**Redis**: Fast, transient queue state (who's waiting? who's processing?)  
**PostgreSQL**: Durable history & metadata (what happened?)

```
Redis owns:
- Active job queue (QUEUED, ACTIVE, DELAYED)
- Job priority ordering
- Worker coordination
- Pub/Sub for events

PostgreSQL owns:
- Job metadata (userId, type, payload)
- Execution history (immutable)
- Results & errors
- Audit trail
- Long-term analytics
```

## Data Flow

### Job Submission

```
1. API receives request
2. Validate with Zod
3. INSERT into PostgreSQL (durable)
4. PUSH to Redis queue (for workers)
5. Return to user
```

### Job Processing

```
1. Worker pulls from Redis queue
2. SELECT from PostgreSQL (get full job)
3. Execute handler
4. INSERT result into PostgreSQL
5. Emit event via Redis Pub/Sub
6. Dashboard updates
```

### On Crash

**Redis crashes:**
```
Workers can't get new jobs
But database still has all job records
Restart Redis
Workers resume
No data loss (jobs were in Redis, but also queued in DB)
```

**PostgreSQL crashes:**
```
Can't store results
But Redis queue still has active jobs
Fix database
Workers retry storing results
No jobs lost
```

## Schema Split

### PostgreSQL Stores

```sql
-- Durable metadata
jobs (id, userId, type, payload, status)
job_executions (jobId, attempt, status, result, error)
job_logs (executionId, level, message)
workers (workerId, status, health)
audit_log (action, actor, timestamp)
```

### Redis Stores

```
Via BullMQ:
- 'queue:default:waiting' (QUEUED jobs)
- 'queue:default:active' (ACTIVE jobs)
- 'queue:default:delayed' (DELAYED jobs)
- 'queue:default:failed' (FAILED jobs)
- Pub/Sub channels (events)
```

## Performance Comparison

| Operation | Storage | Latency | Trade-off |
|-----------|---------|---------|-----------|
| **Queue job** | Redis | ~10ms | Fast add to queue |
| **Get next job** | Redis | ~5ms | Instant availability |
| **Store result** | PostgreSQL | ~50ms | Durable storage |
| **Query history** | PostgreSQL | ~100ms | Consistent data |
| **Real-time updates** | Redis Pub/Sub | ~50ms | Live events |

## Benefits

```
✅ Redis: Ultra-fast for queue operations
✅ PostgreSQL: Durable for business logic
✅ Combined: Best of both worlds
✅ Recovery: Can rebuild from PostgreSQL if Redis lost
```

## Resilience

### Redis Failure

```
t=0: Redis connection lost
t=0: Workers pause (no new jobs available)
t=1: Admin notices, checks database
t=5: Redis restarted
t=6: Workers resume
Loss: 5 seconds downtime, no data loss
```

### PostgreSQL Failure

```
t=0: Database connection lost
t=0: Workers can't write results
t=1: Admin notices
t=10: Database fixed
t=11: Workers retry writes
Loss: 10 seconds, jobs held in memory/Redis, no corruption
```

## Testing

```typescript
describe('Separation of Concerns', () => {
  it('stores job in PostgreSQL', async () => {
    const job = await submitJob(jobData);
    
    const dbRecord = await db.jobs.findUnique(job.id);
    expect(dbRecord).toBeDefined();
  });

  it('queues job in Redis', async () => {
    const job = await submitJob(jobData);
    
    const redisJob = await queue.get(job.id);
    expect(redisJob).toBeDefined();
  });

  it('survives Redis crash (data in PostgreSQL)', async () => {
    const job = await submitJob(jobData);
    
    // Simulate Redis crash
    await redis.flushAll();
    
    // Job still in PostgreSQL
    const dbRecord = await db.jobs.findUnique(job.id);
    expect(dbRecord).toBeDefined();
    
    // Can rebuild Redis from PostgreSQL
    await rebuildQueueFromDatabase();
    
    const redisJob = await queue.get(job.id);
    expect(redisJob).toBeDefined();
  });
});
```

## Related Documentation

- [[ARCHITECTURE/03-Separation-of-Concerns]] - Architecture detail
- [[DATABASE/00-Schema-Overview]] - PostgreSQL tables
- [[COMPONENTS/01-API-Service]] - Uses both
- [[COMPONENTS/02-Worker-Service]] - Uses both
