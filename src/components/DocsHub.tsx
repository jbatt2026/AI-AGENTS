import React, { useState } from 'react';
import { BookOpen, Copy, Check, FileText, Download, Search } from 'lucide-react';

interface DocItem {
  id: string;
  name: string;
  category: 'Guides' | 'Specifications' | 'Workflows';
  description: string;
  content: string;
}

const DOCS: DocItem[] = [
  {
    id: 'install-guide',
    name: 'INSTALL_GITHUB_APP.md',
    category: 'Guides',
    description: 'Step-by-step GitHub App configuration and token exchange guide.',
    content: `# Installing and Configuring the GitHub App for AI Agents

This guide explains how to configure and install a GitHub App to grant automated AI agents (such as Hermes, Claude Code, and Gemini agents) programmatic access to open pull requests, push code branches, and trigger automated verification.

---

## Architecture Overview

1. GitHub App: Acts as the bot identity with granular, scoped permissions.
2. Private Key (.pem): Cryptographically signs JSON Web Tokens (JWT).
3. Installation Access Token: Short-lived (1-hour) bearer token created per target repo.

---

## Step 1: Create the GitHub App
Navigate to GitHub Settings -> Developer settings -> GitHub Apps -> New GitHub App, or use the App Manifest flow.

## Step 2: Configure Scopes & Permissions
- Repository contents: Read & Write (branch creation and code commits)
- Pull requests: Read & Write (PR creation and comments)
- Actions & Checks: Read & Write (CI validation checks)
- Metadata: Read-only

## Step 3: Generate Private Key & Install App
Download the .pem key, install the app on jbatt2026/AI-AGENTS, and note your App ID and Installation ID.`,
  },
  {
    id: 'claude-md',
    name: 'CLAUDE.md',
    category: 'Guides',
    description: 'Guidance and rules for Claude Code and automated AI agents in this repo.',
    content: `# CLAUDE.md

Guidance for Claude Code and other AI agents working in this repository.

## What this repository is
AI-AGENTS (github.com/jbatt2026/AI-AGENTS) hosts tools, scripts, and integrations that let automated AI agents — e.g. Hermes and Claude — create, update, and manage code through GitHub.

## Current Backlog & Spec Files
- INSTALL_GITHUB_APP.md: Step-by-step GitHub App install/config
- .github/GITHUB_APP_MANIFEST.json: App manifest (permissions, webhook, events)
- CONTRIBUTING.md: Contributor and agent guidelines
- CODEOWNERS: Review ownership routing
- .github/workflows/agent-pr-check.yml: Checks on agent-created PRs

## Working Conventions
- Language: Node.js 22 + TypeScript + Vite + React
- Build: npm run build
- Dev: npm run dev (port 3000, host 0.0.0.0)`,
  },
  {
    id: 'contributing',
    name: 'CONTRIBUTING.md',
    category: 'Specifications',
    description: 'Contributor guidelines and agent operation rules.',
    content: `# Contributing Guidelines for AI Agents and Human Developers

## Rules for AI Agents
1. Atomic, Scoped Changes: Branch naming must follow agent/<agent-name>-<task-slug>.
2. Required Attribution Footer: Every PR must include:
   > Generated with [Claude Code](https://claude.ai/code) / [AI-AGENTS](https://github.com/jbatt2026/AI-AGENTS)
   > Co-Authored-By: Claude <noreply@anthropic.com>
3. Verification Before Push: Always run \`npm run build\` and ensure clean build.
4. Secret Safety: NEVER commit .pem private keys or .env credentials.`,
  },
  {
    id: 'codeowners',
    name: 'CODEOWNERS',
    category: 'Specifications',
    description: 'Repository review and ownership routing configuration.',
    content: `# Review ownership routing for AI-AGENTS

# Global repo owners
*       @jbatt2026

# GitHub App and Agent manifests
/.github/                     @jbatt2026
/INSTALL_GITHUB_APP.md        @jbatt2026
/CLAUDE.md                    @jbatt2026

# Application source and tools
/src/                         @jbatt2026
/package.json                 @jbatt2026`,
  },
  {
    id: 'ci-workflow',
    name: '.github/workflows/agent-pr-check.yml',
    category: 'Workflows',
    description: 'GitHub Actions workflow for PR verification and secret leak scans.',
    content: `name: Agent PR Validation Check

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Verify TypeScript & Build
        run: npm run build

      - name: Check for committed secrets
        run: |
          echo "Scanning for accidental secret leaks (.pem, private keys)..."
          if grep -rn "BEGIN RSA PRIVATE KEY" . --exclude-dir={node_modules,.git,dist}; then
            echo "ERROR: Found committed private key in repository!"
            exit 1
          fi
          echo "Secret scan passed cleanly."`,
  },
];

export const DocsHub: React.FC = () => {
  const [selectedDocId, setSelectedDocId] = useState<string>('install-guide');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const filteredDocs = DOCS.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.description.toLowerCase().includes(search.toLowerCase())
  );

  const currentDoc = DOCS.find((d) => d.id === selectedDocId) || DOCS[0];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentDoc.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([currentDoc.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentDoc.name.split('/').pop() || 'document.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
        <div className="flex items-center space-x-3">
          <BookOpen className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-lg font-bold text-white">Repository Specifications & Documentation Hub</h2>
            <p className="text-sm text-slate-400 mt-1">
              Browse, view, and export all official guidelines, app manifests, and CI configurations created for <code className="text-blue-300 font-mono">jbatt2026/AI-AGENTS</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: File List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search specs & docs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              {filteredDocs.map((doc) => {
                const isSelected = selectedDocId === doc.id;
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-blue-950/40 border-blue-500/50 shadow-sm'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="text-xs font-semibold font-mono text-slate-200 truncate">
                          {doc.name}
                        </span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-850 text-slate-400 shrink-0">
                        {doc.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{doc.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Doc Reader */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-slate-200">
                  {currentDoc.name}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 inline-flex items-center space-x-1 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 inline-flex items-center space-x-1 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </button>
              </div>
            </div>

            <pre className="mt-4 p-4 bg-slate-950 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-[500px] leading-relaxed border border-slate-800 whitespace-pre-wrap">
              <code>{currentDoc.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
