// Copyright © SixtyFPS GmbH <info@slint.dev>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0

// Tests for scripts/pr_policy.js, the body of the "PR Policy" workflow.
//
// A pull_request_target workflow only ever runs from the default branch, so the
// bot cannot be exercised by the pull request that changes it. These tests run
// the real module against a mocked API instead.
//
//     node scripts/pr_policy_test.mjs

import { readFileSync } from 'node:fs';
import policy from './pr_policy.js';

// Resolved against this file, not the working directory, so the tests run from
// anywhere now that they no longer sit next to what they read.
const inRepo = path => new URL(`../${path}`, import.meta.url);

const WORKFLOW = inRepo('.github/workflows/pr_policy.yaml');
const TEMPLATE = readFileSync(inRepo('.github/pull_request_template.md'), 'utf8');
const PULL_NUMBER = 500;

// In the fake repository 100 is an issue, 200 is a pull request, everything else
// is absent. Numbers are what the bot extracts from an untrusted description.
const REPO_ISSUES = { 100: {}, 200: { pull_request: {} } };

function fakeGithub({ calls, commits, linked, reopenFails }) {
    return {
        paginate: async (route, options) => (await route(options)).data,
        graphql: async () => ({
            repository: { pullRequest: { closingIssuesReferences: { nodes: linked.map(number => ({ number })) } } },
        }),
        rest: {
            issues: {
                addLabels: async ({ labels }) => calls.push(['addLabels', labels]),
                removeLabel: async ({ name }) => calls.push(['removeLabel', name]),
                createComment: async ({ body }) => calls.push(['comment', body]),
                get: async ({ issue_number }) => {
                    if (!REPO_ISSUES[issue_number]) {
                        throw Object.assign(new Error('Not Found'), { status: 404 });
                    }
                    return { data: REPO_ISSUES[issue_number] };
                },
            },
            pulls: {
                listCommits: async () => ({ data: commits.map(message => ({ commit: { message } })) }),
                update: async ({ state }) => {
                    if (state === 'open' && reopenFails) {
                        throw Object.assign(new Error('branch is gone'), { status: 422 });
                    }
                    calls.push(['update', state]);
                },
            },
        },
    };
}

async function run({
    body = '', labels = [], state = 'open', draft = false, commits = [],
    dryRun = false, action = 'opened', linked = [], reopenFails = false,
} = {}) {
    const calls = [];
    const core = {
        info: message => calls.push(['info', message]),
        warning: message => calls.push(['warning', message]),
        setFailed: message => calls.push(['setFailed', message]),
    };
    const github = fakeGithub({ calls, commits, linked, reopenFails });
    const context = {
        repo: { owner: 'slint-ui', repo: 'slint' },
        payload: {
            action,
            pull_request: { number: PULL_NUMBER, state, draft, labels: labels.map(name => ({ name })) },
        },
    };
    process.env.PR_BODY = body;
    process.env.DRY_RUN = dryRun ? 'true' : '';
    await policy({ github, context, core });
    return calls;
}

// Tick the template boxes carrying the given emoji. The `u` flag matters: 🐞 and
// 📚 are surrogate pairs, so a bare `.` would capture half of one.
function tick(text, ...emojis) {
    return text.replace(/^- \[ \] (.)/gmu, (line, first) =>
        emojis.includes(first) ? line.replace('[ ]', '[x]') : line);
}

function withIssue(text, number) {
    return text.replace('discussed in: #xxx', `discussed in: #${number}`);
}

const COMMENT_KINDS = [
    [/could not reopen/, 'manual-reopen'],
    [/Type of change/, 'needs-template'],
    [/new feature/, 'needs-issue'],
    [/.*/, 'reopened'],
];

const commentKind = text => COMMENT_KINDS.find(([pattern]) => pattern.test(text))[1];

