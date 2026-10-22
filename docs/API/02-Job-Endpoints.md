# Job Endpoints

Base path: `/api/v1/jobs`  
All endpoints require `Authorization: Bearer <accessToken>` unless noted.

---

## Job Object (Full Shape)

Returned by all job endpoints. Learn this once — every endpoint returns this same shape (or a subset of it).

```typescript
interface Job {
  // ── Set by the client on submission ──────────────────────────────────────
  type: string; // "send-email" | "process-payment" | etc.
  name: string | null; // Human-readable label
  queueName: string; // "email" | "payment" | "background"
  priority: number; // -100 to 100, default 0
  payload: Record<string, unknown>; // Input passed to the handler
  maxRetries: number; // Default 3
  idempotencyKey: string | null;
  delayUntil: string | null; // ISO 8601 — schedule job in the future
  tags: string[]; // e.g. ["stripe", "invoice"]
  estimatedDurationMs: number | null;

  // ── Read-only: managed by the server / workers ───────────────────────────
  // Do not send these on submission. Any values provided will be ignored.
  id: string; // UUID, assigned at creation
  userId: string; // UUID, set from the authenticated user
  status: JobStatus; // Driven by the state machine
  retryCount: number; // Incremented by the worker on each failure
  progress: number; // 0–100, updated by the worker mid-execution
  result: Record<string, unknown> | null; // Populated on success
  createdAt: string; // ISO 8601
  startedAt: string | null; // Set when a worker picks up the job
  completedAt: string | null; // Set on successful completion
  failedAt: string | null; // Set on each failure
  movedToDLQAt: string | null; // Set when max retries are exhausted
  cancelledAt: string | null; // Set when status transitions to 'cancelled'
  updatedAt: string; // Updated on every state transition
}

type JobStatus =
  'queued' | 'active' | 'completed' | 'failed' | 'delayed' | 'dead_letter' | 'paused' | 'cancelled';
```

### Job Lifecycle

```
         submit
           │
           ▼
        ┌─────────┐
   ┌───►│ QUEUED  │◄─────────────────────────────┐
   │    └────┬────┘                               │
   │         │ worker picks up                    │ admin replays
   │         ▼                                    │
   │    ┌─────────┐   success    ┌─────────────┐  │
   │    │ ACTIVE  ├─────────────►│  COMPLETED  │  │  ← terminal
   │    └────┬────┘              └─────────────┘  │
   │         │                                    │
   │         │ admin pause    ┌────────┐          │
   │         ├───────────────►│ PAUSED │          │
   │         │                └───┬────┘          │
   │         │                    │ admin resume  │
   │         │                    └──────► ACTIVE │
   │         │ failure                            │
   │         ▼                                    │
   │    ┌─────────┐                               │
   │    │ FAILED  │                               │
   │    └────┬────┘                               │
   │         │                                    │
   │   retries left?                              │
   │         │                                    │
   │    yes  │  no                                │
   │    ▼    │   ▼                                │
   │ ┌───────┴┐  ┌─────────────┐                 │
   └─┤ DELAYED│  │ DEAD_LETTER ├─────────────────┘
     └────────┘  └─────────────┘  ← terminal unless replayed
     (backoff timer fires → QUEUED)

  QUEUED, ACTIVE*, DELAYED, PAUSED → CANCELLED  ← terminal
  * active jobs cancel at next worker checkpoint, not instantly
```

---

## Endpoints

### POST `/jobs` — Submit a Job

Creates a new job and pushes it to the Redis queue.

**RBAC:** Any authenticated user.

**Request:**

```json
{
  "type": "send-email",
  "name": "Welcome email for john@example.com",
  "queueName": "email",
  "payload": {
    "to": "john@example.com",
    "subject": "Welcome",
    "template": "welcome-v2"
  },
  "priority": 0,
  "maxRetries": 3,
  "idempotencyKey": "stripe-evt-abc123",
  "delayUntil": "2026-08-07T03:00:00Z",
  "tags": ["marketing", "welcome"],
  "estimatedDurationMs": 2000
}
```

| Field                 | Required | Type     | Notes                                                       |
| --------------------- | -------- | -------- | ----------------------------------------------------------- |
| `type`                | Yes      | string   | Identifies which handler processes this job                 |
| `queueName`           | Yes      | string   | Which queue to push to                                      |
| `payload`             | Yes      | object   | Passed to the handler as-is                                 |
| `name`                | No       | string   | Human-readable label for the dashboard                      |
| `priority`            | No       | int      | Default `0`. Higher = processed sooner                      |
| `maxRetries`          | No       | int      | Default `3`. Max `10`.                                      |
| `idempotencyKey`      | No       | string   | Unique per user — duplicate submission returns existing job |
| `delayUntil`          | No       | ISO 8601 | Schedule job in the future                                  |
| `tags`                | No       | string[] | For filtering. Max 10 tags, 50 chars each                   |
| `estimatedDurationMs` | No       | int      | Used for analytics only                                     |

