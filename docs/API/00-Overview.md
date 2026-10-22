# API Overview

## RESTful API

Base URL: `http://localhost:3000/api/v1`

Interactive API docs (Swagger UI, generated from the same Zod schemas used for validation): `http://localhost:3000/docs`

All responses are JSON. All requests require `Authorization: Bearer <accessToken>` header except `/auth/login` and `/auth/refresh`.

## Authentication

Short-lived access token + rotating refresh token, not a single long-lived JWT. Full flow (rotation, reuse detection, blacklisting) in [[API/01-Authentication]].

### POST `/auth/login`

```
{
  "email": "user@example.com",
  "password": "password"
}

Response 200 (refresh token also set as an HttpOnly cookie for browser clients):
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "role": "user"
  }
}
```

### POST `/auth/refresh`

Exchanges the refresh token (cookie, for browser clients) for a new access token. See [[API/01-Authentication]] for rotation details.

## Job Endpoints

### POST `/jobs` - Submit Job

Required: `Authorization` header

```json
{
  "type": "send-email",
  "name": "Welcome to john@example.com",
  "queueName": "email",
  "payload": { "to": "john@example.com", "subject": "Welcome" },
  "priority": 1,
  "maxRetries": 3,
  "idempotencyKey": "webhook-123",
  "delayUntil": "2026-07-02T15:30:00Z",
  "tags": ["marketing", "welcome"]
}
```

### GET `/jobs` - List User's Jobs

Query params:

```
?status=active,completed
&type=send-email
&tags=marketing
&limit=50
&offset=0
&sortBy=createdAt
&sortOrder=DESC
```

### GET `/jobs/:jobId` - Get Job Details

Includes execution history and logs.

### POST `/jobs/:jobId/retry` - Retry Failed Job

User can retry own jobs, admin can retry any.

### POST `/jobs/:jobId/cancel` - Cancel Job

User can cancel own jobs, admin can cancel any.

## Admin-Only Endpoints

### GET `/admin/queues` - Queue Statistics

```json
{
  "queues": [
    {
      "name": "email",
      "waiting": 145,
      "active": 3,
      "delayed": 12,
      "failed": 5,
      "completed": 8234
    }
  ]
}
```

### GET `/admin/workers` - Worker Health

```json
{
  "workers": [
    {
      "id": "worker-1",
      "status": "busy",
      "currentJobId": "job-123",
      "jobsProcessed": 1523,
      "jobsSucceeded": 1501,
      "jobsFailed": 22,
      "avgProcessingTime": 2345,
      "lastHeartbeat": "2026-07-02T10:15:30Z"
    }
  ]
}
```

### GET `/admin/dlq` - Dead Letter Queue

List jobs that permanently failed.

### POST `/admin/dlq/:jobId/replay` - Replay from DLQ

```json
{
  "maxRetries": 5,
  "delayMs": 5000
}
```

### POST `/admin/load-test` - Trigger Load Test

```json
{
  "jobType": "send-email",
  "jobCount": 100,
  "concurrency": 10
}
```

## Error Responses

Every response — success or error — includes an `X-Request-ID` response header. Clients should surface this to users so support can trace the call in server logs.

All errors follow this format:

```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job with id 'xyz' not found",
    "statusCode": 404,
    "timestamp": "2026-07-02T10:00:00Z",
    "requestId": "req-b7e2d4f1-1a3c-4e5f-8b9d"
  }
}
```

Success responses carry the same ID in `meta`:

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req-b7e2d4f1-1a3c-4e5f-8b9d"
  }
}
```

The `requestId` comes from Fastify's built-in per-request ID generation (`genReqId`, backed by `crypto.randomUUID()`) and is attached to the request-scoped Pino logger so every log line for that request carries it automatically.

### Common Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad request (validation error)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not found
- `409` - Conflict (idempotency key collision)
- `429` - Rate limited
- `500` - Server error

## Rate Limiting

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1656842400
```

Limit: 1000 requests per 15 minutes.

## Response Format

### Job Object

```json
{
  "id": "job-uuid",
  "userId": "user-uuid",
  "type": "send-email",
  "name": "Welcome email",
  "queueName": "email",
  "status": "completed",
  "payload": { "to": "user@example.com" },
  "result": { "messageId": "msg-123" },
  "priority": 1,
  "retryCount": 0,
  "maxRetries": 3,
  "progress": 100,
  "tags": ["marketing"],
  "createdAt": "2026-07-02T10:00:00Z",
  "startedAt": "2026-07-02T10:00:01Z",
  "completedAt": "2026-07-02T10:00:03Z",
  "cancelledAt": null
}
```

## Pagination

```json
{
  "data": [...],
  "pagination": {
    "total": 523,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  }
}
```

## Related Documentation

- [[COMPONENTS/01-API-Service]] - API implementation
- [[API/01-Authentication]] - JWT details
- [[API/02-Job-Endpoints]] - Detailed endpoint docs
- [[API/03-Admin-Endpoints]] - Admin endpoint docs
- [[API/04-Error-Handling]] - Error formats
