# Claudio Day 01: Cloud Launch Foundation

## Launch goal

The first paid Claudio release is a browser-based companion radio. Users visit a
hosted HTTPS URL and never install Node.js or provide a DeepSeek API key.

Day 01 delivers a protected cloud preview, not the public paid launch. User
accounts, per-user data isolation, quotas, and billing remain launch blockers.

## MVP boundary

### Free

- 10 AI replies per day
- Claudio radio interface and live subtitles
- Short conversation history
- Music recommendations through external links

### Pro

- 200 AI replies per day
- Long-term memory and preference recall
- Longer conversation history
- Additional radio moods and personalities

Initial pricing hypothesis: CNY 29/month. Validate it with invited users before
finalizing the public price.

## Day 01 production rules

- DeepSeek credentials exist only in the cloud secret manager.
- Production uses the DeepSeek-compatible endpoint through the OpenAI adapter.
- Runtime provider/model changes are disabled.
- Ollama fallback, RAG, and RSS are disabled for the first cloud preview.
- `/api/health` is public and minimal for platform health checks.
- Detailed health and all functional APIs require an account session or optional
  administrator `API_TOKEN`.

## Deploy the protected preview

1. Configure `.env.production.example` values in the hosting provider's secret
   manager or a private `.env.production` file.
2. Set strong values for `OPENAI_API_KEY` and `API_TOKEN`.
3. Start the production container:

   ```bash
   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
   ```

4. Verify:

   ```bash
   curl https://YOUR_DOMAIN/api/health
   curl -H "Authorization: Bearer YOUR_API_TOKEN" \
     https://YOUR_DOMAIN/api/health/details
   ```

5. Open the protected preview once using:

   ```text
   https://YOUR_DOMAIN/?token=YOUR_API_TOKEN
   ```

   The browser stores the temporary preview token and removes it from the URL.

## Remaining launch blockers

1. Day 02: user accounts and secure sessions. **Completed 2026-06-13.**
2. Day 03: per-user history, preferences, and configuration persistence.
3. Day 04: quotas, DeepSeek cost accounting, and billing.
4. Day 05-06: onboarding, policies, monitoring, abuse controls, and regression.

## Error tracking

Execution errors, root causes, and resolution status are maintained in
`docs/plan-error-log.md`. Durable project decisions are maintained in
`memory.md`.
