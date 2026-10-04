---
description: CI permissions, optional notifications, and desktop regression prerequisites for this fork
sources:
  - .github/workflows/ci.yml
  - .github/workflows/e2e-regression-test.yml
  - scripts/e2e/regression/cases.ts
  - scripts/e2e/regression/config.ts
  - scripts/e2e/regression/ref.ts
  - scripts/e2e/regression/capabilities.ts
---

# CI and desktop regression in this fork

## Ordinary CI

Enable Actions in the fork's Actions tab if GitHub shows the first-run enable
prompt. In Settings > Actions > General, allow the actions used by the workflows,
including third-party actions and the actionlint container. No API keys, CherryIN
account, Feishu credentials, or personal access token are required for ordinary CI.

Keep the repository's default workflow token read-only. The `repository-checks`
job explicitly requests `contents: read` and `pull-requests: read`:
its `dorny/paths-filter` catalog guard uses the pull request files API on PR runs.
The `changes` job now plans validation from Git history and needs only the
workflow's `contents: read` permission, as do the other jobs. Do not enable write
tokens or secrets for untrusted fork PRs to run these checks.

Non-draft PRs, including stacked PRs targeting another branch, trigger CI.
Pushes to `main` and `release/v*`, scheduled runs, and manual `CI` runs also run
the existing checks. The workflow installs the pinned Node.js and pnpm
versions and project dependencies on GitHub-hosted runners. Local desktop API
settings are not transferred to those runners.

Preserve the upstream validation planner's job dependencies and conditions when
synchronizing this fork. In particular, `repository-checks` needs `changes` and
uses its `repository` output to decide whether to run. Retain the non-PR event
condition on `changes` so scheduled validation still executes.

