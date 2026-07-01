# Claudio Plan: Day 07 Public Launch Integration

## Objective

Prepare Claudio for real public infrastructure without presenting unfinished
email, checkout, or monitoring integrations as production-ready.

## Scope

- Included: email verification core, verified-account access control, security
  headers, launch readiness checks, production Compose variables, dependency
  audit, production simulation, and browser regression.
- Excluded: selecting or purchasing external providers, domain registration,
  real email delivery, real checkout, and cloud resource creation.

## Planned Steps

1. Add secure email verification tokens and status.
2. Integrate registration, browser links, and optional access enforcement.
3. Add security headers and launch readiness checks.
4. Verify production behavior and document external blockers.

## Result

- Completed: All provider-independent Day 07 launch work.
- Not completed: Email delivery, customer checkout, monitoring, cloud hosting,
  domain, and HTTPS remain external integrations.
- Files changed: `lib/accounts.js`, `lib/auth.js`,
  `lib/email-verification.js`, `test/email-verification.test.js`,
  `lib/runtime-config.js`, `test/runtime-config.test.js`,
  `scripts/check-launch-readiness.js`, `server.js`, `public/app.js`,
  `public/sw.js`, `package.json`, `package-lock.json`, `.env.example`,
  `.env.production.example`, and `docker-compose.production.yml`.
- Verification: 70 tests passed, `npm audit` reports zero vulnerabilities,
  Compose configuration parses, browser smoke test has no console errors, and
  production simulation verified the full unverified-to-verified access flow.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-032` | New high-severity WebSocket advisory | Lockfile used `ws` 8.20.1 | Resolved |
| `ERR-033` | Launch readiness remains false | External providers are not connected | Open |
| `ERR-011` | Docker image still cannot build locally | Docker Desktop engine is stopped | Blocked |

## Durable Decisions

- Existing accounts are migrated as verified; newly created accounts begin
  unverified.
- Verification tokens are random, hashed at rest, expire after 24 hours, and
  are single-use.
- Production never returns raw verification tokens.
- `EMAIL_VERIFICATION_REQUIRED` remains false until real email delivery is
  connected.
- Public launch requires `npm run check:launch` to pass.
- External purchases, account creation, domains, and secret entry require
  explicit user/provider decisions.

## Current Launch Blockers

1. Email delivery provider and sending domain.
2. Payment checkout provider and product/price configuration.
3. Error monitoring provider.
4. Cloud hosting target, domain, and HTTPS.
5. Docker build verification or cloud-native image build.

## Memory Update

Day 07 provider-independent work is complete. The next action requires selecting
the external email, payment, monitoring, and hosting providers.