function describeCall([kind, value]) {
    if (kind === 'info') return null;
    if (kind === 'comment') return `comment(${commentKind(value)})`;
    return `${kind}(${Array.isArray(value) ? value.join('+') : value})`;
}

const summary = calls => calls.map(describeCall).filter(Boolean).join(' ');

const cases = [];
const add = (name, options, expected) => cases.push({ name, options, expected });

const CLOSED_NO_ISSUE = 'addLabels(kind:feature) addLabels(needs issue) comment(needs-issue) update(closed)';
const CLOSED_NO_TEMPLATE = 'addLabels(needs template) comment(needs-template) update(closed)';

// --- the template as contributors actually receive it ---------------------

add('untouched template', { body: TEMPLATE }, CLOSED_NO_TEMPLATE);
add('bugfix only', { body: tick(TEMPLATE, '🐞') }, 'addLabels(kind:bugfix)');
add('chore only', { body: tick(TEMPLATE, '📚') }, 'addLabels(kind:chore)');
add('feature, issue left as #xxx', { body: tick(TEMPLATE, '✨') }, CLOSED_NO_ISSUE);
add('feature with the issue filled in',
    { body: withIssue(tick(TEMPLATE, '✨'), 100) }, 'addLabels(kind:feature)');
add('feature and bugfix', { body: tick(TEMPLATE, '✨', '🐞') },
    `addLabels(kind:bugfix+kind:feature) ${CLOSED_NO_ISSUE.replace('addLabels(kind:feature) ', '')}`);
add('all three ticked', { body: tick(TEMPLATE, '🐞', '📚', '✨') },
    'addLabels(kind:bugfix+kind:feature+kind:chore) addLabels(needs issue) comment(needs-issue) update(closed)');
add('only the checklist ticked', { body: TEMPLATE.replace(/- \[ \] If/g, '- [x] If') }, CLOSED_NO_TEMPLATE);

// --- what counts as referencing an issue ----------------------------------

add('reference to a pull request does not count',
    { body: withIssue(tick(TEMPLATE, '✨'), 200) }, CLOSED_NO_ISSUE);
add('reference to a missing issue does not count',
    { body: withIssue(tick(TEMPLATE, '✨'), 999) }, CLOSED_NO_ISSUE);
add('self-reference does not count',
    { body: withIssue(tick(TEMPLATE, '✨'), PULL_NUMBER) }, CLOSED_NO_ISSUE);
add('issue in a commit message counts',
    { body: tick(TEMPLATE, '✨'), commits: ['core: do a thing\n\nFixes #100'] }, 'addLabels(kind:feature)');
add('issue linked through the sidebar counts',
    { body: tick(TEMPLATE, '✨'), linked: [100] }, 'addLabels(kind:feature)');
add('issue as a full URL counts',
    { body: tick(TEMPLATE, '✨') + '\nSee https://github.com/slint-ui/slint/issues/100\n' },
    'addLabels(kind:feature)');
add('owner/repo#n shorthand counts',
    { body: tick(TEMPLATE, '✨') + '\nDiscussed in slint-ui/slint#100\n' }, 'addLabels(kind:feature)');

// --- untrusted input ------------------------------------------------------

add('a colour in a code fence is not a reference',
    { body: tick(TEMPLATE, '✨') + '\n```slint\nText { color: #100; background: #8888; }\n```\n' },
    CLOSED_NO_ISSUE);
add('a colour in inline code is not a reference',
    { body: tick(TEMPLATE, '✨') + '\nUse `#100` for the colour.\n' }, CLOSED_NO_ISSUE);
add('workflow commands in the body never reach the log',
    { body: '## Type of change\n\n- [x] 🐞 Bug fix\n\n::error::pwned\n::stop-commands::x\n' },
    'addLabels(kind:bugfix)');
