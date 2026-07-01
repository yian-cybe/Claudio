# Claudio Plan: Day 04 Usage Quotas and Cost Controls

## Objective

Protect launch model costs by measuring per-user AI usage and enforcing Free
and Pro daily reply limits.

## Scope

- Included: usage records, plan limits, server enforcement, allowance API,
  Settings display, production configuration, and two-user verification.
- Excluded: payment checkout, plan upgrades, authentication rate limits, and
  cloud deployment.

## Planned Steps

1. Add a per-user usage and quota service.
2. Enforce limits in HTTP and WebSocket chat.
3. Expose remaining allowance in Settings.
4. Verify isolation and update durable project records.

## Result

- Completed: All planned Day 04 quota and cost-control work.
- Not completed: Billing and general abuse rate limits remain separate plans.
- Files changed: `lib/usage.js`, `lib/db.js`, `server.js`, `public/index.html`,
  `public/app.js`, `public/style.css`, `public/sw.js`,
  `.env.production.example`, and `test/usage.test.js`.
- Verification: 60 automated tests passed. An isolated production simulation
  confirmed user A was rejected with `429` after one reply while user B retained
  an independent allowance. Browser Settings showed the usage card with no
  console errors.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-024` | Missing test file during inspection | Incorrect filename | Resolved |
| `ERR-025` | Combined patches rejected | Unstable encoded context | Resolved |
| `ERR-026` | SQLite database locked | No write-lock wait timeout | Resolved |
| `ERR-027` | Browser binding collision | Persistent prior binding | Resolved |
| `ERR-028` | Stale Settings frontend | PWA cache version not bumped | Resolved |

## Durable Decisions

- Free users receive 10 AI replies per day by default; Pro users receive 200.
- Limits remain configurable through environment variables.
- Only successful non-offline LLM replies consume quota.
- Music-only local routing does not consume AI allowance.
- Cost estimates use configured per-million-token rates rather than hard-coded
  provider prices.

## Memory Update

Day 04 is complete. The next launch protection step is request and
authentication rate limiting, followed by billing.

