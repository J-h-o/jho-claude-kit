# jho-claude-kit

My Claude Code toolkit. It has two parts:

- **Craft mode.** Always-on coding rules (TDD, KISS, DRY, YAGNI, reuse before writing, tight scope, verified before done), injected into every session and every subagent. Inspired by [ponytail](https://github.com/DietrichGebert/ponytail).
- **`/jira-task`.** Takes a pasted ticket from plan to reviewed commits. It routes work by cost: Haiku explores and implements test-first, Sonnet is the fallback when Haiku fails, and Opus plans and reviews.

## Install

**As a plugin.** Use this where your Claude Code allows third-party marketplaces:

```
/plugin marketplace add J-h-o/jho-claude-kit
/plugin install jho-claude-kit@jho-claude-kit
```

**As linked files.** Use this where policy only allows the official marketplace, because a plugin from this marketplace would be silently turned off there. The skill and agent folders are linked into `~/.claude`, so `git pull` updates them:

```bash
git clone https://github.com/J-h-o/jho-claude-kit.git
node jho-claude-kit/install.js
```

Use one method, not both. `node install.js --uninstall` removes exactly what the installer added. It backs up `settings.json` to `settings.json.bak` before every change. Requires Node 18 or later.

Plugins need Claude Code 2.x; check with `claude --version`. To try the kit for one terminal session without installing anything, start `claude --plugin-dir <path to this clone>`. On Windows, the installer links folders as junctions, which need no Developer Mode or admin rights.

## Use

| Command | What it does |
|---|---|
| `/craft lite\|full\|strict\|off` | Switch the craft level. Default is `full`. The level persists across sessions. |
| `/jira-task <pasted ticket>` | Run the full ticket workflow. Paste the title, description, acceptance criteria and screenshots in the same message. |
| `/jira-task done` | End the run's guard, so the main session can read and edit files itself again. |

Opus understands the ticket, explores with scouts and investigators, and plans. Once you approve the plan, it launches the `jira-execute` workflow once, instead of steering every step itself. The workflow script implements, verifies and reviews, then hands back one report. On the three tickets measured, the main session's turns after approval were 32 to 54% of a ticket's cost, mostly from re-reading 100 to 228K tokens of context on each turn.
- The plan groups tasks into waves. Tasks in a wave don't share files or dependencies.
- A wave of several tasks runs in parallel, each in a detached git worktree next to the repo, in `<repo>-worktrees/<KEY>-task-<n>`. `node_modules` and `.venv` are linked in rather than reinstalled. Finished tasks are cherry-picked back in plan order, and the main session removes the worktrees after the run.
- A failing task is retried on Haiku, then Sonnet, then Opus. A wrong spec, or a failure that needs debugging, comes back to the main session instead.
- Each wave's verify commands run after it, and the full ones at the end. A failure gets one fix task, which climbs the same ladder.
- The reviewer's findings come back to the main session, which decides what to fix.

Workflows are on by default. On Pro, turn them on in `/config`. Approve the plan promptly and don't switch models during a run: either makes the next turn re-read the whole conversation uncached.

During a `/jira-task` run, a guard hook stops the main session from reading, searching, editing or browsing. Every attempt is refused with a pointer to the right subagent. This keeps tool output out of the expensive main context; subagents are never blocked. The main session keeps git, test/build/app runners (npm, npx, mvn, gradle, pytest, flutter, docker, pm2, ...) and the ordinary shell around them.

### Testing logged-in apps
Investigators can start web and mobile apps and log in with test accounts from the project's seed, fixture or example env files, against apps running locally or in a simulator only. Claude Code's auto mode has its own safety check, which may still refuse to handle credentials. The kit doesn't change that check, because it's a safety setting. If you want to allow this case, add the following to `~/.claude/settings.json` yourself:

```json
"autoMode": {
  "environment": ["$defaults", "Apps under development run locally (localhost, 127.0.0.1, *.localhost) and in iOS/Android simulators. Their test accounts are listed in each project's seed, fixture or example env files and are test-only."],
  "allow": ["$defaults", "Logging in to an app the user is developing, running locally or in a simulator, with a test account from that project's seed, fixture or example env files, to test it."]
}
```

The levels:

- **lite** builds what you asked and names a simpler alternative.
- **full** enforces every rule.
- **strict** also challenges the requirement and re-reviews the diff before reporting done.

The rules live in [`rules/craft.md`](rules/craft.md). Edit that one file to change them everywhere: the main session, `/jira-task`, and every subagent.

The active level shows as `[CRAFT:FULL]` and similar. The plugin pins it under the prompt by itself. The linked-files installer puts it in your statusline instead, unless you already have one; then add it to yours:
`node "<kit path>/hooks/craft.js" --statusline`

## Agents

| Agent | Model | Job |
|---|---|---|
| `scout` | Haiku, low effort | Read-only search. Returns `file:line` conclusions, not file dumps. |
| `investigator` | Sonnet, medium effort | Reproduces and debugs, including in the browser. Reports the root cause with evidence. |
| `implementer` | Haiku, high effort | One well-specified task, test-first. The workflow escalates it to Sonnet, then Opus. |
| `reviewer` | Opus, high effort | Reviews the diff against the acceptance criteria and the craft rules. |

The workflow also runs a Haiku integrator of its own. It creates the worktrees, cherry-picks, and runs the verify commands.

## Develop

```bash
node --test tests/*.test.js
claude plugin test .
```