**Validation rules:**

- `type` max 100 chars
- `queueName` max 100 chars, must match a known queue (configurable allowlist)
- `payload` max 1MB serialized
- `maxRetries` between 0 and 10
- `priority` between -100 and 100
- `tags` max 10 items, each max 50 chars
- `idempotencyKey` max 255 chars

**Response 201:**

Every response includes a `requestId` in the `meta` envelope and as an `X-Request-ID` header. Clients should log or display this — it's the key for tracing a specific call in server logs.

```
HTTP/1.1 201 Created
X-Request-ID: req-b7e2d4f1-1a3c-4e5f-8b9d
```

```json
{
  "data": {
    "id": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
    "type": "send-email",
    "name": "Welcome email for john@example.com",
    "queueName": "email",
    "status": "queued",
    "priority": 0,
    "payload": { "to": "john@example.com", "subject": "Welcome", "template": "welcome-v2" },
    "result": null,
    "maxRetries": 3,
    "retryCount": 0,
    "progress": 0,
    "idempotencyKey": "stripe-evt-abc123",
    "delayUntil": null,
    "tags": ["marketing", "welcome"],
    "createdAt": "2026-08-06T10:00:00Z",
    "startedAt": null,
    "completedAt": null,
    "failedAt": null,
    "updatedAt": "2026-08-06T10:00:00Z"
  },
  "meta": {
    "requestId": "req-b7e2d4f1-1a3c-4e5f-8b9d"
  }
}
```

**Idempotency behavior (409 is wrong here):**

If an `idempotencyKey` is provided and a job with that key already exists for this user, the server returns the **existing job** with `200 OK` — not `409`. This is the correct behavior: the client's intent was "ensure this job exists," and it does.

```json
// Duplicate submission — 200, not 201
{
  "data": { ...existing job... },
  "meta": { "idempotent": true }
}
```

**Error responses:**

```json
// 400 — validation failed
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "statusCode": 400,
    "details": [
      { "field": "maxRetries", "message": "Must be between 0 and 10" }
    ]
  }
}

// 400 — unknown queue
{ "error": { "code": "UNKNOWN_QUEUE", "message": "Queue 'foobar' is not configured", "statusCode": 400 } }

// 413 — payload too large
{ "error": { "code": "PAYLOAD_TOO_LARGE", "message": "Payload exceeds 1MB limit", "statusCode": 413 } }
```

---

### GET `/jobs` — List Jobs

Returns the authenticated user's jobs. Admins can see all jobs via `GET /admin/jobs` (see [[API/03-Admin-Endpoints]]).

**RBAC:** User sees own jobs only. Admin sees own jobs here too — use `/admin/jobs` for all.

**Query Parameters:**

| Param       | Type               | Default     | Description                                                                                                    |
| ----------- | ------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `status`    | string (comma-sep) | all         | Filter by status. e.g. `?status=queued,active`                                                                 |
| `type`      | string             | —           | Filter by job type. e.g. `?type=send-email`                                                                    |
| `queueName` | string             | —           | Filter by queue                                                                                                |
| `tags`      | string (comma-sep) | —           | Jobs that have ALL listed tags                                                                                 |
| `search`    | string             | —           | Case-insensitive substring match on `name` (`ILIKE '%query%'`). Not anchored — matches anywhere in the string. |
| `limit`     | int                | 50          | Max 200                                                                                                        |
| `offset`    | int                | 0           | For pagination                                                                                                 |
| `sortBy`    | string             | `createdAt` | `createdAt` \| `updatedAt` \| `priority` — any other value returns `400 VALIDATION_ERROR`                      |
| `sortOrder` | string             | `DESC`      | `ASC` \| `DESC` — any other value returns `400 VALIDATION_ERROR`                                               |
| `from`      | ISO 8601           | —           | Filter jobs created after this time                                                                            |
| `to`        | ISO 8601           | —           | Filter jobs created before this time                                                                           |

**Example:**

```
GET /api/v1/jobs?status=failed,dead_letter&tags=stripe&limit=20&sortBy=createdAt&sortOrder=DESC
```

**Response 200:**

