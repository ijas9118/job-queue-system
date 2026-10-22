# Audit Log Table

## Purpose

**Immutable append-only audit trail** for compliance, security, and debugging. Records all meaningful system events: job submissions, admin actions, permission changes, errors.

**Critical**: Never update or delete. Only append.

## Schema

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID,
  action VARCHAR(100) NOT NULL,
  resourceType VARCHAR(50),
  resourceId VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'success',
  details JSONB,
  ipAddress VARCHAR(45),
  userAgent VARCHAR(500),
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),

  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
);
```

## Columns

| Column         | Type         | Purpose                                                         |
| -------------- | ------------ | --------------------------------------------------------------- |
| `id`           | UUID         | Unique log entry ID                                             |
| `userId`       | UUID         | User who performed action (null for system)                     |
| `action`       | VARCHAR(100) | Action type: 'job_submitted', 'admin_login', 'dlq_replay', etc. |
| `resourceType` | VARCHAR(50)  | What was affected: 'job', 'worker', 'user', etc.                |
| `resourceId`   | VARCHAR(255) | ID of affected resource                                         |
| `status`       | VARCHAR(50)  | 'success', 'failure', 'error'                                   |
| `details`      | JSONB        | Structured event data                                           |
| `ipAddress`    | VARCHAR(45)  | Client IP address (IPv4 or IPv6)                                |
| `userAgent`    | VARCHAR(500) | User-Agent header                                               |
| `createdAt`    | TIMESTAMP    | Event timestamp                                                 |

## Constraints

```sql
-- Valid action types
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_log_action
  CHECK (action IN (
    'job_submitted',
    'job_started',
    'job_completed',
    'job_failed',
    'job_cancelled',
    'job_paused',
    'job_resumed',
    'dlq_replay',
    'dlq_cleared',
    'worker_registered',
    'worker_deregistered',
    'worker_paused',
    'admin_login',
    'admin_logout',
    'admin_load_test',
    'user_created',
    'user_deleted',
    'password_changed',
    'role_changed',
    'permission_denied'
  ));

-- Valid statuses
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_log_status
  CHECK (status IN ('success', 'failure', 'error'));

-- Valid resource types
ALTER TABLE audit_log ADD CONSTRAINT ck_audit_log_resourceType
  CHECK (resourceType IS NULL OR resourceType IN (
    'job', 'execution', 'user', 'worker', 'system'
  ));

-- Prevent updates and deletes (immutable)
CREATE RULE prevent_audit_log_updates AS
  ON UPDATE TO audit_log DO INSTEAD NOTHING;

CREATE RULE prevent_audit_log_deletes AS
  ON DELETE TO audit_log DO INSTEAD NOTHING;
```

## Indexes

```sql
-- Find logs by user (who did what)
CREATE INDEX idx_audit_log_userId_createdAt
  ON audit_log(userId, createdAt DESC)
  WHERE userId IS NOT NULL;

-- Find logs by action (what happened)
CREATE INDEX idx_audit_log_action_createdAt
  ON audit_log(action, createdAt DESC);

-- Find logs by resource (what was affected)
CREATE INDEX idx_audit_log_resourceType_resourceId
  ON audit_log(resourceType, resourceId);

-- Timeline queries (recent events)
CREATE INDEX idx_audit_log_createdAt
  ON audit_log(createdAt DESC);

-- Security: find failed access attempts
CREATE INDEX idx_audit_log_status_action_createdAt
  ON audit_log(status, action, createdAt DESC)
  WHERE status IN ('failure', 'error') AND action LIKE '%denied';

-- Find admin actions
CREATE INDEX idx_audit_log_admin_actions
  ON audit_log(createdAt DESC)
  WHERE action LIKE 'admin_%';
