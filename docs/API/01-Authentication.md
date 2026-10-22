# API Authentication

## Strategy

Stateless JWT-based authentication with rotating refresh tokens and Redis-backed token blacklisting.

- **Access Token**: Short-lived (15 min), sent with every API request
- **Refresh Token**: Long-lived (7 days), used only to obtain a new access token
- **Blacklist**: Redis string keys for revoked access tokens (logout, suspension)

---

## JWT Access Token

### Algorithm

`HS256` (HMAC-SHA256) — symmetric, signed with `JWT_SECRET` env var.

### Claims Shape

```typescript
interface AccessTokenPayload {
  // Standard JWT claims
  sub: string; // User UUID — primary identifier ("subject")
  iat: number; // Issued at (Unix timestamp)
  exp: number; // Expires at (Unix timestamp, iat + 900)
  jti: string; // JWT ID — unique per token (UUID), used for blacklisting

  // Application claims
  email: string; // User email
  role: 'admin' | 'user';
  status: 'active' | 'suspended' | 'archived';
}
```

### Example Decoded Token

```json
{
  "sub": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
  "iat": 1751450400,
  "exp": 1751451300,
  "jti": "b7e2d4f1-1a3c-4e5f-8b9d-2c6a7e8f3b1d",
  "email": "john@example.com",
  "role": "user",
  "status": "active"
}
```

### Expiry

| Token         | TTL            | Rationale                            |
| ------------- | -------------- | ------------------------------------ |
| Access Token  | **15 minutes** | Short window limits damage if stolen |
| Refresh Token | **7 days**     | Balance between UX and security      |

### Why `jti` (JWT ID)?

Access tokens are stateless — you can't "delete" them once issued. `jti` is a unique ID per token that lets you blacklist a specific token in Redis without invalidating all tokens for that user.

```
Login  → issue access token with jti: "token-abc"
Logout → add "token-abc" to Redis blacklist (TTL = remaining lifetime)
Next request with "token-abc" → blacklist check → 401 Unauthorized
```

---

## Authentication Flow

### 1. Login

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Server steps:**

```
1. Validate input with Zod
2. SELECT * FROM users WHERE email = ? AND deletedAt IS NULL
3. If not found → 401 (use same message as wrong password — no user enumeration)
4. argon2.verify(user.passwordHash, password)
5. If invalid → 401 "Invalid credentials"
6. If user.status != 'active' → 403 "Account suspended"
7. Generate access token (HS256, 15m)
8. Generate refresh token (opaque random UUID, 7d)
9. SHA256(refreshToken) → store hash in DB (never the raw token)
10. UPDATE users SET lastLoginAt = NOW() WHERE id = ?
11. INSERT INTO audit_log (userId, action='user_login')
12. Return tokens (raw token to client, hash stays in DB)
```

