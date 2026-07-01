# Claudio Plan Error Log

This is the durable error and risk ledger for project execution.

## Update Rules

- Add an entry whenever a plan produces an error, failed command, unexpected
  result, regression, or newly discovered product risk.
- Never delete resolved entries.
- When fixed, change the status to `Resolved`, add the resolution date, explain
  the fix, and record the verification evidence.
- Use `Open`, `Blocked`, `Mitigated`, or `Resolved` as status values.
- Product risks discovered during implementation belong here even when they did
  not cause a command failure.

## Status Summary

| Status | Count |
| --- | ---: |
| Open | 4 |
| Blocked | 1 |
| Mitigated | 2 |
| Resolved | 27 |

## Open Issues

### ERR-009: SQLite limits multi-instance deployment

- Status: **Open**
- Discovered: 2026-06-13, launch planning
- Area: Infrastructure
- Result: The application stores users and sessions in a local SQLite file.
- Root cause: SQLite was retained to maximize one-week launch speed.
- Impact: Horizontal scaling and multi-instance failover are unsafe.
- Decision: Accept for the first single-instance launch.
- Elimination criteria: Migrate production-owned data to PostgreSQL before
  horizontal scaling.

### ERR-010: Production cloud target is not connected

- Status: **Open**
- Discovered: 2026-06-13, Day 01
- Area: Deployment
- Result: Production templates exist, but no cloud service, domain, HTTPS, or
  monitoring has been configured.
- Root cause: Hosting provider and domain have not been selected.
- Impact: Claudio is not publicly accessible.
- Elimination criteria: Deploy production container, connect domain and HTTPS,
  and pass remote smoke tests.

### ERR-011: Docker image build could not be verified locally

- Status: **Blocked**
- Discovered: 2026-06-13, Day 01 verification
- Area: Tooling
- Failed result: `docker build -t claudio-day01-check .` could not connect to the
  Docker Desktop Linux engine.
- Root cause: Docker Desktop daemon was not running on the development machine.
- Impact: Dockerfile syntax and Compose configuration were checked, but the
  actual image build remains unverified.
- Rechecked: 2026-06-18. Docker Desktop Linux engine is still not running;
  Compose configuration continues to parse successfully.
- Elimination criteria: Start Docker Desktop or build through the selected cloud
  provider's build system.

### ERR-017: Historical source and documentation encoding corruption

- Status: **Open**
- Discovered: 2026-06-13, documentation audit
- Area: Maintainability
- Result: Several existing source comments, UI strings, README sections, and
  older reports display as mojibake.
- Root cause: Files were previously written or converted with inconsistent
  character encodings.
- Impact: UI text can become unreadable, documentation is harder to trust, and
  text-heavy patches can match the wrong location or fail.
- Elimination criteria: Inventory affected files, convert them to UTF-8 without
  changing behavior, and browser-test all user-visible Chinese strings.

### ERR-033: Public launch services are not connected

- Status: **Open**
- Discovered: 2026-06-18, Day 07 launch readiness
- Area: External integrations
- Result: SMTP delivery and mainland WeChat/Alipay checkout code exist, but
  merchant credentials, SMTP credentials, public callbacks, and production
  error monitoring are not connected.
- Root cause: Providers, accounts, domains, and credentials have not been
  selected or supplied.
- Impact: Users cannot receive verification links or complete real-money Pro
  purchases, and production failures would not reach an alerting service.
- Elimination criteria: Add SMTP and WeChat Pay or Alipay merchant credentials,
  deploy public HTTPS callbacks, select monitoring, add secrets through the
  cloud secret manager, and pass `npm run check:launch`.

## Resolved Issues

### ERR-001: Production configuration allowed unsafe startup

- Status: **Resolved**
- Discovered: 2026-06-13, Day 01
- Resolved: 2026-06-13
- Root cause: The local prototype accepted missing secrets, insecure endpoints,
  runtime model switching, and local-only fallback behavior.
- Fix: Added production configuration validation and locked production runtime
  settings.
- Verification: Valid production settings pass; missing key, non-HTTPS URL, and
  unsafe switches reject startup.

### ERR-002: Authenticated health checks broke platform probes

- Status: **Resolved**
- Discovered: 2026-06-13, Day 01
- Resolved: 2026-06-13
- Root cause: `/api/health` required the same bearer token as functional APIs.
- Fix: Split health into minimal public `/api/health` and protected
  `/api/health/details`.
- Verification: Public health succeeds without credentials and exposes only
  service, environment, and uptime.

### ERR-012: Large patch failed against historically corrupted text