```

**Why**:

- `(userId, createdAt)`: "What did this user do?" (compliance)
- `(action, createdAt)`: "How many job_submitted events today?" (metrics)
- `(resourceType, resourceId)`: "What happened to this job?" (debugging)
- `status, action`: Find failed access attempts (security)

## Relationships

### audit_log ← users (N:1)

```sql
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL;
```

**Set NULL**: Keep audit trail even if user deleted.

## Usage Examples

### Log Job Submission

```typescript
// In API after job created
await db.auditLog.create({
  data: {
    userId: user.id,
    action: 'job_submitted',
    resourceType: 'job',
    resourceId: job.id,
    status: 'success',
    details: {
      jobType: job.type,
      queueName: job.queueName,
      maxRetries: job.maxRetries,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  },
});
```

### Log Admin Action

```typescript
// In admin endpoint after DLQ replay
await db.auditLog.create({
  data: {
    userId: adminUser.id,
    action: 'dlq_replay',
    resourceType: 'job',
    resourceId: jobId,
    status: 'success',
    details: {
      reason: dlqItem.reason,
      previousAttempts: dlqItem.failureCount,
      replayCount: dlqItem.replayCount + 1,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  },
});
```

### Log Permission Denial

```typescript
// In authorization middleware
if (user.role !== 'admin') {
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: 'permission_denied',
      resourceType: 'system',
      status: 'failure',
      details: {
        requiredRole: 'admin',
        userRole: user.role,
        endpoint: req.path,
        method: req.method,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  });

  res.status(403).json({ error: 'Unauthorized' });
}
```

### Query User's Actions (Compliance)

```typescript
// Compliance audit: what did user X do?
const userActions = await db.auditLog.findMany({
  where: {
    userId: userId,
    createdAt: {
      gte: new Date('2026-01-01'),
      lte: new Date('2026-12-31'),
    },
  },
  orderBy: { createdAt: 'desc' },
  take: 1000,
});

// Result:
// [
//   { action: 'dlq_replay', resourceId: 'job-123', status: 'success' },
//   { action: 'job_submitted', resourceId: 'job-122', status: 'success' },
//   { action: 'admin_load_test', status: 'success' }
// ]
```

### Find Failed Access Attempts (Security)

```typescript
// Find unauthorized access attempts in last hour
const failedAttempts = await db.auditLog.findMany({
  where: {
    status: 'failure',
    action: 'permission_denied',
    createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
  },
  orderBy: { createdAt: 'desc' },
});

// Alert if too many from same IP
const failuresByIp = {};
for (const attempt of failedAttempts) {
  failuresByIp[attempt.ipAddress] = (failuresByIp[attempt.ipAddress] || 0) + 1;
}

for (const [ip, count] of Object.entries(failuresByIp)) {
  if (count > 10) {
    logger.warn('Multiple failed access attempts', { ip, count });
    // Could trigger rate limiting
  }
}
```

### Timeline of Events for a Resource

```typescript
// What happened to this job?
const jobTimeline = await db.auditLog.findMany({
  where: {
    resourceId: jobId,
  },
  orderBy: { createdAt: 'asc' },
});

// Result:
// [
//   { action: 'job_submitted', createdAt: '10:00:00', status: 'success' },
//   { action: 'job_started', createdAt: '10:00:02', status: 'success' },
//   { action: 'job_failed', createdAt: '10:00:05', status: 'success' },
//   { action: 'dlq_replay', createdAt: '10:05:00', status: 'success' },
//   { action: 'job_completed', createdAt: '10:05:02', status: 'success' }
// ]
```

### Count Actions by Type (Daily Summary)

```typescript
const dailyStats = await db.auditLog.groupBy({
  by: ['action'],
  where: {
    createdAt: {
      gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  },
  _count: true,
});

// Result:
// [
//   { action: 'job_submitted', _count: 1234 },
//   { action: 'job_completed', _count: 1200 },
//   { action: 'admin_load_test', _count: 5 }
// ]
```

### Export Audit Trail (Compliance Report)

```typescript
// Export all admin actions for year
const report = await db.auditLog.findMany({
  where: {
    action: { startsWith: 'admin_' },
    createdAt: {
      gte: new Date('2026-01-01'),
      lte: new Date('2026-12-31'),
    },
  },
  include: {
    user: { select: { email: true } },
  },
  orderBy: { createdAt: 'asc' },
});

// Convert to CSV for auditor
const csv = report.map((log) => ({
  timestamp: log.createdAt,
  user: log.user?.email || 'SYSTEM',
  action: log.action,
  resource: log.resourceId,
  status: log.status,
  details: JSON.stringify(log.details),
}));

sendToComplianceSystem(csv);
```

## Action Types

### Job Actions

- `job_submitted` - New job created
- `job_started` - Worker picked up job
- `job_completed` - Job succeeded
- `job_failed` - Job execution failed (will retry)
- `job_cancelled` - User cancelled job
- `job_paused` - Admin paused job
- `job_resumed` - Job resumed from pause

### Admin Actions

- `dlq_replay` - Replayed job from DLQ
- `dlq_cleared` - Cleared DLQ entries
- `admin_login` - Admin authenticated
- `admin_logout` - Admin logged out
- `admin_load_test` - Triggered load test

### User Actions

- `user_created` - New user registered
- `user_deleted` - User account deleted
- `password_changed` - User changed password
- `role_changed` - Admin changed user role

### Security Actions

- `permission_denied` - Unauthorized access attempt

## Design Rationale

### Append-Only Pattern

```typescript
// ✅ Immutable audit trail
CREATE RULE prevent_audit_log_updates AS
  ON UPDATE TO audit_log DO INSTEAD NOTHING;

// ❌ Never do this
UPDATE audit_log SET action = 'different' WHERE id = ?;  // WRONG!
```

**Why immutable**:

- Can't hide or alter audit trail
- Compliance requirement
- Forensic value
- Can detect tampering

### User ID Can Be NULL

```typescript
// ✅ System actions don't have userId
{
  userId: null,
  action: 'worker_registered',
  details: { workerId: 'worker-1' }
}

// If user is deleted, audit trail stays
{
  userId: null,  // User deleted but history preserved
  action: 'password_changed',
  details: { userEmail: 'deleted@example.com' }
}
```

**Why nullable**:

- System events have no user
- Preserve audit trail even if user deleted
- Compliance won't delete user audit history

### Structured Details (JSONB)

```typescript
// ✅ Structured metadata
{
  action: 'job_submitted',
  details: {
    jobType: 'send-email',
    queueName: 'email',
    maxRetries: 3
  }
}

// ❌ Unstructured message
{
  action: 'job_submitted',
  message: 'User john@example.com submitted a send-email job'
}
```

**Why structured**:

- Queryable in SQL
- Parse and analyze programmatically
- GROUP BY details fields

### IP Address and User-Agent

```typescript
// Track where requests come from
{
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0 (Mac) ...'
}
```

**Why**:

- Detect unauthorized access patterns
- Geo-tracking
- Bot/scraper detection
- Rate limiting by IP

## Cleanup Strategy

Unlike job_logs which grow huge, audit_log is queryable and should be kept long-term (legal/compliance).

```sql
-- Archive strategy (not delete)
INSERT INTO audit_log_archive
SELECT * FROM audit_log
WHERE createdAt < NOW() - INTERVAL '1 year';

-- Query across both
SELECT * FROM audit_log
UNION ALL
SELECT * FROM audit_log_archive
WHERE createdAt > some_threshold;
```

**Don't delete audit logs** - they're required for compliance.

## Related Documentation

- [[DATABASE/00-Schema-Overview]] - Schema overview
- [[PATTERNS/06-Audit-Trail]] - Audit trail pattern
- [[PATTERNS/08-RBAC]] - Permission checking
- [[COMPONENTS/01-API-Service]] - Middleware for logging