**Response 200** (browser client — refresh token set as HttpOnly cookie, see [Refresh Token Storage](#refresh-token-storage)):

```
HTTP/1.1 200 OK
Set-Cookie: refreshToken=f3a9c2d1-...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh; Max-Age=604800
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 900,
  "user": {
    "id": "a3f9c1d2-7e4b-4a2e-9f1c-3d8b2a1e5f0c",
    "email": "user@example.com",
    "role": "user",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

> **Non-browser clients** (mobile, CLI, service-to-service): the refresh token is returned in the JSON body instead of a cookie, since there's no cookie jar and no XSS surface. See [Refresh Token Storage](#refresh-token-storage) for the full comparison.

**Error responses:**

```json
// 401 — wrong email or password (intentionally vague)
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid email or password", "statusCode": 401 } }

// 403 — account not active
{ "error": { "code": "ACCOUNT_SUSPENDED", "message": "Account is suspended", "statusCode": 403 } }

// 429 — too many login attempts
{ "error": { "code": "RATE_LIMITED", "message": "Too many login attempts. Try again in 15 minutes.", "statusCode": 429 } }
```

---

### 2. Using the Access Token

All protected endpoints require:

```
Authorization: Bearer <accessToken>
```

**Auth middleware steps:**

```typescript
async function authenticate(req, res, next) {
  // 1. Extract token
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json(...);

  const token = header.slice(7);

  // 2. Verify signature and expiry — algorithm locked to HS256
  // Explicit algorithms list prevents algorithm confusion attacks
  // (e.g. attacker switching header to "alg: none" or "alg: RS256")
  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256']
    }) as AccessTokenPayload;
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: { code: 'TOKEN_EXPIRED' } });
    return res.status(401).json({ error: { code: 'INVALID_TOKEN' } });
  }

  // 3. Check blacklist
  const isBlacklisted = await redis.get(`blacklist:${payload.jti}`);
  if (isBlacklisted) return res.status(401).json({ error: { code: 'TOKEN_REVOKED' } });

  // 4. Verify user still active (optional DB check — skip for performance, rely on token claims)
  // Only do this check for sensitive admin actions

  // 5. Attach to request
  req.user = {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    status: payload.status
  };

  next();
}
```

> **Note on the DB check (step 4):** For most endpoints, trust the claims in the token — this is the point of JWTs. Only do a live DB lookup for admin-only actions where you need to verify role hasn't changed since token was issued.

---

### 3. Refresh Token Flow

When the access token expires, the client uses the refresh token to get a new access token without re-entering credentials.

```
POST /api/v1/auth/refresh
```

For browser clients, no body is required — the HttpOnly cookie is attached automatically. Non-browser clients send the refresh token explicitly:

```json
{
  "refreshToken": "f3a9c2d1-8e4b-4a2e-9f1c-3d8b2a1e5f0c"
}
```

See [Refresh Token Storage](#refresh-token-storage) for when each form applies.

**Server steps:**

```
1. Hash the received token: hash = SHA256(refreshToken)
2. SELECT * FROM refresh_tokens WHERE tokenHash = ?
3. If not found → 401 (also check: was this token previously valid? → reuse detection)
4. If revokedAt IS NOT NULL → REUSE DETECTED (see Reuse Detection below)
5. If expiresAt < NOW() → 401 "Session expired, please log in again"
6. SELECT * FROM users WHERE id = refresh_token.userId AND status = 'active'
7. If user inactive/deleted → 401, revoke all their refresh tokens
8. Rotate: mark old row revokedAt = NOW()
9. Generate new raw refresh token, store SHA256(newToken)
10. Issue new access token (15m, new jti)
11. UPDATE refresh_tokens SET lastUsedAt = NOW() WHERE id = ?
12. Return both new tokens
```

**Response 200:**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "9b2e5f3a-4c1d-4b8e-a2f9-7d3c1b4e8a2f",
  "expiresIn": 900
}
```

**Why rotate the refresh token?**  
Each use of a refresh token issues a new one and revokes the old. If someone steals a refresh token and uses it after you already rotated it, the server detects the old token was already used — see Reuse Detection below.

### Reuse Detection

If an already-revoked refresh token is presented, it means one of two things:

- The token was stolen and the attacker used it after the legitimate user already rotated it
- The legitimate user is replaying an old token (bug in client)

Either way, treat it as a compromise:

```
Client sends old refresh token
          ↓
SHA256(token) → lookup in DB
          ↓
Found, but revokedAt IS NOT NULL
          ↓
⚠️  REUSE DETECTED
          ↓
Revoke ALL refresh tokens for this userId
          ↓
INSERT INTO audit_log (action='refresh_token_reuse_detected', userId)
          ↓
Return 401 "Session invalidated due to suspicious activity. Please log in again."
          ↓
User must authenticate with email + password
```

```typescript
const existing = await db.refreshTokens.findUnique({
  where: { tokenHash: sha256(receivedToken) },
});

if (!existing) {
  return res.status(401).json({ error: { code: 'INVALID_TOKEN' } });
}

if (existing.revokedAt !== null) {
  // Reuse detected — revoke everything for this user
  await db.refreshTokens.updateMany({
    where: { userId: existing.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await db.auditLog.create({
    data: { userId: existing.userId, action: 'refresh_token_reuse_detected' },
  });
  return res.status(401).json({ error: { code: 'SESSION_COMPROMISED' } });
}
```

---

### 4. Logout

