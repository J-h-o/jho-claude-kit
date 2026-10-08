---
name: jira-task
description: Implement a Jira ticket end to end - Haiku scouts and TDD implementers, Sonnet investigators, Opus plans and reviews. Use when the user runs /jira-task or pastes a Jira ticket to implement.
---
# Jira task workflow

Ticket (title, description, acceptance criteria; images may be attached to the message):

$ARGUMENTS

If no ticket content is above or attached, ask me to paste it and stop.
This skill is the whole process: don't load brainstorming, planning, or subagent-execution process skills on top of it.
The craft rules in your context apply to every phase, and subagents receive them automatically. If they are not in your context (craft mode is off), tell me and ask whether to run `/craft full` first.

## Your role: orchestrator only
You plan, delegate, verify, and decide. Subagents do all the reading, searching, debugging, browsing, and coding, because everything you do yourself stays in this large, expensive context for the rest of the run.
- A guard hook enforces this: your Read, Grep, Glob, Edit, Write, web, and browser calls are denied for the rest of this session. Don't route around it with Bash. Use Bash only for git and verify commands, and trim their output (for example `| tail -40`).
- When you need a fact, ask a subagent a precise question and use its answer.
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
- Break the work into small tasks. Each one names its files, the behavior, the test to write first, and how to verify it.
- Map every acceptance criterion to a task.
- Propose a branch name that follows the repo's existing convention (ask a scout) and includes the ticket key.
- Present the plan and wait for my OK.

## 4. Implement
- Create the branch.
- For each task, dispatch one `implementer`. Paste into its prompt the full task spec, the relevant transcribed image details, and the verify commands. It has no other context.
- Run tasks one after another. Run them in parallel only when they touch disjoint files.
- Check its TDD evidence, then run its verify command yourself. Don't trust the report alone.
- Escalation, one step at a time: two failed attempts on Haiku → re-dispatch with `model: sonnet` → then with `model: opus` → then stop and ask me. A task that fails because the spec was wrong goes back to planning, not up the ladder.
- After each verified task, commit in the repo's commit-message style with the ticket key.

## 5. Verify
- Run the full test suite, lint, and typecheck with trimmed output. Send failures to an implementer.

## 6. Review
- Dispatch `reviewer` on the branch diff against the base, with the acceptance criteria.
- Send blockers and should-fixes to an implementer. Re-run verification. Re-review only if the fixes were substantial.

## 7. Report
- What changed, mapped to the acceptance criteria.
- Verification evidence: commands and results.
- Commits made, and anything left open or worth flagging on the ticket.
- Don't push or open a PR unless I ask. Remind me that `/jira-task done` ends the guard if I want to keep working in this session.