- Status: **Resolved**
- Discovered: 2026-06-13, Day 01 implementation
- Failed result: A large `apply_patch` could not match expected context.
- Root cause: Several source files contain historical encoding corruption, so
  text-heavy patch context was unstable.
- Fix: Split changes into small patches anchored on stable ASCII identifiers.
- Lesson: Prefer stable function names, IDs, and short patch contexts in this
  repository until encoding cleanup is performed.

### ERR-013: Broad patch inserted `identityId` into unrelated callbacks

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02 implementation
- Failed result: A broad replacement accidentally added `identityId` to the
  WebSocket `pong` callback and health response.
- Root cause: Repeated `});` patterns made a context-light patch match the wrong
  locations.
- Fix: Inspected every `identityId` occurrence and corrected the unrelated
  insertions.
- Verification: Syntax checks and 50 automated tests pass; production health and
  browser authentication flow pass.
- Lesson: After broad edits in `server.js`, inspect all occurrences of the new
  symbol before testing.

### ERR-014: Browser REPL variable name collision

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02 browser verification
- Failed result: Browser verification stopped with `Identifier 'errors' has
  already been declared`.
- Root cause: The persistent Node REPL retained a previous top-level binding.
- Fix: Reused a new unique binding name and continued verification.
- Verification: Registration, session persistence, and logout browser flows all
  passed.

### ERR-015: Settings were only runtime state and disappeared on restart

- Status: **Mitigated**
- Discovered: 2026-06-13, pre-Day 01 review
- Root cause: Provider/model changes were held in process memory.
- Mitigation: Production users can no longer modify provider/model; production
  model configuration comes from cloud environment variables.
- Remaining work: Persist only genuine per-user preferences during Day 03.

### ERR-008: Email ownership is not verified

- Status: **Mitigated**
- Discovered: 2026-06-13, Day 02 review
- Mitigated: 2026-06-18, Day 07
- Root cause: Email delivery and verification flows were not connected.
- Mitigation: Added hashed, expiring, one-time verification tokens, verification
  status, browser link handling, and optional production chat/WebSocket
  enforcement.
- Verification: Production simulation rejected unverified chat with HTTP `403`
  and WebSocket close code `4003`, then allowed access after verification.
- Remaining work: Connect a real email delivery provider before enabling
  `EMAIL_VERIFICATION_REQUIRED=true` publicly.

### ERR-016: Shared preview token was unsuitable for customer access

- Status: **Resolved**
- Discovered: 2026-06-13, Day 01
- Resolved: 2026-06-13, Day 02
- Root cause: Day 01 used a shared `API_TOKEN` as temporary preview protection.
- Fix: Added account registration, login, opaque sessions, secure cookies, and
  logout invalidation. `API_TOKEN` is now optional administrator access only.
- Verification: Production browser flow blocks guests, preserves user sessions
  across refresh, and invalidates sessions on logout.

### ERR-004: Global chat lock blocked concurrent users

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02
- Resolved: 2026-06-13, Day 03
- Root cause: The original single-user runtime used one global boolean lock.
- Fix: Replaced the global lock with an active-chat set keyed by authenticated
  identity.
- Verification: Two accounts submitted chat requests concurrently and both
  received HTTP `200`; their histories remained isolated.

### ERR-018: Day 03 state migration patch failed to match

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 implementation
- Failed result: The first combined database/state migration patch was rejected.
- Root cause: Patch context expected a different quoting form in `db.js`.
- Fix: Split the migration into smaller patches anchored on stable schema text.
- Verification: Migration code applied, syntax checks passed, and state
  isolation tests passed.

### ERR-019: Context-light patch inserted identity scope in wrong locations

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 implementation
- Failed result: A broad `});` replacement temporarily added `identityId` to
  unrelated authentication and prompt-builder calls.
- Root cause: Repeated closing syntax in `server.js` made the patch ambiguous.
- Fix: Inspected all `identityId` occurrences and corrected unrelated edits.
- Verification: `node --check`, 53 tests, live two-account API tests, and live
  WebSocket isolation tests passed.

### ERR-020: New browser verification tab failed to attach

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 verification
- Failed result: A new application-browser tab timed out while waiting for the
  Browser webview to attach.
- Root cause: The in-app Browser tool had an unattached blank tab and could not
  attach another new automation tab.
- Fix: Listed available tabs, reused the existing blank tab, and navigated it to
  the local application.
- Verification: The radio rendered, WebSocket displayed connected, the
  development auth gate remained correctly disabled, and the console had no
  errors.

### ERR-003: User-owned context was globally shared

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02
- Resolved: 2026-06-13, Day 03 completion
- Root cause: History, memory, taste, playback, and RAG were designed around one
  local user.