```
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>

{
  "refreshToken": "f3a9c2d1-8e4b-4a2e-9f1c-3d8b2a1e5f0c"
}
```

**Server steps:**

```
1. Verify access token (already done by auth middleware)
2. Add jti to Redis blacklist with TTL = remaining token lifetime
3. Revoke refresh token in DB (SET revokedAt = NOW())
4. INSERT INTO audit_log (action='user_logout')
5. Return 204 No Content
```

```typescript
// Blacklist the access token
const remainingTtl = payload.exp - Math.floor(Date.now() / 1000); // seconds left
await redis.setEx(`blacklist:${payload.jti}`, remainingTtl, '1');

// Revoke refresh token by hash
const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
await db.refreshTokens.update({
  where: { tokenHash },
  data: { revokedAt: new Date() },
});
```

---

### 5. Logout All Sessions

Revokes every active session for the user — useful after a password change, suspected compromise, or "sign out everywhere" from the account settings page.

```
POST /api/v1/auth/logout-all
Authorization: Bearer <accessToken>
```

No body required. The user is identified from the access token.

**Server steps:**

```
1. Verify access token (auth middleware)
2. Add current jti to Redis blacklist (TTL = remaining lifetime)
3. Revoke ALL non-revoked refresh tokens for this userId
4. INSERT INTO audit_log (action='user_logout_all')
5. Return 204 No Content
```

```typescript
// Blacklist the current access token
const remainingTtl = payload.exp - Math.floor(Date.now() / 1000);
await redis.setEx(`blacklist:${payload.jti}`, remainingTtl, '1');

// Revoke every active refresh token for this user
await db.refreshTokens.updateMany({
  where: { userId: payload.sub, revokedAt: null },
  data: { revokedAt: new Date() },
});

await db.auditLog.create({
  data: { userId: payload.sub, action: 'user_logout_all' },
});

res.status(204).send();
```

> **Note on existing access tokens:** Other active access tokens (from other devices) are not blacklisted — they live for at most 15 more minutes. This is the accepted trade-off of stateless JWTs. Revoking all of them would require storing every issued `jti` per user, which defeats the purpose. For immediate revocation, use the `suspended:<userId>` Redis key approach documented in Account Suspension.

---

## Token Blacklisting

### When Tokens Are Blacklisted

| Trigger                           | Blacklists                                         |
| --------------------------------- | -------------------------------------------------- |
| Logout                            | Current access token + current refresh token       |
| Logout all                        | Current access token + all refresh tokens for user |
| Password change                   | All refresh tokens for user                        |
| Account suspended by admin        | All refresh tokens for user + flag in Redis        |
| Admin force-logout (by sessionId) | Specific refresh token                             |
| Refresh token reuse detected      | All refresh tokens for user                        |

### Redis Key Pattern

```
blacklist:<jti>   → value: "1"  |  TTL = remaining lifetime of the access token
```

These are individual string keys, not a Redis Set. Since access tokens are short-lived (15m), the keys are small and self-cleaning via TTL — no manual cleanup needed.

### Account Suspension

When an admin suspends a user:

```typescript
// 1. Update DB
await db.users.update({
  where: { id: userId },
  data: { status: 'suspended' },
});

// 2. Revoke all refresh tokens
await db.refreshTokens.updateMany({
  where: { userId, revokedAt: null },
  data: { revokedAt: new Date() },
});

// 3. Set a short-lived suspension flag in Redis
// New access tokens won't be issued (refresh will fail at step 4)
// Existing tokens are valid until expiry (max 15m) — acceptable for portfolio

// 4. Audit log
await db.auditLog.create({
  data: { userId: adminId, action: 'user_suspended', resourceId: userId },
});
```

> For stricter revocation, add a Redis key `suspended:<userId>` and check it in the auth middleware alongside the blacklist. For this project, accepting up to 15 min of lag is fine.

---

## Refresh Token DB Table

This table is **not in the original schema** — it needs to be added.

