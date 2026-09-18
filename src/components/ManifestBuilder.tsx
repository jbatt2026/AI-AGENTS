import React, { useState } from 'react';
import { Copy, Check, Download, ExternalLink, Shield, RefreshCw } from 'lucide-react';
import { GitHubAppManifest } from '../types';

const INITIAL_MANIFEST: GitHubAppManifest = {
  name: 'ai-agents-bot',
  url: 'https://github.com/jbatt2026/AI-AGENTS',
  hook_attributes: {
    url: 'https://example.com/api/github/webhook',
    active: false,
  },
  redirect_url: 'https://github.com/jbatt2026/AI-AGENTS',
  description: 'Automated GitHub App for AI Agents (Hermes, Claude Code, Gemini) to push branches, open pull requests, and manage code reviews.',
  public: false,
  default_permissions: {
    contents: 'write',
    pull_requests: 'write',
    issues: 'write',
    actions: 'write',
    checks: 'write',
    workflows: 'write',
    metadata: 'read',
  },
  default_events: [
    'pull_request',
    'pull_request_review',
    'issue_comment',
    'workflow_run',
    'workflow_dispatch',
    'push',
  ],
};

const AVAILABLE_PERMISSIONS: { key: string; label: string; desc: string; options: ('none' | 'read' | 'write')[] }[] = [
  { key: 'contents', label: 'Repository Contents', desc: 'Required to create branches and commit agent code changes', options: ['none', 'read', 'write'] },
  { key: 'pull_requests', label: 'Pull Requests', desc: 'Required to open PRs, update descriptions, and add reviewers', options: ['none', 'read', 'write'] },
  { key: 'issues', label: 'Issues', desc: 'Required to read bug tasks, link issue numbers, and post comments', options: ['none', 'read', 'write'] },
  { key: 'actions', label: 'Actions', desc: 'Required to monitor GitHub Actions CI runs on agent PRs', options: ['none', 'read', 'write'] },
  { key: 'checks', label: 'Checks API', desc: 'Required to read validation and test status checks', options: ['none', 'read', 'write'] },
  { key: 'workflows', label: 'Workflows', desc: 'Required to dispatch workflow runs or update CI configurations', options: ['none', 'read', 'write'] },
  { key: 'metadata', label: 'Repository Metadata', desc: 'Mandatory read access to basic repository details', options: ['read'] },
];

const AVAILABLE_EVENTS = [
  { id: 'pull_request', label: 'Pull Requests', desc: 'Triggered when PRs are opened, closed, synchronized, or reopened' },
  { id: 'pull_request_review', label: 'PR Reviews', desc: 'Triggered when reviewers leave feedback or approve agent PRs' },
  { id: 'issue_comment', label: 'Issue Comments', desc: 'Triggered when users reply with instructions or review prompts' },
  { id: 'workflow_run', label: 'Workflow Runs', desc: 'Triggered when GitHub Actions CI jobs complete or fail' },
  { id: 'workflow_dispatch', label: 'Workflow Dispatch', desc: 'Manual triggers for validation pipelines' },
  { id: 'push', label: 'Push Events', desc: 'Triggered on new commits pushed to branches' },
];

