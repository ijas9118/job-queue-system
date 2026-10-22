# Admin Endpoints

Base path: `/api/v1/admin`  
All endpoints require `Authorization: Bearer <accessToken>` **and** `role: 'admin'`.  
Non-admins receive `403 FORBIDDEN` on every route here — no further detail is given.

Every response includes `X-Request-ID` header and `meta.requestId` in the body. See [[API/00-Overview]].

---

## System Health

### GET `/health` — Shallow Health Check

Public endpoint — no authentication required. Used by load balancers, uptime monitors, and container orchestrators (Docker, Kubernetes) to decide whether to route traffic to this instance.

Returns `200 OK` if the API process is running. Returns `503 Service Unavailable` if the process is up but a critical dependency (PostgreSQL, Redis) is unreachable.

**Response 200:**

```json
{ "status": "ok" }
```

**Response 503:**

```json
{ "status": "degraded", "reason": "postgres_unreachable" }
```

> Keep this endpoint fast — it should not block on slow queries or external calls. If you want dependency checks, use `GET /admin/system/health` instead.

---

### GET `/admin/system/health` — Deep System Health

Auth required (`role: admin`). Returns full system state — intended as the first page of the admin dashboard and for on-call debugging.

All dependency checks are live per request (Redis `PING`, PostgreSQL `SELECT 1`). Response time is typically 10–30ms.

**Response 200:**

