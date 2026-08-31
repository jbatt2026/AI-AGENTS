export type TabType = 'workbench' | 'manifest' | 'auth' | 'scripts' | 'docs';

export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: {
    url: string;
    active: boolean;
  };
  redirect_url: string;
  description: string;
  public: boolean;
  default_permissions: Record<string, 'read' | 'write' | 'none'>;
  default_events: string[];
}

export interface AgentCredentials {
  appId: string;
  installationId: string;
  privateKey: string;
  targetRepo: string;
  webhookSecret: string;
}

export interface AgentTask {
  id: string;
  title: string;
  agent: 'Claude Code' | 'Hermes' | 'Gemini Agent' | 'Custom Bot';
  branch: string;
  description: string;
  filesChanged: {
    path: string;
    action: 'created' | 'modified' | 'deleted';
    diff: string;
  }[];
  prTitle: string;
  prBody: string;
  labels: string[];
}

export interface PRStepStatus {
  step: 'auth' | 'branch' | 'commit' | 'pr' | 'ci';
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  timestamp?: string;
  details?: string;
}

export interface SimulatedPR {
  id: number;
  number: number;
  title: string;
  author: string;
  branch: string;
  targetBranch: string;
  status: 'open' | 'merged' | 'closed';
  createdAt: string;
  body: string;
  labels: string[];
  checksStatus: 'pending' | 'passing' | 'failing';
  files: {
    path: string;
    additions: number;
    deletions: number;
    diff: string;
  }[];
}
