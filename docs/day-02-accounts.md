# Claudio Day 02: Accounts and Sessions

## Delivered

- Email/password registration and login.
- Passwords stored with salted `scrypt` hashes.
- Opaque server-side sessions stored in SQLite.
- `HttpOnly`, `SameSite=Lax`, and production `Secure` session cookies.
- Logout invalidates the server-side session.
- Production functional APIs require a valid account session.
- Optional `API_TOKEN` remains available for administrator automation.
- WebSocket connections authenticate with the same session cookie.
- User-triggered chat events are sent only to that user's WebSocket clients.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/me` | Read current account state |
| `POST` | `/api/auth/register` | Create account and session |
| `POST` | `/api/auth/login` | Create session |
| `POST` | `/api/auth/logout` | Delete session and clear cookie |

Registration and login accept:

```json
{ "email": "person@example.com", "password": "at-least-8-characters" }
```

## Current boundary

Account identity is now established, but existing conversation history,
preferences, memory, and playback state still use the original shared storage.
Day 03 must add `user_id` ownership to those records before inviting unrelated
users into the same production deployment.

## Day 03 migration order

1. Add `user_id` to history and per-user settings.
2. Pass authenticated user identity into state/history operations.
3. Isolate clear-history, messages, memory, taste, and playback state.
4. Add two-user isolation regression tests.

## Error tracking

Day 02 execution errors and remaining risks are recorded in
`docs/plan-error-log.md`. The durable project summary is maintained in
`memory.md`.