- Fix: Added user-owned history/settings, moved long-term memory and taste
  profiles into per-user settings, and added `user_id` ownership to RAG vectors.
- Verification: Unit isolation tests and live production two-account profile and
  context checks passed.

### ERR-005: Shared realtime events could reach unrelated users

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02
- Resolved: 2026-06-13, Day 03 completion
- Root cause: The original application treated Radio and schedules as one
  globally shared station.
- Fix: Scoped user-owned events by identity and disabled shared Radio, manual
  schedules, and automatic scheduler startup in production.
- Verification: Production Radio returned `409`, no production schedules were
  started, and two-account WebSocket isolation passed.

### ERR-021: Combined RAG ownership patch failed to match

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 completion
- Failed result: The first combined RAG schema and query patch was rejected.
- Root cause: Historical mojibake comments made the expected patch context
  unstable.
- Fix: Split the change into stable SQL and function-signature patches.
- Verification: RAG schema contains `user_id`, ownership index migration
  succeeds, syntax checks pass, and 56 automated tests pass.

### ERR-022: No-match safety scan returned exit code 1

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 completion verification
- Failed result: The combined validation command returned exit code `1`.
- Root cause: `rg` correctly found no remaining unsafe identity-less calls and
  reports no matches using exit code `1`.
- Fix: Interpreted the no-match result separately from `git diff --check`.
- Verification: Syntax checks and 56 automated tests passed.

### ERR-007: No per-user DeepSeek quota or cost accounting

- Status: **Resolved**
- Discovered: 2026-06-13, launch planning
- Resolved: 2026-06-13, Day 04
- Root cause: Usage records and plan entitlements were not implemented.
- Fix: Added per-user usage events, Free/Pro daily limits, model token and
  estimated-cost accounting, server-side quota enforcement, and frontend
  remaining-allowance display.
- Verification: Unit tests and an isolated production simulation confirmed that
  one Free user receives `429` after exhausting the limit while another user's
  allowance remains independent.

### ERR-023: Final browser UI verification could not attach

- Status: **Resolved**
- Discovered: 2026-06-13, Day 03 completion verification
- Resolved: 2026-06-13, Day 04
- Root cause: The Browser plugin temporarily had no attached application
  webview.
- Fix: Reconnected the in-app Browser, opened the local application, and
  repeated the UI smoke check.
- Verification: The Settings panel and usage card rendered with no browser
  console errors.

### ERR-024: Test inspection referenced a nonexistent file

- Status: **Resolved**
- Discovered: 2026-06-13, Day 04 inspection
- Failed result: The inspection command attempted to read `test/state.test.js`.
- Root cause: The actual test file is named `test/state-isolation.test.js`.
- Fix: Used the repository's real test filenames and continued inspection.
- Verification: The full suite discovered and passed all 60 tests.

### ERR-025: Combined quota integration patches failed to match

- Status: **Resolved**
- Discovered: 2026-06-13, Day 04 implementation
- Failed result: Combined patches against `server.js` and `public/index.html`
  were rejected.
- Root cause: Historical encoding differences and broad patch context made the
  expected text unstable.
- Fix: Split edits into small patches anchored on stable ASCII identifiers.
- Verification: All quota symbol locations were inspected; syntax checks and
  the full test suite passed.

### ERR-026: Parallel SQLite usage test hit a write lock

- Status: **Resolved**
- Discovered: 2026-06-13, Day 04 verification
- Failed result: The first full test run failed with `database is locked` while
  recording usage.
- Root cause: Parallel Node test processes shared the SQLite database, and the
  connection had no write-lock wait timeout.
- Fix: Added `PRAGMA busy_timeout=5000` while retaining WAL mode.
- Verification: The next full test run passed all 60 tests.

### ERR-027: Persistent browser binding name collided

- Status: **Resolved**
- Discovered: 2026-06-13, Day 04 browser verification
- Failed result: Initial browser setup returned an identifier-already-declared
  error.
- Root cause: A prior browser session retained the same top-level binding.
- Fix: Reused the existing binding and later reconnected with unique names.
- Verification: Browser automation completed the Settings panel check.

### ERR-028: PWA served stale Settings assets

- Status: **Resolved**
- Discovered: 2026-06-13, Day 04 browser verification
- Failed result: The restarted server served the new HTML, but the browser
  continued running old cached frontend assets and did not load the usage card.
- Root cause: The Service Worker cache version remained `claudio-shell-v13`
  after frontend assets changed.
- Fix: Bumped the shell cache to `claudio-shell-v14` and reloaded after the new
  worker activated.
