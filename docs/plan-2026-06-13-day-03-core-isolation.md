# Claudio Plan: Day 03 Core User Isolation

## Objective

Prevent authenticated users from reading, clearing, blocking, or receiving
another user's core conversation and playback state.

## Scope

- Included:
  - Message history ownership
  - LLM history context ownership
  - History clear and prune ownership
  - Current playback ownership
  - Per-user chat concurrency
  - User-triggered chat WebSocket isolation
- Excluded:
  - File-backed memory and taste
  - Shared RAG index
  - Global Radio and scheduled broadcast product decision

## Result

- Added `user_id` to history with safe migration of existing rows to `legacy`.
- Added `user_settings` for per-user playback state.
- Passed authenticated identity through state and history operations.
- Replaced global `chatBusy` with per-user active chat locks.
- Added state isolation regression tests.

## Errors and Unexpected Results

| Error ID | Result | Root cause | Status |
| --- | --- | --- | --- |
| `ERR-018` | Initial migration patch was rejected | Unstable patch context | Resolved |
| `ERR-019` | Broad edit touched unrelated calls | Ambiguous repeated syntax | Resolved |
| `ERR-020` | New browser tab failed to attach | In-app Browser tool state | Resolved |
| `ERR-003` | Memory/taste/RAG remain shared | Original file-backed single-user design | Mitigated |
| `ERR-005` | Radio/scheduled events remain global | Shared-radio architecture | Mitigated |

## Verification

- `53/53` automated tests pass.
- Two accounts submitted chat requests concurrently and both returned `200`.
- Each account saw only its own message and assistant reply.
- Clearing account A history did not alter account B history.
- Account B received no user-echo, thinking, or say event from account A.
- Latest local page rendered and connected without browser console errors.
- Day 03 test accounts and data were removed after verification.

## Durable Decisions

- Existing unowned history is assigned to the inaccessible `legacy` owner
  instead of being exposed to new accounts.
- The first cloud launch remains single-instance SQLite.
- Global Radio and scheduled events require an explicit product decision before
  they can be considered correctly scoped.
