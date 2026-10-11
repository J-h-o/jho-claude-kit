const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'jira-execute.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Runs the workflow script the way the runtime does: top-level await, a returned value, and these globals.
// `answer(call)` stands in for each agent; every call is recorded.
async function run(args, answer) {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    const call = { prompt, ...opts };
    calls.push(call);
    return answer(call);
  };
  const parallel = (thunks) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)));
  const body = SOURCE.replace('export const meta', 'const meta');
  const report = await new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', body)(
    agent, parallel, () => {}, () => {}, args);
  return { report, calls };
}

const task = (n, extra = {}) => ({
  n, title: `task ${n}`, files: [`src/${n}.js`], spec: `do ${n}`, testFirst: `test ${n}`,
  verify: [`npm test -- ${n}`], commit: `feat: task ${n}`, criteria: [0], ...extra,
});

const ARGS = {
  key: 'HER-1', repoRoot: '/work/app', base: 'b0', agentPrefix: 'jho-claude-kit:',
  acceptanceCriteria: ['it works'], imageNotes: '', fullVerify: ['npm test', 'npm run lint'],
  waves: [[task(1), task(2)], [task(3)]],
};

const done = { status: 'done', blockedKind: 'none', reason: '', commit: 'c1', files: ['src/x.js'],
  tdd: { failing: 'expected 1, got 0', passing: '1 passing' }, verify: [{ cmd: 'npm test', exitCode: 0 }] };
const failed = (reason) => ({ ...done, status: 'blocked', blockedKind: 'failure', reason });
const pass = (cmds) => cmds.map((cmd) => ({ cmd, exitCode: 0, tail: '' }));

// A healthy engine: every implementer succeeds, every integration is clean, the reviewer approves.
function healthy(overrides = {}) {
  return (call) => {
    for (const [prefix, respond] of Object.entries(overrides)) {
      if (call.label.startsWith(prefix)) {
        const result = respond(call);
        if (result !== undefined) return result;
      }
    }
    if (call.label.startsWith('setup')) return { ok: true, base: 'w0', error: '' };
    if (call.label.startsWith('integrate')) return { dirty: [], picked: [1, 2], conflicts: [], verify: pass(['npm test']) };
    if (call.label.startsWith('verify')) return { verify: pass(['npm test']) };
    if (call.label.startsWith('review')) return { verdict: 'APPROVE', findings: [] };
    return done;
  };
}

const labels = (calls) => calls.map((c) => c.label);
const statusOf = (report, n) => report.tasks.find((t) => t.n === n).status;

test('runs a parallel wave in detached worktrees, then a one-task wave in place, then verifies and reviews', async () => {
  const { report, calls } = await run(ARGS, healthy());

  assert.deepEqual(labels(calls), [
    'setup wave 1', 'task 1 · haiku', 'task 2 · haiku', 'integrate wave 1',
    'task 3 · haiku', 'verify wave 2', 'verify full', 'review',
  ]);
  const setup = calls[0].prompt;
  assert.match(setup, /worktree add --detach \/work\/app-worktrees\/HER-1-task-1 HEAD/);
  assert.match(setup, /worktree add --detach \/work\/app-worktrees\/HER-1-task-2 HEAD/);
  assert.match(calls[1].prompt, /\/work\/app-worktrees\/HER-1-task-1/);
  assert.match(calls[4].prompt, /\/work\/app\b/);
  assert.doesNotMatch(calls[4].prompt, /worktrees/);
  assert.equal(calls[1].agentType, 'jho-claude-kit:implementer');
  assert.equal(calls[1].model, 'haiku');
  assert.equal(calls[7].agentType, 'jho-claude-kit:reviewer');
  assert.match(calls[7].prompt, /git diff b0\.\.HEAD/);

  assert.deepEqual(report.tasks.map((t) => [t.n, t.status]), [[1, 'done'], [2, 'done'], [3, 'done']]);
  assert.deepEqual(report.worktrees, ['/work/app-worktrees/HER-1-task-1', '/work/app-worktrees/HER-1-task-2']);
  assert.equal(report.review.verdict, 'APPROVE');
  assert.deepEqual(report.notStarted, []);
});

