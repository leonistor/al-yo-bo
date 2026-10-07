---
description: Release a new version of al-yo-bo — verify, bump, changelog, tag, and push on approval.
---

Release a new version of al-yo-bo:

- verify git status, including untracked files
- verify with lint, typecheck, tests and build (`bun run lint`, `bun run typecheck`, `bun test`,
  `bun run build`)
- check the current version in `package.json`
- ask for the new version number, suggest a minor version bump
- update `CHANGELOG.md`: promote the `## Unreleased` section to `## vX.Y.Z — YYYY-MM-DD` with a
  one-line italic tagline, drafting user-facing bullets with the `changelog-generator` skill from
  the commits since the last tag — then ask for confirmation on the changelog
- tag the release in git (`vX.Y.Z`)
- commit the changes
- push, including the tag, **only with explicit user approval**