```json
{
  "data": {
    "status": "ok",

    "api": {
      "version": "1.0.0",
      "nodeVersion": "v22.4.0",
      "environment": "production",
      "uptimeSeconds": 86423,
      "memory": {
        "heapUsedMb": 142,
        "heapTotalMb": 210,
        "rssMb": 280
      }
    },

    "postgres": {
      "status": "ok",
      "latencyMs": 3
    },

    "redis": {
      "status": "ok",
      "latencyMs": 1
    },

    "workers": {
      "total": 3,
      "healthy": 2,
      "stale": 1,
      "heartbeatTimeoutMs": 60000
    },

    "queues": {
      "total": 3,
      "paused": 0,
      "inMaintenance": 1
    }
  },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Top-level `status` values:**

| Value      | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `ok`       | All dependencies reachable, no stale workers                         |
| `degraded` | At least one dependency slow or one worker stale — system functional |
| `critical` | PostgreSQL or Redis unreachable — system non-functional              |

**Response 503** when `status` is `critical`:

```json
{
  "data": {
    "status": "critical",
    "postgres": { "status": "unreachable", "error": "Connection refused" },
    "redis": { "status": "ok", "latencyMs": 1 },
    "workers": { "total": 0, "healthy": 0, "stale": 0 },
    "queues": { "total": 3, "paused": 0, "inMaintenance": 0 }
  },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

> Return `503` even for admin endpoints when the system is critical — monitoring tools check HTTP status codes, not response bodies.

**Implementation sketch:**

```typescript
async function getSystemHealth() {
  const [pgResult, redisResult] = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,
    redis.ping()
  ]);

  const postgres = pgResult.status === 'fulfilled'
    ? { status: 'ok', latencyMs: pgResult.value.latencyMs }
    : { status: 'unreachable', error: pgResult.reason.message };

  const redisOk = redisResult.status === 'fulfilled' && redisResult.value === 'PONG';
  const redisStatus = redisOk
    ? { status: 'ok', latencyMs: redisResult.value.latencyMs }
    : { status: 'unreachable', error: redisResult.reason?.message };

  const critical = postgres.status === 'unreachable' || redisStatus.status === 'unreachable';
  const status = critical ? 'critical' : 'ok';

  return { status, postgres, redis: redisStatus, ... };
}
```

`Promise.allSettled` (not `Promise.all`) ensures both checks run even if one fails — you want to know which dependency is down, not just that something is.

---

## Jobs

### GET `/admin/jobs` — All Jobs (Any User)

Same as `GET /jobs` but returns jobs across all users. Useful for support and monitoring dashboards.

**Query Parameters:** Identical to `GET /jobs` plus:

| Param       | Type               | Default     | Description                              |
| ----------- | ------------------ | ----------- | ---------------------------------------- |
| `userId`    | UUID               | —           | Filter to a specific user's jobs         |
| `status`    | string (comma-sep) | all         |                                          |
| `type`      | string             | —           |                                          |
| `queueName` | string             | —           |                                          |
| `tags`      | string (comma-sep) | —           | AND filter                               |
| `search`    | string             | —           | `ILIKE '%query%'` on `name`              |
| `limit`     | int                | 50          | Max 200                                  |
| `offset`    | int                | 0           |                                          |
| `sortBy`    | string             | `createdAt` | `createdAt` \| `updatedAt` \| `priority` |
| `sortOrder` | string             | `DESC`      | `ASC` \| `DESC`                          |
| `from`      | ISO 8601           | —           |                                          |
| `to`        | ISO 8601           | —           |                                          |

**Response 200:**

```json
{
  "data": [ { ...job object... } ],
  "pagination": { "total": 18432, "limit": 50, "offset": 0, "hasMore": true },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

---

### POST `/admin/jobs/:jobId/move-to-dlq` — Manually Move to DLQ

Moves any non-terminal job directly to the dead letter queue without waiting for retries to exhaust. Useful when you know a job will never succeed (e.g. invalid payload, decommissioned job type).

**Allowed current statuses:** `queued`, `active`, `failed`, `delayed`, `paused`

**Request:**

```json
{
  "reason": "Manually moved to DLQ",
  "note": "Job type 'send-fax' is no longer supported"
}
```

`reason` must match one of the DLQ reason enum values. `note` is a free-text field stored in `metadata`.

**Behavior by current status:**

| Status                                  | What happens                                               |
| --------------------------------------- | ---------------------------------------------------------- |
| `queued`                                | Removed from Redis queue immediately. Moved to DLQ.        |
| `delayed`                               | Removed from BullMQ delayed set immediately. Moved to DLQ. |
| `failed`                                | No active worker. Moved to DLQ immediately.                |
| `paused`                                | No active worker. Moved to DLQ immediately.                |
| `active`                                | **Deferred** — see below.                                  |
| `completed`, `cancelled`, `dead_letter` | Rejected. `409 JOB_NOT_MOVABLE`.                           |

**Active job edge case:**

A job with `status = active` is currently being executed by a worker. The move cannot happen atomically because the worker owns the job until it finishes or fails.

The API handles this by signalling intent via Redis:

```
Admin calls move-to-dlq on active job
          ↓
SET job:<jobId>:force-dlq "reason" EX 3600   (Redis signal)
          ↓
Return 202 Accepted  (not 200 — move is pending, not done)
          ↓
Worker finishes current operation or reaches next checkpoint
          ↓
Worker checks job:<jobId>:force-dlq
          ↓
Flag found → worker abandons result, moves job to DLQ
          ↓
Status becomes dead_letter
```

The response is `202 Accepted` when the job is `active` — not `200` — because the move hasn't happened yet. The job object in the response still shows `status: 'active'` with a `pending` meta flag:

```json
{
  "data": { ...job with status: "active"... },
  "meta": {
    "requestId": "req-a1b2c3d4",
    "pending": true,
    "pendingAction": "move-to-dlq"
  }
}
```

**Race condition — worker completes before detecting the flag:**

If the worker finishes successfully and marks the job `completed` before reading the Redis signal, the signal is ignored and the job lands as `completed`. The admin would need to move it manually afterward.

This is an accepted trade-off. The window is small (milliseconds between job completion and flag check), and the alternative — taking a distributed lock across the API and worker — adds significant complexity for a rare case. The audit log records the `move-to-dlq` intent regardless of outcome.

**Server steps:**

```
1. Validate status is not terminal (completed, cancelled, dead_letter)
2. If status is queued/delayed: remove from Redis queue
3. If status is active:
   a. SET job:<jobId>:force-dlq <reason> EX 3600 in Redis
   b. INSERT INTO audit_log (action='job_move_to_dlq_signalled')
   c. Return 202 Accepted with meta.pending = true
4. If status is failed/paused (no active worker):
   a. UPDATE jobs SET status='dead_letter', movedToDLQAt=NOW()
   b. INSERT INTO dead_letter_queue
   c. INSERT INTO audit_log (action='job_moved_to_dlq_manually')
   d. Return 200 with updated job
```

**Response 200** (non-active jobs): Updated job object with `status: 'dead_letter'`.  
**Response 202** (active jobs): Job object with `status: 'active'` and `meta.pending: true`.

---

## Queues

### GET `/admin/queues` — Queue Statistics

Returns a mix of two data sources — live queue counts from BullMQ (Redis) and derived metrics from PostgreSQL. Both are fetched and merged per request.

**Query parameters:**

| Param    | Type          | Default | Description                                        |
| -------- | ------------- | ------- | -------------------------------------------------- |
| `window` | int (minutes) | `5`     | Rolling time window for derived metrics. `1`–`60`. |

**Response 200:**

```json
{
  "data": [
    {
      "name": "email",

      "counts": {
        "waiting": 145,
        "active": 3,
        "delayed": 12,
        "failed": 5,
        "completed": 8234
      },

      "metrics": {
        "throughputPerMinute": 42.3,
        "averageProcessingTimeMs": 1840,
        "retryRate": 0.08,
        "windowMinutes": 5
      },

      "paused": false,
      "maintenance": false,
      "workers": 2
    }
  ],
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Field definitions:**

| Field                             | Source                               | How calculated                                                                                                                             |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `counts.*`                        | Redis (BullMQ)                       | Live queue state at request time                                                                                                           |
| `paused`                          | Redis key `queue:<name>:paused`      | Accepts jobs, does not process                                                                                                             |
| `maintenance`                     | Redis key `queue:<name>:maintenance` | Rejects new jobs, does not process                                                                                                         |
| `counts.completed`                | Redis                                | BullMQ in-memory counter — resets on Redis flush. Use `jobs` table for durable historical counts.                                          |
| `metrics.throughputPerMinute`     | PostgreSQL                           | `COUNT(*) / windowMinutes` where `completedAt > NOW() - window` and `queueName = ?`                                                        |
| `metrics.averageProcessingTimeMs` | PostgreSQL                           | `AVG(durationMs)` from `job_executions` joined to jobs in this queue, within the window                                                    |
| `metrics.retryRate`               | PostgreSQL                           | `COUNT(*) FILTER (WHERE retryCount > 0) / COUNT(*)` for completed jobs within the window. `0.08` = 8% of jobs required at least one retry. |
| `metrics.windowMinutes`           | —                                    | Echo of the `window` query param used — makes cached responses self-describing                                                             |

**SQL for derived metrics (per queue, single query):**

```sql
SELECT
  COUNT(*) FILTER (WHERE completedAt > NOW() - INTERVAL '5 minutes')
    / 5.0                                            AS throughputPerMinute,

  AVG(je.durationMs)
    FILTER (WHERE je.createdAt > NOW() - INTERVAL '5 minutes')  AS averageProcessingTimeMs,

  COUNT(*) FILTER (WHERE retryCount > 0 AND completedAt > NOW() - INTERVAL '5 minutes')
  / NULLIF(COUNT(*) FILTER (WHERE completedAt > NOW() - INTERVAL '5 minutes'), 0)
                                                     AS retryRate

FROM jobs j
LEFT JOIN job_executions je ON je.jobId = j.id AND je.status = 'completed'
WHERE j.queueName = $1
  AND j.cancelledAt IS NULL;
```

> `NULLIF(..., 0)` prevents division-by-zero when no jobs completed in the window — both `throughputPerMinute` and `retryRate` return `null` in that case, which the dashboard should display as `—` rather than `0`.

---

### POST `/admin/queues/:queueName/pause` — Pause a Queue

Stops workers from picking up new jobs from this queue. Jobs already `active` continue to completion.

| Mode        | Accepts new jobs         | Processes jobs |
| ----------- | ------------------------ | -------------- |
| Normal      | Yes                      | Yes            |
| **Paused**  | **Yes — 201, jobs wait** | **No**         |
| Maintenance | No — 503 rejected        | No             |

**Submitting to a paused queue still returns `201 Created`.**  
The job is accepted, stored in PostgreSQL, and pushed to Redis — it just won't be picked up until the queue resumes. From the client's perspective the request succeeded. This is intentional: the producer doesn't need to know or care about queue pause state.

```
Queue paused
     │
     ▼
POST /jobs  →  201 Created  ✓
     │
     ▼
Job sits in Redis (waiting)
     │
     ▼
Queue resumed
     │
     ▼
Worker picks up job  →  ACTIVE
```

The operational implication: pausing a queue is safe to do mid-flight. You can pause, deploy a fix, then resume — jobs that arrived during the pause are not lost and don't need to be resubmitted.

**Response 200:**

```json
{
  "data": { "queueName": "email", "paused": true },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Error responses:**

```json
// 404 — queue not found
{ "error": { "code": "QUEUE_NOT_FOUND", "message": "Queue 'foobar' not found", "statusCode": 404 } }

// 409 — already paused
{ "error": { "code": "QUEUE_ALREADY_PAUSED", "message": "Queue 'email' is already paused", "statusCode": 409 } }
```

---

### POST `/admin/queues/:queueName/resume` — Resume a Queue

Unpauses a queue. Workers begin picking up jobs immediately.

**Response 200:**

```json
{
  "data": { "queueName": "email", "paused": false },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

---

### POST `/admin/queues/:queueName/maintenance` — Enter Maintenance Mode

Puts the queue into maintenance mode. Unlike pause, **new job submissions are rejected at the API layer** — clients receive `503 Service Unavailable` immediately rather than a queued job that silently waits.

| Mode            | Accepts new jobs      | Processes jobs |
| --------------- | --------------------- | -------------- |
| Normal          | Yes                   | Yes            |
| Paused          | Yes — 201, jobs wait  | No             |
| **Maintenance** | **No — 503 rejected** | **No**         |

Use maintenance mode when:

- Running a database migration that affects job schema
- Deploying a breaking change to a job handler
- The downstream service a queue depends on is known to be down

**Implementation:** Stored as a Redis key `queue:<name>:maintenance`. The `POST /jobs` handler checks this key before accepting a submission — if set, it returns 503 before touching the database.

**Request:** No body required.

**Response 200:**

```json
{
  "data": {
    "queueName": "email",
    "maintenance": true,
    "acceptJobs": false,
    "processJobs": false
  },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Effect on `POST /jobs` while in maintenance:**

```json
HTTP/1.1 503 Service Unavailable
Retry-After: 300

{
  "error": {
    "code": "QUEUE_IN_MAINTENANCE",
    "message": "Queue 'email' is currently in maintenance mode. Try again later.",
    "statusCode": 503,
    "requestId": "req-a1b2c3d4"
  }
}
```

`Retry-After` is set to 300 seconds as a hint — clients and load balancers can use it for backoff. The actual duration of maintenance is unknown, so this is advisory only.

**Error responses:**

```json
// 409 — already in maintenance
{
  "error": {
    "code": "QUEUE_ALREADY_IN_MAINTENANCE",
    "message": "Queue 'email' is already in maintenance mode",
    "statusCode": 409
  }
}
```

---

### DELETE `/admin/queues/:queueName/maintenance` — Exit Maintenance Mode

Removes the maintenance flag. The queue resumes accepting and processing jobs immediately.

**Response 200:**

```json
{
  "data": {
    "queueName": "email",
    "maintenance": false,
    "acceptJobs": true,
    "processJobs": true
  },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

> If the queue was also paused before entering maintenance, exiting maintenance does **not** automatically resume it — paused state is independent and must be explicitly resumed via `POST /admin/queues/:queueName/resume`.

---

### DELETE `/admin/queues/:queueName/failed` — Purge Failed Jobs

Removes all jobs in the `failed` state from a queue. Irreversible — use with caution. Does **not** affect `dead_letter` entries.

**Request:**

```json
{
  "confirm": "email",
  "force": true
}
```

Both fields are required and validated independently:

- `confirm` must exactly equal the `queueName` path parameter — the admin types the name they intend to purge, preventing copy-paste errors across queues.
- `force` must be boolean `true` — not the string `"true"`. An explicit second signal of intent, separate from the name confirmation.

Neither field alone is sufficient. Both must pass or the request is rejected with `400`.

```typescript
if (body.confirm !== queueName) {
  return res.status(400).json({
    error: {
      code: 'CONFIRMATION_MISMATCH',
      message: `confirm must equal queue name '${queueName}'`,
    },
  });
}
if (body.force !== true) {
  return res.status(400).json({
    error: { code: 'FORCE_REQUIRED', message: 'force must be boolean true' },
  });
}
```

> **Alternative pattern — confirmation token (not implemented here):**  
> Some APIs issue a short-lived token for destructive operations: the admin first calls `POST /admin/queues/:queueName/failed/confirm-token` which returns a token valid for 60 seconds, then passes that token in the delete request. This is stronger because the token proves an interactive session rather than a scripted call, and it expires. Consider this pattern if you later add bulk operations or webhook-triggered automation that could accidentally hit destructive endpoints.

**Response 200:**

```json
{
  "data": { "purged": 47 },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Error responses:**

```json
// 400 — confirm doesn't match queue name
{ "error": { "code": "CONFIRMATION_MISMATCH", "message": "confirm must equal queue name 'email'", "statusCode": 400 } }

// 400 — force not provided or not boolean true
{ "error": { "code": "FORCE_REQUIRED", "message": "force must be boolean true", "statusCode": 400 } }
```

---

## Workers

### GET `/admin/workers` — Worker Registry and Health

Returns all worker instances registered in the database. Workers with no heartbeat within the timeout window are marked `healthy: false`.

**Heartbeat timeout:** Default 60 seconds, configurable via `WORKER_HEARTBEAT_TIMEOUT_MS` env var. The same value is used by the worker process to set its heartbeat interval (it sends a heartbeat at half this value to avoid edge-case races).

**Response 200:**

```json
{
  "data": [
    {
      "workerId": "worker-prod-1",
      "hostname": "app-server-1.internal",
      "status": "busy",
      "currentJobId": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
      "concurrency": 5,
      "processedCount": 1523,
      "failureCount": 22,
      "startedAt": "2026-08-06T08:00:00Z",
      "lastHeartbeatAt": "2026-08-06T10:15:28Z",
      "healthy": true
    },
    {
      "workerId": "worker-prod-2",
      "hostname": "app-server-2.internal",
      "status": "idle",
      "currentJobId": null,
      "concurrency": 5,
      "processedCount": 892,
      "failureCount": 4,
      "startedAt": "2026-08-06T08:00:00Z",
      "lastHeartbeatAt": "2026-08-06T09:45:00Z",
      "healthy": false
    }
  ],
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

`healthy: false` means `lastHeartbeatAt` is older than 60 seconds — the worker may have crashed. The row stays in the database until the worker restarts or is explicitly removed.

---

### POST `/admin/workers/:workerId/drain` — Drain a Worker

Signals a worker to finish its current job and then stop accepting new work. Used for graceful shutdown before deploying new worker code.

The worker detects this via a Redis flag (`worker:<workerId>:drain`). It completes its current job, then exits the processing loop.

**Response 200:**

```json
{
  "data": { "workerId": "worker-prod-1", "draining": true },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Error responses:**

```json
// 404 — worker not found
{
  "error": {
    "code": "WORKER_NOT_FOUND",
    "message": "Worker 'worker-prod-99' not found",
    "statusCode": 404
  }
}
```

---

### DELETE `/admin/workers/:workerId` — Remove Stale Worker

Removes a worker row from the database. Only valid for workers that are stale (no heartbeat for > 60s). Cannot remove a healthy worker — use drain first.

**Response 204:** No content.

**Error responses:**

```json
// 409 — worker is still healthy
{
  "error": {
    "code": "WORKER_STILL_ACTIVE",
    "message": "Worker last heartbeat was 12s ago. Drain it first.",
    "statusCode": 409
  }
}
```

---

## Dead Letter Queue

### GET `/admin/dlq` — List DLQ Entries

**Query parameters:**

| Param       | Type    | Default   | Description                                       |
| ----------- | ------- | --------- | ------------------------------------------------- |
| `reviewed`  | boolean | —         | `true` = reviewed only, `false` = unreviewed only |
| `reason`    | string  | —         | Filter by failure reason                          |
| `limit`     | int     | 50        | Max 200                                           |
| `offset`    | int     | 0         |                                                   |
| `sortBy`    | string  | `movedAt` | `movedAt` \| `failureCount` \| `replayCount`      |
| `sortOrder` | string  | `DESC`    | `ASC` \| `DESC`                                   |

**Response 200:**

```json
{
  "data": [
    {
      "id": "dlq-uuid-1",
      "jobId": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
      "job": {
        "type": "send-email",
        "name": "Invoice to john@example.com",
        "queueName": "email",
        "payload": { "to": "john@example.com" }
      },
      "reason": "Max retries exceeded",
      "failureCount": 4,
      "metadata": {
        "lastErrorType": "SMTPTimeout",
        "lastErrorMessage": "Connection refused on port 587"
      },
      "movedAt": "2026-08-06T10:05:00Z",
      "reviewedAt": null,
      "reviewedBy": null,
      "replayedAt": null,
      "replayCount": 0
    }
  ],
  "pagination": { "total": 12, "limit": 50, "offset": 0, "hasMore": false },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

---

### POST `/admin/dlq/:jobId/replay` — Replay from DLQ

Re-queues the job. Resets `retryCount` to 0 so it gets a fresh retry budget. Optionally override parameters before replaying.

**Request:**

```json
{
  "maxRetries": 5,
  "priority": 1,
  "delayMs": 5000
}
```

All fields optional. `delayMs` delays the first attempt, useful when replaying after fixing an external dependency.

**Server steps:**

```
1. Fetch DLQ entry + job
2. Apply overrides (maxRetries, priority)
3. UPDATE jobs SET status='delayed', retryCount=0, movedToDLQAt=null,
                   delayUntil=NOW()+delayMs, maxRetries=override
4. UPDATE dead_letter_queue SET replayedAt=NOW(), replayCount=replayCount+1
5. Push to Redis queue (BullMQ) with delay
6. INSERT INTO audit_log (action='dlq_job_replayed', userId=adminId)
7. Return updated job
```

**Response 200:**

```json
{
  "data": { ...job object with status: "delayed", retryCount: 0... },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

---

### PATCH `/admin/dlq/:jobId/review` — Mark as Reviewed

Marks a DLQ entry as reviewed without replaying it. Used when you've investigated and decided to discard the job.

**Request:**

```json
{
  "note": "Invalid email address — user account deleted. Safe to discard."
}
```

**Server steps:**

```
1. UPDATE dead_letter_queue SET reviewedAt=NOW(), reviewedBy=adminId, metadata.note=note
2. INSERT INTO audit_log (action='dlq_entry_reviewed', userId=adminId)
3. Return updated DLQ entry
```

**Response 200:** Updated DLQ entry.

---

### DELETE `/admin/dlq/:jobId` — Discard from DLQ

Permanently removes the DLQ entry and soft-deletes the job. Irreversible.

**Server steps:**

```
1. DELETE FROM dead_letter_queue WHERE jobId = ?
2. UPDATE jobs SET status='cancelled', cancelledAt=NOW()
3. INSERT INTO audit_log (action='dlq_job_discarded', userId=adminId)
4. Return 204
```

**Response 204:** No content.

---

## Users

### GET `/admin/users` — User List

**Query parameters:**

| Param       | Type   | Default     | Description                                           |
| ----------- | ------ | ----------- | ----------------------------------------------------- |
| `status`    | string | `active`    | `active` \| `suspended` \| `archived`                 |
| `role`      | string | —           | `admin` \| `user`                                     |
| `search`    | string | —           | `ILIKE '%query%'` on `email`, `firstName`, `lastName` |
| `limit`     | int    | 50          | Max 200                                               |
| `offset`    | int    | 0           |                                                       |
| `sortBy`    | string | `createdAt` | `createdAt` \| `lastLoginAt`                          |
| `sortOrder` | string | `DESC`      | `ASC` \| `DESC`                                       |

**Response 200:**

```json
{
  "data": [
    {
      "id": "user-uuid",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "status": "active",
      "lastLoginAt": "2026-08-05T14:30:00Z",
      "createdAt": "2026-01-15T09:00:00Z",
      "jobCount": 142
    }
  ],
  "pagination": { "total": 387, "limit": 50, "offset": 0, "hasMore": true },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

> `jobCount` is included for convenience — derived via a subquery on the `jobs` table.  
> Passwords and `passwordHash` are never returned.

---

### PATCH `/admin/users/:userId` — Update User

Update role or status. Cannot update email or password through this endpoint.

**Request:**

```json
{
  "role": "admin",
  "status": "suspended"
}
```

Both fields optional. At least one must be provided.

**Suspend behavior:** See [[API/01-Authentication]] — suspending revokes all refresh tokens immediately. Existing access tokens expire naturally within 15 minutes.

**Server steps:**

```
1. Validate at least one field provided
2. UPDATE users SET role=?, status=?, updatedAt=NOW()
3. If status → 'suspended':
   a. Revoke all refresh tokens for this userId
   b. INSERT INTO audit_log (action='user_suspended', userId=adminId, resourceId=userId)
4. If role changed:
   a. INSERT INTO audit_log (action='user_role_changed', metadata={from, to})
5. Return updated user (without passwordHash)
```

**Response 200:**

```json
{
  "data": { "id": "user-uuid", "email": "john@example.com", "role": "admin", "status": "active" },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

**Error responses:**

```json
// 400 — no fields provided
{ "error": { "code": "VALIDATION_ERROR", "message": "At least one of role or status must be provided", "statusCode": 400 } }

// 409 — self-demotion
{ "error": { "code": "SELF_MODIFICATION_FORBIDDEN", "message": "Admins cannot change their own role or status", "statusCode": 409 } }
```

> Block self-demotion — an admin accidentally suspending themselves or removing their own admin role would lock them out.

---

### DELETE `/admin/users/:userId/sessions` — Force Logout All Sessions

Revokes all active refresh tokens for a user. Their current access tokens expire within 15 minutes; no new tokens can be issued until they log in again.

**Response 204:** No content.

---

## Load Testing

### POST `/admin/load-test` — Trigger Load Test

Submits a batch of synthetic jobs for testing worker throughput and queue behavior. Jobs are tagged `load-test` for easy cleanup.

**Request:**

```json
{
  "jobType": "send-email",
  "queueName": "email",
  "jobCount": 100,
  "concurrency": 10,
  "payloadTemplate": {
    "to": "loadtest@example.com",
    "subject": "Load test"
  }
}
```

| Field             | Required | Notes                                                          |
| ----------------- | -------- | -------------------------------------------------------------- |
| `jobType`         | Yes      | Must be a known handler type                                   |
| `queueName`       | Yes      | Target queue                                                   |
| `jobCount`        | Yes      | 1–1000                                                         |
| `concurrency`     | No       | How fast to submit jobs (per second). Default 10.              |
| `payloadTemplate` | No       | Base payload — each job gets a `_loadTestIndex` field appended |

**Server steps:**

```
1. Validate jobCount <= 1000
2. Batch-insert jobs into PostgreSQL with tag 'load-test'
3. Push all to Redis queue in batches of 100
4. INSERT INTO audit_log (action='load_test_triggered', metadata={jobCount, queueName})
5. Return summary
```

**Response 202:** Accepted — jobs are being submitted asynchronously.

```json
{
  "data": {
    "loadTestId": "lt-uuid",
    "jobCount": 100,
    "queueName": "email",
    "status": "submitting",
    "tag": "load-test"
  },
  "meta": { "requestId": "req-a1b2c3d4" }
}
```

> Returns `202 Accepted` because large batches are submitted asynchronously. Track progress by filtering `GET /admin/jobs?tags=load-test`.

**Cleanup:** Delete all load test jobs with `DELETE /admin/jobs?tags=load-test` (not yet documented — add if needed).

---

## Error Code Reference

| Code                           | Status | When                                                |
| ------------------------------ | ------ | --------------------------------------------------- |
| `FORBIDDEN`                    | 403    | Authenticated user is not an admin                  |
| `QUEUE_NOT_FOUND`              | 404    | Queue name not in configured allowlist              |
| `QUEUE_ALREADY_PAUSED`         | 409    | Pause called on already-paused queue                |
| `QUEUE_NOT_PAUSED`             | 409    | Resume called on running queue                      |
| `QUEUE_IN_MAINTENANCE`         | 503    | Job submission rejected — queue in maintenance mode |
| `QUEUE_ALREADY_IN_MAINTENANCE` | 409    | Maintenance called on already-in-maintenance queue  |
| `WORKER_NOT_FOUND`             | 404    | Worker ID not in database                           |
| `WORKER_STILL_ACTIVE`          | 409    | Tried to delete a healthy worker                    |
| `JOB_NOT_FOUND`                | 404    | Job not found                                       |
| `JOB_ALREADY_IN_DLQ`           | 409    | Move-to-DLQ called on already-dead-lettered job     |
| `JOB_NOT_MOVABLE`              | 409    | Move-to-DLQ on terminal job (completed, cancelled)  |
| `SELF_MODIFICATION_FORBIDDEN`  | 409    | Admin trying to change their own role/status        |
| `VALIDATION_ERROR`             | 400    | Request body fails validation                       |

---

## Related Documentation

- [[API/00-Overview]] - Response envelope, request IDs, rate limiting
- [[API/01-Authentication]] - Token blacklisting, session revocation, suspension behavior
- [[API/02-Job-Endpoints]] - User-facing job endpoints
- [[DATABASE/05-Workers-Table]] - Worker schema
- [[DATABASE/06-DLQ-Table]] - DLQ schema
- [[PATTERNS/08-RBAC]] - Permission model
- [[PATTERNS/03-Dead-Letter-Queue]] - DLQ pattern and replay strategy
- [[PATTERNS/10-Graceful-Shutdown]] - Worker drain behavior
