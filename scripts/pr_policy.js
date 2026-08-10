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
  "👋 Thanks for opening this! I've moved it back to **draft** for now 🤖",
  '',
  "We couldn't tell what kind of change this is: the **Type of change** section is either missing from the description, or none of its boxes is ticked in a form we recognise. We ask for it because new features need an agreed API before implementation, while bug fixes can go straight to review — and we can't tell which path this takes without it.",
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
  'Tick whatever applies — more than one is fine — then press **Ready for review** and I will check again. Nothing is lost: your branch, diff and review comments are all untouched.',
  '',
  `👉 [Contributing guidelines](${CONTRIBUTING})`,
].join('\n');

const NEEDS_ISSUE_COMMENT = [
  "👋 Thank you for this contribution! I've moved it back to **draft** for now 🤖",
  '',
  'This PR is marked as a **new feature**, and Slint is 1.0 with a stable public API: every API we merge, we maintain forever. So we like to agree on the API **first**, in an issue, before anyone writes the implementation. That’s to protect your time as much as ours — nothing is worse than finishing a feature and then hearing we can’t take it in that shape.',
  '',
  `👉 [Adding New Features](${CONTRIBUTING})`,
  '',
  "**Your work isn't lost** — the branch, the diff and any review comments are untouched. To pick it back up:",
  '',
  // The team handle stays in a code span on purpose: a live mention here would
  // notify the whole team on every rejection, which is spammable.
  `1. Open a ✨ [Feature Request](${FEATURE_REQUEST}) describing the API you have in mind (or find the existing issue), and ping \`@slint-ui/slint\` there`,
  "2. Once we've agreed on the shape of the API, edit this PR's description and fill in the issue number on the feature line: `- [x] ✨ New feature / public API change - discussed in: #1234`",
  '3. Press **Ready for review** and I will check again ♻️',
  '',
  '🐞 If this is actually a **bug fix** and not a new feature, tick the `Bug fix` box in the description instead — bug fixes need no issue.',
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
  'Please point the feature line at the issue where the API was discussed, then press **Ready for review**:',
  '',
  '`- [x] ✨ New feature / public API change - discussed in: #1234`',
  '',
  `👉 [Adding New Features](${CONTRIBUTING})`,
].join('\n');

const READY_COMMENT = '✨ Thanks for updating the description — this looks good now. A reviewer will take a look!';

// A Slint PR body routinely contains colours like `#8888`, which would otherwise
// read as issue references and wave the feature gate through.
const withoutCode = text => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

// The heading is matched loosely: a retyped or reworded one is a formatting slip.
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

function declaredKinds(body) {
  const kinds = new Set(typeOfChangeTicks(body).map(kindOf).filter(Boolean));
  return KINDS.filter(kind => kinds.has(kind)).map(kind => kind.label);
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

  // Draft state is not in the REST API, only in GraphQL.
  async function convertToDraft() {
    const mutation = `mutation($pullRequest: ID!) {
      convertPullRequestToDraft(input: { pullRequestId: $pullRequest }) { clientMutationId }
    }`;
    await github.graphql(mutation, { pullRequest: pullRequest.node_id });
  }

  // `marker` names a specific complaint. Those are said even when we otherwise stay
  // quiet, because an author who tried to fix something has to learn why it did not
  // work; the marker keeps it to once per distinct cause.
  async function reject(label, message, marker) {
    const otherRejection = label === NEEDS_TEMPLATE ? NEEDS_ISSUE : NEEDS_TEMPLATE;
    await removeLabel(otherRejection);
    await addLabels([label]);
    if (marker && !await alreadySaid(marker)) await comment(`${message}\n\n${marker}`);
    // An edit never drafts: otherwise editing the description of a pull request a
    // maintainer had marked ready would send it straight back to draft.
    if (wasEdited) return core.info('edited: labelling only, not converting to draft');
    if (!marker) await comment(message);
    core.info('converting to draft');
    if (!dryRun) await convertToDraft();
  }

  // Nothing to undo: the bot only ever sees a pull request the author has marked
  // ready again, so clearing the labels is all that is left.
  async function accept() {
    const rejections = [NEEDS_TEMPLATE, NEEDS_ISSUE].filter(label => presentLabels.has(label));
    if (!rejections.length) return;
    for (const label of rejections) await removeLabel(label);
    await comment(READY_COMMENT);
  }

  // Issues linked through the sidebar leave no trace in the body, so ask GitHub
  // for them rather than drafting a PR that did discuss the API.
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

  const declared = declaredKinds(body);
  core.info(`declared: ${declared.join(', ') || 'nothing'}`);
  for (const kind of KINDS) {
    if (!declared.includes(kind.label)) await removeLabel(kind.label);
  }
  await addLabels(declared);

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
