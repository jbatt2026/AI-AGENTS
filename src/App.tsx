import { useState } from 'react';
import { TabType } from './types';
import { Header } from './components/Header';
import { PRWorkflowWorkbench } from './components/PRWorkflowWorkbench';
import { ManifestBuilder } from './components/ManifestBuilder';
import { TokenAuthSimulator } from './components/TokenAuthSimulator';
import { AgentScriptsRunner } from './components/AgentScriptsRunner';
import { DocsHub } from './components/DocsHub';
import { GitPullRequest, ShieldCheck, Terminal, BookOpen, CheckCircle } from 'lucide-react';

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('workbench');
  const [openPRCount, setOpenPRCount] = useState<number>(1);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Top Navigation */}
      <Header activeTab={activeTab} setActiveTab={setActiveTab} openPRCount={openPRCount} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Quick Summary Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div
            onClick={() => setActiveTab('workbench')}
            className="cursor-pointer bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 transition-all"
          >
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Agent PRs</span>
              <GitPullRequest className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-xl font-bold text-white">{openPRCount} Open</div>
            <span className="text-[11px] text-emerald-400 flex items-center space-x-1 mt-1">
              <CheckCircle className="w-3 h-3" />
              <span>CI Passing</span>
            </span>
          </div>

          <div
            onClick={() => setActiveTab('manifest')}
            className="cursor-pointer bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 transition-all"
          >
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">GitHub App</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-white">Configured</div>
            <span className="text-[11px] text-slate-400 mt-1 block">7 repo permissions</span>
          </div>

          <div
            onClick={() => setActiveTab('scripts')}
            className="cursor-pointer bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 transition-all"
          >
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Agent Tools</span>
              <Terminal className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-xl font-bold text-white">3 Scripts</div>
            <span className="text-[11px] text-purple-400 mt-1 block">Octokit + Secret Scan</span>
          </div>

          <div
            onClick={() => setActiveTab('docs')}
            className="cursor-pointer bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl p-4 transition-all"
          >
            <div className="flex items-center justify-between text-slate-400 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider">Specifications</span>
              <BookOpen className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-white">5 Docs Ready</div>
            <span className="text-[11px] text-amber-400 mt-1 block">CLAUDE, Install, CI</span>
          </div>
        </div>

        {/* Tab Views */}
        {activeTab === 'workbench' && <PRWorkflowWorkbench onPRCountChange={setOpenPRCount} />}
        {activeTab === 'manifest' && <ManifestBuilder />}
        {activeTab === 'auth' && <TokenAuthSimulator />}
        {activeTab === 'scripts' && <AgentScriptsRunner />}
        {activeTab === 'docs' && <DocsHub />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <span>Repository:</span>
            <a
              href="https://github.com/jbatt2026/AI-AGENTS"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline font-mono"
            >
              github.com/jbatt2026/AI-AGENTS
            </a>
          </div>
          <div className="flex items-center space-x-4">
            <span>Runtime: Node.js 22 + Vite + React</span>
            <span>•</span>
            <span className="text-slate-400">Compatible with Hermes, Claude Code, and Gemini agents</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
