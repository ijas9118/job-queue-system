# Pattern 6: Audit Trail (Immutable History)

## The Problem

**Without audit trail**: Job fails. How did it fail? What was tried? Can we replay?

```
No record of attempts
Can't debug failure
Can't replay
Can't prove compliance
```

## The Solution: Immutable History

Every job attempt is recorded forever (append-only).

```
job_executions table (never updated):
  - attempt 1: failed, error = 'Timeout'
  - attempt 2: failed, error = 'Timeout'
  - attempt 3: succeeded, result = {...}

Can always look back and understand what happened
Can replay from any point
Satisfies compliance requirements
```

## Implementation

### Append-Only Design

```sql
-- job_executions is APPEND ONLY
-- Never update, only insert

INSERT INTO job_executions (jobId, attempt, status, result)
VALUES ('job-123', 1, 'completed', '{"messageId": "msg-123"}');

-- Never do this:
-- UPDATE job_executions SET ...  ❌ WRONG

-- If you need to fix data, insert new row with explanation
INSERT INTO audit_log (jobId, action, metadata)
VALUES ('job-123', 'execution_corrected', '{"reason": "data entry error"}');
```

### Complete Context

```typescript
// Record everything about execution
await db.jobExecutions.create({
  jobId: job.id,
  attempt: retryCount + 1,
  status: 'completed',
  workerId: 'worker-1',
  result: { messageId: 'msg-123' },
  duration: 2345,
  startedAt: new Date('2026-07-02T10:00:00Z'),
  completedAt: new Date('2026-07-02T10:00:02Z'),
  // Optional but helpful:
  processingTime: 2300, // Time actually executing
  queueTime: 45, // Time waiting in queue
});
```

## Benefits

| Benefit        | How                            |
| -------------- | ------------------------------ |
| **Debugging**  | See entire history of attempts |
| **Compliance** | Immutable record for audits    |
| **Replay**     | Can reprocess from any point   |
| **Analytics**  | Analyze failure patterns       |
| **Forensics**  | What happened and when         |

## Querying History

```sql
-- See all attempts for a job
SELECT * FROM job_executions
WHERE jobId = 'job-123'
ORDER BY attempt;

-- Find jobs with consistent failures
SELECT
  jobId, type,
  COUNT(*) as attempts,
  COUNT(*) FILTER (WHERE status = 'failed') as failures
FROM job_executions
GROUP BY jobId, type
HAVING COUNT(*) > 1 AND failures > 0;

-- Average attempts by job type
SELECT
  j.type,
  AVG(je.attempt) as avg_attempts
FROM job_executions je
JOIN jobs j ON je.jobId = j.id
WHERE je.status = 'completed'
GROUP BY j.type;
```

## Testing

```typescript
describe('Audit Trail', () => {
  it('records every execution attempt', async () => {
    const jobId = 'job-123';

    // Attempt 1
    await processor.process(job); // Fails

    // Attempt 2
    await processor.process(job); // Succeeds

    const executions = await db.jobExecutions.findMany({
      where: { jobId },
    });

    expect(executions).toHaveLength(2);
    expect(executions[0].status).toBe('failed');
    expect(executions[1].status).toBe('completed');
  });

  it('never updates execution records', async () => {
    const exec = await db.jobExecutions.create({
      jobId: 'job-123',
      attempt: 1,
      status: 'failed',
    });

    // Should not be able to update
    expect(async () => {
      await db.jobExecutions.update(exec.id, {
        status: 'completed', // Change result?
      });
    }).toThrow();
  });
});
```

## Related Documentation

- [[DATABASE/03-Job-Executions-Table]] - Schema
- [[PATTERNS/00-Overview]] - All patterns
- [[COMPONENTS/02-Worker-Service]] - Records executions
