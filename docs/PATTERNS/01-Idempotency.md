# Pattern 1: Idempotency

## The Problem

**Scenario**: Webhook fires twice with identical payload.

```
Stripe sends webhook: "payment_succeeded"
  ↓
API processes: Create job to send receipt email
  ↓
Network timeout (but processing succeeded)
  ↓
Stripe retries: Sends same webhook again
  ↓
API processes: Creates ANOTHER job to send receipt email
  ↓
User gets email TWICE ❌
```

**Another scenario**: Client retries API call.

```
User clicks "Submit Job" button
  ↓
Network glitch, request hangs
  ↓
User clicks again
  ↓
First request finally processes
  ↓
Second request also processes
  ↓
Job created TWICE ❌
```

## The Solution: Idempotency Key

Attach a unique key to the request. Same key = same result (no side effects).

```
First request:  POST /jobs with idempotencyKey='stripe-evt-123'
  → Check: Does this key exist?
  → NO → Create job, store key
  → Return job ID

Retry request:  POST /jobs with idempotencyKey='stripe-evt-123'
  → Check: Does this key exist?
  → YES → Return existing job (no new side effects)
```

## Implementation

### API Endpoint

```typescript
// POST /api/v1/jobs

interface SubmitJobRequest {
  type: string;
  payload: object;
  idempotencyKey?: string;  // Optional, generated if not provided
  // ... other fields
}

async function submitJob(req: SubmitJobRequest) {
  const idempotencyKey = req.idempotencyKey || generateUUID();
  
  // CHECK: Does this key already exist for this user?
  const existing = await db.jobs.findUnique({
    where: {
      idempotencyKey_userId: {
        idempotencyKey,
        userId: req.user.id
      }
    }
  });
  
  if (existing) {
    // KEY EXISTS: Return existing job (idempotent)
    logger.info('Idempotent retry detected', { idempotencyKey });
    return existing;
  }
  
  // NEW REQUEST: Create job
  const job = await db.jobs.create({
    data: {
      idempotencyKey,
      userId: req.user.id,
      type: req.type,
      payload: req.payload,
      // ... other fields
    }
  });
  
  // Add to queue
  await queue.add(job.id, job.payload);
  
  return job;
}
```

### Database Schema

```sql
-- Unique constraint ensures same key = same user = one job only
CREATE UNIQUE INDEX idx_jobs_idempotency 
ON jobs(idempotencyKey, userId);

-- Table structure
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  userId UUID NOT NULL,
  idempotencyKey VARCHAR(255),
  type VARCHAR(100),
  payload JSONB,
  status VARCHAR(50),
  -- ... other columns
  
  CONSTRAINT fk_jobs_userId 
    FOREIGN KEY (userId) REFERENCES users(id),
  CONSTRAINT idx_jobs_idempotency_unique 
    UNIQUE (idempotencyKey, userId)
);
```

## Examples

### Webhook Use Case

```typescript
// Stripe webhook arrives
POST /webhooks/stripe
{
  "id": "evt_1234567890",
  "type": "payment.succeeded",
  "data": {
    "charge": {
      "id": "ch_1111111111",
      "amount": 2000
    }
  }
}

// Our handler
async function handleStripeWebhook(event) {
  const idempotencyKey = event.id;  // Use event ID as key
  
  // Process payment succeeded event
  // If webhook retries with same event.id, we return existing job
  const job = await submitJob({
    type: 'send-receipt-email',
    payload: event.data,
    idempotencyKey
  });
  
  return job;
}
```

**Result**:
- 1st webhook: Creates job, sends email
- 2nd webhook (retry with same evt_id): Returns existing job, no new email
- User gets email once ✅

### Retry Logic Use Case

```typescript
// Frontend
async function submitJob(jobData) {
  const idempotencyKey = generateUUID();
  
  try {
    return await api.post('/jobs', {
      ...jobData,
      idempotencyKey
    });
  } catch (error) {
    // Network error, retry with same key
    return await api.post('/jobs', {
      ...jobData,
      idempotencyKey  // Same key
    });
    // → Returns existing job (idempotent)
  }
}
```

