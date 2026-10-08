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

**As linked files.** Use this where policy only allows the official marketplace, because a plugin from this marketplace would be silently turned off there. Skills and agents are symlinked into `~/.claude`, so `git pull` updates them:

```bash
git clone https://github.com/J-h-o/jho-claude-kit.git
node jho-claude-kit/install.js
```

Use one method, not both. `node install.js --uninstall` removes exactly what the installer added. It backs up `settings.json` to `settings.json.bak` before every change. Requires Node 18 or later.

## Use

| Command | What it does |
|---|---|
| `/craft lite\|full\|strict\|off` | Switch the craft level. Default is `full`. The level persists across sessions. |
| `/jira-task <pasted ticket>` | Run the full ticket workflow. Paste the title, description, acceptance criteria and screenshots in the same message. |

The levels:

- **lite** builds what you asked and names a simpler alternative.
- **full** enforces every rule.
- **strict** also challenges the requirement and re-reviews the diff before reporting done.

The rules live in [`rules/craft.md`](rules/craft.md). Edit that one file to change them everywhere: the main session, `/jira-task`, and every subagent.

The statusline shows `[CRAFT:FULL]` and similar. The linked-files installer sets it up unless you already have a statusline. Otherwise, or as a plugin, add it yourself:
`"statusLine": { "type": "command", "command": "node \"<kit path>/hooks/craft.js\" --statusline" }`

## Agents

| Agent | Model | Job |
|---|---|---|
| `scout` | Haiku, low effort | Read-only search. Returns `file:line` conclusions, not file dumps. |
| `implementer` | Haiku, high effort | One well-specified task, test-first. |
| `reviewer` | Opus, high effort | Reviews the diff against the acceptance criteria and the craft rules. |

## Develop

```bash
node --test
```
