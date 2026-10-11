export const meta = {
  name: 'jira-execute',
  description: 'Run an approved /jira-task plan: implement each wave test-first, integrate, verify, and review',
  whenToUse: 'Launched by the jira-task skill after the user approves the plan. Takes the plan as args.',
  phases: [{ title: 'Verify' }, { title: 'Review' }],
}

// args: { key, repoRoot, base, agentPrefix, acceptanceCriteria, imageNotes, fullVerify, waves: [[task]] }
// task: { n, title, files, spec, testFirst, verify, commit, criteria }
// The orchestrator creates the feature branch before the launch, and removes the returned worktrees after it.

const LADDER = ['haiku', 'haiku', 'sonnet', 'opus']
const VERIFY_TAIL_LINES = 30

const IMPLEMENTER_SCHEMA = {
  type: 'object',
  required: ['status', 'blockedKind', 'reason', 'commit', 'files', 'tdd', 'verify'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    blockedKind: { type: 'string', enum: ['none', 'failure', 'spec', 'investigate'] },
    reason: { type: 'string' },
    commit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    tdd: {
      type: 'object', required: ['failing', 'passing'],
      properties: { failing: { type: 'string' }, passing: { type: 'string' } },
    },
    verify: {
      type: 'array',
      items: { type: 'object', required: ['cmd', 'exitCode'], properties: { cmd: { type: 'string' }, exitCode: { type: 'integer' } } },
    },
  },
}
const SETUP_SCHEMA = {
  type: 'object', required: ['ok', 'base', 'error'],
  properties: { ok: { type: 'boolean' }, base: { type: 'string' }, error: { type: 'string' } },
}
const VERIFY_RESULTS = {
  type: 'array',
  items: {
    type: 'object', required: ['cmd', 'exitCode', 'tail'],
    properties: { cmd: { type: 'string' }, exitCode: { type: 'integer' }, tail: { type: 'string' } },
  },
}
const VERIFY_SCHEMA = { type: 'object', required: ['verify'], properties: { verify: VERIFY_RESULTS } }
const INTEGRATION_SCHEMA = {
  type: 'object', required: ['dirty', 'picked', 'conflicts', 'verify'],
  properties: {
    dirty: { type: 'array', items: { type: 'string' } },
    picked: { type: 'array', items: { type: 'integer' } },
    conflicts: { type: 'array', items: { type: 'integer' } },
    verify: VERIFY_RESULTS,
  },
}
const REVIEW_SCHEMA = {
  type: 'object', required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['APPROVE', 'CHANGES REQUIRED'] },
    findings: {
      type: 'array',
      items: {
        type: 'object', required: ['severity', 'path', 'line', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'should-fix', 'minor'] },
          path: { type: 'string' }, line: { type: 'integer' }, problem: { type: 'string' }, fix: { type: 'string' },
        },
      },
    },
  },
}

const repo = args.repoRoot
const worktreeOf = task => {
  const slash = repo.lastIndexOf('/')
  return `${repo.slice(0, slash)}/${repo.slice(slash + 1)}-worktrees/${args.key}-task-${task.n}`
}
const bullets = items => items.map(item => `- ${item}`).join('\n')
const succeeded = r => r && r.status === 'done' && r.tdd.failing && r.tdd.passing
  && r.verify.length > 0 && r.verify.every(c => c.exitCode === 0)
const allPass = results => results.every(r => r.exitCode === 0)

function taskPrompt(task, dir) {
  return `Implement task ${task.n} of ticket ${args.key}: ${task.title}

Your worktree path is ${dir}. Commit there when the task is done.

Behavior: ${task.spec}
Files it touches: ${task.files.join(', ')}
Test to write first: ${task.testFirst}
Verify commands:
${bullets(task.verify)}
Commit message: ${task.commit}

Acceptance criteria this task serves:
${bullets(task.criteria.map(i => args.acceptanceCriteria[i]))}
${args.imageNotes ? `\nDetails from the ticket's images:\n${args.imageNotes}\n` : ''}
Report status "blocked" with blockedKind "spec" if the spec is wrong, ambiguous or contradicts the code, and "investigate" if a failure's cause is unclear and needs debugging rather than another attempt. Report "commit" as the sha of your commit and "tdd.failing" as the failing assertion from your first test run. In "verify", list only the final run of each verify command after your change, with its exit code.`
}

