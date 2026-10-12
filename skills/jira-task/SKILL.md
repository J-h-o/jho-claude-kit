---
name: jira-task
description: Implement a Jira ticket end to end - Haiku scouts and TDD implementers, Sonnet investigators, Opus plans and reviews. Use when the user runs /jira-task or pastes a Jira ticket to implement.
---
# Jira task workflow

Ticket (title, description, acceptance criteria; images may be attached to the message):

$ARGUMENTS

If no ticket content is above or attached, ask me to paste it and stop.
One ticket per session: everything from earlier work stays in this context and makes every turn more expensive. If this session already handled a ticket, recommend a new session before you start.
This skill is the whole process: don't load brainstorming, planning, or subagent-execution process skills on top of it.
The craft rules in your context apply to every phase, and subagents receive them automatically. If they are not in your context (craft mode is off), tell me and ask whether to run `/craft full` first.

## Your role: orchestrator only
You plan, delegate, verify, and decide. Subagents do all the reading, searching, debugging, browsing, and coding, because everything you do yourself stays in this large, expensive context for the rest of the run.
- A guard hook enforces this for the rest of this session. Your Read, Grep, Glob, Edit, Write, web, and browser calls are denied, and Bash is limited to git and test/build runners. Trim their output (for example `| tail -40`).
- When you need a fact, ask a subagent a precise question and use its answer. For a follow-up, message the same subagent with SendMessage: it keeps its full context, including everything it left out of its report.
- If an investigator reports a block, ask me to unblock it, then resume that same investigator with SendMessage instead of starting a new one.
- Browser work, including checking a fix in the running app, always goes to an `investigator`.
- If I want you to work directly, I'll end the run with `/jira-task done`.

| Need | Delegate to |
|---|---|
| Where is X, what pattern do we use, which test command | `scout` (Haiku) |
| Why does X happen, reproduce a bug, check behavior in the browser | `investigator` (Sonnet) |
| Change code for one well-specified task | `implementer` (Haiku) |
| Review the finished diff | `reviewer` (Opus) |

## 1. Understand
- Restate the ticket in 3-5 lines and list its acceptance criteria. Write criteria from the description if the ticket has none.
- Images: only you can see them, subagents can't. Transcribe what matters into words: layout, labels and copy, states, colors, error messages, and the data shown.
- Ask about real ambiguities now, in one batch. Don't ask what the code can answer.

## 2. Explore
- Dispatch `scout`s (in parallel when the questions are independent) for the relevant code, reusable helpers, test patterns, and the test, lint, and typecheck commands.
- For a bug, or any behavior you don't yet understand, dispatch an `investigator` for the root cause before you plan. Give it the symptoms, the environment details, and what "fixed" looks like.

## 3. Plan — stop for my approval
- Break the work into small tasks. Each one names the files it touches (including tests and shared files), the tasks it depends on, the behavior, the test to write first, how to verify it, and its commit message.
- Map every acceptance criterion to a task.
- Group the tasks into waves. A wave holds tasks whose dependencies are already done and whose touched files don't overlap, at most 4 per wave. Hotspots never share a wave: package manifests and lockfiles, shared types and barrel/index files, route or DI registries, migrations, i18n files, global config, and shared test setup. When in doubt, put the task in its own wave.
- Propose a branch name that follows the repo's existing convention (ask a scout) and includes the ticket key.
- Present the plan with its waves and wait for my OK.

## 4. Execute
- Create the branch, and record its base with `git rev-parse HEAD`.
- Launch the saved workflow `jira-execute` once (`jho-claude-kit:jira-execute` when the kit is installed as a plugin) with the plan as `args`:
  ```
  { key, repoRoot, base, agentPrefix, acceptanceCriteria: [...], imageNotes, fullVerify: [...],
    waves: [[{ n, title, files: [...], spec, testFirst, verify: [...], commit, criteria: [...] }]] }
  ```
  `repoRoot` is this working tree's absolute path. `agentPrefix` is `jho-claude-kit:` when your agent types carry that prefix, otherwise empty. `imageNotes` holds the transcribed image details, `fullVerify` the full test, lint and typecheck commands, and each task's `criteria` the indexes of the acceptance criteria it serves.
- Don't poll the run; wait for its completion notice. It implements each wave test-first up the Haiku, Sonnet, Opus ladder, brings parallel waves together through detached worktrees, verifies each wave and then the whole change, and has the `reviewer` check the diff.
- When it returns, remove every path in its `worktrees` with `git worktree remove <path>` in one Bash call.

## 5. Handle the result
- `needsReplan` tasks go back to planning with me. For `needsInvestigation` tasks, dispatch an `investigator` with the reason, then re-plan them. Report `blocked` tasks with their reason and the models tried.
- Once those are resolved, launch `jira-execute` again with only the waves that didn't finish.
- Judge the reviewer's findings yourself. Send the valid blockers and should-fixes to one `implementer` as a batch, with this working tree as its worktree path so it commits. Run `fullVerify` and check the exit codes. Re-review only if the fixes were substantial.

## 6. Report
- What changed, mapped to the acceptance criteria.
- Verification evidence: commands and results.
- Commits made, and anything left open or worth flagging on the ticket.
- Don't push or open a PR unless I ask. Remind me that `/jira-task done` ends the guard if I want to keep working in this session.
