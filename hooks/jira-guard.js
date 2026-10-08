#!/usr/bin/env node
// Jira-task guard: once `/jira-task` starts in a session, the main session may only
// plan, delegate, and verify. Its read/search/edit/browse calls (selected by the
// PreToolUse matcher in hooks.json) are denied with a pointer to the right subagent.
// Subagent calls carry an agent_id and always pass. `/jira-task done` ends the run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const START_COMMAND = /^\/(?:jho-claude-kit:)?jira-task(?:\s+([\s\S]*))?$/i;
const SAFE_SESSION_ID = /^[\w-]+$/;
const STALE_RUN_MS = 7 * 24 * 60 * 60 * 1000;
const DENY_REASON = 'jira-task run: the orchestrator does not read, search, edit, or browse itself. '
  + 'Delegate instead: `scout` to find code, `investigator` to debug, reproduce, or use the browser, '
  + '`implementer` to change code. Do not work around this with Bash; use Bash only for git and verify commands. '
  + 'If the user wants you to do it yourself, they end the run with /jira-task done.';

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const runsDir = path.join(configDir, '.jira-task-runs');
const runPath = (sessionId) => path.join(runsDir, sessionId);

function startRun(sessionId) {
  fs.mkdirSync(runsDir, { recursive: true });
  for (const name of fs.readdirSync(runsDir)) {
    const file = runPath(name);
    if (Date.now() - fs.statSync(file).mtimeMs > STALE_RUN_MS) fs.rmSync(file, { force: true });
  }
  fs.writeFileSync(runPath(sessionId), '');
}

function handle(event) {
  const sessionId = String(event.session_id ?? '');
  if (!SAFE_SESSION_ID.test(sessionId)) return;

  if (event.hook_event_name === 'UserPromptSubmit') {
    const match = String(event.prompt ?? '').trim().match(START_COMMAND);
    if (!match) return;
    if (match[1]?.trim().toLowerCase() === 'done') fs.rmSync(runPath(sessionId), { force: true });
    else startRun(sessionId);
    return;
  }

  if (event.hook_event_name === 'PreToolUse' && !event.agent_id && fs.existsSync(runPath(sessionId))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: DENY_REASON },
    }));
  }
}

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    handle(JSON.parse(input));
  } catch {
    // A hook must never break the session; bad input means no guard.
  }
});