function fixPrompt(scope, failures) {
  return `These verify commands fail in ${repo} after ticket ${args.key}'s ${scope} was integrated:

${failures.map(f => `$ ${f.cmd}  (exit ${f.exitCode})\n${f.tail}`).join('\n\n')}

Your worktree path is ${repo}. Find the cause, fix it test-first where behavior changes, rerun the commands until they exit 0, and commit with a message in this repo's existing style. Report status "blocked" with blockedKind "investigate" if the cause is unclear and needs debugging, and "spec" if fixing it means changing what the ticket asks for.`
}

// Runs a prompt up the model ladder until an attempt succeeds, the spec is wrong, or debugging is needed.
async function climb(label, prompt) {
  const attempts = []
  let reason = ''
  for (const model of LADDER) {
    const retry = reason ? `\n\nA previous attempt failed: ${reason}\nThe directory may hold its work; build on it.` : ''
    const r = await agent(prompt + retry, {
      label: `${label} · ${model}`, model, agentType: `${args.agentPrefix}implementer`, schema: IMPLEMENTER_SCHEMA,
    })
    attempts.push(model)
    if (r && r.blockedKind === 'spec') return { status: 'needsReplan', reason: r.reason, attempts }
    if (r && r.blockedKind === 'investigate') return { status: 'needsInvestigation', reason: r.reason, attempts }
    if (succeeded(r)) return { status: 'done', reason: '', attempts, commit: r.commit }
    reason = !r ? 'the agent returned nothing'
      : r.status === 'blocked' && r.reason ? r.reason : `failing verify commands: ${r.verify.filter(c => c.exitCode !== 0).map(c => c.cmd).join(', ') || 'no TDD evidence or verify run'}`
  }
  return { status: 'blocked', reason, attempts }
}

const integrator = (label, prompt, schema) => agent(
  `${prompt}\n\nYou only run git and the listed commands; you never edit files.`,
  { label, model: 'haiku', effort: 'low', schema })

const runCommands = commands => `In ${repo}, run each command below exactly as written, on its own as \`cd ${repo} && <command>\`, with no pipes or redirects, so the exit code is the command's own. Report each one's exit code and the last ${VERIFY_TAIL_LINES} lines of its output:
${bullets([...new Set(commands)])}`

// Verifies, and on failure runs one fix up the ladder and verifies again. Returns the last results and the fix.
async function verifyWithFix(scope, label, commands, record) {
  let result = await integrator(`verify ${label}`, runCommands(commands), VERIFY_SCHEMA)
  if (!result) return { ok: false, error: 'the verify agent returned nothing' }
  record(result.verify)
  if (allPass(result.verify)) return { ok: true }
  const fix = await climb(`fix ${label}`, fixPrompt(scope, result.verify.filter(r => r.exitCode !== 0)))
  if (fix.status !== 'done') return { ok: false, fix }
  result = await integrator(`verify ${label}`, runCommands(commands), VERIFY_SCHEMA)
  if (!result) return { ok: false, error: 'the verify agent returned nothing', fix }
  record(result.verify)
  return { ok: allPass(result.verify), fix }
}

const report = { tasks: [], worktrees: [], waveVerify: [], fixes: [], fullVerify: [], review: null, notStarted: [], error: '' }
const record = (task, outcome) => {
  const entry = { n: task.n, title: task.title, ...outcome }
  report.tasks = report.tasks.filter(t => t.n !== task.n).concat(entry)
}

