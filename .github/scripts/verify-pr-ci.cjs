// Used only by the hosted develop deployment gate; never executes artifact contents.
module.exports = async function verifyPrCi({ github, context, workflow, artifactPrefix, requiredJobs }) {
  const fail = (message) => { throw new Error(`${message}. Update/retest the PR against develop; deployment will not rerun tests.`); };
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/develop') fail('Only develop pushes may deploy');
  const repo = context.repo;
  const fullName = `${repo.owner}/${repo.repo}`;
  const { data: tip } = await github.rest.git.getRef({ ...repo, ref: 'heads/develop' });
  if (tip.object.sha !== context.sha) fail('This develop push has been superseded');
  const prs = await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
    ...repo, commit_sha: context.sha, per_page: 100,
  });
  const candidates = prs.filter(pr => pr.merge_commit_sha === context.sha && pr.base.ref === 'develop');
  if (candidates.length !== 1) fail('No unique merged develop PR for this commit');
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: candidates[0].number });
  if (!pr.merged || pr.merge_commit_sha !== context.sha || pr.base.ref !== 'develop'
      || pr.head.repo?.full_name !== fullName) fail('PR provenance does not match this deployment');

  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo, workflow_id: workflow, event: 'pull_request', head_sha: pr.head.sha, per_page: 100,
  });
  const run = runs.filter(item => item.event === 'pull_request' && item.head_sha === pr.head.sha
    && item.head_repository?.full_name === fullName && item.path === `.github/workflows/${workflow}`)
    .sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') fail('Latest matching PR CI is not successful');
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo, run_id: run.id, filter: 'latest', per_page: 100,
  });
  for (const name of requiredJobs) {
    if (!jobs.some(job => job.name === name && job.conclusion === 'success')) fail(`Missing successful gate: ${name}`);
  }
  const { data: commit } = await github.rest.git.getCommit({ ...repo, commit_sha: context.sha });
  const tree = commit.tree.sha;
  const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...repo, run_id: run.id, per_page: 100,
  });
  const matches = artifacts.filter(item => item.name === `${artifactPrefix}-${tree}` && !item.expired
    && item.workflow_run?.id === run.id && item.workflow_run?.head_sha === pr.head.sha);
  if (matches.length !== 1) fail('No unexpired PR artifact for the exact merged Git tree');
  return { runId: run.id, artifactId: matches[0].id, tree, prNumber: pr.number };
};
