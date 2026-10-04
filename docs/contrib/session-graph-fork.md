---
description: Architecture and review conventions for the session graph layer in this Cherry Studio fork
sources:
  - src/main/data/services/TopicService.ts
  - src/main/data/services/MessageService.ts
  - src/main/data/db/schemas
  - src/renderer/components/sessionGraph/SessionCategoriesPopup.tsx
  - src/renderer/components/sessionGraph/SessionCategoryTopicsPopup.tsx
---

# Session graph development in this fork

This fork adds an opt-in organization layer to ordinary Cherry Studio topic chats. A topic remains the unit of model context and message storage. Agent sessions are outside this feature. The graph layer records logical turns, topic relationships, ownership, references, and exploration tasks; it does not change model behavior. GitHub milestones, task issues and decision issues are the only active planning records. Historical development progress is archived locally outside the repository; former workspace planning files are retired.

## Repository and review workflow

- `origin` is `ziyumieming/cherry-studio`; `upstream` is `CherryHQ/cherry-studio`. Feature PRs target this fork's `main`. The owner reviews and merges them.
- Start each feature branch from the latest reviewed fork `main`. Keep one coherent, testable behavior per PR, explain its data and UI effects, and use the repository PR template. Sign off commits and retain verified commit signatures.
- Update from upstream through a separate PR after comparing dependencies, migrations, topic/message contracts, and touched files. Do not rewrite published migrations or mix upstream synchronization with a feature PR.
- Keep feature code in existing main, shared, and renderer directories. Prefer additive schemas and service APIs over changes to existing message or topic storage. The first PR that adds a user-visible action must also enforce its data invariants.
- Verify each PR at the scope of its change. Database PRs need real migrated SQLite tests, persistence after restart, and backup/restore coverage. UI PRs need focused interaction checks. Record any limits in the PR.

## Implementation boundaries

Keep storage invariants and their user entry points in reviewable task slices. A user-visible operation must enforce its invariants in the service transaction as well as in the UI. Split work into sub-issues when each part can be independently implemented and reviewed; resolve unanswered decisions before implementing their dependent behavior.

Existing topic-internal message branches are not independent sessions. A graph-aware fork creates a new topic, records the source and physical-to-logical message mapping, and treats common ancestors as one logical history across every descendant topic. References do not implicitly copy history or supply model context. Reuse existing tabs, settings, message location and whole-database backup boundaries.

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

### Managing categories

Open **Session categories** from a conversation's existing menu. Search matches complete category paths, so identically named categories under different parents remain distinguishable. Select multiple categories and choose **Save** to replace this conversation's assignments; searching does not discard hidden selections. Cancel leaves those assignments unchanged.

The same dialog creates, renames, moves and deletes categories. These changes save immediately and affect all conversations using those categories; the dialog explains this separately from assignment saving. The parent selector excludes the category itself and its descendants. Deletion requires confirmation and reports the service's dependency error when children or conversation assignments remain. Removing an assignment in the dialog does not permit deletion until that assignment has been saved.

The dialog revalidates category paths and assignments on committed DataApi notifications. Local selections survive refresh, with deleted category IDs removed. Reads that fail or have not loaded disable editing and saving; mutation failures preserve the draft for retry. Switching to another topic does not reuse the previous topic's fetched assignments.

No new tables or backup paths are needed for this UI. General-purpose tags are unchanged.

### Finding conversations by category

Open **Browse conversations by category** from a conversation's existing menu. Search full category paths on the left and choose a category. The conversation list initially includes direct assignments only; **Include subcategories** expands it to the entire subtree. Search conversation titles within that scope and use **Load more** for subsequent pages. Multi-category conversations appear once, and archived conversations are excluded. Existing conversation ordering is preserved, including pins within the selected scope.

The browser uses additive `sessionGraphCategoryId` and `includeCategoryDescendants` filters on the cursor-paginated `GET /topics` API. The latter requires a category ID. Category IDs are validated, missing categories return an error, and the category filter intersects existing title, ID and trash filters. An SQL membership subquery avoids collecting a bounded list of candidate IDs or multiplying rows by their category bindings. The existing category-ID collection endpoint remains unchanged.

Switching categories resets the conversation search, subtree toggle and pagination, and never shows results from the previous category while loading. Read failures expose a retry action. Committed topic, membership and category changes refresh the list; removing the selected category clears the selection. Before opening a conversation, the browser rechecks its active membership and reads its current title. Failed selection leaves the dialog open; cancellation or switching categories prevents late requests from opening an old target.

