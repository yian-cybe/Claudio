# Claudio Plan: SMTP Email Integration

## Objective

Connect the existing email verification flow to a provider-neutral delivery
interface without committing to a specific email vendor.

## Scope

- Included: SMTP configuration, verification email templates, production send,
  resend behavior, connection readiness checks, tests, and deployment variables.
- Excluded: purchasing a sending domain, creating an email-provider account,
  entering production credentials, and payment-provider selection.

## Result

- Completed: SMTP delivery implementation and launch checks.
- Not completed: Real delivery remains disabled until SMTP credentials and a
  verified sender domain are supplied.
- Files changed: `lib/email.js`, `test/email.test.js`, `server.js`,
  `lib/runtime-config.js`, `test/runtime-config.test.js`,
  `scripts/check-launch-readiness.js`, `package.json`, `package-lock.json`,
  `.env.example`, `.env.production.example`, and
  `docker-compose.production.yml`.
- Verification: 73 tests pass, `npm audit` reports zero vulnerabilities, and
  the launch check reports missing SMTP and checkout configuration.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-034` | Restart command printed no listener | Port query timing | Resolved |

## Durable Decisions

- Email delivery uses standard SMTP to avoid vendor lock-in.
- SMTP credentials come only from environment variables.
- Registration remains successful if mail delivery temporarily fails.
- Production responses never expose verification tokens or SMTP credentials.
- The launch check verifies the SMTP connection when configuration is present.

## Next Decision

Select the payment provider based on the legal entity and settlement country.