```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userId UUID NOT NULL,
  tokenHash VARCHAR(64) NOT NULL UNIQUE,  -- SHA256(rawToken) — never store plaintext
  sessionId UUID NOT NULL DEFAULT gen_random_uuid(), -- stable ID for this session
  deviceName VARCHAR(255),                -- "Chrome on Mac", "Safari on iPhone"
  userAgent VARCHAR(512),
  ipAddress VARCHAR(45),                  -- IPv4 or IPv6
  expiresAt TIMESTAMP NOT NULL,
  lastUsedAt TIMESTAMP,                   -- updated on every successful refresh
  revokedAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),

  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_refresh_tokens_tokenHash ON refresh_tokens(tokenHash);
CREATE INDEX idx_refresh_tokens_userId ON refresh_tokens(userId) WHERE revokedAt IS NULL;
CREATE INDEX idx_refresh_tokens_expiresAt ON refresh_tokens(expiresAt);
```

### Why SHA256 and Not Argon2id?

Refresh tokens are already high-entropy random UUIDs (128 bits). Argon2id is designed to slow down brute-force on **low-entropy** secrets (passwords). A 128-bit random token has no realistic brute-force surface — SHA256 is fast and sufficient here.

```typescript
import crypto from 'crypto';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Store
const rawToken = crypto.randomUUID();
await db.refreshTokens.create({
  data: {
    userId: user.id,
    tokenHash: hashToken(rawToken),
    deviceName: parseUserAgent(req.headers['user-agent']),
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  },
});

// Lookup on refresh/logout
const hash = hashToken(receivedToken);
const row = await db.refreshTokens.findUnique({ where: { tokenHash: hash } });
```

### Session Management (Admin / User Visibility)

With `sessionId` and `deviceName`, users can see and revoke individual sessions:

```
GET /api/v1/auth/sessions

Response:
[
  {
    "sessionId": "e3a9c1d2-...",
    "deviceName": "Chrome on Mac",
    "ipAddress": "192.168.1.1",
    "lastUsedAt": "2026-08-06T10:30:00Z",
    "createdAt": "2026-08-01T09:00:00Z",
    "current": true
  },
  {
    "sessionId": "b7f2d4e1-...",
    "deviceName": "Safari on iPhone",
    "ipAddress": "10.0.0.5",
    "lastUsedAt": "2026-08-05T18:12:00Z",
    "createdAt": "2026-07-28T14:20:00Z",
    "current": false
  }
]

DELETE /api/v1/auth/sessions/:sessionId   → revoke one session
DELETE /api/v1/auth/sessions              → revoke all sessions (logout everywhere)
```

---

## Refresh Token Storage

Two valid approaches. Choose one based on your client type.

### Option A: JSON Response (simpler, current approach)

```
Login response body:
{
  "accessToken": "...",
  "refreshToken": "..."
}
```

Client stores the refresh token in `localStorage` or `sessionStorage`. Fine for non-browser clients (mobile apps, CLI tools, server-to-server). For a browser client, `localStorage` is vulnerable to XSS — any injected script can read it.

### Option B: HttpOnly Cookie (more secure for browsers)

The server sets the refresh token as a cookie. The browser attaches it automatically and JavaScript **cannot read it**, removing the XSS risk.

```
Login response:
HTTP/1.1 200 OK
Set-Cookie: refreshToken=f3a9c2d1-...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh; Max-Age=604800

Body:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresIn": 900,
  "user": { ... }
}
```

The access token still travels in the `Authorization` header. Only the refresh token is in the cookie.

```typescript
res.cookie('refreshToken', rawToken, {
  httpOnly: true, // not accessible via document.cookie
  secure: true, // HTTPS only
  sameSite: 'lax', // sent on top-level navigation, not cross-site POSTs
  path: '/api/v1/auth/refresh', // scoped — only sent to the refresh endpoint
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
});
```

On refresh, the server reads from the cookie:

```typescript
const rawToken = req.cookies.refreshToken;
```

On logout, clear the cookie:

```typescript
res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
```

|                       | JSON body | HttpOnly Cookie                                 |
| --------------------- | --------- | ----------------------------------------------- |
| XSS protection        | No        | Yes                                             |
| Works for mobile/CLI  | Yes       | Awkward                                         |
| CSRF risk             | No        | Yes (mitigate with `SameSite=Lax` + CSRF token) |
| Implementation effort | Low       | Medium                                          |

