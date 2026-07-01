# Claudio Project Memory

> This file is the durable engineering memory for Claudio.
> Update it after every implementation plan, investigation, or release milestone.
> `prompts/memory.md` is Claudio's in-product personality memory and must not be
> used for engineering notes.

## Product Direction

Claudio is an AI personality radio and companion, not a conventional chat app.
The browser cloud version is the first paid release. A native desktop app is not
required for the first launch.

The paid promise is:

> Open Claudio and immediately have a companion radio that responds, remembers,
> recommends music, and feels present.

## Launch Target

- Target: browser-based cloud launch within one week.
- Delivery model: HTTPS website with optional PWA installation.
- AI provider: server-managed DeepSeek API.
- Users must not install Node.js or provide API keys.
- Launch requires accounts, isolated user data, quotas, billing, monitoring, and
  production deployment.

## MVP Boundary

### Required

- Desktop-radio companion UI
- AI conversation and live subtitles
- Account registration, login, and logout
- Per-user history, preferences, memory, and playback state
- DeepSeek usage limits and cost tracking
- Free and Pro plans
- Cloud deployment, HTTPS, monitoring, and abuse controls

### Deferred

- Native desktop application
- User-provided API keys
- User-selectable AI providers
- Full hosted music playback
- Complex social features

## Completed Work

### UI Foundation

- Rebuilt the main page as a single-screen desktop radio.
- Retained the pixel dinosaur, dynamic waveform, live subtitles, Music, Talk,
  and Settings controls.
- Talk input is hidden until requested.
- Desktop and mobile layouts were browser-tested.

### Day 01: Cloud Launch Foundation

- Added production configuration validation.
- Locked runtime provider/model switching in production.
- Added minimal public health endpoint and protected detailed health endpoint.
- Added production environment template, Docker Compose configuration, and
  deployment documentation.
- Kept DeepSeek credentials server-side.

### Day 02: Accounts and Sessions

- Added email/password registration and login.
- Added salted `scrypt` password hashes.
- Added SQLite-backed opaque sessions.
- Added secure session cookies and logout invalidation.
- Added production login gate.
- Bound WebSocket connections to authenticated identities.
- Scoped user-triggered chat WebSocket events to the initiating identity.

### Day 03: Core User Data Isolation

- Added `user_id` ownership to message history.
- Added per-user settings storage for current playback state.
- Isolated message read, append, clear, prune, and LLM history context.
- Replaced the global `chatBusy` boolean with per-user active chat locks.
- Verified simultaneous requests from two accounts.
- Verified one account cannot read, clear, or receive another account's chat
  history or user-triggered WebSocket events.

### Day 03 Completion: Private Context Boundary

- Moved long-term memory and taste profiles from shared files to per-user
  settings.
- Added user ownership to RAG vectors and filtered retrieval by identity.
- Disabled shared Radio, manual schedules, and automatic scheduled broadcasts in
  cloud production.
- Verified production profile and context isolation with two accounts.

### Day 04: Usage Quotas and Cost Controls

- Added per-user model usage events with provider, model, token totals, and
  configurable estimated cost.
- Added default daily allowances of 10 Free replies and 200 Pro replies.
- Enforced quotas in HTTP and WebSocket chat paths.
- Kept local music-only routing outside the AI allowance.
- Added `/api/usage` and a Settings allowance card.
- Verified that exhausted users receive `429` without affecting another user.
- Increased the PWA shell cache version after frontend changes.

### Day 05: Abuse Protection

- Added fixed-window registration IP limits.
- Added login limits by IP and normalized email.
- Added chat limits by IP and authenticated account for HTTP and WebSocket.
- Added standard rate-limit response headers and client-visible retry timing.
- Verified all protected paths in a low-threshold production simulation.
- Recorded a high-severity vulnerability risk in the music dependency chain.

### Day 06: Dependency Security and Billing Foundation

- Removed all audit findings by overriding the vulnerable transitive music
  parser while retaining `NeteaseCloudMusicApi` 4.32.0.
- Added HMAC-SHA256 billing webhook signature verification.
- Added idempotent billing event storage.
- Added controlled Free-to-Pro and Pro-to-Free plan transitions.
- Added `/api/billing/status`; checkout remains explicitly unavailable.
- Verified billing transitions in an isolated production simulation.

### Day 07: Public Launch Integration Foundation

- Added hashed, expiring, one-time email verification tokens.
- Added verification link handling and optional chat/WebSocket enforcement.
- Added production CSP, HSTS, framing, referrer, MIME, and permissions headers.
- Added `/api/launch-readiness` and `npm run check:launch`.
- Updated production Compose with launch-era configuration variables.
- Upgraded `ws` to 8.21.0 after a new high-severity advisory.
- Verified the unverified-to-verified production flow and browser regression.

### SMTP Verification Email Integration

- Added provider-neutral SMTP delivery using Nodemailer.
- Added verification email text and HTML templates.
- Added SMTP connection verification to `check:launch`.
- Kept registration successful when email delivery temporarily fails.
- Added SMTP variables to local and production deployment templates.

### Mainland China Payments