- Verification: Settings displayed `ADMIN · Unlimited AI replies · 0 tokens`
  and the browser console had no errors.
- Recurrence: On 2026-06-22 the first payment UI reload still showed the old
  shell. Cache version `v17` and a versioned navigation loaded the new Pro card.

### ERR-006: No request or authentication rate limits

- Status: **Resolved**
- Discovered: 2026-06-13, Day 02 review
- Resolved: 2026-06-13, Day 05
- Root cause: The local prototype did not need abuse protection.
- Fix: Added fixed-window registration IP limits, login IP and normalized-email
  limits, and chat IP and account limits for both HTTP and WebSocket paths.
- Verification: Unit tests and a low-threshold production simulation confirmed
  `429` plus `Retry-After` for registration, login, and HTTP chat, and a
  `rate-limit` event for WebSocket chat.

### ERR-030: Combined Day 05 documentation patch failed to match

- Status: **Resolved**
- Discovered: 2026-06-13, Day 05 documentation update
- Failed result: The combined documentation patch was rejected.
- Root cause: Historical encoding corruption changed the expected Settings
  verification line.
- Fix: Split documentation edits into small patches anchored on stable headings.
- Verification: Error ledger, Day 05 plan result, and project memory were
  updated successfully.

### ERR-029: Music dependency chain has known high-severity vulnerabilities

- Status: **Resolved**
- Discovered: 2026-06-13, Day 05 security audit
- Resolved: 2026-06-13, Day 06
- Root cause: `NeteaseCloudMusicApi` 4.32.0 allowed an old vulnerable
  `music-metadata` version, used only by its cloud-upload module.
- Fix: Kept the compatible music API version and used npm `overrides` to install
  patched `music-metadata` 11.13.0 and `file-type` 21.3.4.
- Verification: Music module imports successfully, 66 tests pass, and
  `npm audit --audit-level=high --omit=dev` reports zero vulnerabilities.

### ERR-031: Suggested Netease package downgrade worsened security

- Status: **Resolved**
- Discovered: 2026-06-13, Day 06 dependency remediation
- Failed result: Installing npm's suggested `NeteaseCloudMusicApi` 3.47.5
  increased findings to six high-severity vulnerabilities.
- Root cause: The suggested downgrade removed the original parser dependency but
  introduced older vulnerable dependencies including Axios.
- Fix: Rejected the downgrade, restored 4.32.0, and upgraded only the vulnerable
  transitive parser through an override.
- Verification: Final dependency tree has zero audit findings and all tests
  pass.

### ERR-032: WebSocket dependency gained a high-severity DoS advisory

- Status: **Resolved**
- Discovered: 2026-06-18, Day 07 security audit
- Resolved: 2026-06-18
- Failed result: `npm audit --audit-level=high --omit=dev` reported
  `GHSA-96hv-2xvq-fx4p` against `ws` 8.20.1.
- Root cause: The lockfile resolved to a WebSocket version vulnerable to memory
  exhaustion from fragmented input.
- Fix: Pinned direct `ws` dependency to 8.21.0.
- Verification: 70 tests pass and `npm audit` reports zero vulnerabilities.

### ERR-034: Local restart command returned no listener result

- Status: **Resolved**
- Discovered: 2026-06-21, external provider integration
- Failed result: The combined restart command exited with code `1` and printed
  no listener row.
- Root cause: The immediate listener query ran before the new process was
  observable to that command pipeline.
- Fix: Queried the port and logs separately.
- Verification: Claudio is listening on port `8080` and the health startup log
  confirms the latest service is running.
- Recurrence: On 2026-06-22 the combined restart/health command again returned
  no health body; separate listener and log checks confirmed PID `18756`.

### ERR-035: Parallel payment tests hit a SQLite initialization lock

- Status: **Resolved**
- Discovered: 2026-06-22, mainland China payments
- Resolved: 2026-06-22
- Failed result: The first targeted test run failed with `database is locked`
  while three test processes initialized the shared SQLite database.
- Root cause: `PRAGMA journal_mode=WAL` ran before `PRAGMA busy_timeout`, so
  database initialization did not wait for another process to release the lock.
- Fix: Configure the five-second busy timeout before requesting WAL mode.
- Verification: Targeted tests pass, followed by all 83 tests passing in
  parallel.

### ERR-036: Payment documentation patch did not match memory structure

- Status: **Resolved**
- Discovered: 2026-06-22, mainland China payments
- Resolved: 2026-06-22
- Failed result: Two combined documentation patches were rejected because an
  expected SMTP summary heading was not present in `memory.md`.
- Root cause: `memory.md` and the error ledger use different summary headings
  and section ordering.
