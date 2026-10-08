#!/usr/bin/env node
// Jira-task guard: once `/jira-task` starts in a session, the main session may only
// plan, delegate, and verify. Its read/search/edit/browse calls (selected by the
// PreToolUse matcher in hooks.json) are denied with a pointer to the right subagent,
// and Bash is limited to git and test/build runners. Subagent calls carry an
// agent_id and always pass. `/jira-task done` ends the run.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const START_COMMAND = /^\/(?:jho-claude-kit:)?jira-task(?:\s+([\s\S]*))?$/i;
const SAFE_SESSION_ID = /^[\w-]+$/;
const STALE_RUN_MS = 7 * 24 * 60 * 60 * 1000;
const DENY_REASON = 'jira-task run: the orchestrator does not read, search, edit, probe, or browse itself. '
  + 'Delegate instead: `scout` to find code, `investigator` to debug, reproduce, or use the browser, '
  + '`implementer` to change code. Bash is limited to git and test/build runners (npm, npx, mvn, gradle, pytest, ...), '
  + 'optionally piped to tail/head/grep/wc. If the user wants you to do it yourself, they end the run with /jira-task done.';
const SECOND_TICKET_NOTE = 'This session already ran a /jira-task, and all of its context is carried into this ticket, '
  + 'making every turn more expensive. Before starting, recommend that the user runs this ticket in a new session; '
  + 'continue here only if they say so.';
const ORCHESTRATOR_COMMANDS = new Set(['git', 'cd', 'ls', 'ln', 'npm', 'npx', 'pnpm', 'yarn', 'mvn', './mvnw',
  'gradle', './gradlew', 'pytest', 'go', 'cargo', 'make', 'dotnet']);
const OUTPUT_FILTERS = new Set(['tail', 'head', 'grep', 'wc']);

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const runsDir = path.join(configDir, '.jira-task-runs');
const runPath = (sessionId) => path.join(runsDir, sessionId);

// Each `cmd | filter` segment must start with an orchestrator command and pipe only into output filters.
function isOrchestratorCommand(command) {
  if (/\$\(|`/.test(command)) return false;
  const unquoted = command.replace(/'[^']*'|"[^"]*"/g, '""');
  return unquoted.split(/&&|\|\||;|\n/).map((segment) => segment.trim()).filter(Boolean).every((segment) => {
    const [first, ...piped] = segment.split('|').map((part) => part.trim().split(/\s+/)[0]);
    return ORCHESTRATOR_COMMANDS.has(first) && piped.every((filter) => OUTPUT_FILTERS.has(filter));
  });
}

function startRun(sessionId) {
  const alreadyRan = fs.existsSync(runPath(sessionId));
  fs.mkdirSync(runsDir, { recursive: true });
  for (const name of fs.readdirSync(runsDir)) {
    const file = runPath(name);
    if (Date.now() - fs.statSync(file).mtimeMs > STALE_RUN_MS) fs.rmSync(file, { force: true });
  }
  fs.writeFileSync(runPath(sessionId), '');
  return alreadyRan;
}

function emit(hookEventName, fields) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, ...fields } }));
}

function handle(event) {
  const sessionId = String(event.session_id ?? '');
  if (!SAFE_SESSION_ID.test(sessionId)) return;

  if (event.hook_event_name === 'UserPromptSubmit') {
    const match = String(event.prompt ?? '').trim().match(START_COMMAND);
    if (!match) return;
    if (match[1]?.trim().toLowerCase() === 'done') fs.rmSync(runPath(sessionId), { force: true });
    else if (startRun(sessionId)) emit('UserPromptSubmit', { additionalContext: SECOND_TICKET_NOTE });
    return;
  }

  if (event.hook_event_name !== 'PreToolUse' || event.agent_id || !fs.existsSync(runPath(sessionId))) return;
  if (event.tool_name === 'Bash' && isOrchestratorCommand(String(event.tool_input?.command ?? ''))) return;
  emit('PreToolUse', { permissionDecision: 'deny', permissionDecisionReason: DENY_REASON });
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
