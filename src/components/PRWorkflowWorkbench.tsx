import React, { useState } from 'react';
import { GitPullRequest, Play, CheckCircle2, XCircle, Clock, RefreshCw, ShieldCheck, GitMerge, FileText } from 'lucide-react';
import { AgentTask, PRStepStatus, SimulatedPR } from '../types';

const INITIAL_TASKS: AgentTask[] = [
  {
    id: 'task-1',
    title: 'TypeScript Typecheck & Build Automation',
    agent: 'Claude Code',
    branch: 'agent/claude-ts-build-system',
    description: 'Configure standard TypeScript compiler options, Vite dev server, and package scripts.',
    filesChanged: [
      {
        path: 'package.json',
        action: 'modified',
        diff: '+\n+    "dev": "vite --host 0.0.0.0 --port 3000",\n+    "build": "vite build",\n+    "preview": "vite preview"',
      },
      {
        path: 'tsconfig.json',
        action: 'created',
        diff: '+{\n+  "compilerOptions": {\n+    "target": "ES2020",\n+    "module": "ESNext",\n+    "strict": true\n+  }\n+}',
      },
    ],
    prTitle: 'feat(build): setup vite development server and strict typescript build',
    prBody: 'Sets up the development and production build pipeline for AI-AGENTS.\n\n### Changes\n- Added Vite dev server binding to port 3000\n- Added tsconfig with strict typechecking\n\n> Generated with [Claude Code](https://claude.ai/code) / [AI-AGENTS](https://github.com/jbatt2026/AI-AGENTS)\n> Co-Authored-By: Claude <noreply@anthropic.com>',
    labels: ['automated-pr', 'enhancement', 'build'],
  },
  {
    id: 'task-2',
    title: 'GitHub App Installation & Manifest Specification',
    agent: 'Hermes',
    branch: 'agent/hermes-manifest-specs',
    description: 'Create .github/GITHUB_APP_MANIFEST.json and comprehensive INSTALL_GITHUB_APP.md documentation.',
    filesChanged: [
      {
        path: '.github/GITHUB_APP_MANIFEST.json',
        action: 'created',
        diff: '+{\n+  "name": "ai-agents-bot",\n+  "default_permissions": { "contents": "write", "pull_requests": "write" }\n+}',
      },
      {
        path: 'INSTALL_GITHUB_APP.md',
        action: 'created',
        diff: '+# Installing and Configuring the GitHub App for AI Agents\n+Step-by-step setup for Hermes, Claude Code, and Gemini agents.',
      },
    ],
    prTitle: 'docs(app): add GitHub App manifest and step-by-step install guide',
    prBody: 'Creates the official GitHub App manifest template and step-by-step setup instructions for AI agents.\n\n> Generated with [Hermes Agent](https://github.com/jbatt2026/AI-AGENTS)\n> Co-Authored-By: Hermes <agent@hermes.ai>',
    labels: ['automated-pr', 'documentation'],
  },
  {
    id: 'task-3',
    title: 'CI Automated PR Check Workflow',
    agent: 'Gemini Agent',
    branch: 'agent/gemini-ci-validation',
    description: 'Add GitHub Actions workflow to validate PR builds and scan for committed secrets.',
    filesChanged: [
      {
        path: '.github/workflows/agent-pr-check.yml',
        action: 'created',
        diff: '+name: Agent PR Validation Check\n+on: [pull_request]\n+jobs:\n+  validate:\n+    runs-on: ubuntu-latest\n+    steps:\n+      - uses: actions/checkout@v4\n+      - run: npm ci && npm run build',
      },
    ],
    prTitle: 'ci: add pull request validation and secret leak check workflow',
    prBody: 'Wires GitHub Actions CI pipeline to verify npm build and prevent accidental leakage of private keys.\n\n> Generated with [Gemini Agent](https://ai.google.dev)\n> Co-Authored-By: Gemini <gemini@google.com>',
    labels: ['automated-pr', 'ci/cd'],
  },
];