add('a whitespace flood does not stall the job', { body: ' '.repeat(65536) + '\n' }, CLOSED_NO_TEMPLATE);
{
    const decoys = Array.from({ length: 500 }, (_, index) => `#${9000 + index}`).join(' ');
    add('reference spam is capped',
        { body: tick(TEMPLATE, '✨') + '\n' + decoys },
        'addLabels(kind:feature) warning(gave up after 20 of 500 referenced numbers) addLabels(needs issue) comment(needs-issue) update(closed)');
    add('a deliberate reference outranks decoys',
        { body: tick(TEMPLATE, '✨') + '\n' + decoys + '\nDiscussed in: #100\n' },
        'addLabels(kind:feature)');
    add('a sidebar link outranks decoys',
        { body: tick(TEMPLATE, '✨') + '\n' + decoys, linked: [100] }, 'addLabels(kind:feature)');
}

// --- a reworded section is a formatting slip, not grounds for closing -----

add('heading with a trailing colon', { body: '## Type of change:\n\n- [x] 🐞 Bug fix\n' }, 'addLabels(kind:bugfix)');
add('heading with a parenthetical', { body: '## Type of Change (tick one)\n\n- [x] 🐞 Bug fix\n' }, 'addLabels(kind:bugfix)');
add('bold pseudo-heading', { body: '**Type of change**\n\n- [x] 🐞 Bug fix\n' }, 'addLabels(kind:bugfix)');
add('level-one heading', { body: '# Type of change\n\n- [x] 🐞 Bug fix\n' }, 'addLabels(kind:bugfix)');
add('uppercase X, asterisk bullet, level-three heading',
    { body: '### Type of change\n\n* [X] 🐞 Bug fix\n' }, 'addLabels(kind:bugfix)');
add('CRLF line endings', { body: '## Type of change\r\n\r\n- [x] 🐞 Bug fix\r\n' }, 'addLabels(kind:bugfix)');
add('emoji deleted, keyword kept', { body: '## Type of change\n\n- [x] Bug fix\n' }, 'addLabels(kind:bugfix)');
add('a tick nobody can classify is left to the reviewer',
    { body: '## Type of change\n\n- [x] Something else entirely\n' },
    'warning(a box is ticked but none of the kinds could be recognised)');

// --- drafts, edits and recovery -------------------------------------------

add('a draft is labelled but never closed',
    { body: tick(TEMPLATE, '✨'), draft: true }, 'addLabels(kind:feature) addLabels(needs issue)');
add('a draft without a template is never closed',
    { body: 'nope', draft: true }, 'addLabels(needs template)');
add('marking a draft ready applies the gate',
    { action: 'ready_for_review', body: tick(TEMPLATE, '✨'), labels: ['kind:feature', 'needs issue'] },
    'comment(needs-issue) update(closed)');
add('recovering from needs issue',
    { action: 'edited', body: withIssue(tick(TEMPLATE, '✨'), 100), labels: ['kind:feature', 'needs issue'], state: 'closed' },
    'update(open) removeLabel(needs issue) comment(reopened)');
add('recovering from needs template',
    { action: 'edited', body: tick(TEMPLATE, '🐞'), labels: ['needs template'], state: 'closed' },
    'addLabels(kind:bugfix) update(open) removeLabel(needs template) comment(reopened)');
add('a feature downgraded to a chore is reopened',
    { action: 'edited', body: tick(TEMPLATE, '📚'), labels: ['kind:feature', 'needs issue'], state: 'closed' },
    'removeLabel(kind:feature) addLabels(kind:chore) update(open) removeLabel(needs issue) comment(reopened)');
add('an edit that still fails does not comment twice',
    { action: 'edited', body: tick(TEMPLATE, '✨'), labels: ['kind:feature', 'needs issue'], state: 'closed' }, '');
add('a changed rejection reason swaps the label',
    { action: 'edited', body: tick(TEMPLATE, '✨'), labels: ['needs template'], state: 'closed' },
    'addLabels(kind:feature) removeLabel(needs template) addLabels(needs issue)');
