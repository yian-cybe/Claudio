# Claudio Plan: Day 06 Dependency Security and Billing Foundation

## Objective

Remove the known high-severity music dependency risk and create a secure,
provider-neutral foundation for Free and Pro plan changes.

## Scope

- Included: vulnerability reachability analysis, dependency remediation, signed
  billing webhook, event idempotency, plan transitions, status API, tests, and
  production simulation.
- Excluded: real payment provider checkout, refunds, invoices, taxes, email
  verification, and cloud deployment.

## Planned Steps

1. Analyze the vulnerable music parser path.
2. Upgrade or isolate the dependency without breaking music APIs.
3. Add signed and idempotent plan-change events.
4. Verify production behavior and update durable records.

## Result

- Completed: Dependency remediation and billing backend foundation.
- Not completed: A customer cannot purchase Pro until a payment provider and
  checkout flow are connected.
- Files changed: `package.json`, `package-lock.json`, `lib/music/ncm.js`,
  `lib/accounts.js`, `lib/billing.js`, `test/billing.test.js`, `server.js`,
  `.env.example`, and `.env.production.example`.
- Verification: 66 tests passed; production simulation verified invalid
  signatures, Free-to-Pro upgrade, Pro quota, duplicate event idempotency,
  cancellation, and disabled-by-default webhook behavior. `npm audit` reports
  zero vulnerabilities.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-031` | Suggested downgrade introduced more high vulnerabilities | Old transitive dependencies | Resolved |

## Durable Decisions

- Keep `NeteaseCloudMusicApi` pinned to 4.32.0 and override
  `music-metadata` to 11.13.0 until the upstream package updates.
- Billing plan changes require an HMAC-SHA256 signature over the raw request
  body.
- Billing events must have unique IDs and are idempotent.
- Webhook processing is disabled until `BILLING_WEBHOOK_SECRET` is configured.
- `checkoutAvailable` remains false until a real payment provider is connected.

## Sources

- npm overrides:
  https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides
- Node HMAC:
  https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options
- Node constant-time comparison:
  https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b

## Memory Update

Day 06 is complete. The next plan should connect a real payment provider or
prioritize cloud deployment and verified-email access before public launch.