async function runWave(wave, index) {
  const label = `wave ${index + 1}`
  phase(`Wave ${index + 1}`)
  let inPlace = wave

  if (wave.length > 1) {
    const dirs = wave.map(worktreeOf)
    const setup = await integrator(`setup ${label}`, `In ${repo}, record \`git -C ${repo} rev-parse HEAD\` as "base", then for each path below run \`git -C ${repo} worktree add --detach <path> HEAD\`. After each one, if ${repo}/node_modules exists run \`ln -s ${repo}/node_modules <path>/node_modules\`, and if ${repo}/.venv exists run \`ln -s ${repo}/.venv <path>/.venv\`.
${bullets(dirs.map(d => `git -C ${repo} worktree add --detach ${d} HEAD`))}
Report ok false with the error text if any command fails.`, SETUP_SCHEMA)
    if (!setup || !setup.ok) return (setup && setup.error) || 'worktree setup returned nothing'
    report.worktrees.push(...dirs)

    const outcomes = await parallel(wave.map(task => () => climb(`task ${task.n}`, taskPrompt(task, worktreeOf(task)))))
    wave.forEach((task, i) => record(task, outcomes[i] || { status: 'blocked', reason: 'the task returned nothing', attempts: [] }))
    const finished = wave.filter((task, i) => outcomes[i] && outcomes[i].status === 'done')

    const integration = await integrator(`integrate ${label}`, `1. Run \`git -C ${repo} status --short\` and put each line it prints in "dirty", or [] if it prints nothing. If it printed anything, stop there.
2. In this order, for each worktree below: let HEAD be \`git -C <worktree> rev-parse HEAD\`. If HEAD is ${setup.base}, skip it. Otherwise run \`git -C ${repo} cherry-pick ${setup.base}..<HEAD>\`. A conflict is an expected outcome, not an error: run \`git -C ${repo} cherry-pick --abort\`, list the task in "conflicts", and go on with the next one. List tasks picked cleanly in "picked".
${bullets(finished.map(task => `task ${task.n}: ${worktreeOf(task)}`))}
3. ${runCommands(finished.flatMap(task => task.verify))}`, INTEGRATION_SCHEMA)
    if (!integration) return 'the integration agent returned nothing'
    if (integration.dirty.length > 0) return `the main working tree has uncommitted changes:\n${integration.dirty.join('\n')}`
    report.waveVerify.push({ wave: label, verify: integration.verify })
    inPlace = wave.filter(task => integration.conflicts.includes(task.n))
    if (inPlace.length === 0 && !allPass(integration.verify)) {
      const fixed = await verifyWithFix(label, label, finished.flatMap(task => task.verify), verify => report.waveVerify.push({ wave: label, verify }))
      if (fixed.fix) report.fixes.push({ scope: label, ...fixed.fix })
      if (!fixed.ok) return fixed.error || `verification of ${label} still fails`
    }
  }

  for (const task of inPlace) record(task, await climb(`task ${task.n}`, taskPrompt(task, repo)))
  const stuck = wave.find(task => report.tasks.find(t => t.n === task.n).status !== 'done')
  if (stuck) return ''

  if (inPlace.length > 0) {
    const fixed = await verifyWithFix(label, label, wave.flatMap(task => task.verify), verify => report.waveVerify.push({ wave: label, verify }))
    if (fixed.fix) report.fixes.push({ scope: label, ...fixed.fix })
    if (!fixed.ok) return fixed.error || `verification of ${label} still fails`
  }
  return null
}

let stopped = false
for (const [index, wave] of args.waves.entries()) {
  if (stopped) {
    report.notStarted.push(...wave.map(task => task.n))
    continue
  }
  const error = await runWave(wave, index)
  if (error !== null) {
    stopped = true
    report.error = error
  }
}

if (!stopped) {
  phase('Verify')
  const fixed = await verifyWithFix('whole change', 'full', args.fullVerify, verify => { report.fullVerify = verify })
  if (fixed.fix) report.fixes.push({ scope: 'full', ...fixed.fix })
  if (!fixed.ok) {
    stopped = true
    report.error = fixed.error || 'full verification still fails'
  }
}

if (!stopped) {
  phase('Review')
  report.review = await agent(`Review \`git diff ${args.base}..HEAD\` in ${repo} for ticket ${args.key} against these acceptance criteria:
${bullets(args.acceptanceCriteria.map((c, i) => `${i}. ${c}`))}`, {
    label: 'review', agentType: `${args.agentPrefix}reviewer`, schema: REVIEW_SCHEMA,
  })
}

report.criteria = args.acceptanceCriteria.map((criterion, i) => ({
  criterion, tasks: args.waves.flat().filter(task => task.criteria.includes(i)).map(task => task.n),
}))
return report
