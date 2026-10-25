# Notes for Claude

- Every PR description needs a `## Dev log` section: one to three plain, non-technical sentences
  about what changed for players (no code, file names, usernames or stats). When the PR merges
  into main, .github/workflows/discord-merge-summary.yml posts that section to the Discord dev
  log. Without it, only the PR title is posted.
- Almost everything a band can do is a discovery. A new feature (a building, tool, job or recipe)
  gets a row in `src/sim/know.ts`, with what it needs first, the practice that leads to it and what
  hurries it, and the planner only uses it once the band knows it. Tune its timing with
  `npx tsx tools/discoveries.ts`.