- Fix: Read the exact section boundaries and apply file-specific patches.
- Verification: Payment decisions, baseline, and error records are now present
  in the durable project documentation.

### ERR-037: Browser policy blocked interactive Settings verification

- Status: **Blocked**
- Discovered: 2026-06-22, mainland China payments
- Failed result: The in-app browser loaded the new Pro card but rejected the
  Settings button click under its localhost security policy.
- Root cause: Browser policy disallowed interactive use of
  `http://localhost:8080` for this session.
- Impact: The new payment card markup was visually observed, but the
  post-click provider-disabled state and console could not be browser-verified.
- Current evidence: Frontend syntax passes; all 83 automated tests pass; the
  page snapshot contains `Claudio Pro`, `30 天 · ¥29`, and the payment status.
- Elimination criteria: Repeat the Settings interaction in a browser session
  that permits this local origin or on the deployed HTTPS preview.

## Plan Summaries

### Day 01 Summary

- Delivered production configuration boundary, deployment templates, health
  endpoints, and locked server-managed DeepSeek configuration.
- Main remaining issue after Day 01 was the absence of customer accounts.

### Day 02 Summary

- Delivered account sessions and the production login gate.
- Reduced realtime leakage by identity-scoping user chat events.
- Exposed the next critical issue: authenticated users still share underlying
  state, so public registration remains unsafe until Day 03.

### Project Memory Setup Summary

- Added root `memory.md` as durable engineering memory.
- Added this error ledger and `docs/plan-template.md`.
- Distinguished engineering memory from `prompts/memory.md`, which remains part
  of Claudio's in-product personality context.
- No execution failure occurred during this documentation plan.

### Day 03 Summary

- Added `user_id` ownership to history and per-user settings.
- Isolated message reads, writes, clear, prune, LLM history context, and current
  playback.
- Replaced the global chat lock with per-user locks.
- Verified two concurrent accounts and WebSocket chat-event isolation.
- File-backed memory, taste, RAG, Radio, and scheduled events remain shared.

### Day 03 Completion Summary

- Moved long-term memory and taste profiles into user-owned settings.
- Added RAG vector ownership and user-filtered lookup.
- Disabled shared Radio and scheduled execution in production.
- Completed the cloud-launch user privacy boundary.

### Day 04 Summary

- Added per-user model usage records, daily Free/Pro quotas, token totals, and
  configurable cost estimates.
- Enforced quota limits for HTTP and WebSocket chat while leaving local music
  routing outside the AI allowance.
- Added a Settings allowance card and upgraded the PWA cache version.
- Verified two-user quota isolation and a `429` response after exhaustion.

### Day 05 Summary

- Added single-instance fixed-window abuse limits for registration, login, HTTP
  chat, and WebSocket chat.
- Added IP, normalized-email, and authenticated-account limit dimensions.
- Exposed `Retry-After` and rate-limit metadata to clients.
- Verified all four protected paths in a low-threshold production simulation.
- Discovered and recorded a high-severity music dependency-chain risk.

### Day 06 Summary

- Eliminated the music parser vulnerability chain while preserving current
  Netease API behavior.
- Added signed, disabled-by-default billing webhooks with event idempotency.
- Added controlled Free/Pro plan transitions and billing status reporting.
- Verified upgrade, duplicate-event, cancellation, invalid-signature, and
  disabled-webhook behavior.

### Day 07 Summary

- Added secure email verification tokens, browser verification links, and
  optional verified-account enforcement for chat and WebSocket.
- Added production CSP, HSTS, frame, content-type, referrer, and permissions
  security headers.
- Added launch readiness reporting and `npm run check:launch`.
- Updated production Compose with quota, rate-limit, verification, billing, and
  monitoring variables.
- Upgraded `ws` to 8.21.0 after a new high-severity advisory.
- Confirmed external email delivery, checkout, monitoring, hosting, and domain
  work remain blocked on provider choices and credentials.

### SMTP Integration Summary

- Added provider-neutral SMTP verification email delivery through Nodemailer.
- Added SMTP connection verification to the launch readiness command.
- Preserved successful account creation when email delivery temporarily fails.
- Increased the automated baseline to 73 tests with zero audit findings.

### Mainland China Payments Summary

- Selected direct WeChat Pay Native and Alipay precreate QR checkout.
- Added a server-fixed CNY 29 product that grants 30 days and extends remaining
  paid time.
- Added user-owned orders, idempotent fulfillment, signed callbacks, QR
  checkout, and Settings purchase UI.
- Real-money acceptance remains blocked on merchant credentials and public
  HTTPS callbacks.
