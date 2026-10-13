const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isOrchestratorCommand } = require('../hooks/orchestrator-shell');

// Commands the guard wrongly refused in real /jira-task runs: git and verify work wrapped in ordinary shell.
const REAL_VERIFY_COMMANDS = [
  'for r in simplex-ui simplex-admin-api; do echo "$r $(git -C /repos/$r branch --show-current)"; done',
  'cd /repos/simplex-admin-api && git status --short && npx tsc --noEmit -p . 2>&1 | tail -5; echo "tsc exit=${PIPESTATUS[0]}"',
  'cd /repos/simplex-ui && npm run build:admin > /private/tmp/claude-501/run/build.log 2>&1; echo "build=$?"',
  'npx jest --silent --reporters summary > /dev/null 2>&1 && echo jest=0 || echo jest=fail; npm run lint 2>&1 | tail -3',
  'tail -20 /private/tmp/claude-501/-Users-x/0b25929d/tasks/b0u1wy.output',
  'git fetch origin dev 2>&1 | tail -2; B=$(git merge-base origin/dev mr-212); echo base=$B; git log --oneline $B..mr-212',
  'S=/private/tmp/claude-501/run/scratchpad git -C /repos/app worktree list',
  'for r in a b; do b=$(git -C "$r" branch -a 2>/dev/null | grep -i sl-103); [ -n "$b" ] && echo "$r: $b"; done',
  'npm --prefix /repos/simplex-common-api test 2>&1 | tail -6; echo "exit=${PIPESTATUS[0]}"',
  'if git diff --quiet; then echo clean; else git diff --stat; fi',
  '(cd app && npm test) | tail -5',
];

const APP_RUNNERS = ['flutter test 2>&1 | tail -20', 'dart analyze', 'xcodebuild test -scheme App | tail -30',
  'docker compose up -d', 'pm2 restart simplex-ui'];

test('git, verify, and app-runner commands pass, including shell scripting around them', () => {
  for (const command of [...REAL_VERIFY_COMMANDS, ...APP_RUNNERS]) {
    assert.equal(isOrchestratorCommand(command), true, command);
  }
});

test('reading, editing, or probing through the shell is refused', () => {
  for (const command of ["sed -i 's/a/b/' src/app.ts", 'cat src/app.ts', 'curl -s http://localhost:8080',
    'python3 -c "print(1)"', 'git diff && cat src/app.ts', 'npm test; node -e "1"', 'git log $(cat .env)',
    'npm test | xargs rm', 'grep -n "teams" src/routes/routes.ts', 'tail -20 src/app.ts', 'B=$(cat src/app.ts)',
    'echo "export const x = 1" > src/app.ts', 'npm test >> src/notes.md', 'echo "$(cat .env)"',
    'for f in src/*.ts; do cat "$f"; done', 'echo hi | tee src/x.ts', 'brew install glab']) {
    assert.equal(isOrchestratorCommand(command), false, command);
  }
});

test('output may be written only to temp files or /dev/null', () => {
  assert.equal(isOrchestratorCommand('npm test > /tmp/claude-501/test.log 2>&1'), true);
  assert.equal(isOrchestratorCommand('npm test > test.log'), false);
});