```json
{
  "data": [
    { ...job object... },
    { ...job object... }
  ],
  "pagination": {
    "total": 143,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

> `total` reflects the count after filters are applied — use it to drive pagination UI.

**Notes:**

- Cancelled jobs are excluded by default. Pass `?status=cancelled` to include them explicitly.
- `tags` filter is AND — `?tags=stripe,invoice` returns jobs that have **both** tags.
- `search` uses `ILIKE '%query%'` — case-insensitive, matches anywhere in `name`. An empty string is treated as no filter (not an error).

---

### GET `/jobs/:jobId` — Get Job Details

Returns a single job with its full execution history and recent logs.

**RBAC:** User can fetch own jobs. Admin can fetch any job.

**Response 200:**

```json
{
  "data": {
    "id": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
    "type": "send-email",
    "status": "completed",
    "retryCount": 1,
    "result": { "messageId": "msg-456" },
    "createdAt": "2026-08-06T10:00:00Z",
    "completedAt": "2026-08-06T10:00:05Z",

    "executions": [
      {
        "id": "exec-uuid-1",
        "attempt": 1,
        "status": "failed",
        "workerId": "worker-1",
        "startedAt": "2026-08-06T10:00:01Z",
        "endedAt": "2026-08-06T10:00:02Z",
        "durationMs": 1000,
        "errorType": "SMTPTimeout",
        "errorMessage": "Connection refused on port 587",
        "errorStack": "Error: Connection refused\n  at smtp.connect..."
      },
      {
        "id": "exec-uuid-2",
        "attempt": 2,
        "status": "completed",
        "workerId": "worker-2",
        "startedAt": "2026-08-06T10:00:04Z",
        "endedAt": "2026-08-06T10:00:05Z",
        "durationMs": 1000,
        "result": { "messageId": "msg-456" }
      }
    ],

    "logs": [
      {
        "id": "log-uuid-1",
        "executionId": "exec-uuid-2",
        "level": "info",
        "message": "Connecting to SMTP server",
        "timestamp": "2026-08-06T10:00:04Z"
      },
      {
        "id": "log-uuid-2",
        "executionId": "exec-uuid-2",
        "level": "info",
        "message": "Email sent successfully",
        "data": { "messageId": "msg-456" },
        "timestamp": "2026-08-06T10:00:05Z"
      }
    ]
  }
}
```

`logs` returns the last 100 entries for the most recent execution. For full log history, see the query params below.

**Query params for detail view:**

| Param         | Default | Description                              |
| ------------- | ------- | ---------------------------------------- |
| `logsLimit`   | 100     | How many log lines to include            |
| `logsOffset`  | 0       | Pagination for logs                      |
| `executionId` | latest  | Pin logs to a specific execution attempt |

**Error responses:**

```json
// 404 — job not found (or belongs to another user)
{ "error": { "code": "JOB_NOT_FOUND", "message": "Job not found", "statusCode": 404 } }
```

> Return 404 (not 403) when a user requests another user's job — don't confirm the job exists.

---

### GET `/jobs/:jobId/status` — Lightweight Status

Returns only the fields a polling client needs to track progress. Use this instead of `GET /jobs/:jobId` when you don't need execution history or logs — it's a smaller payload and skips the joins.

**RBAC:** Same as `GET /jobs/:jobId` — own job or admin.

**Response 200:**

```json
{
  "data": {
    "id": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
    "status": "active",
    "progress": 42,
    "retryCount": 0,
    "startedAt": "2026-08-06T10:00:01Z",
    "updatedAt": "2026-08-06T10:00:04Z"
  },
  "meta": {
    "requestId": "req-c9f3e5a2-2b4d-6f7e-9c1a"
  }
}
```

**When to use each endpoint:**

| Situation                              | Endpoint                                  |
| -------------------------------------- | ----------------------------------------- |
| Dashboard job detail page              | `GET /jobs/:jobId`                        |
| Polling for completion (e.g. every 2s) | `GET /jobs/:jobId/status`                 |
| Real-time updates                      | WebSocket — see [[WEBSOCKET/00-Overview]] |

> **Prefer WebSocket over polling.** The status endpoint exists for clients that can't use WebSocket (server-to-server, CLI tools). For a browser dashboard, subscribe to `job:${jobId}` events instead — the server pushes updates rather than the client pulling them.

---

### POST `/jobs/:jobId/retry` — Retry a Failed Job

Manually re-queues a failed or dead-letter job. Resets `retryCount` to 0 so it gets the full `maxRetries` budget again.

**RBAC:** User can retry own jobs. Admin can retry any job.

**Allowed current statuses:** `failed`, `dead_letter`  
**Not allowed:** `queued`, `active`, `completed`, `cancelled`, `paused`

**Request body (optional):**

```json
{
  "maxRetries": 5,
  "priority": 1
}
```

Both fields are optional overrides — useful when retrying from DLQ with adjusted parameters.

**Server steps:**

```
1. Fetch job — check exists + RBAC
2. Validate status is retryable (failed or dead_letter)
3. Apply overrides (maxRetries, priority) if provided
4. Reset: retryCount = 0, status = 'queued', failedAt = null, movedToDLQAt = null
5. Remove from DLQ table if dead_letter
6. Push to Redis queue (BullMQ)
7. INSERT INTO audit_log (action='job_retried_manually')
8. Return updated job
```

**Response 200:**

```json
{
  "data": { ...job object with status: "queued", retryCount: 0... }
}
```

**Error responses:**

```json
// 409 — job is not in a retryable state
{
  "error": {
    "code": "JOB_NOT_RETRYABLE",
    "message": "Job cannot be retried in status 'completed'",
    "statusCode": 409
  }
}

