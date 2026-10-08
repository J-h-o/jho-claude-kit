---
name: jira-task
description: Implement a Jira ticket end to end - Haiku scouts and TDD implementers, Opus plans and reviews. Use when the user runs /jira-task or pastes a Jira ticket to implement.
---
# Jira task workflow

Ticket (title, description, acceptance criteria; images may be attached to the message):

$ARGUMENTS

If no ticket content is above or attached, ask me to paste it and stop.
This skill is the whole process: don't load brainstorming, planning, or subagent-execution process skills on top of it.
The craft rules in your context apply to every phase, and subagents receive them automatically. If they are not in your context (craft mode is off), tell me and ask whether to run `/craft full` first.

## 1. Understand
- Restate the ticket in 3-5 lines and list its acceptance criteria. Write criteria from the description if the ticket has none.
- Images: only you can see them, subagents can't. Transcribe what matters into words: layout, labels and copy, states, colors, error messages, and the data shown.
- Ask about real ambiguities now, in one batch. Don't ask what the code can answer.

## 2. Explore
- Dispatch `scout` subagents (in parallel if the questions are independent) to find the relevant code, reusable helpers, test patterns, and the test, lint, and typecheck commands.
- Read files yourself only when a decision needs the detail.

## 3. Plan — stop for my approval
- Break the work into small tasks. Each one names its files, the behavior, the test to write first, and how to verify it.
- Map every acceptance criterion to a task.
- Propose a branch name that follows the repo's existing convention (check `git branch -a` and `git log --oneline -20`) and includes the ticket key.
- Present the plan and wait for my OK.

## 4. Implement
- Create the branch.
- For each task, dispatch one `implementer` (Haiku). Paste into its prompt the full task spec, the relevant transcribed image details, and the verify commands. It has no other context.
- Run tasks one after another. Run them in parallel only when they touch disjoint files.
- Check each result yourself by running its verify command. Don't trust the report alone.
- Escalation: if a task fails verification twice, re-dispatch it with `model: sonnet`. If Sonnet fails, do it yourself.
- After each verified task, commit in the repo's commit-message style with the ticket key.

## 5. Verify
- Run the full test suite, lint, and typecheck. Fix failures before review.

## 6. Review
- Dispatch `reviewer` (Opus) on the branch diff against the base, with the acceptance criteria.
- Fix blockers and should-fixes, through an implementer or yourself, whichever is smaller. Re-run verification. Re-review only if the fixes were substantial.

## 7. Report
- What changed, mapped to the acceptance criteria.
- Verification evidence: commands and results.
- Commits made, and anything left open or worth flagging on the ticket.
- Don't push or open a PR unless I ask.