export const ManifestBuilder: React.FC = () => {
  const [manifest, setManifest] = useState<GitHubAppManifest>(INITIAL_MANIFEST);
  const [copied, setCopied] = useState(false);

  const handlePermissionChange = (key: string, value: 'read' | 'write' | 'none') => {
    setManifest((prev) => ({
      ...prev,
      default_permissions: {
        ...prev.default_permissions,
        [key]: value,
      },
    }));
  };

  const handleEventToggle = (eventId: string) => {
    setManifest((prev) => {
      const exists = prev.default_events.includes(eventId);
      return {
        ...prev,
        default_events: exists
          ? prev.default_events.filter((e) => e !== eventId)
          : [...prev.default_events, eventId],
      };
    });
  };

  const manifestJson = JSON.stringify(manifest, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(manifestJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([manifestJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'GITHUB_APP_MANIFEST.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setManifest(INITIAL_MANIFEST);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Shield className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-bold text-white">GitHub App Manifest Configurator</h2>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              Configure fine-grained permissions and webhook events for agent bots (Hermes, Claude, Gemini).
              This file maps directly to <code className="text-blue-300 font-mono text-xs">.github/GITHUB_APP_MANIFEST.json</code>.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleReset}
              className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg shadow-sm transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied JSON!' : 'Copy Manifest'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .json</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid: Editor & Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Permission Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* General Metadata */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              App Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  GitHub App Name
                </label>
                <input
                  type="text"
                  value={manifest.name}
                  onChange={(e) => setManifest({ ...manifest, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Homepage URL
                </label>
                <input
                  type="text"
                  value={manifest.url}
                  onChange={(e) => setManifest({ ...manifest, url: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={manifest.description}
                  onChange={(e) => setManifest({ ...manifest, description: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="sm:col-span-2 flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div>
                  <span className="text-xs font-medium text-slate-200 block">Active Webhook</span>
                  <span className="text-[11px] text-slate-400">Enable if your agent has a real-time event listener server</span>
                </div>
                <button
                  type="button"
                  onClick={() => setManifest({
                    ...manifest,
                    hook_attributes: { ...manifest.hook_attributes, active: !manifest.hook_attributes.active }
                  })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    manifest.hook_attributes.active ? 'bg-blue-600' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      manifest.hook_attributes.active ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Repository Permissions */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center justify-between">
              <span>Repository Scopes & Permissions</span>
              <span className="text-xs text-blue-400 font-normal">Least Privilege Recommended</span>
            </h3>
            <div className="space-y-3">
              {AVAILABLE_PERMISSIONS.map((perm) => {
                const currentVal = manifest.default_permissions[perm.key] || 'none';
                return (
                  <div
                    key={perm.key}
                    className="p-3 bg-slate-950 rounded-lg border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-slate-200">{perm.label}</span>
                        <code className="text-[11px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                          {perm.key}
                        </code>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{perm.desc}</p>
                    </div>

                    <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 self-start sm:self-auto">
                      {perm.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handlePermissionChange(perm.key, opt)}
                          className={`px-2.5 py-1 rounded text-xs font-medium capitalize transition-all ${
                            currentVal === opt
                              ? opt === 'write'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : opt === 'read'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-slate-700 text-slate-200'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Webhook Events */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Subscribed Webhook Events
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {AVAILABLE_EVENTS.map((event) => {
                const isSelected = manifest.default_events.includes(event.id);
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => handleEventToggle(event.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'bg-blue-950/40 border-blue-500/40 text-blue-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold font-mono">{event.id}</span>
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border ${
                          isSelected ? 'bg-blue-600 border-blue-500' : 'border-slate-700'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{event.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Live Manifest Code Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 sticky top-20">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="text-xs font-bold text-slate-300 font-mono">
                  .github/GITHUB_APP_MANIFEST.json
                </span>
              </div>
              <button
                onClick={handleCopy}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium inline-flex items-center space-x-1"
              >
                <Copy className="w-3 h-3" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <pre className="mt-3 p-4 bg-slate-950 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-[520px] leading-relaxed border border-slate-800/80">
              <code>{manifestJson}</code>
            </pre>

            {/* Quick Helper */}
            <div className="mt-4 p-3 bg-blue-950/30 border border-blue-500/20 rounded-lg text-xs text-blue-300 space-y-2">
              <p className="font-semibold flex items-center space-x-1">
                <span>🚀 How to use this on GitHub</span>
              </p>
              <p className="text-slate-300 leading-normal">
                Commit this file to <code className="text-blue-300 font-mono">.github/GITHUB_APP_MANIFEST.json</code>.
                When ready, navigate to GitHub Developer Settings to create your App directly from this configuration.
              </p>
              <a
                href="https://github.com/settings/apps/new"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-1 text-blue-400 hover:underline font-semibold pt-1"
              >
                <span>Open GitHub App Creator</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
