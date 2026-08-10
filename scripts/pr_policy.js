// Copyright © SixtyFPS GmbH <info@slint.dev>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0

// The body of the "PR Policy" workflow (.github/workflows/pr_policy.yaml). See
// CONTRIBUTING.md#adding-new-features for the policy itself.
//
// This lives outside the YAML so that it can be read, linted and tested like
// ordinary code. Tests: `node scripts/pr_policy_test.mjs`.
//
// The pull request description reaches this through the PR_BODY environment
// variable and is untrusted throughout: never log it (the runner reads stdout for
// workflow commands) and never interpolate it into anything that gets executed.

const FEATURE = 'kind:feature';
const KINDS = [
  { label: 'kind:bugfix', emoji: '🐞', keyword: /bug\s*fix/i },
  { label: FEATURE, emoji: '✨', keyword: /new feature/i },
  { label: 'kind:chore', emoji: '📚', keyword: /\bdocs?\b|\bci\b|\brefactor\b/i },
];
const NEEDS_TEMPLATE = 'needs template';
const NEEDS_ISSUE = 'needs issue';
const MAX_CANDIDATES = 20;
const CONTRIBUTING = 'https://github.com/slint-ui/slint/blob/master/CONTRIBUTING.md#adding-new-features';
const FEATURE_REQUEST = 'https://github.com/slint-ui/slint/issues/new?template=2-feature-request.yaml';

const NEEDS_TEMPLATE_COMMENT = [
  '👋 Thanks for opening this — and sorry for the automated close 🤖',
  '',
  "We couldn't tell what kind of change this is, because the **Type of change** section is missing from the description. We ask for it because new features need an agreed API before implementation, while bug fixes can go straight to review — and we can't tell which path this takes without it.",
  '',
  '**This takes about ten seconds to fix** ♻️ Edit the description and add:',
  '',
  // Kept in step with .github/pull_request_template.md — the test in
  // scripts/pr_policy_test.mjs fails if the two drift apart.
  '````markdown',
  '## Type of change',
  '',
  '- [ ] 🐞 Bug fix',
  '- [ ] 📚 Docs / CI / refactor (no public API change)',
  '- [ ] ✨ New feature / public API change - discussed in: #xxx',
  '````',
  '',
  "Tick whatever applies — more than one is fine — and I'll reopen this automatically. Your branch and diff are untouched.",
  '',
  `👉 [Contributing guidelines](${CONTRIBUTING})`,
].join('\n');

const NEEDS_ISSUE_COMMENT = [
  '👋 Thank you for this contribution — and sorry for the automated close 🤖',
  '',
  'This PR is marked as a **new feature**, and Slint is 1.0 with a stable public API: every API we merge, we maintain forever. So we like to agree on the API **first**, in an issue, before anyone writes the implementation. That’s to protect your time as much as ours — nothing is worse than finishing a feature and then hearing we can’t take it in that shape.',
  '',
  `👉 [Adding New Features](${CONTRIBUTING})`,
  '',
  "**Your work isn't lost** — the branch and the diff are untouched. To pick it back up:",
  '',
  // The team handle stays in a code span on purpose: a live mention here would
  // notify the whole team on every rejection, which is spammable.
  `1. Open a ✨ [Feature Request](${FEATURE_REQUEST}) describing the API you have in mind (or find the existing issue), and ping \`@slint-ui/slint\` there`,
  "2. Once we've agreed on the shape of the API, edit this PR's description and fill in the issue number on the feature line: `- [x] ✨ New feature / public API change - discussed in: #1234`",
  "3. I'll reopen this PR automatically ♻️",
  '',
  '🐞 If this is actually a **bug fix** and not a new feature, tick the `Bug fix` box in the description instead — bug fixes don’t need an issue, and I’ll reopen right away.',
].join('\n');

// Saying only "no issue referenced" to someone who plainly referenced something
// reads as the bot being broken, so name what was looked up and why it missed.
const unresolvedIssueComment = (attempted, repository) => [
  "👋 Thanks for the update — but I still can't find an issue for this feature 🤖",
  '',
  `I looked up ${attempted.map(reference => `\`${reference.text}\``).join(', ')} and found no matching **issue in \`${repository}\`**.`,
  '',
  'The usual reasons:',
  '',
  '- the number is a **pull request**, not an issue',
  `- the issue is in a **different repository** — it has to be an issue in \`${repository}\``,
  '- the number is a typo',
  '',
  'Please point the feature line at the issue where the API was discussed:',
  '',
  '`- [x] ✨ New feature / public API change - discussed in: #1234`',
  '',
  `👉 [Adding New Features](${CONTRIBUTING})`,
].join('\n');

const REOPENED_COMMENT = '✨ Thanks for updating the description — reopening! A reviewer will take a look.';
const MANUAL_REOPEN_COMMENT = '👋 Thanks for updating the description — that fixes it! I could not reopen this pull request automatically, so please reopen it yourself, or open a new one if the branch is gone.';

// A Slint PR body routinely contains colours like `#8888`, which would otherwise
// read as issue references and wave the feature gate through.
const withoutCode = text => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