**Result**:
- 1st attempt: Creates job
- 2nd attempt (retry with same key): Returns same job
- Job processed once ✅

## Key Design Decisions

### 1. Scope: Per User

```sql
UNIQUE (idempotencyKey, userId)
```

**Why**: Two users can submit similar jobs. Keys only need to be unique per user.

### 2. Optional Key

```typescript
idempotencyKey || generateUUID()
```

**Why**: Callers who don't care about idempotency get a unique key automatically.

### 3. Scope: Time-Limited? No

**Why**: Jobs are long-lived. Keep key forever (or at least as long as job is queryable).

## Trade-offs

| Pro | Con |
|-----|-----|
| Safe against duplicate processing | Must generate key on client side |
| Works for any operation | Adds minor DB overhead (unique index) |
| Simple to implement | Must document requirement clearly |
| Works across retries & replays | Key collision edge case (extremely rare) |

## A Different Failure Mode: Idempotent Job Handlers

Everything above prevents a duplicate **job row** from being created. It does not prevent a duplicate **side effect** from happening during processing — that's a separate problem, and it's the one that actually matters once a job is already queued.

```
Job #123 (charge card / send email / generate report)
    ↓
Worker starts
    ↓
Handler performs the real-world side effect (charges card, sends email)
    ↓
Worker crashes BEFORE marking the job/execution as complete
    ↓
BullMQ sees no ack → retries the job
    ↓
Handler runs again
    ↓
Did the side effect just happen TWICE? ❌
```

The idempotency key on `jobs` only guarantees the job was *submitted* once. It says nothing about whether the *handler body* is safe to execute more than once for the same job — and BullMQ's at-least-once delivery means it will, eventually, run a handler twice for some job.

### Making the Handler Itself Safe to Re-run

The fix has to live inside the handler, not just at the API boundary:

```typescript
async function chargeCardHandler(payload: ChargePayload, jobId: string) {
  // Check the execution log FIRST — did a previous attempt already succeed
  // even though the worker crashed before we could record it?
  const priorSuccess = await db.jobExecutions.findFirst({
    where: { jobId, status: 'completed' }
  });
  if (priorSuccess) {
    return priorSuccess.result;  // Already done — don't charge again
  }

  // Pass the job's idempotency key through to the external system too.
  // Stripe (and most payment/email APIs) accept their own idempotency key
  // so THEIR side effect is also safe to retry, not just ours.
  const charge = await stripe.charges.create(
    { amount: payload.amount, source: payload.token },
    { idempotencyKey: payload.idempotencyKey }
  );

  return charge;
}
```

Two layers, both needed:

| Layer | Protects against | Mechanism |
|-------|-------------------|-----------|
| API / job submission | Duplicate **job rows** (double-click, webhook retry) | `UNIQUE (idempotencyKey, userId)` on `jobs` |
| Job handler | Duplicate **side effects** (worker crash mid-processing, BullMQ retry) | Check prior execution result before acting; forward the idempotency key to the external API when it supports one |

For side effects with no external idempotency support (e.g. an internal email service with no dedup), the handler must record "in-progress" state transactionally *before* performing the effect, so a crash-and-retry can detect "was I already doing this?" rather than only "did I already finish?".

## Related Patterns

- [[PATTERNS/06-Audit-Trail]] - Every attempt logged immutably
- [[PATTERNS/02-Exponential-Backoff]] - Safe to retry with backoff
- [[JOB-LIFECYCLE/04-Idempotency]] - How idempotency works in job processing

## Interview Questions

**Q: "How do you handle webhook duplicates?"**  
A: Idempotency key. Attach unique ID to request. Same ID = same result, no side effects.

**Q: "What if two requests come in simultaneously with same idempotency key?"**  
A: Database unique constraint + transaction ensures only one succeeds.

**Q: "Can I generate the key on the server?"**  
A: No, client must generate (otherwise retry gets new key, creating duplicate).

## Further Reading

- **Stripe's Approach**: Stripe Idempotency Keys (industry standard)
- **HTTP Spec**: RFC 9110 (Idempotent Methods)
- **General Pattern**: Exactly-once semantics in distributed systems
