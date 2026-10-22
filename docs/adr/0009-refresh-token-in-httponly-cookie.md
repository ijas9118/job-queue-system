# 0009. Refresh token in an HttpOnly cookie

- Status: Accepted
- Date: 2026-10-22
- Milestone: M4

## Context

The authentication doc offers two options for the refresh token (JSON body
stored by the client, or HttpOnly cookie) and calls the JSON option "current"
while recommending the cookie. The dashboard is a browser SPA, where any
injected script can read `localStorage`, so a stolen 7-day refresh token is a
full account takeover.

## Decision

- Access token: JWT, HS256 with the algorithm pinned on verify, 15 minutes,
  kept only in memory in the dashboard and sent as `Authorization: Bearer`.
- Refresh token: random 256-bit opaque value, stored server-side as a SHA-256
  hash, sent as a cookie with `HttpOnly; Secure; SameSite=Lax;
Path=/api/v1/auth`, 7 days.
- Rotation on every refresh; tokens belong to a family, and reuse of an old
  token revokes the whole family and is audit-logged.
- CSRF: refresh and logout require a custom header (for example
  `X-Requested-With`) and check `Origin`.
- On page load the dashboard calls refresh to get a new access token.

## Consequences

- XSS cannot read the refresh token; a stolen access token expires in 15 minutes.
- The API and dashboard must share a site (same domain or subdomains) for the
  cookie to be sent; CORS must allow credentials from the dashboard origin only.
- Non-browser clients would need a separate flow; none are planned.

## Alternatives considered

- **Refresh token in JSON and localStorage:** simplest, but exposed to XSS.
- **Server sessions instead of JWTs:** simpler revocation, but the project's
  learning goals include JWT handling.
