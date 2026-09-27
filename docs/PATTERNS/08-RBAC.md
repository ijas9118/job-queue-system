# Pattern 8: RBAC (Role-Based Access Control)

## The Problem

**Without RBAC**: Anyone can see/do anything.

```
User A accesses User B's jobs
Admin actions available to everyone
No permission boundaries
Security risk
```

## The Solution: Role-Based Access Control

**Two roles**: Admin (full access) and User (limited access)

```
ADMIN:
  ✅ View all jobs
  ✅ Retry any job
  ✅ Access DLQ
  ✅ Manage workers
  ✅ Run load tests

USER:
  ✅ Submit jobs
  ✅ View own jobs
  ✅ Retry own failed jobs
  ❌ View others' jobs
  ❌ Access DLQ
  ❌ Run load tests
```

## Implementation

### Permission Rules

```typescript
interface User {
  id: UUID;
  email: string;
  role: 'admin' | 'user';
}

// Permission checks
function canViewJob(user: User, job: Job): boolean {
  if (user.role === 'admin') return true;  // Admin sees all
  return job.userId === user.id;           // User sees own
}

function canRetryJob(user: User, job: Job): boolean {
  if (user.role === 'admin') return true;  // Admin retries any
  return job.userId === user.id;           // User retries own
}

function canAccessDLQ(user: User): boolean {
  return user.role === 'admin';            // Admin only
}

function canRunLoadTests(user: User): boolean {
  return user.role === 'admin';            // Admin only
}
```

### Fastify preHandler Hook

```typescript
// Check permission before route handler
export function requireAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== 'admin') {
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'Admin required' }
      });
    }
  };
}

// Usage in routes
fastify.get('/admin/dlq', { preHandler: requireAdmin() }, dlqHandler);
fastify.post('/admin/load-test', { preHandler: requireAdmin() }, loadTestHandler);
```

### API Routes

```typescript
// Anyone can view own jobs
GET /api/v1/jobs
  → Returns only user's jobs

// Admin can view all jobs
GET /api/v1/admin/jobs
  → Returns all jobs (admin only)

// Anyone can retry own
POST /api/v1/jobs/:jobId/retry
  → Check: Is job mine or am I admin?
  → If yes: Retry
  → If no: 403 Forbidden

// Admin only endpoints
GET /api/v1/admin/queues
GET /api/v1/admin/workers
GET /api/v1/admin/dlq
POST /api/v1/admin/load-test
```

## Database-Level (Optional)

```sql
-- Could add role checks at database level (Row-Level Security)
-- But application level is usually sufficient

CREATE TABLE jobs (
  id UUID,
  userId UUID,
  role_created_by TEXT,
  -- ...
);

-- Only show jobs user owns or if user is admin
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_jobs_policy ON jobs
  USING (
    userId = current_setting('app.current_user_id')::UUID
    OR current_setting('app.current_role') = 'admin'
  );
```

## Testing

```typescript
describe('RBAC', () => {
  it('allows admin to view all jobs', async () => {
    const admin = { role: 'admin', id: 'user-123' };
    const job = { userId: 'user-456' };  // Someone else's job
    
    expect(canViewJob(admin, job)).toBe(true);
  });

  it('prevents user from viewing others jobs', async () => {
    const user = { role: 'user', id: 'user-123' };
    const job = { userId: 'user-456' };  // Someone else's job
    
    expect(canViewJob(user, job)).toBe(false);
  });

  it('allows user to view own jobs', async () => {
    const user = { role: 'user', id: 'user-123' };
    const job = { userId: 'user-123' };  // Own job
    
    expect(canViewJob(user, job)).toBe(true);
  });

  it('allows admin only for DLQ', async () => {
    expect(canAccessDLQ({ role: 'admin' })).toBe(true);
    expect(canAccessDLQ({ role: 'user' })).toBe(false);
  });
});
```

## Audit Trail with RBAC

```sql
-- Who did what?
INSERT INTO audit_log (userId, action, resourceId, metadata)
VALUES (
  'user-123',
  'job_retried',
  'job-456',
  '{"role": "user", "jobOwner": "user-123"}'  -- Allowed: owns job
);

-- Admin action
INSERT INTO audit_log (userId, action, resourceId, metadata)
VALUES (
  'admin-1',
  'job_replayed_from_dlq',
  'job-999',
  '{"role": "admin"}'  -- Allowed: admin
);
```

## Related Documentation

- [[COMPONENTS/01-API-Service]] - Implements in routes
- [[PATTERNS/00-Overview]] - All patterns
- [[DATABASE/07-Audit-Log-Table]] - Records who did what
