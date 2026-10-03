# Dev review and improvement plan

Reviewed the dev branch at `7904e20` on 2026-10-03, covering command wiring,
service API calls and replies, caching, metrics, tests, and CI configuration.
This is a focused source review, not a live Discord/AniList validation.

## Implemented: command registration and bot lifecycle

- Build one command registry in `app.js` and use it for registration and dispatch.
  Previously the two lists had to be updated separately for every new command.
- Register commands on `guildCreate`, so newly joined guilds do not need a bot restart.
  Log registration failures without rejecting the asynchronous event handler.
- Use the constructor's token argument; previously it always used the environment token.
- Await Discord client destruction during shutdown, including before the client is ready.

Regression tests cover shared-registry registration/dispatch, newly joined guilds,
registration failures, explicit tokens, and shutdown ordering. The full Jest suite
passes: 11 suites, 204 tests; coverage is 97.65% lines and 83.02% branches.

## Follow-up work, in priority order

1. **Correct command outcome metrics.** Services catch fetch errors and send error
   replies, then resolve. The dispatcher records those resolved calls as successes.
   Define an explicit handler outcome and propagate it to the duration metric.
   Verify successful replies, handled API failures, invalid input, and failed replies.
2. **Improve recommendation candidate selection.** `animeRecommendation.js` fetches
   only five popular candidates and then filters out the user's existing entries.
   A user who has all five receives no recommendation even when later candidates
   exist. Exclude existing media IDs in the query or fetch additional bounded pages.
   Test overlap with the initial candidates and exhausted results.
3. **Deduplicate random selection IDs.** The random anime and manga services flatten
   all list entries without removing duplicates. Entries repeated in custom lists
   can receive extra selection weight. Deduplicate before caching while preserving
   the separate ID and detail queries; test overlapping custom lists and cache reuse.
4. **Validate CI syntax checks.** The lint job invokes ESLint without a declared
   dependency/configuration and suppresses errors with `|| true`. Add an explicit,
   blocking syntax check, then introduce a configured lint baseline separately.

Keep these follow-ups in separate PRs with regression tests for the stated behavior.