const INITIAL_PRS: SimulatedPR[] = [
  {
    id: 101,
    number: 1,
    title: 'feat(build): setup vite development server and strict typescript build',
    author: 'ai-agents-bot[bot]',
    branch: 'agent/claude-ts-build-system',
    targetBranch: 'main',
    status: 'open',
    createdAt: 'Just now',
    body: 'Sets up the development and production build pipeline for AI-AGENTS.\n\n### Changes\n- Added Vite dev server binding to port 3000\n- Added tsconfig with strict typechecking\n\n> Generated with [Claude Code](https://claude.ai/code) / [AI-AGENTS](https://github.com/jbatt2026/AI-AGENTS)\n> Co-Authored-By: Claude <noreply@anthropic.com>',
    labels: ['automated-pr', 'enhancement', 'build'],
    checksStatus: 'passing',
    files: [
      { path: 'package.json', additions: 14, deletions: 0, diff: '+\n+    "dev": "vite --host 0.0.0.0 --port 3000",\n+    "build": "vite build"' },
      { path: 'tsconfig.json', additions: 22, deletions: 0, diff: '+{\n+  "compilerOptions": {\n+    "strict": true\n+  }\n+}' },
    ],
  },
];

interface PRWorkflowWorkbenchProps {
  onPRCountChange?: (count: number) => void;
}

