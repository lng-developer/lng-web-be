const assert = require('node:assert/strict');
const { test } = require('node:test');
const verify = require('./verify-pr-ci.cjs');

function fixture() {
  const pr = { number: 42, merged: true, merge_commit_sha: 'merged', base: { ref: 'develop' }, head: { sha: 'head', repo: { full_name: 'org/repo' } } };
  const run = { id: 7, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: 'head', head_repository: { full_name: 'org/repo' }, path: '.github/workflows/ci.yml', run_attempt: 1 };
  const artifact = { id: 8, name: 'build-tree123', expired: false, workflow_run: { id: 7, head_sha: 'head' } };
  const jobs = [{ name: 'test', conclusion: 'success' }, { name: 'build', conclusion: 'success' }];
  const state = { prs: [pr], runs: [run], artifacts: [artifact], jobs, tip: 'merged' };
  const github = { rest: { repos: { listPullRequestsAssociatedWithCommit: 'prs' },
    pulls: { get: async () => ({ data: state.prs[0] }) },
    git: { getCommit: async () => ({ data: { tree: { sha: 'tree123' } } }), getRef: async () => ({ data: { object: { sha: state.tip } } }) },
    actions: { listWorkflowRuns: 'runs', listJobsForWorkflowRun: 'jobs', listWorkflowRunArtifacts: 'artifacts' } },
    paginate: async (method) => state[method],
  };
  const args = { github, context: { repo: { owner: 'org', repo: 'repo' }, sha: 'merged', eventName: 'push', ref: 'refs/heads/develop' },
    workflow: 'ci.yml', artifactPrefix: 'build', requiredJobs: ['test', 'build'] };
  return { state, args, pr, run, artifact };
}

test('merge commit with identical tested tree selects immutable PR artifact', async () => {
  const { args } = fixture();
  assert.deepEqual(await verify(args), { runId: 7, artifactId: 8, tree: 'tree123', prNumber: 42 });
});
for (const [name, change] of [
  ['direct push', f => { f.state.prs = []; }],
  ['unmerged PR', f => { f.pr.merged = false; }],
  ['different merge SHA', f => { f.pr.merge_commit_sha = 'other'; }],
  ['different base', f => { f.pr.base.ref = 'main'; }],
  ['fork', f => { f.pr.head.repo.full_name = 'other/repo'; }],
  ['wrong head', f => { f.run.head_sha = 'old'; }],
  ['manual run', f => { f.run.event = 'workflow_dispatch'; }],
  ['failed run', f => { f.run.conclusion = 'failure'; }],
  ['wrong workflow', f => { f.run.path = '.github/workflows/other.yml'; }],
  ['wrong run repository', f => { f.run.head_repository.full_name = 'other/repo'; }],
  ['skipped gate', f => { f.state.jobs[0].conclusion = 'skipped'; }],
  ['missing gate', f => { f.state.jobs.pop(); }],
  ['different tested tree', f => { f.artifact.name = 'build-other-tree'; }],
  ['expired artifact', f => { f.artifact.expired = true; }],
  ['artifact wrong run', f => { f.artifact.workflow_run.id = 9; }],
  ['stale develop push', f => { f.state.tip = 'newer'; }],
  ['manual event', f => { f.args.context.eventName = 'workflow_dispatch'; }],
]) {
  test(`rejects ${name}`, async () => {
    const f = fixture(); change(f);
    await assert.rejects(verify(f.args));
  });
}