// The heading is matched loosely: a retyped or reworded one is a formatting slip,
// not a reason to close someone's pull request.
// Strip the markdown decoration with one character class rather than matching
// around it: `\s*` on both sides of an optional group backtracks quadratically.
const isTypeOfChangeHeading = line => /^type of change\b/i.test(line.replace(/^[\s#*]+/, ''));

const startsNewSection = line => /^\s*(?:#{1,6}\s+|\*\*\w)/.test(line);
const isTickedBox = line => /^[ \t]*[-*][ \t]*\[[xX]\]/.test(line);

// Only the "Type of change" section, so that ticking an unrelated checklist item
// further down cannot be mistaken for a declaration.
function typeOfChangeTicks(body) {
  const lines = body.split(/\r?\n/);
  const headingIndex = lines.findIndex(isTypeOfChangeHeading);
  if (headingIndex < 0) return [];
  const section = lines.slice(headingIndex + 1);
  const endIndex = section.findIndex(startsNewSection);
  return (endIndex < 0 ? section : section.slice(0, endIndex)).filter(isTickedBox);
}

// The emoji wins where there is one: the descriptions overlap in wording, so
// keywords are only a fallback for a retyped section.
const kindOf = line =>
  KINDS.find(kind => line.includes(kind.emoji)) || KINDS.find(kind => kind.keyword.test(line));

// `declared` and `ticked` differ when the section was reworded: an unrecognised
// tick is still a declaration, so it must not be read as a missing template.
function declaration(body) {
  const ticks = typeOfChangeTicks(body);
  const kinds = new Set(ticks.map(kindOf).filter(Boolean));
  return {
    declared: KINDS.filter(kind => kinds.has(kind)).map(kind => kind.label),
    ticked: ticks.length > 0,
  };
}

// Which reference survives the cap below: a changelog-style body can list twenty
// numbers before it gets to the one that matters.
const INTRODUCED_BY_KEYWORD = /(?:discussed in|fixes|closes|resolves|refs?|see)[\s:]*$/i;

// `repository: null` means a bare `#123`, which always means this repository. The
// owner and repository are captured rather than assumed, so a reference to another
// repository is not looked up here under the same number.
const REFERENCE_PATTERNS = [
  /([\w.-]+)\/([\w.-]+)#(\d+)\b/g,
  /github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b/g,
  /(?:^|[^\w/])#(\d+)\b/gm,
];

function references(text) {
  const found = [];
  for (const pattern of REFERENCE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const [owner, repository, number] = match.length === 4 ? match.slice(1) : [null, null, match[1]];
      found.push({
        text: owner ? `${owner}/${repository}#${number}` : `#${number}`,
        repository: owner && `${owner}/${repository}`,
        number: Number(number),
        deliberate: INTRODUCED_BY_KEYWORD.test(text.slice(Math.max(0, match.index - 24), match.index)),
      });
    }
  }
  return found;
}

module.exports = async ({ github, context, core }) => {
  const pullRequest = context.payload.pull_request;
  const pullRequestNumber = pullRequest.number;
  const dryRun = process.env.DRY_RUN === 'true';
  const wasEdited = context.payload.action === 'edited';
  const issueTarget = { ...context.repo, issue_number: pullRequestNumber };
  const pullTarget = { ...context.repo, pull_number: pullRequestNumber };
  const presentLabels = new Set(pullRequest.labels.map(label => label.name));
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  const body = withoutCode(process.env.PR_BODY || '');

  async function addLabels(labels) {
    const missing = labels.filter(label => !presentLabels.has(label));
    if (!missing.length) return;
    core.info(`add labels: ${missing.join(', ')}`);
    if (!dryRun) await github.rest.issues.addLabels({ ...issueTarget, labels: missing });
  }

  async function removeLabel(label) {
    if (!presentLabels.has(label)) return;
    core.info(`remove label: ${label}`);
    if (dryRun) return;
    try {
      await github.rest.issues.removeLabel({ ...issueTarget, name: label });
    } catch (error) {
      // Someone removed it between the webhook and this run.
      if (error.status !== 404) throw error;
    }
  }

  async function comment(message) {
    core.info(`comment:\n${message}`);
    if (!dryRun) await github.rest.issues.createComment({ ...issueTarget, body: message });
  }

  async function alreadySaid(marker) {
    const posted = await github.paginate(github.rest.issues.listComments, { ...issueTarget, per_page: 100 });
    return posted.some(posting => (posting.body || '').includes(marker));
  }

  // `marker` names a specific complaint. Those are said even when we otherwise stay
  // quiet, because an author who tried to fix something has to learn why it did not
  // work; the marker keeps it to once per distinct cause.
  async function reject(label, message, marker) {
    const otherRejection = label === NEEDS_TEMPLATE ? NEEDS_ISSUE : NEEDS_TEMPLATE;
    await removeLabel(otherRejection);
    await addLabels([label]);
    if (marker && !await alreadySaid(marker)) await comment(`${message}\n\n${marker}`);
    // A draft is explicitly work in progress; ready_for_review runs this check again.
    if (pullRequest.draft) return core.info('draft: deferring until ready for review');
    // An edit never closes: otherwise editing the description of a pull request
    // a maintainer had reopened would close it straight back.
    if (wasEdited) return core.info('edited: labelling only, not closing');
    // Being closed already is the record that we reported this, which the label
    // is not: a draft and an edit both label without commenting.
    if (pullRequest.state === 'closed') return core.info('already closed');
    if (!marker) await comment(message);
    core.info('closing');
    if (!dryRun) await github.rest.pulls.update({ ...pullTarget, state: 'closed' });
  }

  async function accept() {
    const rejections = [NEEDS_TEMPLATE, NEEDS_ISSUE].filter(label => presentLabels.has(label));
    if (!rejections.length) return;
    if (pullRequest.state !== 'closed') {
      for (const label of rejections) await removeLabel(label);
      return;
    }
    core.info('reopening');
    if (dryRun) return;
    // Reopen before clearing the labels: if the fork branch is gone the reopen
    // fails, and the labels are the only record of why it is closed.
    try {
      await github.rest.pulls.update({ ...pullTarget, state: 'open' });
    } catch (error) {
      core.warning(`could not reopen: ${error.message}`);
      return comment(MANUAL_REOPEN_COMMENT);
    }
    for (const label of rejections) await removeLabel(label);
    await comment(REOPENED_COMMENT);
  }

  // Issues linked through the sidebar leave no trace in the body, so ask GitHub
  // for them rather than closing a PR that did discuss the API.
  async function linkedIssues() {
    const query = `query($owner:String!, $repo:String!, $number:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) {
          closingIssuesReferences(first: 20) { nodes { number } }
        }
      }
    }`;
    try {
      const result = await github.graphql(query, { ...context.repo, number: pullRequestNumber });
      return result.repository.pullRequest.closingIssuesReferences.nodes.map(node => node.number);
    } catch (error) {
      core.warning(`could not read linked issues: ${error.message}`);
      return [];
    }
  }

  async function referencedHere() {
    const commits = await github.paginate(github.rest.pulls.listCommits, { ...pullTarget, per_page: 100 });
    const text = [body, ...commits.map(commit => withoutCode(commit.commit.message))].join('\n');
    const linked = (await linkedIssues()).map(number => ({ text: `#${number}`, number, deliberate: true }));
    const cited = references(text).filter(reference => reference.number !== pullRequestNumber);

    const here = reference => !reference.repository || reference.repository.toLowerCase() === repository.toLowerCase();
    const mine = [...linked, ...cited.filter(here)].sort((a, b) => b.deliberate - a.deliberate);
    const seen = new Set();
    return {
      candidates: mine.filter(reference => !seen.has(reference.number) && seen.add(reference.number)),
      elsewhere: cited.filter(reference => !here(reference)),
    };
  }

  // Referencing an issue is what shows the API was discussed, so a reference to
  // another pull request does not count.
  async function isIssue(number) {
    try {
      const { data } = await github.rest.issues.get({ ...context.repo, issue_number: number });
      return !data.pull_request;
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
      return false;
    }
  }

  // Returns the references that were tried and missed, or null once one resolves.
  async function unresolvedReferences() {
    const { candidates, elsewhere } = await referencedHere();
    // One API call per candidate, and the body is untrusted: a description full of
    // `#1 #2 #3 ...` would otherwise burn the whole repository's hourly rate limit.
    const checkable = candidates.slice(0, MAX_CANDIDATES);
    for (const reference of checkable) {
      if (await isIssue(reference.number)) {
        core.info(`references issue #${reference.number}`);
        return null;
      }
    }
    if (candidates.length > checkable.length) {
      core.warning(`gave up after ${MAX_CANDIDATES} of ${candidates.length} referenced numbers`);
    }
    return [...checkable, ...elsewhere];
  }

  const { declared, ticked } = declaration(body);
  core.info(`declared: ${declared.join(', ') || 'nothing'}${ticked ? '' : ' (nothing ticked)'}`);
  for (const kind of KINDS) {
    if (!declared.includes(kind.label)) await removeLabel(kind.label);
  }
  await addLabels(declared);

  // Something was ticked but the wording was changed past recognition. That is a
  // formatting slip, so leave it to the reviewer.
  if (!declared.length && ticked) {
    return core.warning('a box is ticked but none of the kinds could be recognised');
  }
  if (!declared.length) return reject(NEEDS_TEMPLATE, NEEDS_TEMPLATE_COMMENT);
  if (!declared.includes(FEATURE)) return accept();

  const unresolved = await unresolvedReferences();
  if (!unresolved) return accept();
  if (!unresolved.length) return reject(NEEDS_ISSUE, NEEDS_ISSUE_COMMENT);

  const shown = unresolved.slice(0, 5);
  return reject(
    NEEDS_ISSUE,
    unresolvedIssueComment(shown, repository),
    `<!-- pr-policy:unresolved ${shown.map(reference => reference.text).join(' ')} -->`,
  );
};
