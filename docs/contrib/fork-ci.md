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
requirements is handled by the controller's case-specific preflight. New graph
cases must declare their actual service requirements when registered.

## Current E2E setup

Run **E2E Regression Test** manually from `main`. Its `ref` input accepts
`main`, `release/*` branches and `v*` tags. For pre-merge acceptance, a repository
administrator can review the exact code and add its complete lowercase
40-character commit SHA to the Actions variable `CHERRY_TEST_TRUSTED_SHAS`
(comma or whitespace separated). Enter that same SHA in `ref`; a moving feature
branch, PR ref or unlisted SHA is rejected. Approval of one SHA never approves
its next commit. Remove obsolete entries after acceptance. Only reviewed code
should be approved because it will execute with the selected test credentials.
The controller still comes from `main` and checks out the target by immutable SHA.
A tag run also needs the matching release and installable assets in this fork.
The workflow does not run automatically on PRs.

Select `platforms: windows` for this fork's Windows milestone checks, or keep
the default `all` for both Windows and macOS. Matrix selection, report collection,
assembly and aggregate verdict use the same selection. A missing selected report
blocks acceptance; an unselected platform is not presented as missing or passed.

Set the following repository Actions configuration under Settings > Secrets and
variables > Actions. Requirements depend on selected cases; `all` retains the
full eleven-entry requirement. Local `notes`, `startup-smoke`, `mini-app` and
`provider-model-scroll` require none of these service settings. Custom chat,
assistant, translation and similar chat flows need only the chat URL, key and
model. Knowledge adds the embedding settings. Claude Code/Claude Agent cases
also require the Anthropic URL; CherryIN chat/image cases require their real
account and the corresponding model. No placeholder accounts or URLs are used.
The config loader contains an exhaustive case-to-requirement map; register a
new case there as well as in the case manifest.

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

The workflow always provisions pinned Node.js/pnpm and project dependencies.
Claude Code, Codex and OpenClaw are installed only when the selected task
includes code-tool cases.
Application binary dependencies, the Electron SQLite rebuild and utility-process
builds are still required for source runs. Only the selected service configuration
is exported into the application/test environment. Preflight and export errors
name configuration keys without printing their values.
It uses Playwright over Electron CDP; it does not
require a separately installed Playwright Chromium browser or user recordings.
Native file dialogs, shortcuts, and selection cases need desktop automation.
The controller probes Windows desktop input and macOS accessibility/screen
capture; missing required capabilities are reported as blocked, not passed.
Self-hosted runners would need interactive desktops and those OS permissions.

The selected matrix runs Windows or both platforms. Its aggregate job already has
`actions: write` to remove this run's temporary artifacts after uploading the
combined `test-report`; no personal token or global read/write default is needed.
Reports are retained for 30 days. Test accounts and generated data should be safe
to appear in screenshots and evidence, particularly in a public repository.

## Session graph E2E preparation

[V1](https://github.com/ziyumieming/cherry-studio/issues/30) owns controller
preparation and its verification evidence. Merging controller changes into
`main` is required before dispatch can use them. Unit tests, CLI preflight and
enumeration verify preparation, not a live Electron or external-service pass.
[V2](https://github.com/ziyumieming/cherry-studio/issues/31) owns graph-specific
cases and actual desktop runs; owner UAT remains separate in V3. Ordinary CI
permissions need no expansion. A repository administrator manages any required
Actions variables/secrets and exact-SHA approvals; no personal token or CherryIN
account is needed for local graph organization checks.
