---
description: Development and review plan for the session graph layer in this Cherry Studio fork
sources:
  - src/main/data/services/TopicService.ts
  - src/main/data/services/MessageService.ts
  - src/main/data/db/schemas
---

# Session graph development in this fork

This fork adds an opt-in organization layer to ordinary Cherry Studio topic chats. A topic remains the unit of model context and message storage. Agent sessions are outside this feature. The graph layer records logical turns, topic relationships, ownership, references, and exploration tasks; it does not change model behavior. Product decisions and open interaction questions are tracked in the workspace's `ROADMAP.md`, `REVIEW_QUEUE.md`, and `USER_NOTES.md` outside this repository.

## Repository and review workflow

- `origin` is `ziyumieming/cherry-studio`; `upstream` is `CherryHQ/cherry-studio`. Feature PRs target this fork's `main`. The owner reviews and merges them.
- Start each feature branch from the latest reviewed fork `main`. Keep one coherent, testable behavior per PR, explain its data and UI effects, and use the repository PR template. Sign off commits and retain verified commit signatures.
- Update from upstream through a separate PR after comparing dependencies, migrations, topic/message contracts, and touched files. Do not rewrite published migrations or mix upstream synchronization with a feature PR.
- Keep feature code in existing main, shared, and renderer directories. Prefer additive schemas and service APIs over changes to existing message or topic storage. The first PR that adds a user-visible action must also enforce its data invariants.
- Verify each PR at the scope of its change. Database PRs need real migrated SQLite tests, persistence after restart, and backup/restore coverage. UI PRs need focused interaction checks. Record any limits in the PR.

## Delivery slices

| Slice | Reviewable result | Dependency / guard |
| --- | --- | --- |
| 0. Fork setup | This plan, separate profile and baseline evidence | No product behavior |
| 1. Data foundation | Additive schema and service for logical IDs and links; persistence plus whole-database backup/restore check | No user entry point yet |
| 2. Fork identity | Copy a topic path while preserving ancestor logical IDs and assigning new IDs after the fork; persist mapping atomically | Internal operation until write guards are complete |
| 3. Shared-ancestor protection | Block edit, regenerate, delete, and clear paths that would change shared history; explain lock in UI | Enable graph-aware fork only with complete protection |
| 4. Exploration task | Select an assistant reply excerpt, choose label and concrete target topic, save an editable pending task | Depends on confirmed interaction details |
| 5. Link on send | Fill a draft from a pending task and turn it into a typed relation only after successful send | Atomic task consumption and link creation |
| 6. Daily navigation | Question summaries, topic outline, tabs, back navigation, and reading position | Uses existing topic tabs and search |
| 7. Organization | Move primary ownership while preserving other references | Enforce an acyclic primary forest |
| 8. Graph overview | Visualize the forest and additional references | After everyday navigation works |

Slices may be subdivided when a PR would otherwise become hard to review. Unconfirmed interaction choices stay in the workspace review queue; they are resolved before their dependent slice. Existing topic-internal message branches are not independent sessions. A graph-aware fork creates a new topic, records the source and physical-to-logical message mapping, and treats common ancestors as one logical history across every descendant topic.

## Shared history protection

Topic duplication records durable locks for every copied message and its source in `session_graph_ancestor_lock`, in the same transaction as the new topic and logical identity mapping. This includes system and legacy assistant-only records, even when they have no logical turn. The virtual roots remain topic-local. Migration `0028` backfills locks from previously recorded logical copies and their ancestors; untracked legacy copies cannot be reconstructed from that metadata.

Message services reject edits, edited siblings, regenerated answers, retries, content finalization, tool approval changes, deletion, and clear-history operations that affect locked messages. Reply-group deletion also checks unselected members, and reparenting checks the children it would move. New user questions below a shared answer remain independent. Uncopied replies can be edited or individually deleted, but generating additional answers to a locked question is blocked: the existing generation request identifies the question, not the source reply. Per-topic derived usage statistics and compaction summaries can still be updated.

A path containing a pending message cannot be duplicated: a live stream could otherwise change its source after the copy becomes immutable. Deleting an entire topic follows the existing topic lifecycle and removes only that topic's physical rows; locks on surviving copies remain. The lock table is included in the existing whole-database backup and restore. The renderer reads `GET /topics/:topicId/history-protection` to distinguish immutable content from operation-specific restrictions. The read model covers the entire topic, including reply-group members outside the loaded conversation page. Shared messages carry a read-only badge. Editing, regeneration, model-picker regeneration, translation writes, and unsafe deletions are disabled with translated explanations; protection still loading or unavailable does not permit mutations. Copying, branch navigation, new questions, and further completed-history forks remain available. Clear-history actions check the current protection state before their delete request. A fork publishes protection changes for both source and copied topics, including other open windows. Services remain the final transactional guard if a fork races with a UI operation.

