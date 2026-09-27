# Users Table

## Purpose

Stores user accounts, authentication credentials, and role-based access control (RBAC). Single source of truth for all system users.

## Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  firstName VARCHAR(100),
  lastName VARCHAR(100),
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  lastLoginAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedAt TIMESTAMP NOT NULL DEFAULT NOW(),
  deletedAt TIMESTAMP
);
```

## Columns

| Column | Type | Constraints | Purpose |
|--------|------|-----------|---------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE | Login email, unique per system |
| `passwordHash` | VARCHAR(255) | NOT NULL | Argon2id hash of password |
| `firstName` | VARCHAR(100) | Optional | User's first name |
| `lastName` | VARCHAR(100) | Optional | User's last name |
| `role` | VARCHAR(50) | NOT NULL, DEFAULT 'user' | 'admin' or 'user' |
| `status` | VARCHAR(50) | NOT NULL, DEFAULT 'active' | 'active', 'suspended', 'archived' |
| `lastLoginAt` | TIMESTAMP | Optional | Tracks last successful login |
| `createdAt` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Account creation time |
| `updatedAt` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Last profile update |
| `deletedAt` | TIMESTAMP | Optional | Soft delete timestamp (NULL if active) |

## Constraints

```sql
-- Unique email per system
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);

-- Ensure role is valid
ALTER TABLE users ADD CONSTRAINT ck_users_role 
  CHECK (role IN ('admin', 'user'));

-- Ensure status is valid
ALTER TABLE users ADD CONSTRAINT ck_users_status 
  CHECK (status IN ('active', 'suspended', 'archived'));

-- deletedAt can only be set once (no "un-delete")
ALTER TABLE users ADD CONSTRAINT ck_users_deletedAt 
  CHECK (deletedAt IS NULL OR updatedAt <= deletedAt);
```

## Indexes

```sql
-- Fast lookups
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deletedAt IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deletedAt IS NULL;
CREATE INDEX idx_users_createdAt ON users(createdAt DESC);
CREATE INDEX idx_users_lastLoginAt ON users(lastLoginAt DESC);
```

**Why**:
- `email`: Primary authentication key, must be unique among active users
- `role`: Dashboard queries (admin list, permissions check)
- `createdAt`: Analytics, user registration trends
- `lastLoginAt`: Track active users, find inactive accounts

## Relationships

### users → jobs (1:N)

```sql
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE;
```

**Cascade**: If user is deleted, all their jobs are cascade-deleted (respects soft delete)

### users → audit_log (1:N)

```sql
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_userId
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL;
```

**Set NULL**: Keep audit trail even if user deleted

## Usage Examples

### Create User

```typescript
const user = await db.users.create({
  data: {
    email: 'john@example.com',
    passwordHash: await argon2.hash(password),
    firstName: 'John',
    lastName: 'Doe',
    role: 'user',
    status: 'active'
  }
});
```

### Authenticate User

```typescript
const user = await db.users.findUnique({
  where: { email: email }
});

if (user && user.deletedAt === null) {
  const valid = await argon2.verify(user.passwordHash, password);
  if (valid) {
    await db.users.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    // Issue JWT token
  }
}
```

### Check Admin Permission

```typescript
const user = await db.users.findUnique({
  where: { id: userId }
});

if (user?.role !== 'admin') {
  throw new Error('Unauthorized: admin role required');
}
```

### Get Active Users

```typescript
const activeUsers = await db.users.findMany({
  where: {
    status: 'active',
    deletedAt: null
  },
  orderBy: { lastLoginAt: 'desc' }
});
```

### Soft Delete User

```typescript
await db.users.update({
  where: { id: userId },
  data: {
    deletedAt: new Date(),
    status: 'archived'
  }
});
```

### Find Inactive Users (for cleanup)

```typescript
const inactiveUsers = await db.users.findMany({
  where: {
    lastLoginAt: {
      lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
    }
  }
});
```

## Design Rationale

### Password Storage

- **Argon2id**: Password Hashing Competition winner (2015); memory-hard, which makes GPU/ASIC brute-forcing far more expensive than bcrypt's compute-only cost — a better default for a new project than defaulting to bcrypt out of habit
- **Never store plaintext**: Always hash before storing
- **Never log passwords**: Never include in logs or error messages

### Soft Delete Pattern

- **deletedAt field**: Preserve audit trail, comply with data retention policies
- **Queries filter deletedAt IS NULL**: Active users only
- **Cascade delete respects soft delete**: Related jobs also soft-deleted

### Role-Based Access

- **Simple two-tier system**: 'admin' or 'user'
- **Admin can**: view queue stats, manage workers, access DLQ, load test
- **User can**: submit jobs, view own jobs, cancel own jobs
- **Check in middleware**: Authorization logic centralized

### Soft Deletes Don't Cascade Hard Delete

```typescript
// ✅ Soft delete a user
UPDATE users SET deletedAt = NOW() WHERE id = ?;

// ❌ Don't hard delete
DELETE FROM users WHERE id = ?;  // Never!

// Jobs are cascade soft-deleted via triggers
CREATE TRIGGER cascade_user_delete
AFTER UPDATE ON users
WHEN NEW.deletedAt IS NOT NULL AND OLD.deletedAt IS NULL
BEGIN
  UPDATE jobs SET status = 'cancelled', cancelledAt = NOW() WHERE userId = NEW.id;
END;
```

## Related Documentation

- [[PATTERNS/08-RBAC]] - Permission model details
- [[COMPONENTS/01-API-Service]] - Authentication middleware
- [[DATABASE/00-Schema-Overview]] - Complete schema
- [[TECH-STACK/00-Overview]] - Argon2id security choice
