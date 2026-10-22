# Error Handling

## Error Envelope

Every error response uses this shape, regardless of endpoint:

```typescript
interface ErrorResponse {
  error: {
    code: string; // Machine-readable, stable across versions
    message: string; // Human-readable, may change — do not parse
    statusCode: number; // Mirrors the HTTP status code
    requestId: string; // For tracing — same as X-Request-ID header
    timestamp: string; // ISO 8601
    details?: FieldError[]; // Only present on validation errors
  };
}

interface FieldError {
  field: string; // Dot-notation path: "payload.to", "tags[0]"
  message: string; // What's wrong with this field
  received?: unknown; // The value that was rejected (omitted for passwords)
}
```

**Example — validation error:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "statusCode": 400,
    "requestId": "req-b7e2d4f1",
    "timestamp": "2026-08-06T10:00:00Z",
    "details": [
      { "field": "maxRetries", "message": "Must be between 0 and 10", "received": 99 },
      {
        "field": "payload.to",
        "message": "Must be a valid email address",
        "received": "not-an-email"
      }
    ]
  }
}
```

**Example — business logic error:**

```json
{
  "error": {
    "code": "JOB_NOT_RETRYABLE",
    "message": "Job cannot be retried in status 'completed'",
    "statusCode": 409,
    "requestId": "req-c9f3e5a2",
    "timestamp": "2026-08-06T10:00:00Z"
  }
}
```

---

## HTTP Status Code Usage

| Code  | Used for                                                      | Notes                                                          |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| `400` | Validation errors, malformed requests                         | Always includes `details` array                                |
| `401` | Missing, expired, or invalid token                            | Client must re-authenticate                                    |
| `403` | Authenticated but not authorized                              | Don't reveal why — return generic message                      |
| `404` | Resource not found, or forbidden (to avoid enumeration)       | See note below                                                 |
| `409` | State conflict — request is valid but wrong for current state | e.g. retrying a completed job                                  |
| `413` | Payload too large                                             |                                                                |
| `429` | Rate limit exceeded                                           | Always includes `Retry-After` header                           |
| `500` | Unhandled server error                                        | Never leaks internals — log internally, return generic message |
| `503` | Dependency unreachable, or queue in maintenance               | Includes `Retry-After` header                                  |

**400 vs 409:** Use `400` when the request itself is malformed (bad types, missing fields). Use `409` when the request is structurally valid but conflicts with current state (cancelling an already-cancelled job). A `400` means "fix your request." A `409` means "your request is fine, but the timing is wrong."

**401 vs 403:** Use `401` when there is no valid identity (no token, expired token, bad signature). Use `403` when identity is established but permission is denied. Never return `403` on a route that requires authentication if the token is missing — that's `401`.

**404 vs 403 for ownership checks:** When user A requests user B's job, return `404`, not `403`. Returning `403` confirms the resource exists. This is documented in [[API/02-Job-Endpoints]] but the rule is universal: never confirm a resource exists to an unauthorised caller.

---

## Error Categories

### 1. Authentication Errors

Client must re-authenticate before retrying.

| Code                  | HTTP | Trigger                                             |
| --------------------- | ---- | --------------------------------------------------- |
| `MISSING_TOKEN`       | 401  | No `Authorization` header                           |
| `INVALID_TOKEN`       | 401  | Token fails signature verification                  |
| `TOKEN_EXPIRED`       | 401  | `exp` claim is in the past                          |
| `TOKEN_REVOKED`       | 401  | `jti` found in Redis blacklist                      |
| `INVALID_CREDENTIALS` | 401  | Wrong email or password (intentionally vague)       |
| `ACCOUNT_SUSPENDED`   | 403  | User `status = 'suspended'`                         |
| `SESSION_COMPROMISED` | 401  | Refresh token reuse detected — all sessions revoked |

### 2. Authorization Errors

Client is authenticated but lacks permission. Do not retry without a role change.

| Code        | HTTP | Trigger                                                   |
| ----------- | ---- | --------------------------------------------------------- |
| `FORBIDDEN` | 403  | Correct role required (e.g. non-admin hitting `/admin/*`) |

### 3. Validation Errors

Fix the request before retrying.

| Code                    | HTTP | Trigger                                              |
| ----------------------- | ---- | ---------------------------------------------------- |
| `VALIDATION_ERROR`      | 400  | Zod schema failure — always includes `details`       |
| `PAYLOAD_TOO_LARGE`     | 413  | Job payload exceeds 1MB                              |
| `UNKNOWN_QUEUE`         | 400  | `queueName` not in configured allowlist              |
| `CONFIRMATION_MISMATCH` | 400  | Destructive operation confirmation string wrong      |
| `FORCE_REQUIRED`        | 400  | `force: true` not provided for destructive operation |

### 4. State Conflict Errors

Request is valid but conflicts with current resource state.

| Code                           | HTTP | Trigger                                      |
| ------------------------------ | ---- | -------------------------------------------- |
| `JOB_NOT_FOUND`                | 404  | Job doesn't exist or belongs to another user |
| `JOB_NOT_RETRYABLE`            | 409  | Retry on non-failed job                      |
| `JOB_NOT_CANCELLABLE`          | 409  | Cancel on terminal job                       |
| `JOB_NOT_MOVABLE`              | 409  | Move-to-DLQ on terminal job                  |
| `JOB_ALREADY_IN_DLQ`           | 409  | Move-to-DLQ on already-dead-lettered job     |
| `QUEUE_NOT_FOUND`              | 404  | Queue name unknown                           |
| `QUEUE_ALREADY_PAUSED`         | 409  | Pause on already-paused queue                |
| `QUEUE_NOT_PAUSED`             | 409  | Resume on running queue                      |
| `QUEUE_ALREADY_IN_MAINTENANCE` | 409  | Maintenance on already-in-maintenance queue  |
| `WORKER_NOT_FOUND`             | 404  | Worker ID not in database                    |
| `WORKER_STILL_ACTIVE`          | 409  | Delete on healthy worker                     |
| `SELF_MODIFICATION_FORBIDDEN`  | 409  | Admin changing own role or status            |

### 5. Rate Limit Errors

Retry after the `Retry-After` header value.

| Code           | HTTP | Trigger                               |
| -------------- | ---- | ------------------------------------- |
| `RATE_LIMITED` | 429  | Global or per-endpoint limit exceeded |

```
HTTP/1.1 429 Too Many Requests
Retry-After: 847
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1754476800
```

### 6. System Errors

Transient — safe to retry with backoff.

| Code                   | HTTP | Trigger                                            |
| ---------------------- | ---- | -------------------------------------------------- |
| `INTERNAL_ERROR`       | 500  | Unhandled exception — details logged, not returned |
| `QUEUE_IN_MAINTENANCE` | 503  | Job submitted to queue in maintenance mode         |
| `SERVICE_UNAVAILABLE`  | 503  | PostgreSQL or Redis unreachable                    |

---

## Retryability

| Category                  | Retryable?                      | Strategy                            |
| ------------------------- | ------------------------------- | ----------------------------------- |
| Auth (401)                | Only after re-authenticating    | Refresh token, then retry once      |
| Auth (403)                | No                              | User needs different permissions    |
| Validation (400, 413)     | No — fix the request first      |                                     |
| State conflict (409)      | Maybe — depends on the conflict | Check current state before retrying |
| Not found (404)           | No                              |                                     |
| Rate limit (429)          | Yes                             | Wait `Retry-After` seconds          |
| Server error (500)        | Yes                             | Exponential backoff, max 3 attempts |
| Service unavailable (503) | Yes                             | Wait `Retry-After` seconds          |

**409 retryability nuance:** A `JOB_NOT_RETRYABLE` (retrying a completed job) is never retryable — the state won't change. A `QUEUE_ALREADY_PAUSED` is retryable if you're writing idempotent infra scripts — the queue is already in the desired state, treat it as success.

---

## Idempotency and Errors

If a request fails partway through (network drop after the DB write but before the Redis push), retrying with the same `idempotencyKey` returns the existing job — the error is effectively healed. This is the main reason to use idempotency keys on job submissions.

For all other endpoints (cancel, retry, etc.), operations are idempotent at the state level — cancelling an already-cancelled job returns `409 JOB_NOT_CANCELLABLE`, which the client can treat as success if its intent was to ensure the job is stopped.

---

## Internal Error Handling

### Fastify Error Handler

All unhandled errors are routed to a single `setErrorHandler` hook. This is the only place that writes to the response on error.

```typescript
// apps/api/src/app.ts
fastify.setErrorHandler((error, request, reply) => {
  // request.id is built-in — Fastify generates it automatically
  // (or reads X-Request-ID if genReqId is configured — see setup below)
  const requestId = request.id;

  if (error instanceof AppError) {
    // Known, intentional errors
    request.log.warn({ code: error.code, statusCode: error.statusCode }, error.message);
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        requestId,
        timestamp: new Date().toISOString(),
        ...(error.details && { details: error.details }),
      },
    });
  }

  // Unhandled — log full stack, return generic message
  request.log.error({ err: error }, 'Unhandled error');
  reply.status(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      statusCode: 500,
      requestId,
      timestamp: new Date().toISOString(),
    },
  });
});
```

**Key differences from Express:**

- `setErrorHandler` replaces the 4-argument `(err, req, res, next)` middleware pattern
- `request` / `reply` instead of `req` / `res`
- `reply.status(n).send(body)` instead of `res.status(n).json(body)`
- `request.log` is Fastify's per-request Pino logger — no separate logger import needed
- No `next` parameter — throwing or returning ends the handler

### Request ID Setup

Fastify generates a numeric request ID by default. To read the incoming `X-Request-ID` header (for load balancer pass-through) and fall back to a UUID:

```typescript
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';

const fastify = Fastify({
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
  logger: {
    level: config.LOG_LEVEL,
    // Pino is built-in — structured JSON logging with no extra setup
  },
});
```

`request.id` will then be whatever `genReqId` returns, and Fastify automatically includes it in every log line written via `request.log`.

### AppError Class

All intentional errors are thrown as `AppError` instances so the middleware can distinguish them from unexpected crashes.

```typescript
class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: FieldError[]
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Usage in a service
throw new AppError('JOB_NOT_FOUND', 'Job not found', 404);
throw new AppError('VALIDATION_ERROR', 'Validation failed', 400, zodErrors);
```

### What Gets Logged

| Error type               | Log level | Includes stack trace?  |
| ------------------------ | --------- | ---------------------- |
| Auth errors (401/403)    | `warn`    | No                     |
| Validation errors (400)  | `info`    | No                     |
| State conflicts (409)    | `warn`    | No                     |
| Rate limits (429)        | `info`    | No                     |
| Unhandled (500)          | `error`   | Yes — server-side only |
| System unavailable (503) | `error`   | Yes — server-side only |

Stack traces are never sent to the client. They are logged with the `requestId` via Pino (Fastify's built-in logger) so they can be retrieved by support when a client reports an error.

---

## What Clients Should Do

```typescript
async function apiCall(url: string, options: RequestInit) {
  const res = await fetch(url, options);

  if (res.ok) return res.json();

  const body = await res.json();
  const { code, requestId } = body.error;

  switch (code) {
    case 'TOKEN_EXPIRED':
      // Refresh and retry once
      await refreshTokens();
      return apiCall(url, options);

    case 'RATE_LIMITED':
    case 'SERVICE_UNAVAILABLE':
    case 'QUEUE_IN_MAINTENANCE': {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60');
      await sleep(retryAfter * 1000);
      return apiCall(url, options);
    }

    case 'INTERNAL_ERROR':
      // Retry with backoff, surface requestId to user for support
      throw new RetryableError(code, requestId);

    case 'VALIDATION_ERROR':
      // Never retry — show field errors to user
      throw new ValidationError(body.error.details);

    default:
      // Surface requestId so user can report it
      throw new ApiError(code, requestId);
  }
}
```

Always surface `requestId` to the end user when an error is unresolvable — "Something went wrong. Reference: req-b7e2d4f1" lets support find the server-side log entry.

---

## Related Documentation

- [[API/00-Overview]] - Error envelope in context of full response format
- [[API/01-Authentication]] - Auth-specific error flows
- [[API/02-Job-Endpoints]] - Job error codes
- [[API/03-Admin-Endpoints]] - Admin error codes
- [[COMPONENTS/01-API-Service]] - Error middleware implementation
