# Journal

## TypeScript: noUncheckedIndexedAccess

**What it does:**
When enabled, accessing an array element (e.g., `array[0]`) has type `T | undefined` instead of just `T`. You must check if the element exists before using it.

```ts
// Without noUncheckedIndexedAccess
const jobs = [];
const job = jobs[0]; // Type: Job (assumed to exist)
process(job); // Silent runtime error if array is empty

// With noUncheckedIndexedAccess
const jobs = [];
const job = jobs[0]; // Type: Job | undefined (enforced)
if (job) process(job); // Must check explicitly
```

**Why it matters for a queue system:**

- Job queues frequently dequeue items and check if items exist
- Without this check, you could write code that processes `undefined` jobs
- In a distributed queue, unhandled undefined values silently fail and can:
  - Poison the queue with incomplete data
  - Lose work (jobs not persisted as "processed")
  - Cause cascading failures in workers
- TypeScript catches these errors at **compile time**, not runtime

**Interview angle:**
Shows you understand:

1. Type safety catches real bugs before production
2. Distributed systems need bulletproof error handling
3. Strictness flags exist because people write these bugs in real code
4. A queue system is a good example because it's state-critical (losing jobs is expensive)

---

## Redis: maxmemory-policy for BullMQ

**The Problem:**
Redis is often used as a cache, which means it automatically removes keys when memory reaches certain limits according to an eviction policy. BullMQ, however, cannot work properly if Redis evicts queue keys arbitrarily—this would cause jobs to be lost or corrupted.

**The Solution:**
Configure `maxmemory-policy noeviction` in Redis. This is the **only** setting that guarantees correct BullMQ behavior:

```yaml
# docker-compose.yml
redis:
  command:
    - redis-server
    - --appendonly yes
    - --maxmemory-policy noeviction
```

**Why it matters:**

- **Cache mode** (`allkeys-lru`, `allkeys-lfu`): Redis evicts any key when memory is full → **jobs get lost**
- **Noeviction mode**: Redis refuses new writes when full → **you see the error and can respond** (add more memory, clear old data)

The queue will fail loudly and safely instead of silently losing work. Better to run out of memory and alert than to have invisible job loss.

---
