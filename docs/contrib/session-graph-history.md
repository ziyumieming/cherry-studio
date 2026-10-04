---
description: Fixed migration snapshot of implemented session graph capabilities and their pull requests
sources:
  - src/main/data/services/SessionGraphIdentityService.ts
  - src/main/data/services/SessionGraphProtectionService.ts
  - src/main/data/services/SessionGraphCategoryService.ts
  - src/renderer/components/sessionGraph/SessionCategoriesPopup.tsx
  - src/renderer/components/sessionGraph/SessionCategoryTopicsPopup.tsx
  - .github/workflows/ci.yml
---

# Session graph implementation history

This is a fixed archive taken on **2026-10-04** when the workspace plan was
migrated to GitHub. It records merged implementation, not desktop acceptance.
All eleven pre-migration PRs were checked against GitHub's merge metadata at
fork main `12429ca19fd55d4589fd8500fbbbae464f1b1170`.

Future work and completion live in the repository's
[milestones](https://github.com/ziyumieming/cherry-studio/milestones),
[task issues](https://github.com/ziyumieming/cherry-studio/issues?q=is%3Aissue%20label%3Atask),
and [decision issues](https://github.com/ziyumieming/cherry-studio/issues?q=is%3Aissue%20label%3Adecision).
This archive is not a second backlog and will not receive routine progress updates.
The [engineering guide](./session-graph-fork.md) retains architecture and review conventions.

## Implemented capabilities

| Slice | Implemented result | Merged PRs |
| --- | --- | --- |
| Setup | Documented the fork's development boundary, isolated profile and incremental review workflow. No application behavior was added. | [#1](https://github.com/ziyumieming/cherry-studio/pull/1) |
| A1: logical identities | Added logical turns, logical answer identities and physical-copy mappings in the existing SQLite database. Multiple answers can have distinct identities under one question. | [#2](https://github.com/ziyumieming/cherry-studio/pull/2) |
| B: fork identity mapping | Integrated path-copy mapping in the duplication transaction. Multi-level forks reuse shared ancestor identities; later questions remain independent. | [#3](https://github.com/ziyumieming/cherry-studio/pull/3), [#4](https://github.com/ziyumieming/cherry-studio/pull/4) |
| C1: service history protection | Added persistent ancestor locks and migration backfill. Services reject content/structure changes to shared history; independent later questions remain possible. | [#5](https://github.com/ziyumieming/cherry-studio/pull/5) |
| C2: history protection UI | Added read-only badges, translated explanations, action guards, clear-history checks and cross-window refresh. Services remain the final guard. | [#6](https://github.com/ziyumieming/cherry-studio/pull/6) |
| CI preparation | Fixed fork CI permissions and made Feishu notifications opt-in. The same PR repaired compatibility after upstream adopted validation planning and corrected a stale refresh assertion. | [#7](https://github.com/ziyumieming/cherry-studio/pull/7) |
| D1: category storage | Added an independent category tree and many-to-many topic assignments, stable IDs, full paths, CRUD/query APIs, cycle validation and backup/restore integration. General tags were not changed. | [#8](https://github.com/ziyumieming/cherry-studio/pull/8) |
| D2a: category management | Added a conversation-menu dialog for category creation, rename, move, confirmed deletion, path search and multiple assignment. Category CRUD and topic assignment have explicit save boundaries. | [#26](https://github.com/ziyumieming/cherry-studio/pull/26) |
| D2b: fork category inheritance | Forks inherit the immediate source topic's current categories atomically. Memberships can be refined independently; no child categories are generated. | [#27](https://github.com/ziyumieming/cherry-studio/pull/27) |
| D2c: category conversation browser | Added direct/subtree category filtering, title search, cursor pagination, refresh and revalidated topic opening through existing tab/window navigation. The picker is reusable for exploration targets. | [#28](https://github.com/ziyumieming/cherry-studio/pull/28) |

PR #3 was stacked into `feat/session-graph-identities`; PR #4 integrated the
same three-file fork-mapping slice into `main`. They represent one capability,
not two separate milestones. PR #4 was created manually without a description;
its actual file diff was checked rather than inferring scope from its title.
PR #28 merged before this snapshot and is therefore archived here.

## Verification at the archive boundary

The PRs contain their original regression evidence and limitations. Logical
identity, fork, lock, category, migration and backup behavior have SQLite
integration coverage. Renderer changes have focused UI/SWR/menu regressions.
Later PRs also passed affected-scope Actions checks, including types, lint,
documentation, translations and selected test projects/platform contracts.

The final D2c implementation passed 112 main and 24 renderer regressions locally
and [CI #20](https://github.com/ziyumieming/cherry-studio/actions/runs/37143667383).
This is not evidence that session graph desktop E2E or owner UAT passed: neither
was completed before migration. The first functional milestone retains that
acceptance work before exploration-task development starts.

Early base selection compared Cherry Studio v2.1.4 with Chatbox CE v1.23.5.
The user fork's `main` became the development baseline; stable-version trials
were selection evidence only. Electron startup, isolated profile use and a few
provider requests/model checks were verified. Clean installation, complete
desktop provider flows and production packaging were not thereby certified.
The earlier Copilot model-support errors require separate follow-up.

## Migration correspondence

The former A2 umbrella is represented by concrete exploration-task, reference,
version-protection and ownership tasks. It is not another unfinished foundation
slice. Duplicate phase checklists were consolidated into their feature or
acceptance tasks. Restart/restore checks, learning scenarios, personal-use
packaging and optional Codespaces verification remain in GitHub.

Confirmed decisions retain their full original comments and point to the
implementation or task that carries them. Closing a decision means its answer
is settled; it does not claim the feature is implemented. Decision
[#24](https://github.com/ziyumieming/cherry-studio/issues/24) still has an
unanswered owner follow-up at this boundary. Existing shared-question
regeneration restrictions remain in place pending further decisions.

The local roadmap is retired, and the old CI/E2E memo is a historical snapshot.
Ongoing test configuration guidance remains in [the fork CI runbook](./fork-ci.md).