- Added server-fixed CNY 29 payment orders for 30 days of Pro.
- Added automatic plan expiry and renewal extension.
- Added WeChat Pay Native and Alipay precreate QR adapters.
- Added signed callback fulfillment, QR checkout, and order polling in Settings.
- Updated launch readiness to accept either complete mainland payment channel.

### Project Memory and Error Tracking

- Added `memory.md` as the durable engineering summary.
- Added `docs/plan-error-log.md` as the append-only error and risk ledger.
- Added `docs/plan-template.md` as the required structure for future plans.
- Established the rule that resolved errors remain documented with root cause
  and verification evidence.

## Current Architecture

- Runtime: Node.js 20+, Express, WebSocket
- Frontend: vanilla JavaScript PWA
- Storage: SQLite through `node:sqlite`
- AI: OpenAI-compatible adapter configured for DeepSeek
- Authentication: account session cookie, optional administrator bearer token
- Production deployment: Docker / Docker Compose template

## Current Launch Blockers

1. **External launch services**
   SMTP and checkout support exist, but sender credentials, merchant
   credentials, public callbacks, and error monitoring are not connected.
2. **Email enforcement**
   Verification core exists, but production enforcement remains disabled until
   email delivery is connected.
3. **Production infrastructure**
   No cloud provider, production domain, HTTPS certificate, or monitoring
   service has been connected.
4. **Historical encoding corruption**
   Several older source strings and documents contain mojibake and require a
   controlled UTF-8 cleanup.

## Decisions

- Production users cannot switch AI provider or model.
- DeepSeek API keys remain server-side.
- SQLite is acceptable for the first single-instance launch, but not for a
  multi-instance deployment.
- Music launch scope is recommendation plus external links to reduce copyright
  risk.
- Shared Radio and scheduled broadcasts are disabled in cloud production until
  they are redesigned as explicitly public or user-owned features.
- `API_TOKEN` is only an optional administrator credential. User authentication
  uses account sessions.
- Rate limits are process-local for the single-instance launch and must move to
  Redis before horizontal scaling.
- `TRUST_PROXY=true` is allowed only behind a reverse proxy that overwrites
  `X-Forwarded-For`.
- Billing webhooks are disabled by default and require signatures over the raw
  request body.
- Billing events are idempotent and plan changes accept only `free` or `pro`.
- Keep the music parser override until upstream removes its vulnerable
  transitive dependency.
- Existing accounts migrate as verified; new accounts start unverified.
- Production must not enable verification enforcement before email delivery is
  connected.
- Public launch must pass `npm run check:launch`.
- Verification email delivery uses standard SMTP to avoid provider lock-in.
- Mainland checkout uses direct WeChat Pay Native and Alipay precreate QR
  payments rather than foreign card processors.
- `pro_30d` is fixed on the server at CNY 29.00; clients cannot submit price.
- One-time payment grants 30 days of Pro and renewal extends unexpired time.
- Only a verified provider callback may fulfill a payment order.

## Verification Baseline

- Automated tests: 83 passing tests across 20 suites.
- Production registration, login, session persistence, and logout were verified
  in a real browser.
- Production unauthenticated access is blocked.
- Production settings are read-only.
- Local development remains available at `http://localhost:8080`.
- Latest local UI renders and connects without browser console errors.
- Docker Compose configuration parses successfully.
- Docker image build has not been verified because Docker Desktop was not
  running on the development machine.
- Browser Settings displays the current plan and daily AI allowance without
  console errors.
- A production simulation verified independent Free-user quotas and `429`
  enforcement after exhaustion.
- A production simulation verified registration, login, HTTP chat, and
  WebSocket chat rate limits with retry timing.
- `npm audit --audit-level=high --omit=dev` reports zero vulnerabilities.
- Production billing simulation verified invalid-signature rejection, upgrade,
  duplicate event idempotency, Pro quota activation, and cancellation.
- Production email simulation verified HTTP `403` and WebSocket `4003` before
  verification, followed by successful access after verification.
- Production security headers were verified, including CSP and HSTS.
- Compose configuration parses with the complete launch environment surface.
- Docker image build remains blocked because the Docker Desktop engine is not
  running.
- WeChat Pay API v3 and Alipay RSA2 adapters pass local cryptographic and
  request-shape tests.
- Settings renders the Pro product and disables purchase when no merchant
  channel is configured.
- The new Pro card was observed in the browser, but interactive Settings
  verification was blocked by the browser's localhost policy for this session.

## Maintenance Protocol

After every plan:

1. Start from `docs/plan-template.md`.
2. Update `docs/plan-error-log.md` with every error, failure, unexpected result,
   and newly discovered risk.
3. Record the root cause, evidence, impact, and current status.
4. When an issue is eliminated, update the existing entry instead of deleting it.
5. Add a short plan summary and any durable decisions to this file.
6. Update the verification baseline when tests or deployment status change.

## Next Plan

Select and connect external launch providers.

Required order:

1. Supply SMTP credentials and verify the sending domain.
2. Select payment checkout provider based on settlement country.
3. Select monitoring and cloud hosting providers.
4. Add credentials through the cloud secret manager and pass `check:launch`.
