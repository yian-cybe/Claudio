# Claudio Plan: Mainland China Payments

## Objective

Add a secure browser checkout foundation for a mainland China merchant using
WeChat Pay and Alipay.

## Scope

- Included: fixed server price, 30-day Pro entitlement, payment orders, QR
  checkout, signed callbacks, Settings purchase UI, launch configuration.
- Excluded: merchant account application, real-money production transaction,
  refunds, invoices, recurring debit agreements, and reconciliation jobs.

## Result

- Fixed `pro_30d` at CNY 29.00 on the server.
- Added user-owned, idempotent payment orders.
- Added 30-day Pro expiry and renewal extension.
- Added WeChat Pay API v3 Native signing, callback verification, and AES-GCM
  resource decryption.
- Added Alipay precreate RSA2 signing and asynchronous notification verification.
- Added authenticated checkout, order polling, QR rendering, and Settings UI.
- Updated launch readiness to require at least one complete payment channel.

## Merchant Setup Checklist

1. Complete mainland China business identity and settlement-account review.
2. WeChat Pay: obtain merchant ID, linked AppID, merchant API certificate
   serial/private key, API v3 key, and platform public key/certificate.
3. Alipay: create an application, enable face-to-face payment, configure RSA2
   application keys, obtain the Alipay public key, and record seller ID.
4. Deploy Claudio behind a public HTTPS domain.
5. Configure callback URLs exactly as shown in `.env.production.example`.
6. Store all credentials in the hosting secret manager, never in Git.
7. Run small-value sandbox or production acceptance payments and verify callback,
   entitlement, duplicate callback, expiry, and reconciliation behavior.

## Verification

- Automated tests: 83 passing across 20 suites.
- `node --check` passed for server, frontend, and payment adapters.
- `npm audit` reported zero vulnerabilities after adding direct QR dependency.
- Real-money payment remains blocked until merchant credentials and public HTTPS
  callbacks are supplied.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-035` | Parallel targeted tests initially hit `database is locked`. | SQLite set `busy_timeout` after requesting WAL mode. | Resolved |
| `ERR-036` | Documentation patch did not match memory headings. | Memory and ledger structures differed. | Resolved |
| `ERR-037` | Browser policy blocked the Settings click. | Localhost interaction was disallowed for this session. | Blocked |

## Durable Decisions

- Browser clients never submit or control the payable amount.
- A successful browser response does not grant Pro; only a verified provider
  callback can do so.
- A one-time CNY 29 payment grants 30 days and renewals extend remaining time.
- Direct WeChat Pay and Alipay integration replaces foreign card checkout for
  the mainland China launch.