**Recommendation for this project: Option B (HttpOnly Cookie).** The dashboard is a browser-based SPA, and a refresh token sitting in `localStorage`/`sessionStorage` is readable by any injected script — one XSS bug anywhere in the dependency tree becomes a full session-theft bug with a 7-day blast radius. The access token still lives in memory only on the client (never persisted), which caps the damage of a stolen access token to its 15-minute lifetime. Mitigate the added CSRF surface with `SameSite=Lax` (already scoped to `/api/v1/auth/refresh`) plus a custom header requirement (e.g. `X-Requested-With`) on state-changing requests, since CSRF can't set custom headers cross-origin. Reserve the JSON-body option for non-browser clients (mobile apps, CLI, service-to-service) where there's no cookie jar and no XSS surface to defend against.

---

## Expired Token Cleanup

Expired rows in `refresh_tokens` accumulate over time. Run a daily cleanup job to keep the table small.

```sql
-- Run once per day (cron or scheduled job)
DELETE FROM refresh_tokens
WHERE expiresAt < NOW();
```

```typescript
// apps/worker/src/jobs/cleanup-expired-tokens.ts
export async function cleanupExpiredRefreshTokens() {
  const result = await db.$executeRaw`
    DELETE FROM refresh_tokens WHERE expiresAt < NOW()
  `;
  console.log(`Cleaned up ${result} expired refresh token rows`);
}
```

Schedule via BullMQ repeatable job:

```typescript
await queue.add(
  'cleanup-expired-tokens',
  {},
  { repeat: { pattern: '0 3 * * *' } } // 3am daily
);
```

---

## Environment Variables Required

```bash
JWT_SECRET=<minimum 32 character random string>
JWT_ACCESS_EXPIRY=900         # 15 minutes in seconds
JWT_REFRESH_EXPIRY=604800     # 7 days in seconds
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Rate Limiting on Auth Endpoints

Login and refresh are targeted by brute force attacks. Apply stricter limits than the global 1000 req/15min.

```
POST /auth/login    → 10 requests per 15 min per IP
POST /auth/refresh  → 60 requests per 15 min per IP
POST /auth/logout   → global rate limit (already authenticated)
```

---

## Security Decisions

| Decision              | Choice                                    | Why                                                                                    |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| JWT algorithm         | HS256 with `algorithms: ['HS256']` locked | Prevents algorithm confusion attacks (`alg: none`, RS256 abuse)                        |
| Access token TTL      | 15 min                                    | Short window limits damage if token is stolen                                          |
| Refresh token type    | Opaque random UUID                        | Can be revoked in DB; JWT refresh tokens can't be invalidated                          |
| Refresh token storage | SHA256(token) hash only                   | DB leak doesn't expose usable tokens — same principle as password hashing              |
| Refresh token hashing | SHA256 (not bcrypt)                       | Tokens are already 128-bit random — no brute-force surface; SHA256 is sufficient       |
| Refresh rotation      | Yes, with reuse detection                 | Reused revoked token → revoke all sessions for that user                               |
| Blacklist store       | Redis string keys                         | O(1) lookup, auto-expiry via TTL, no DB hit on every request                           |
| Refresh token cookie  | HttpOnly + Secure + SameSite=Lax          | Prevents XSS access; scoped to refresh path only                                       |
| Claims in token       | Minimal                                   | `sub`, `role`, `email`, `status`, `jti` — avoids stale data                            |
| Login error message   | Generic                                   | "Invalid email or password" — prevents user enumeration                                |
| Password hashing      | Argon2id                                  | Password Hashing Competition winner; better resistance to GPU/ASIC attacks than bcrypt |
| Session visibility    | `sessionId` + `deviceName`                | Users can see and revoke individual devices                                            |
| Token cleanup         | Daily cron at 3am                         | Keeps `refresh_tokens` table small without manual ops                                  |

---

## Related Documentation

- [[DATABASE/01-Users-Table]] - User schema and password hashing
- [[PATTERNS/08-RBAC]] - Role permission model
- [[API/00-Overview]] - All endpoints and error format
- [[COMPONENTS/01-API-Service]] - Auth middleware implementation