export const PRWorkflowWorkbench: React.FC<PRWorkflowWorkbenchProps> = ({ onPRCountChange }) => {
  const [tasks] = useState<AgentTask[]>(INITIAL_TASKS);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('task-1');
  const [prs, setPrs] = useState<SimulatedPR[]>(INITIAL_PRS);
  const [selectedPR, setSelectedPR] = useState<SimulatedPR | null>(INITIAL_PRS[0]);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<PRStepStatus[]>([
    { step: 'auth', title: '1. Installation Token Auth', status: 'completed', details: 'App token generated with scopes [contents:write, pull_requests:write]' },
    { step: 'branch', title: '2. Create Feature Branch', status: 'completed', details: 'Created branch refs/heads/agent/claude-ts-build-system' },
    { step: 'commit', title: '3. Generate & Sign Commits', status: 'completed', details: '2 files modified, GPG-signed by bot' },
    { step: 'pr', title: '4. Open Pull Request', status: 'completed', details: 'Opened PR #1 with attribution footer' },
    { step: 'ci', title: '5. Run CI Checks', status: 'completed', details: 'Workflow agent-pr-check.yml passed (build + secret scan)' },
  ]);

  const currentTask = tasks.find((t) => t.id === selectedTaskId) || tasks[0];

  const runSimulation = async () => {
    if (isRunning) return;
    setIsRunning(true);

    const newSteps: PRStepStatus[] = [
      { step: 'auth', title: '1. Installation Token Auth', status: 'pending' },
      { step: 'branch', title: '2. Create Feature Branch', status: 'pending' },
      { step: 'commit', title: '3. Generate & Sign Commits', status: 'pending' },
      { step: 'pr', title: '4. Open Pull Request', status: 'pending' },
      { step: 'ci', title: '5. Run CI Checks', status: 'pending' },
    ];
    setSteps(newSteps);

    // Step 1
    newSteps[0].status = 'running';
    setSteps([...newSteps]);
    await new Promise((r) => setTimeout(r, 600));
    newSteps[0].status = 'completed';
    newSteps[0].details = `Issued token for ${currentTask.agent} against jbatt2026/AI-AGENTS`;
    newSteps[0].timestamp = new Date().toLocaleTimeString();

    // Step 2
    newSteps[1].status = 'running';
    setSteps([...newSteps]);
    await new Promise((r) => setTimeout(r, 700));
    newSteps[1].status = 'completed';
    newSteps[1].details = `Created ref refs/heads/${currentTask.branch}`;
    newSteps[1].timestamp = new Date().toLocaleTimeString();

    // Step 3
    newSteps[2].status = 'running';
    setSteps([...newSteps]);
    await new Promise((r) => setTimeout(r, 700));
    newSteps[2].status = 'completed';
    newSteps[2].details = `Committed ${currentTask.filesChanged.length} changes for ${currentTask.title}`;
    newSteps[2].timestamp = new Date().toLocaleTimeString();

    // Step 4
    newSteps[3].status = 'running';
    setSteps([...newSteps]);
    await new Promise((r) => setTimeout(r, 800));
    newSteps[3].status = 'completed';
    const nextPRNumber = prs.length + 1;
    newSteps[3].details = `Created PR #${nextPRNumber}: "${currentTask.prTitle}"`;
    newSteps[3].timestamp = new Date().toLocaleTimeString();

    // Step 5
    newSteps[4].status = 'running';
    setSteps([...newSteps]);
    await new Promise((r) => setTimeout(r, 900));
    newSteps[4].status = 'completed';
    newSteps[4].details = `Workflow agent-pr-check.yml passed (build + security scan)`;
    newSteps[4].timestamp = new Date().toLocaleTimeString();

    // Create the PR object
    const createdPR: SimulatedPR = {
      id: Date.now(),
      number: nextPRNumber,
      title: currentTask.prTitle,
      author: `${currentTask.agent.toLowerCase().replace(/\s+/g, '-')}[bot]`,
      branch: currentTask.branch,
      targetBranch: 'main',
      status: 'open',
      createdAt: 'Just now',
      body: currentTask.prBody,
      labels: currentTask.labels,
      checksStatus: 'passing',
      files: currentTask.filesChanged.map((f) => ({
        path: f.path,
        additions: f.diff.split('\n').filter((l) => l.startsWith('+')).length,
        deletions: f.diff.split('\n').filter((l) => l.startsWith('-')).length,
        diff: f.diff,
      })),
    };

    setPrs((prev) => [createdPR, ...prev]);
    setSelectedPR(createdPR);
    setIsRunning(false);
    if (onPRCountChange) {
      onPRCountChange(prs.length + 1);
    }
  };

  const handleMergePR = (id: number) => {
    setPrs((prev) =>
      prev.map((pr) => (pr.id === id ? { ...pr, status: 'merged' } : pr))
    );
    if (selectedPR && selectedPR.id === id) {
      setSelectedPR({ ...selectedPR, status: 'merged' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <GitPullRequest className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-bold text-white">Agent PR Automation Workbench</h2>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Simulate and execute autonomous agent pull request workflows from authentication to merge.
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
              Active Target: <strong className="text-blue-400">jbatt2026/AI-AGENTS</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Task Picker & Step Runner */}
        <div className="lg:col-span-5 space-y-6">
          {/* Select Task */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                1. Select Agent Task
              </h3>
              <span className="text-xs text-slate-400">
                Agent: <strong className="text-blue-400">{currentTask.agent}</strong>
              </span>
            </div>

            <div className="space-y-2">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedTaskId === task.id
                      ? 'bg-blue-950/40 border-blue-500/50 shadow-sm'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-200">{task.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-blue-300 font-mono">
                      {task.agent}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{task.description}</p>
                </button>
              ))}
            </div>

            <button
              onClick={runSimulation}
              disabled={isRunning}
              className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white shadow-md flex items-center justify-center space-x-2 transition-all ${
                isRunning
                  ? 'bg-blue-600/50 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.99]'
              }`}
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Agent Executing Pipeline...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Run Agent PR Pipeline</span>
                </>
              )}
            </button>
          </div>

          {/* Execution Pipeline Steps */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              2. Pipeline Execution Steps
            </h3>

            <div className="space-y-3">
              {steps.map((step) => {
                const isCompleted = step.status === 'completed';
                const isRunningStep = step.status === 'running';
                const isPending = step.status === 'pending';
                const isFailed = step.status === 'failed';

                return (
                  <div
                    key={step.step}
                    className={`p-3 rounded-lg border transition-all ${
                      isRunningStep
                        ? 'bg-blue-950/30 border-blue-500/40'
                        : isCompleted
                        ? 'bg-slate-950 border-slate-800'
                        : 'bg-slate-950/50 border-slate-800/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {isCompleted && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                        {isRunningStep && <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />}
                        {isPending && <Clock className="w-4 h-4 text-slate-500 shrink-0" />}
                        {isFailed && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                        <span className="text-xs font-semibold text-slate-200">{step.title}</span>
                      </div>
                      {step.timestamp && (
                        <span className="text-[10px] text-slate-400 font-mono">{step.timestamp}</span>
                      )}
                    </div>
                    {step.details && (
                      <p className="text-[11px] text-slate-400 mt-1 pl-6 font-mono leading-relaxed">
                        {step.details}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Pull Requests List & Selected PR Detail View */}
        <div className="lg:col-span-7 space-y-6">
          {/* PRs Header and Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <GitPullRequest className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  Open Pull Requests ({prs.length})
                </h3>
              </div>
              <span className="text-xs text-slate-400">Simulated GitHub Repo Feed</span>
            </div>

            <div className="space-y-2">
              {prs.map((pr) => {
                const isSelected = selectedPR?.id === pr.id;
                const isMerged = pr.status === 'merged';

                return (
                  <button
                    key={pr.id}
                    onClick={() => setSelectedPR(pr)}
                    className={`w-full text-left p-3.5 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-slate-950 border-blue-500/60 shadow-sm'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isMerged
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {isMerged ? <GitMerge className="w-3 h-3" /> : <GitPullRequest className="w-3 h-3" />}
                            <span>{isMerged ? 'Merged' : 'Open'}</span>
                          </span>
                          <span className="text-xs font-bold text-slate-200 hover:text-blue-400">
                            #{pr.number} {pr.title}
                          </span>
                        </div>

                        <div className="flex items-center space-x-2 text-[11px] text-slate-400">
                          <span>by <strong className="text-slate-300">{pr.author}</strong></span>
                          <span>•</span>
                          <span className="font-mono text-blue-400">{pr.branch}</span>
                          <span>→</span>
                          <span className="font-mono text-slate-400">{pr.targetBranch}</span>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1 shrink-0">
                        {pr.labels.map((lbl) => (
                          <span
                            key={lbl}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono hidden sm:inline-block"
                          >
                            {lbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected PR Detail View */}
          {selectedPR && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-bold text-white">
                      #{selectedPR.number} {selectedPR.title}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 text-xs text-slate-400 mt-1">
                    <span>Opened by <strong>{selectedPR.author}</strong></span>
                    <span>•</span>
                    <span className="text-emerald-400 flex items-center space-x-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>CI Checks Passing</span>
                    </span>
                  </div>
                </div>

                {selectedPR.status === 'open' && (
                  <button
                    onClick={() => handleMergePR(selectedPR.id)}
                    className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors self-start sm:self-auto"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    <span>Merge Pull Request</span>
                  </button>
                )}
              </div>

              {/* PR Description */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  PR Description & Attribution
                </h4>
                <div className="p-4 bg-slate-950 rounded-lg text-xs text-slate-300 leading-relaxed font-sans border border-slate-800 whitespace-pre-wrap">
                  {selectedPR.body}
                </div>
              </div>

              {/* Files Changed & Diff */}
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Files Changed ({selectedPR.files.length})
                </h4>
                <div className="space-y-3">
                  {selectedPR.files.map((file) => (
                    <div key={file.path} className="border border-slate-800 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-slate-950 flex items-center justify-between border-b border-slate-800">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-xs font-mono font-medium text-slate-200">
                            {file.path}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono space-x-1.5">
                          <span className="text-emerald-400">+{file.additions}</span>
                          <span className="text-rose-400">-{file.deletions}</span>
                        </div>
                      </div>
                      <pre className="p-3 bg-slate-950/70 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                        <code>{file.diff}</code>
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
