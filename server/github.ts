import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export interface PRSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  head: string;
  /** owner/repo the head branch lives in (differs for forks). */
  headRepo: string;
}

/** Everything the agent can do on GitHub. No merge, delete, or force-push exists. */
export interface GitHubPort {
  /** owner/repo this port is pinned to. */
  readonly fullName: string;
  readFile(path: string, ref?: string): Promise<string>;
  listDir(path: string, ref?: string): Promise<string[]>;
  listPRs(): Promise<PRSummary[]>;
  getPR(number: number): Promise<PRSummary & { body: string }>;
  getCheckRuns(number: number): Promise<{ name: string; status: string; conclusion: string | null }[]>;
  createBranch(name: string): Promise<void>;
  commitFiles(branch: string, message: string, files: { path: string; content: string }[]): Promise<string>;
  openDraftPR(head: string, title: string, body: string): Promise<{ number: number; url: string }>;
  commentPR(number: number, body: string): Promise<void>;
}

export interface GitHubConfig {
  appId: string;
  privateKey: string;
  installationId: number;
  owner: string;
  repo: string;
  baseBranch: string;
}

export function createGitHub(cfg: GitHubConfig): GitHubPort {
  // Installation tokens are minted and refreshed by the auth strategy; the repo
  // is pinned here so no tool can name a different one.
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: cfg.appId, privateKey: cfg.privateKey, installationId: cfg.installationId },
  });
  const { owner, repo, baseBranch } = cfg;

  const toSummary = (p: {
    number: number;
    title: string;
    state: string;
    draft?: boolean;
    html_url: string;
    head: { ref: string; repo: { full_name: string } | null };
  }): PRSummary => ({
    number: p.number,
    title: p.title,
    state: p.state,
    draft: Boolean(p.draft),
    url: p.html_url,
    head: p.head.ref,
    headRepo: p.head.repo?.full_name ?? '',
  });

  return {
    fullName: `${owner}/${repo}`,
    async readFile(path, ref) {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref: ref ?? baseBranch });
      if (Array.isArray(data) || data.type !== 'file') throw new Error(`${path} is not a file`);
      return Buffer.from(data.content, 'base64').toString('utf8');
    },
    async listDir(path, ref) {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref: ref ?? baseBranch });
      if (!Array.isArray(data)) throw new Error(`${path} is not a directory`);
      return data.map((e) => (e.type === 'dir' ? `${e.name}/` : e.name));
    },
    async listPRs() {
      const { data } = await octokit.pulls.list({ owner, repo, state: 'open', per_page: 30 });
      return data.map(toSummary);
    },
    async getPR(number) {
      const { data } = await octokit.pulls.get({ owner, repo, pull_number: number });
      return { ...toSummary(data), body: data.body ?? '' };
    },
    async getCheckRuns(number) {
      const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: number });
      const { data } = await octokit.checks.listForRef({ owner, repo, ref: pr.head.sha });
      return data.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
    },
    async createBranch(name) {
      const { data: base } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
      await octokit.git.createRef({ owner, repo, ref: `refs/heads/${name}`, sha: base.object.sha });
    },
    async commitFiles(branch, message, files) {
      const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
      const { data: parent } = await octokit.git.getCommit({ owner, repo, commit_sha: ref.object.sha });
      const { data: tree } = await octokit.git.createTree({
        owner,
        repo,
        base_tree: parent.tree.sha,
        tree: files.map((f) => ({ path: f.path, mode: '100644' as const, type: 'blob' as const, content: f.content })),
      });
      const { data: commit } = await octokit.git.createCommit({
        owner,
        repo,
        message,
        tree: tree.sha,
        parents: [parent.sha],
      });
      // force: false — a non-fast-forward update is refused by GitHub.
      await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha, force: false });
      return commit.sha;
    },
    async openDraftPR(head, title, body) {
      const { data } = await octokit.pulls.create({ owner, repo, head, base: baseBranch, title, body, draft: true });
      return { number: data.number, url: data.html_url };
    },
    async commentPR(number, body) {
      await octokit.issues.createComment({ owner, repo, issue_number: number, body });
    },
  };
}
