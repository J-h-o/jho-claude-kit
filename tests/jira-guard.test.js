const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const KIT = path.join(__dirname, '..');
const SCRIPT = path.join(KIT, 'hooks', 'jira-guard.js');
let configDir;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jira-guard-'));
});

function run(input) {
  const result = spawnSync('node', [SCRIPT], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const prompt = (text, session_id = 's1') => ({ hook_event_name: 'UserPromptSubmit', session_id, prompt: text });
const toolCall = (extra = {}) => ({ hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', ...extra });

function decision(stdout) {
  const output = JSON.parse(stdout).hookSpecificOutput;
  return { decision: output.permissionDecision, reason: output.permissionDecisionReason };
}

test('outside a jira-task run, tool calls pass untouched', () => {
  assert.equal(run(toolCall()), '');
});

test('during a run, the main session is told to delegate', () => {
  run(prompt('/jira-task HER-123 Fix the export'));

  const { decision: verdict, reason } = decision(run(toolCall()));

  assert.equal(verdict, 'deny');
  assert.match(reason, /scout/);
  assert.match(reason, /investigator/);
  assert.match(reason, /\/jira-task done/);
});

test('subagents are never blocked', () => {
  run(prompt('/jira-task HER-123'));

  assert.equal(run(toolCall({ agent_id: 'agent-1' })), '');
});

test('the guard applies only to the session that started the run', () => {
  run(prompt('/jira-task HER-123', 's1'));

  assert.equal(run(toolCall({ session_id: 's2' })), '');
});

test('/jira-task done ends the run', () => {
  run(prompt('/jira-task HER-123'));
  run(prompt('/jira-task done'));

  assert.equal(run(toolCall()), '');
});

test('the plugin-namespaced command starts a run; look-alikes do not', () => {
  run(prompt('/jira-taskforce go', 's2'));
  run(prompt('please run /jira-task later', 's3'));
  run(prompt('/jho-claude-kit:jira-task HER-9', 's1'));

  assert.equal(decision(run(toolCall())).decision, 'deny');
  assert.equal(run(toolCall({ session_id: 's2' })), '');
  assert.equal(run(toolCall({ session_id: 's3' })), '');
});

test('an unsafe session id is ignored, never used as a path', () => {
  run(prompt('/jira-task HER-1', '../../escape'));

  assert.equal(fs.existsSync(path.join(configDir, '..', 'escape')), false);
  assert.equal(run(toolCall({ session_id: '../../escape' })), '');
});

test('malformed input never blocks anything', () => {
  assert.equal(run('not json'), '');
  assert.equal(run({ hook_event_name: 'Stop', session_id: 's1' }), '');
});

test('the plugin matcher guards reading, editing and browsing, not delegating', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(KIT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const matcher = new RegExp(`^(?:${hooks.PreToolUse.find((g) => g.matcher).matcher})$`);

  for (const tool of ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
    'mcp__Claude_Browser__navigate', 'mcp__plugin_playwright_playwright__browser_click', 'mcp__claude-in-chrome__read_page']) {
    assert.match(tool, matcher, tool);
  }
  for (const tool of ['Bash', 'Agent', 'Skill', 'AskUserQuestion', 'SendMessage', 'mcp__ccd_session__mark_chapter']) {
    assert.doesNotMatch(tool, matcher, tool);
  }
});
