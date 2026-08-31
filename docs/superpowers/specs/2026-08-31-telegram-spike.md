# Telegram notification spike (P2, deferred wiring)

**Status:** design spike only — not shipped in the Electron app yet.  
**Scope:** single-machine Munder; notify a human when Ask Me hard-gates open.

## Goal

Mirror Slack’s “needs you” signal for operators who live in Telegram: when
`agentsAwaitingHuman` becomes non-empty, post a short message with task titles
and a reminder to open Command Center → Ask Me.

## Shape (thin)

1. Config (future): `telegramEnabled`, `telegramBotToken`, `telegramChatId`.
2. On `applyHumanGateFromTasks`, if the waiting set grows, fire-and-forget
   `sendMessage` to Telegram Bot API (`https://api.telegram.org/bot…/sendMessage`).
3. Deduplicate by task id set hash so a 5s poll does not spam.
4. Never forward tool payloads or secrets — titles + assignee names only.

## Non-goals

- Two-way bot commands / answering Ask Me from Telegram
- Public tunnel exposure of the bot webhook
- Replacing Slack or desktop notifications

## Next step when picked up

Add `src/main/telegramNotify.ts` + config fields; unit-test the dedupe helper
without hitting the network.