Normal regeneration creates additional assistant rows under the existing question, preserving the original answer and its follow-up path. Each new answer can develop its own path within the same topic; it is not a new topic session. Failed-answer retry can instead reset the original row. Shared questions currently prohibit both operations; allowing additional answers later requires an explicit source-answer contract and precise logical answer references.


## Session categories

Session categories use two additive tables, `session_graph_category` and `session_graph_topic_category`, in the existing SQLite database. Cherry's general-purpose tags retain globally unique names and are shared by assistants and other resources; changing that contract would affect unrelated features. The owner chose independent session categories so different category paths can reuse a name without changing existing tag APIs or bindings. Category validation reuses the existing name and color schemas.

Category IDs remain stable through renames and moves. Each category has at most one parent; the service checks its ancestor path inside the write transaction and rejects self-parenting or moves below descendants. Foreign keys reject missing parents, a database check rejects direct self-parenting, and unique indexes reject duplicate names among siblings (including root categories). Names are trimmed at the API boundary; uniqueness is case-sensitive. Returned paths contain `{ id, name }` items instead of parsing display strings. Topic membership is many-to-many and refers to IDs, never names or fork positions.

| Endpoint | Contract |
| --- | --- |
| `GET /session-graph/categories` | Flat category collection, each with its current complete path |
| `POST /session-graph/categories` | Create a category; omitted parent means root |
| `PATCH /session-graph/categories/:id` | Rename, recolor or move; explicit `parentId: null` moves to root |
| `DELETE /session-graph/categories/:id` | Delete only after child categories and topic bindings have been removed |
| `GET /session-graph/categories/:id/topics` | Active topic IDs belonging directly to this category; `includeDescendants=true` includes its subtree and deduplicates topics |
| `GET /topics/:topicId/session-graph-categories` | Assigned categories with complete paths |
| `PUT /topics/:topicId/session-graph-categories` | Atomically replace up to 100 category assignments; unknown IDs or failed writes preserve all previous assignments |

Soft-deleted topics do not appear in candidate queries and cannot have their categories changed until restored. Their bindings survive trash/restore; physical topic removal cascades only its bindings. Category deletion does not implicitly remove child categories or assignments, including assignments retained for trashed topics. Restore or permanently remove a trashed topic before cleaning up its remaining assignments.

Successful category writes publish read-model refresh effects after commit. Category UI consumers should subscribe to these effects and existing topic membership notifications for trash/restore/permanent deletion, and refetch when mounted. The new tables travel with the existing whole-database backup; snapshot restoration is tested through production migration and service reads. Full backup UI acceptance remains a later desktop check.

This slice exposes storage and DataApi only. It does not introduce a category page, translate generic tags into categories, inherit assignments during fork, or settle the pending automatic-child-category interaction. Category selection and management ship in the next UI slice.

## Confirmed organization model

Session category labels have stable identities, a single parent category, and many-to-many topic membership. Their hierarchy is independent of fork history: a multi-label topic does not implicitly clone all its categories when it forks. Category management and selection will ship separately before exploration tasks.

Primary semantic ownership connects whole topics, not a selected source turn. It chooses one parent for the navigable forest and rejects ownership cycles; references are equal-status graph edges that can originate at multiple turns and may contain cycles. Reassigning primary ownership preserves all references and historical fork provenance.

An exploration task stores the selected answer excerpt, category, concrete target topic, and optional question. Users explicitly select one or several tasks when sending, append their questions to the current draft, and connect each source to the persisted target question atomically. Reference metadata is not automatically sent to the model. Full source-message snapshots are captured only before a referenced ordinary message changes or is removed; the required selected excerpt is stored at task creation. All metadata and snapshots use the existing SQLite database. Permanent deletion of referenced topics will be guarded in the same service slice that introduces references and task dependencies.

Question summaries will use a separately selectable model and preserve manually edited titles. Navigation will reuse existing topic tabs and message location machinery. The global graph remains a later interactive prototype for owner feedback, after daily navigation and ownership work.
