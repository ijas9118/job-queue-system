# 0010. Local Docker Compose first; cloud decided at M12

- Status: Accepted
- Date: 2026-10-22
- Milestone: M0, M12

## Context

The deployment docs plan an AWS setup (EC2, RDS, ElastiCache, CloudFront) with
cost estimates in INR. Some assumptions need re-checking before money is spent:
AWS changed its free tier for new accounts in 2025, ElastiCache clusters
cannot be stopped like RDS instances, and stopped RDS instances restart
automatically after 7 days. None of this blocks building the system.

## Decision

- Until M12 the only supported environment is local: `docker compose up` runs
  Postgres, Redis (AOF on, `maxmemory-policy noeviction`), Mailpit, API,
  worker and dashboard.
- CI runs the same Compose stack for integration and end-to-end tests.
- Images are built to be cloud-ready (multi-stage, non-root, health checks,
  config from environment) so the target can be chosen later.
- At M12 we write a new ADR choosing the cloud target after checking current
  pricing and free-tier rules.

## Consequences

- No cloud cost or account setup during development.
- The deployment docs stay as a draft until revalidated.
- The portfolio link waits until M12; a recorded demo can fill the gap.

## Alternatives considered

- **Deploy to AWS now:** earlier public link, but ongoing cost and
  infrastructure work before there is a system to show.
- **Pick a cheaper single VM or PaaS now:** possibly right, but best decided
  with real resource numbers from M10 load tests.
