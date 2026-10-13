// Decides whether a Bash command is orchestrator work during a /jira-task run: git, test/build/app runners,
// and the ordinary shell around them (loops, conditionals, echo of exit codes, $(...)). Anything that reads,
// edits, or probes the codebase belongs to a subagent instead. A cost guard, not a sandbox.

const ORCHESTRATOR_COMMANDS = new Set(['git', 'cd', 'ls', 'ln', 'npm', 'npx', 'pnpm', 'yarn', 'mvn', './mvnw',
  'gradle', './gradlew', 'pytest', 'go', 'cargo', 'make', 'dotnet', 'flutter', 'dart', 'xcodebuild', 'docker', 'pm2']);
const SHELL_BUILTINS = new Set(['echo', 'printf', 'test', '[', '[[', 'true', 'false', 'export', 'set', 'read', 'exit', ':']);
const OUTPUT_FILTERS = new Set(['tail', 'head', 'grep', 'wc', 'sort', 'uniq', 'cut', 'tr', 'jq']);
// Background runs and scratch logs live in temp; reading those is checking results, not reading code.
const TEMP_FILE_READERS = new Set(['cat', 'tail', 'head']);
const LEADING_KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{']);
const CLOSING_KEYWORDS = new Set(['done', 'fi', 'esac', '}']);
const CONTROL_HEADERS = new Set(['for', 'case', 'select']);

const isTempPath = (word) => /^\/(private\/)?tmp\//.test(word);
const isSafeRedirectTarget = (target) => target.startsWith('&') || target === '/dev/null' || isTempPath(target);

// Double-quoted text still runs its $(...) and `...`, so those become commands of their own; the rest is inert.
function splitQuoting(command) {
  const substitutions = [];
  const collect = (text) => {
    for (const [, inner] of text.matchAll(/\$\(([^()]*)\)/g)) substitutions.push(inner);
    for (const [, inner] of text.matchAll(/`([^`]*)`/g)) substitutions.push(inner);
  };
  const outside = command
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, (quoted) => { collect(quoted); return '""'; });
  return { outside, substitutions };
}

function redirectsAreSafe(text) {
  return [...text.matchAll(/\d*&?>>?\s*([^\s;|]+)/g)].every(([, target]) => isSafeRedirectTarget(target));
}

function words(segment) {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function stripPrefixes(tokens) {
  let rest = tokens;
  while (rest.length > 0 && (LEADING_KEYWORDS.has(rest[0]) || /^\w+=/.test(rest[0]))) rest = rest.slice(1);
  return rest;
}

function isAllowedCommand(tokens) {
  const [name, ...args] = tokens;
  if (ORCHESTRATOR_COMMANDS.has(name) || SHELL_BUILTINS.has(name)) return true;
  const paths = args.filter((arg) => !arg.startsWith('-') && !/^\d+$/.test(arg));
  return TEMP_FILE_READERS.has(name) && paths.length > 0 && paths.every(isTempPath);
}

function isAllowedPipeline(pipeline) {
  const [first, ...downstream] = pipeline.split('|');
  const tokens = stripPrefixes(words(first));
  const filtersOnly = downstream.every((part) => OUTPUT_FILTERS.has(words(part)[0]));
  if (CONTROL_HEADERS.has(tokens[0])) return downstream.length === 0;
  // An empty head or a closing keyword pipes the output of the subshell or loop that just ended.
  if (tokens.length === 0 || CLOSING_KEYWORDS.has(tokens[0])) return filtersOnly;
  return isAllowedCommand(tokens) && filtersOnly;
}

function isOrchestratorCommand(command) {
  const { outside, substitutions } = splitQuoting(command);
  // Subshells and substitutions become plain command boundaries, so their contents are checked like the rest.
  const script = [outside.replace(/\$\(|[()`]/g, ';'), ...substitutions].join(';');
  if (!redirectsAreSafe(script)) return false;
  return script.split(/&&|\|\||;|\n/).filter((pipeline) => pipeline.trim()).every(isAllowedPipeline);
}

module.exports = { isOrchestratorCommand };