// 403 — user trying to retry another user's job
{ "error": { "code": "FORBIDDEN", "message": "Access denied", "statusCode": 403 } }
```

---

### POST `/jobs/:jobId/cancel` — Cancel a Job

Stops a job and marks it as cancelled. Behaviour differs by current status.

**RBAC:** User can cancel own jobs. Admin can cancel any job.

**Allowed current statuses:** `queued`, `active`, `delayed`, `paused`  
**Not allowed:** `completed`, `dead_letter`, `cancelled`

**Request body (optional):**

```json
{
  "reason": "User requested cancellation from dashboard"
}
```

**Cancellation behaviour by status:**

| Current Status | What happens                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `queued`       | Removed from Redis queue. `status = cancelled`, `cancelledAt = NOW()`                                  |
| `delayed`      | Removed from BullMQ delayed set. `status = cancelled`, `cancelledAt = NOW()`                           |
| `paused`       | Marked cancelled immediately                                                                           |
| `active`       | Worker detects cancellation flag on next checkpoint. Job stops at the next safe point — not instantly. |

> For `active` jobs: the worker polls a `job:<id>:cancelled` Redis key. The API sets this key; the worker checks it between processing steps and exits cleanly. There is no guarantee of immediate termination.

**Server steps:**

```
1. Fetch job — check exists + RBAC
2. Validate status is cancellable
3. If queued/delayed: remove from Redis via BullMQ API
4. If active: SET job:<jobId>:cancelled 1 EX 3600 in Redis (worker will detect)
5. UPDATE jobs SET status='cancelled', cancelledAt=NOW()
6. INSERT INTO audit_log (action='job_cancelled', metadata={reason})
7. Return updated job
```

**Response 200:**

```json
{
  "data": { ...job object with status: "cancelled"... }
}
```

**Error responses:**

```json
// 409 — job already in terminal state
{
  "error": {
    "code": "JOB_NOT_CANCELLABLE",
    "message": "Job cannot be cancelled in status 'completed'",
    "statusCode": 409
  }
}
```

---

## Error Code Reference

All job endpoint errors use the standard error envelope from [[API/00-Overview]].

| Code                  | Status | When                                          |
| --------------------- | ------ | --------------------------------------------- |
| `VALIDATION_ERROR`    | 400    | Request body fails Zod schema                 |
| `UNKNOWN_QUEUE`       | 400    | `queueName` not in configured allowlist       |
| `PAYLOAD_TOO_LARGE`   | 413    | `payload` exceeds 1MB                         |
| `UNAUTHORIZED`        | 401    | Missing or invalid access token               |
| `TOKEN_EXPIRED`       | 401    | Access token expired                          |
| `FORBIDDEN`           | 403    | Authenticated but no permission (wrong owner) |
| `JOB_NOT_FOUND`       | 404    | Job doesn't exist or belongs to another user  |
| `JOB_NOT_RETRYABLE`   | 409    | Retry attempted on non-failed job             |
| `JOB_NOT_CANCELLABLE` | 409    | Cancel attempted on terminal job              |
| `RATE_LIMITED`        | 429    | Global rate limit hit                         |

---

## Related Documentation

- [[API/00-Overview]] - All endpoints, error format, pagination
- [[API/01-Authentication]] - Auth middleware, RBAC
- [[API/03-Admin-Endpoints]] - Admin job list, DLQ, queue stats
- [[DATABASE/02-Jobs-Table]] - Full job schema and indexes
- [[JOB-LIFECYCLE/00-Overview]] - State machine and valid transitions
- [[PATTERNS/01-Idempotency]] - Idempotency key pattern