Selection opens the existing conversation in a new tab through the shared conversation navigation boundary; detached windows use its existing new-window fallback. No context, assignment or semantic relation is changed. The picker returns both the selected category ID and current topic to its callback for reuse by an exploration-task dialog. Exploration tasks and source/target relations are tracked in [E](https://github.com/ziyumieming/cherry-studio/issues/33) and [F](https://github.com/ziyumieming/cherry-studio/issues/36).

### Categories when forking

Duplicating a completed conversation path inherits all category IDs currently assigned to the source topic. This includes forks from an earlier turn: assignments belong to the whole topic, not the copied message position. No categories or child categories are created automatically. An unclassified source remains unclassified.

The inherited assignments are independent memberships. Open **Session categories** in either topic to select or create finer categories explicitly; changing one topic's assignments does not change the other. A subsequent fork inherits its immediate source's current assignments. Category IDs and their shared hierarchy remain stable, so renaming or moving a category still updates its path everywhere it is assigned.

Membership copying runs through the category-owning service inside the existing topic duplication transaction. A failed insert rolls back the new topic, copied history, logical identities and shared-history locks together. Category assignment and candidate-topic refresh effects are published only after commit. This needs no migration, new endpoint or backup path; existing empty-path and pending-generation guards continue to apply.

## Confirmed organization model

Session category labels have stable identities, a single parent category, and many-to-many topic membership. Their hierarchy is independent of fork history. Forks inherit source category assignments as described above; finer categories are selected or created explicitly. Category-based conversation selection is available as described above; related development and acceptance are tracked in GitHub.

Primary semantic ownership connects whole topics, not a selected source turn. It chooses one parent for the navigable forest and rejects ownership cycles; references are equal-status graph edges that can originate at multiple turns and may contain cycles. Reassigning primary ownership preserves all references and historical fork provenance.

An exploration task stores the selected answer excerpt, category, concrete target topic, and optional question. Users explicitly select one or several tasks when sending, append their questions to the current draft, and connect each source to the persisted target question atomically. Reference metadata is not automatically sent to the model. Full source-message snapshots are captured only before a referenced ordinary message changes or is removed; the required selected excerpt is stored at task creation. All metadata and snapshots use the existing SQLite database. Permanent deletion of referenced topics will be guarded in the same service slice that introduces references and task dependencies.

Question summaries will use a separately selectable model and preserve manually edited titles. Navigation will reuse existing topic tabs and message location machinery. The global graph remains a later interactive prototype for owner feedback, after daily navigation and ownership work.

## Review and requirement tracking

GitHub is the only active progress source. Use these three levels:

- **Milestones** represent functional acceptance loops, not release versions. Close them after implementation, relevant E2E, owner UAT and required feedback fixes are complete. Do not add unagreed deadlines.
- **Development tasks** use the `task` label and the **Development Task** form. Keep slice codes such as E1 and F2. Use native parent/sub-issue relationships; assign parents and children to the same milestone. Each reviewable implementation slice, E2E check and owner UAT has its own task.
- **Decisions** use the `decision` label. Preserve the original question and comments, append links to the tasks that carry a confirmed answer, then close the decision. Closing it records agreement, not implementation. Unanswered follow-ups remain open.

Before implementing a task, read its dependencies, related decisions and latest comments. Use `Refs #number` for partial implementation and closing keywords only when a PR fully completes a leaf task. Close a parent after all children and its own completion conditions are satisfied. Keep E2E reports and owner acceptance comments in the corresponding tasks; CI success does not substitute for desktop UAT. Feedback defects become sub-tasks in the same milestone.

| Functional loop | Acceptance entry |
| --- | --- |
| [M1: Fork and category organization](https://github.com/ziyumieming/cherry-studio/milestone/2) | [V: E2E preparation, cases and owner UAT](https://github.com/ziyumieming/cherry-studio/issues/29) |
| [M2: Exploration and references](https://github.com/ziyumieming/cherry-studio/milestone/3) | [V4: E2E and owner UAT](https://github.com/ziyumieming/cherry-studio/issues/40) |
| [M3: Review and semantic ownership](https://github.com/ziyumieming/cherry-studio/milestone/4) | [V5: E2E and owner UAT](https://github.com/ziyumieming/cherry-studio/issues/49) |
| [M4: Global graph prototype](https://github.com/ziyumieming/cherry-studio/milestone/5) | [H: Demo, feedback, iteration and E2E](https://github.com/ziyumieming/cherry-studio/issues/52) |
| [M5: Everyday Windows use](https://github.com/ziyumieming/cherry-studio/milestone/6) | [I: Packaging, clean environment, E2E and owner UAT](https://github.com/ziyumieming/cherry-studio/issues/57) |
| [MX: Optional remote verification](https://github.com/ziyumieming/cherry-studio/milestone/7) | [X1: Actual gh/Codespaces connection and clean installation](https://github.com/ziyumieming/cherry-studio/issues/62) |

Complete M1 acceptance before starting [E1](https://github.com/ziyumieming/cherry-studio/issues/34). MX supplies optional compute and does not block product milestones. The former A2 umbrella is distributed across concrete task, reference/version and ownership work instead of becoming a duplicate issue.

Local `ROADMAP.md`, `REVIEW_QUEUE.md` and `USER_NOTES.md` no longer receive progress updates. The old CI/E2E memo and fixed development history remain local historical records outside Git. [fork-ci.md](./fork-ci.md) retains current configuration guidance. Keep architecture and operating conventions in the repository, and use GitHub tasks for active progress and acceptance evidence.

Category decisions are preserved in [#12](https://github.com/ziyumieming/cherry-studio/issues/12) (fork inheritance and explicit refinement), [#13](https://github.com/ziyumieming/cherry-studio/issues/13) (independent storage), and [#14](https://github.com/ziyumieming/cherry-studio/issues/14) (multiple categories). New questions can be filed asynchronously without interrupting independent work. The unanswered follow-up in [#24](https://github.com/ziyumieming/cherry-studio/issues/24) remains open; existing shared-question regeneration restrictions remain in effect.

Use the configured `github-bot` MCP service as `virginialogy[bot]` for commits, PRs and issue comments. Repository documentation and commit messages remain English; owner-facing PR descriptions and discussions use Chinese. Assign review PRs to `ziyumieming`. When the desktop tool form is unavailable, the owner authorizes calling that same configured MCP service from a script to publish the prepared request. Issue assignment alone does not configure background comment polling or wake this local development chat.

For this migration only, the owner authorized milestone management through the official GitHub API using the same App's installation token because the configured MCP lacks milestone tools. This does not authorize other direct-API writes or personal-account publishing. No scheduled monitoring is configured.
