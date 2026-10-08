#!/usr/bin/env node
// Craft mode hook: injects the craft rules into sessions and subagents,
// and switches the level when the user types `/craft <level>`.
//
//   SessionStart, SubagentStart  -> inject the rules unless the mode is off
//   UserPromptSubmit             -> persist a new level from `/craft <level>`
//   --statusline                 -> print the active level badge

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LEVELS = ['lite', 'full', 'strict', 'off'];
const DEFAULT_LEVEL = 'full';
const RULES_PATH = path.join(__dirname, '..', 'rules', 'craft.md');
const SWITCH_COMMAND = /^\/(?:jho-claude-kit:)?craft\s+(\w+)\s*$/i;

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const modePath = path.join(configDir, '.craft-mode');

function readLevel() {
  try {
    const level = fs.readFileSync(modePath, 'utf8').trim();
    return LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

function writeLevel(level) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(modePath, level);
}

// rules/craft.md describes every level as a `- <level>:` line; keep only the active one.
function rulesContext(level) {
  const rules = fs.readFileSync(RULES_PATH, 'utf8')
    .split('\n')
    .filter((line) => !/^- (lite|full|strict)\b/.test(line) || line.startsWith(`- ${level}`))
    .join('\n');
  return `Craft mode is on (level: ${level}). Follow these rules for all code work.\n\n${rules}`;
}

function emit(hookEventName, additionalContext) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }));
}

function handle(event) {
  const name = event.hook_event_name;

  if (name === 'SessionStart' || name === 'SubagentStart') {
    const level = readLevel();
    if (level !== 'off') emit(name, rulesContext(level));
    return;
  }

  if (name === 'UserPromptSubmit') {
    const level = String(event.prompt || '').trim().match(SWITCH_COMMAND)?.[1].toLowerCase();
    if (!LEVELS.includes(level)) return;

    writeLevel(level);
    emit(name, level === 'off'
      ? 'Craft mode is off. Stop applying the craft rules until it is turned back on.'
      : rulesContext(level));
  }
}

if (process.argv.includes('--statusline')) {
  const level = readLevel();
  if (level !== 'off') process.stdout.write(`[CRAFT:${level.toUpperCase()}]`);
} else {
  let input = '';
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      handle(JSON.parse(input));
    } catch {
      // A hook must never block the user's prompt; bad input means no injection.
    }
  });
}