test('the integrator cherry-picks only finished tasks, in plan order, from the wave base', async () => {
  const { calls } = await run(ARGS, healthy({ 'task 1': () => ({ ...done, status: 'blocked', blockedKind: 'spec' }) }));

  const integrate = calls.find((c) => c.label === 'integrate wave 1').prompt;
  assert.match(integrate, /status --short/);
  assert.match(integrate, /no pipes/);
  assert.match(integrate, /cherry-pick w0\.\./);
  assert.match(integrate, /HER-1-task-2/);
  assert.doesNotMatch(integrate, /HER-1-task-1\b/);
});

test('a verify command shared by several tasks runs once', async () => {
  const shared = { ...ARGS, waves: [[task(1, { verify: ['npm test'] }), task(2, { verify: ['npm test'] })]] };
  const { calls } = await run(shared, healthy());

  const integrate = calls.find((c) => c.label === 'integrate wave 1').prompt;
  assert.equal(integrate.match(/^- npm test$/gm).length, 1);
});

test('a failing task climbs haiku, haiku, sonnet, opus, then blocks and stops later waves', async () => {
  const { report, calls } = await run(ARGS, healthy({ 'task 2': () => failed('tests still red') }));

  assert.deepEqual(calls.filter((c) => c.label.startsWith('task 2')).map((c) => c.model),
    ['haiku', 'haiku', 'sonnet', 'opus']);
  const blocked = report.tasks.find((t) => t.n === 2);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'tests still red');
  assert.deepEqual(blocked.attempts, ['haiku', 'haiku', 'sonnet', 'opus']);
  assert.deepEqual(report.notStarted, [3]);
  assert.equal(report.review, null);
});

test('later attempts are told why the previous one failed', async () => {
  const { calls } = await run(ARGS, healthy({ 'task 2 · haiku': () => failed('lint error in src/2.js') }));

  const sonnet = calls.find((c) => c.label === 'task 2 · sonnet');
  assert.match(sonnet.prompt, /lint error in src\/2\.js/);
});

test('a "done" report with a red verify run passes on the failing command, not its summary', async () => {
  const { calls } = await run(ARGS, healthy({
    'task 2 · haiku': () => ({ ...done, reason: 'all good, committed', verify: [{ cmd: 'npm test -- 2', exitCode: 1 }] }),
  }));

  const sonnet = calls.find((c) => c.label === 'task 2 · sonnet').prompt;
  assert.match(sonnet, /npm test -- 2/);
  assert.doesNotMatch(sonnet, /all good/);
});

test('a non-zero exit code or missing TDD evidence counts as a failed attempt', async () => {
  let attempt = 0;
  const { report } = await run(ARGS, healthy({
    'task 1': () => (++attempt === 1
      ? { ...done, verify: [{ cmd: 'npm test', exitCode: 1 }] }
      : attempt === 2 ? { ...done, tdd: { failing: '', passing: '1 passing' } } : done),
  }));

  assert.deepEqual(report.tasks.find((t) => t.n === 1).attempts, ['haiku', 'haiku', 'sonnet']);
  assert.equal(statusOf(report, 1), 'done');
});

test('only the final verify runs decide an attempt, not the red run reported as TDD evidence', async () => {
  const { report } = await run(ARGS, healthy({
    'task 1': () => ({ ...done, tdd: { failing: 'not ok 1 (exit 1)', passing: 'ok 1' }, verify: [{ cmd: 'npm test', exitCode: 0 }] }),
  }));

  assert.deepEqual(report.tasks.find((t) => t.n === 1).attempts, ['haiku']);
});

