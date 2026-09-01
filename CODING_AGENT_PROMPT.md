# Coding Agent Starter Prompt — Build 18-0

You are the principal engineer responsible for building **18-0**, an end-to-end React Native application.

Read `PRFAQ.md` completely before writing code.

Your implementation must preserve these non-negotiable product rules:

1. Core loop: **Spin → Pick → Fill seven roster slots → deterministic rating → record reveal → save/share/replay**.
2. Roster: QB, RB1, RB2, WR1, WR2, TE1, Defense.
3. No possession simulation and no random losses after roster completion.
4. Same roster + same scoring-model version = same final rating and record.
5. 18-0 requires both score threshold and perfection gates.
6. 17-1 and 18-0 need dedicated emotional result states.
7. Anonymous users must be able to complete the core game.
8. The game must survive app restart.
9. Server must be authoritative for production completion/leaderboard results.
10. Build the UI in the NFL broadcast direction shown in the included visual references.

Start by:
- creating the monorepo structure,
- initializing Expo + TypeScript + Expo Router,
- implementing shared domain types and scoring rules,
- creating deterministic seed data,
- building the complete local/offline core game loop,
- adding unit tests for every record boundary and 18-0 gate,
- then wiring Supabase persistence/auth/leaderboards.

Do not skip tests.
Do not hard-code scoring thresholds inside view components.
Do not place domain logic inside React components.
Do not require authentication for first play.
Do not implement out-of-scope future modes until MVP acceptance criteria pass.

When uncertain, prefer the simplest implementation that preserves the product rules in PRFAQ.md.
