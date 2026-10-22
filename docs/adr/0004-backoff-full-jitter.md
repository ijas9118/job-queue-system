# 0004. Exponential backoff with full jitter

- Status: Accepted
- Date: 2026-10-22
- Milestone: M5

## Context

The docs give three different retry delay sequences (1/4/16 s, 1/2/4 s and
2/4/8 s) and use +/-20% jitter. Retrying at fixed or lightly jittered
intervals makes many failed jobs retry at about the same moment, which hits a
recovering dependency all at once (a thundering herd).

## Decision

The delay before retry number n (n = 1 for the first retry) is:

    delay = random(0, min(cap, base * 2^(n-1)))

with base = 1 s, cap = 1 h. This is "full jitter".
Defaults: maxRetries = 3 (so up to 4 attempts), overridable per job up to 10.

The formula lives in one pure function, used as BullMQ's custom
`backoffStrategy` (ADR 0001), and is unit-tested with a seeded or stubbed
random source.

## Consequences

- Retries spread out evenly, so a recovering service sees a smooth load.
- Individual delays are unpredictable, so tests assert ranges, not exact values.
- A retry can occasionally run almost immediately; acceptable because the
  expected delay still grows exponentially.
- All docs must reference this one formula.

## Alternatives considered

- **Plain exponential (no jitter):** synchronised retries. Rejected.
- **Exponential with +/-20% jitter (docs):** better, but still clusters.
- **Decorrelated jitter:** also good; full jitter is simpler to explain and test.