test('a wrong spec goes back to planning without escalating', async () => {
  const { report, calls } = await run(ARGS, healthy({
    'task 1': () => ({ ...done, status: 'blocked', blockedKind: 'spec', reason: 'criterion 0 contradicts the API' }),
  }));

  assert.equal(calls.filter((c) => c.label.startsWith('task 1')).length, 1);
  assert.equal(statusOf(report, 1), 'needsReplan');
  assert.equal(report.tasks.find((t) => t.n === 1).reason, 'criterion 0 contradicts the API');
});

test('a task that needs debugging is handed back for an investigator without escalating', async () => {
  const { report, calls } = await run(ARGS, healthy({
    'task 1': () => ({ ...done, status: 'blocked', blockedKind: 'investigate', reason: 'cache returns stale rows' }),
  }));

  assert.equal(calls.filter((c) => c.label.startsWith('task 1')).length, 1);
  assert.equal(statusOf(report, 1), 'needsInvestigation');
});

test('a cherry-pick conflict re-runs that task in place after the rest of the wave', async () => {
  const { report, calls } = await run(ARGS, healthy({
    'integrate wave 1': () => ({ dirty: [], picked: [1], conflicts: [2], verify: pass(['npm test']) }),
  }));

  const order = labels(calls);
  const rerun = order.lastIndexOf('task 2 · haiku');
  assert.ok(rerun > order.indexOf('integrate wave 1'));
  assert.ok(rerun < order.indexOf('task 3 · haiku'));
  assert.match(calls[rerun].prompt, /\/work\/app\b/);
  assert.doesNotMatch(calls[rerun].prompt, /worktrees/);
  assert.equal(statusOf(report, 2), 'done');
});

test('a dirty main tree stops the run before anything is cherry-picked', async () => {
  const { report, calls } = await run(ARGS, healthy({
    'integrate wave 1': () => ({ dirty: ['M src/app.js'], picked: [], conflicts: [], verify: [] }),
  }));

  assert.match(report.error, /M src\/app\.js/);
  assert.deepEqual(report.notStarted, [3]);
  assert.ok(!labels(calls).includes('review'));
});

test('a failed wave verify gets one fix task on the ladder, then is verified again', async () => {
  let verifies = 0;
  const { report, calls } = await run(ARGS, healthy({
    'verify wave 2': () => ({
      verify: ++verifies === 1 ? [{ cmd: 'npm test -- 3', exitCode: 1, tail: 'AssertionError: 3' }] : pass(['npm test -- 3']) }),
  }));

  const fix = calls.find((c) => c.label === 'fix wave 2 · haiku');
  assert.match(fix.prompt, /AssertionError: 3/);
  assert.equal(labels(calls).filter((l) => l === 'verify wave 2').length, 2);
  assert.ok(labels(calls).includes('review'));
  assert.deepEqual(report.waveVerify.at(-1).verify, pass(['npm test -- 3']));
});

test('verification that still fails after the fix stops the run and is reported', async () => {
  const red = { verify: [{ cmd: 'npm test', exitCode: 1, tail: 'boom' }] };
  const { report, calls } = await run(ARGS, healthy({ 'verify full': () => red }));

  assert.ok(labels(calls).includes('fix full · haiku'));
  assert.deepEqual(report.fullVerify, red.verify);
  assert.equal(report.review, null);
});

test('without the plugin prefix, the linked-files agent names are used', async () => {
  const { calls } = await run({ ...ARGS, agentPrefix: '' }, healthy());

  assert.equal(calls.find((c) => c.label === 'task 1 · haiku').agentType, 'implementer');
  assert.equal(calls.find((c) => c.label === 'review').agentType, 'reviewer');
});

test('review findings are returned, not applied', async () => {
  const findings = [{ severity: 'should-fix', path: 'src/1.js', line: 3, problem: 'p', fix: 'f' }];
  const { report, calls } = await run(ARGS, healthy({ review: () => ({ verdict: 'CHANGES REQUIRED', findings }) }));

  assert.equal(labels(calls).at(-1), 'review');
  assert.deepEqual(report.review.findings, findings);
});
