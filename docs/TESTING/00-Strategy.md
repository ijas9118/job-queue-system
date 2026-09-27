# Testing Strategy

## Testing Pyramid

Three layers, different jobs, different tools — not "one runner across the stack" as a goal in itself:

```
        /\
       /  \        E2E Tests (5-10%)         → Playwright, real browser
      /    \       Full workflow
     /------\
    /        \     Integration Tests (20-30%) → Vitest + fastify.inject()
   /          \    API routes, database, real services
  /____________\
 /              \   Unit Tests (60-70%)       → Vitest
/______________\   Functions, components, isolated
```

## Unit Tests (with Vitest)

Test individual functions in isolation.

### Job Handler Tests

```typescript
// packages/handlers/__tests__/sendEmail.test.ts
import { describe, it, expect, vi } from 'vitest';
import { sendEmailHandler } from '../src/handlers/sendEmail';

describe('sendEmailHandler', () => {
  it('sends email and returns messageId', async () => {
    const result = await sendEmailHandler.execute({
      to: 'user@example.com',
      subject: 'Test',
      template: 'welcome'
    });
    
    expect(result.messageId).toBeDefined();
  });

  it('validates email format', () => {
    expect(() => {
      sendEmailHandler.schema.parse({
        to: 'invalid-email',
        subject: 'Test',
        template: 'welcome'
      });
    }).toThrow();
  });

  it('retries on temporary failure', async () => {
    const mockSend = vi.fn()
      .mockRejectedValueOnce(new Error('Temp failure'))
      .mockResolvedValueOnce({ id: 'msg-123' });
    
    // Mock SMTP service
    // Test that retry works
  });
});
```

### Utility Tests

```typescript
describe('calculateBackoff', () => {
  it('calculates exponential delays', () => {
    expect(calculateBackoff(0)).toBeLessThan(2000);    // ~1s
    expect(calculateBackoff(1)).toBeLessThan(6000);    // ~4s
    expect(calculateBackoff(2)).toBeLessThan(20000);   // ~16s
  });

  it('adds jitter', () => {
    const attempts = Array.from({ length: 100 }, () => calculateBackoff(1));
    const unique = new Set(attempts);
    expect(unique.size).toBeGreaterThan(1);  // Not all the same
  });

  it('caps at maximum delay', () => {
    const veryLate = calculateBackoff(20);
    expect(veryLate).toBeLessThanOrEqual(3600000);  // 1 hour max
  });
});
```

---

## Integration Tests (with `fastify.inject()`)

Test API routes with real database and services, via Fastify's built-in injection (no separate HTTP server needed — faster than Supertest and avoids port binding in CI).

### API Route Tests

```typescript
// apps/api/__tests__/routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { db } from '@job-queue/database';

describe('POST /api/v1/jobs', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildApp();

    const user = await db.users.create({
      data: { email: 'test@example.com', passwordHash: await argon2.hash('password') }
    });
    userId = user.id;

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'test@example.com', password: 'password' }
    });
    accessToken = loginRes.json().accessToken;
  });

  afterAll(async () => {
    await db.users.delete({ where: { id: userId } });
    await app.close();
  });

  it('submits a job and returns job ID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { type: 'send-email', payload: { to: 'user@example.com' } }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().id).toBeDefined();
    expect(response.json().status).toBe('queued');
  });

  it('rejects invalid job type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { type: 'invalid-type', payload: {} }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_JOB_TYPE');
  });

  it('enforces idempotency at the request level', async () => {
    const jobData = {
      type: 'send-email',
      payload: { to: 'user@example.com' },
      idempotencyKey: 'test-123'
    };

    const response1 = await app.inject({
      method: 'POST', url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${accessToken}` }, payload: jobData
    });
    const response2 = await app.inject({
      method: 'POST', url: '/api/v1/jobs',
      headers: { authorization: `Bearer ${accessToken}` }, payload: jobData
    });

    expect(response1.json().id).toBe(response2.json().id);
  });

  it('checks authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: { type: 'send-email', payload: {} }
    });

    expect(response.statusCode).toBe(401);
  });
});
```

### Retry Tests

```typescript
describe('Retry Logic', () => {
  it('schedules retries with exponential backoff', async () => {
    const job = await submitJob({ type: 'flaky-job', payload: {} });
    
    // First attempt
    await processor.process(job);  // Fails
    
    let jobRecord = await db.jobs.findUnique(job.id);
    expect(jobRecord.status).toBe('delayed');
    expect(jobRecord.retryCount).toBe(1);
    expect(jobRecord.delayUntil).toBeDefined();
    
    // Second attempt
    await new Promise(resolve => setTimeout(resolve, 2000));
    await processor.process(job);  // Fails again
    
    jobRecord = await db.jobs.findUnique(job.id);
    expect(jobRecord.retryCount).toBe(2);
    expect(jobRecord.delayUntil.getTime())
      .toBeGreaterThan(Date.now() + 3000);  // 4s delay
  });

  it('moves to DLQ after max retries', async () => {
    const job = await submitJob({ 
      type: 'always-fails', 
      payload: {},
      maxRetries: 1
    });
    
    // Attempt 1: Fails
    await processor.process(job);
    
    // Attempt 2: Fails
    await processor.process(job);
    
    const jobRecord = await db.jobs.findUnique(job.id);
    expect(jobRecord.status).toBe('dead_letter');
    
    const dlqRecord = await db.deadLetterQueue.findUnique({
      where: { jobId: job.id }
    });
    expect(dlqRecord).toBeDefined();
  });
});
```

---

## End-to-End Tests (Playwright)

Automated, driving a real browser against the real dashboard + API + worker stack (via `docker-compose` in CI). This is the layer that proves the whole system works together, not just its parts — the exact flow the reviewer diagram calls out:

```
Login → Create job → Job appears in dashboard → Worker processes it →
Status changes → Real-time notification appears
```

### Scenario 1: Job Success Path

```typescript
// e2e/job-success.spec.ts
import { test, expect } from '@playwright/test';