Feishu notifications are optional; see [the notification switch](./feishu-notify.md#ci-failure-notifications).
The switch affects only the notification job, not CI failure detection or gates.

Publishing changes to `.github/workflows` through the GitHub App requires its
repository **Workflows: write** permission, in addition to the existing Contents
and Pull requests write permissions. Approve updated installation permissions
after changing the App. This publishing permission is separate from the
workflow's `GITHUB_TOKEN` permissions.

## E2E decision and scope

Use the existing Playwright regression framework for completed session graph UI
flows. The current manifest contains 21 cases across ten phases. In particular,
`N-01` creates a note and verifies it survives a restart, and `M-03` verifies
scrolling within a provider's model list. These are comparable in granularity to
our feature slices. They do not cover session graph behavior.

Add focused cases alongside the corresponding UI slices:

- Fork a completed topic, check the shared-history lock in both paths, reject
  edits to shared history, and verify new questions remain possible.
- Create and move categories, check topic membership and navigation, and verify
  persistence after restarting the same profile.
- Select an answer excerpt, create an exploration task, retarget or select it,
  send the question, and verify the task disappears and both ends can navigate.

Keep identity mapping, ownership cycles, migrations, and backup restoration in
unit/integration tests. The category storage-only slice does not need an E2E
case before a UI entry point exists. This CI repair adds no E2E cases and does not
claim desktop acceptance. Register future cases in `cases.ts`, update workflow
task choices for new tasks, and add a workflow step only for a new phase.
See the [scenario guide](../../tests/e2e/regression/README.md) and
[controller contract](../../scripts/e2e/regression/README.md).

Run ordinary CI on each PR and keep desktop E2E manually triggered at milestones:
shared-history protection and category UI, the exploration task/send/navigation
loop, personal-use releases, and substantial upstream synchronization. Select
the related cases instead of routinely running the full suite on feature PRs.

Functional milestones keep separate E2E and owner UAT tasks. Start with
[M1 acceptance](https://github.com/ziyumieming/cherry-studio/issues/29), then
[M2](https://github.com/ziyumieming/cherry-studio/issues/40),
[M3](https://github.com/ziyumieming/cherry-studio/issues/49),
[M4](https://github.com/ziyumieming/cherry-studio/issues/52) and
[M5](https://github.com/ziyumieming/cherry-studio/issues/57).
Keep reports in those tasks and require explicit owner acceptance before
closing each loop. CI results alone do not establish desktop UAT.

Graph organization does not itself require embeddings, an Anthropic service,
or a CherryIN account. Chat scenarios need an available chat API; knowledge
scenarios need embeddings; agent/code scenarios need their protocol and tool
support; CherryIN scenarios need a real CherryIN account. Removing unrelated
requirements from graph cases first needs the controller changes below.

## Current E2E setup

Run **E2E Regression Test** manually from `main`. Its `ref` input accepts only
`main`, `release/*` branches, and `v*` tags; ordinary feature and PR refs are
rejected. A tag run also needs the matching release and installable assets in
this fork. The current workflow does not run automatically on PRs.

Set the following repository Actions configuration under Settings > Secrets and
variables > Actions. All eleven entries are currently required by global
preflight, even when selecting `notes`, `startup-smoke`, or `provider-model-scroll`.

| Kind | Name | Required capability |
| --- | --- | --- |
| Variable | `CHERRY_TEST_CUSTOM_PROVIDER_BASE_URL` | Reachable OpenAI-compatible chat URL, including its API prefix |
| Variable | `CHERRY_TEST_CUSTOM_PROVIDER_ANTHROPIC_BASE_URL` | Reachable Anthropic-compatible URL for agent/code tool tests |
| Secret | `CHERRY_TEST_CUSTOM_PROVIDER_API_KEY` | Test key authorized for the configured chat and Anthropic endpoints |
| Variable | `CHERRY_TEST_CUSTOM_PROVIDER_CHAT_MODEL` | Available chat model ID |
| Variable | `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_BASE_URL` | Reachable OpenAI-compatible embedding URL |
| Secret | `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_API_KEY` | Test key authorized for embeddings |
| Variable | `CHERRY_TEST_CUSTOM_PROVIDER_EMBEDDING_MODEL` | Available embedding model ID |
| Variable | `CHERRY_TEST_CHERRYIN_CHAT_MODEL` | Available CherryIN chat model ID |
| Variable | `CHERRY_TEST_CHERRYIN_IMAGE_MODEL` | Available CherryIN image model ID |
| Secret | `CHERRY_TEST_CHERRYIN_ACCOUNT` | Dedicated CherryIN test account |
| Secret | `CHERRY_TEST_CHERRYIN_PASSWORD` | Its password |

Preflight checks presence and URL syntax, not live credentials, model access,
quotas, or rate limits. Free keys configured in the desktop app do not prove that
these endpoints or models are accessible from hosted runners. Use test accounts
with suitable quotas; concurrent Windows and macOS jobs can both make API calls.

The workflow provisions pinned Node.js/pnpm, project dependencies, Claude Code,
Codex, OpenClaw, application binary dependencies, the Electron SQLite rebuild,
and utility-process builds. It uses Playwright over Electron CDP; it does not
require a separately installed Playwright Chromium browser or user recordings.
Native file dialogs, shortcuts, and selection cases need desktop automation.
The controller probes Windows desktop input and macOS accessibility/screen
capture; missing required capabilities are reported as blocked, not passed.
Self-hosted runners would need interactive desktops and those OS permissions.

The current matrix always runs Windows and macOS. Its aggregate job already has
`actions: write` to remove this run's temporary artifacts after uploading the
combined `test-report`; no personal token or global read/write default is needed.
Reports are retained for 30 days. Test accounts and generated data should be safe
to appear in screenshots and evidence, particularly in a public repository.

## Follow-up before session graph E2E

[V1](https://github.com/ziyumieming/cherry-studio/issues/30) tracks a separate
controller PR to validate configuration per selected case, so
local category/navigation tests do not require unrelated CherryIN and embedding
services. Add an explicitly reviewed trusted-ref mechanism for pre-merge testing;
do not broadly accept arbitrary PR code in a secret-bearing run. Consider a
Windows-only milestone selection with matching aggregate expectations, retaining
both platforms for cross-platform acceptance. Current progress and dependencies
live in that task. These changes are not part of the ordinary CI repair or the
planning migration; the setup requirements above describe the current workflow.