add('an edit never closes a pull request a maintainer reopened',
    { action: 'edited', body: tick(TEMPLATE, '✨'), labels: ['kind:feature'], state: 'open' },
    'addLabels(needs issue)');
add('a maintainer close is not undone',
    { body: tick(TEMPLATE, '🐞'), labels: ['kind:bugfix'], state: 'closed' }, '');
add('a failed reopen keeps the label and explains itself',
    { action: 'edited', body: tick(TEMPLATE, '🐞'), labels: ['needs template'], state: 'closed', reopenFails: true },
    'addLabels(kind:bugfix) warning(could not reopen: branch is gone) comment(manual-reopen)');
add('a dry run writes nothing', { body: tick(TEMPLATE, '✨'), dryRun: true }, '');

let checks = 0;
let failures = 0;

function check(name, problems) {
    checks++;
    if (!problems.length) return console.log(`ok   ${name}`);
    failures += problems.length;
    for (const problem of problems) console.log(`FAIL ${problem}`);
}

for (const { name, options, expected } of cases) {
    let actual;
    try {
        actual = summary(await run(options));
    } catch (error) {
        actual = `THREW ${error.message}`;
    }
    check(name, actual === expected ? []
        : [`${name}\n       expected: ${expected || '(nothing)'}\n       actual:   ${actual || '(nothing)'}`]);
}

// The workflow holds a write-scoped token under pull_request_target, so checking
// out anything the pull request author controls would hand it to them. Under that
// trigger `actions/checkout` defaults to the base branch, and the only way to lose
// that is to add a `ref:`.
// Comments are stripped first: this file explains in prose what must never be
// configured, and that prose must not itself trip the check.
const workflow = readFileSync(WORKFLOW, 'utf8')
    .split('\n')
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n');
const DANGEROUS = [
    [/^\s*ref:/m, 'the checkout has a `ref:` — under pull_request_target that can select PR head'],
    [/head\.(sha|ref)/, 'the workflow references the pull request head'],
    [/script:\s*\|[\s\S]*?\$\{\{/, 'a ${{ }} expression appears inside the script block'],
];
check('the workflow checks out no pull request code and interpolates nothing into the script',
    DANGEROUS.filter(([pattern]) => pattern.test(workflow)).map(([, complaint]) => complaint));

const comments = [];
for (const options of [
    { body: 'no template here' },
    { body: tick(TEMPLATE, '✨') },
    { action: 'edited', body: tick(TEMPLATE, '🐞'), labels: ['needs template'], state: 'closed' },
]) {
    for (const [kind, value] of await run(options)) if (kind === 'comment') comments.push(value);
}

// The bot cannot read the template at runtime — there is no checkout — so it
// quotes the checkbox lines literally. Catch the two drifting apart here.
function typeOfChangeBoxes() {
    const lines = TEMPLATE.split('\n');
    const start = lines.findIndex(line => /^#+\s*Type of change/i.test(line));
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => /^#+\s/.test(line));
    return (end < 0 ? rest : rest.slice(0, end)).filter(line => line.startsWith('- [ ] '));
}

const templateBoxes = typeOfChangeBoxes();
const quoted = comments.find(text => text.includes('## Type of change'));
const missing = templateBoxes.filter(line => !quoted?.includes(line));
check(`the needs-template comment quotes the template verbatim (${templateBoxes.length} boxes)`,
    missing.length ? [`the needs-template comment no longer matches the template\n       missing: ${missing.join('  |  ')}`] : []);

// A live @mention would notify the whole team on every rejection, and anyone can
// trigger a rejection by opening a pull request.
const mentioning = comments.filter(text => /(^|[^`\w])@[\w-]+/.test(text.replace(/`[^`]*`/g, '')));
check(`no bot comment mentions anyone (${comments.length} checked)`,
    mentioning.length ? [`a bot comment mentions someone\n${mentioning.join('\n---\n')}`] : []);

console.log(`\n${checks - failures}/${checks} passed`);
process.exit(failures ? 1 : 0);
