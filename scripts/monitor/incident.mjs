#!/usr/bin/env node
/**
 * One GitHub issue per outage: opened when checks start failing, kept current
 * while they fail, closed when they pass.
 *
 *   node scripts/monitor/incident.mjs results.json            # what checks.mjs --json wrote
 *   node scripts/monitor/incident.mjs results.json --dry-run  # say what it would do
 *
 * The rules, each of which exists because the alternative is an alert nobody
 * reads:
 *
 * - **One open issue labelled `incident`, ever.** A second failure while one
 *   is open is the same outage until it recovers.
 * - **Opening is the only loud moment.** It is the only time this exits
 *   non-zero, which fails the workflow run, which is what makes GitHub email
 *   the owner -- the issue itself notifies the repository's watchers. A run
 *   that finds the outage still going edits the issue body silently.
 * - **A change in *what* is failing is a comment.** Someone reading the issue
 *   needs to know the site came back but the functions did not; they do not
 *   need to know it was still down at 14:15, 14:30 and 14:45.
 * - **Recovery closes it with a comment**, so the timeline of an outage is the
 *   issue's own history.
 *
 * Warnings (a check that passed on retry, a health endpoint not deployed yet)
 * are in the run summary but never open anything.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DRY = process.argv.includes('--dry-run');
const REPO = process.env.GITHUB_REPOSITORY ?? 'mutaaf/18-0';
const RUN = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : 'a local run';
const LABEL = 'incident';
const TITLE_PREFIX = 'Monitor:';

if (!file) {
  console.error('usage: node scripts/monitor/incident.mjs <results.json> [--dry-run]');
  process.exit(2);
}

// A checks run that crashed before writing anything is itself an outage of the
// monitor, and is filed like any other -- once -- rather than failing this
// step every fifteen minutes with a stack trace nobody is emailed about twice.
let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  report = {
    at: new Date().toISOString(),
    site: process.env.MONITOR_SITE ?? 'https://18-0.co',
    results: [{ group: 'monitor', name: 'the checks ran', ok: false, detail: `no results: ${error.message}` }],
  };
}
const failing = report.results.filter((r) => !r.ok);
const warnings = report.results.filter((r) => r.ok && r.warn);

function gh(args, input) {
  if (DRY && !['list', 'view'].includes(args[1])) {
    console.log(`[dry run] gh ${args.join(' ')}`);
    return '';
  }
  const out = spawnSync('gh', [...args, '--repo', REPO], { encoding: 'utf8', input });
  if (out.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${out.stderr.trim()}`);
  return out.stdout;
}

const table = (rows) =>
  ['| | Check | Detail |', '|---|---|---|', ...rows.map((r) => `| ${r.ok ? (r.warn ? '⚠️' : '✅') : '❌'} | ${r.group}: ${r.name} | ${String(r.detail ?? '').replace(/\|/g, '\\|')} |`)].join('\n');

/** Which checks are failing, as a stable string, kept in the issue body. */
const signature = failing.map((r) => `${r.group}/${r.name}`).sort().join(';');
const marker = (sig) => `<!-- monitor:failing=${sig} -->`;

function body(since) {
  return [
    marker(signature),
    `**${failing.length} check${failing.length === 1 ? '' : 's'} failing** on ${report.site}, first seen ${since}, last checked ${report.at} (${RUN}).`,
    '',
    table(report.results),
    '',
    `What each check means and what to do about it: [docs/observability.md](https://github.com/${REPO}/blob/main/docs/observability.md#runbook).`,
    'Reproduce from a laptop: `node --env-file=apps/mobile/.env scripts/monitor/checks.mjs`.',
    '',
    'This issue closes itself when every check passes again.',
  ].join('\n');
}

// The run summary is written whatever happens, so a green run still shows its numbers.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Monitor ${failing.length ? '❌' : '✅'}\n\n${table(report.results)}\n`);
}

const open = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,title,body,createdAt', '--limit', '20']) || '[]')
  .filter((i) => i.title.startsWith(TITLE_PREFIX))
  .sort((a, b) => a.number - b.number)[0];

let exit = 0;
if (failing.length && !open) {
  // The label is created on first use rather than by hand, so a fresh fork or
  // a renamed repository does not fail the first real incident on a 422.
  gh(['label', 'create', LABEL, '--color', 'B60205', '--description', 'Opened and closed by the monitor workflow', '--force']);
  const title = `${TITLE_PREFIX} ${failing.length === 1 ? failing[0].name : `${failing.length} checks failing`}`;
  gh(['issue', 'create', '--title', title, '--label', LABEL, '--body-file', '-'], body(report.at));
  console.log(`Opened an incident: ${title}`);
  exit = 1;
} else if (failing.length && open) {
  const previous = /<!-- monitor:failing=(.*?) -->/.exec(open.body ?? '')?.[1] ?? '';
  const since = /first seen ([^,\s]+)/.exec(open.body ?? '')?.[1] ?? open.createdAt;
  gh(['issue', 'edit', String(open.number), '--body-file', '-'], body(since));
  if (previous !== signature) {
    gh(['issue', 'comment', String(open.number), '--body-file', '-'], `What is failing changed at ${report.at} (${RUN}):\n\n${table(failing)}`);
    console.log(`Incident #${open.number}: what is failing changed.`);
  } else {
    console.log(`Incident #${open.number}: still failing, body updated.`);
  }
} else if (!failing.length && open) {
  gh(['issue', 'comment', String(open.number), '--body-file', '-'], `Recovered: every check passed at ${report.at} (${RUN}).${warnings.length ? `\n\nStill warning:\n\n${table(warnings)}` : ''}`);
  gh(['issue', 'close', String(open.number), '--reason', 'completed']);
  console.log(`Incident #${open.number} closed: recovered.`);
} else {
  console.log(`All clear${warnings.length ? `, ${warnings.length} warning(s)` : ''}. No incident open.`);
}
process.exit(exit);