test('job goes from queued to completed with live updates', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/');

  await page.click('text=Submit Job');
  await page.selectOption('[name=type]', 'send-email');
  await page.fill('[name=payload]', JSON.stringify({ to: 'john@example.com' }));
  await page.click('button:has-text("Submit")');

  const jobRow = page.locator('[data-testid=job-row]').first();
  await expect(jobRow).toContainText('QUEUED');

  // WebSocket-driven updates — no polling, no reload
  await expect(jobRow).toContainText('ACTIVE', { timeout: 5000 });
  await expect(jobRow).toContainText('COMPLETED', { timeout: 10000 });

  await jobRow.click();
  await expect(page.locator('[data-testid=job-result]')).toBeVisible();
});
```

### Scenario 2: Retry Path

```typescript
test('failed job retries with backoff and eventually succeeds', async ({ page }) => {
  // ... login as in Scenario 1 ...

  await submitJob(page, { type: 'flaky-job', payload: {} });

  const jobRow = page.locator('[data-testid=job-row]').first();
  await expect(jobRow).toContainText('FAILED', { timeout: 5000 });
  await expect(jobRow).toContainText('DELAYED');           // retry scheduled
  await expect(jobRow).toContainText('ACTIVE', { timeout: 15000 }); // retry fired
  await expect(jobRow).toContainText('COMPLETED', { timeout: 20000 });
});
```

### Scenario 3: Admin DLQ Management

```typescript
test('admin can inspect and replay a dead-lettered job', async ({ page }) => {
  await loginAs(page, 'admin@example.com');
  await page.goto('/dlq');

  const dlqRow = page.locator('[data-testid=dlq-row]').first();
  await expect(dlqRow).toBeVisible();

  await dlqRow.locator('text=Inspect').click();
  await expect(page.locator('[data-testid=error-detail]')).toBeVisible();

  await page.click('text=Replay');
  await expect(page.locator('[data-testid=job-row]').first()).toContainText('COMPLETED', { timeout: 10000 });
});
```

---

## Test Coverage Goals

| Component | Coverage | Priority |
|-----------|----------|----------|
| **Unit Tests** | 80%+ | High |
| **Integration Tests** | 70%+ | High |
| **API Routes** | 100% | Critical |
| **Handlers** | 90%+ | High |
| **RBAC Logic** | 100% | Critical |
| **Retry Logic** | 95%+ | Critical |
| **E2E Scenarios (Playwright)** | 5+ major paths, automated | Medium |

---

## Running Tests

### All Tests

```bash
pnpm test
```

### Specific Package

```bash
pnpm --filter queue test
pnpm --filter api test:watch
```

### Coverage Report

```bash
pnpm test --coverage

# Output:
# ├── API: 87%
# ├── Worker: 92%
# ├── Queue: 95%
# └── Handlers: 88%
```

---

## Test Maintenance

### Before Each Release

- [ ] Run full test suite (unit + integration)
- [ ] Check coverage (must be > 80%)
- [ ] Run Playwright E2E suite
- [ ] Load test with admin panel
- [ ] Check for failing tests

### Continuous Integration

```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test
      - run: pnpm test --coverage
      - uses: codecov/codecov-action@v3

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: npx playwright install --with-deps
      - run: docker-compose up -d
      - run: pnpm exec playwright test
```

---

## Related Documentation

- [[TESTING/01-Unit-Tests]] - Unit testing details
- [[TESTING/02-Integration-Tests]] - Integration testing details
- [[TESTING/03-E2E-Tests]] - E2E testing details
- [[TESTING/04-Load-Testing]] - Load testing approach
