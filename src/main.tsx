import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// A previous simulator version persisted private-key text under this key.
// Purge it before any route renders, even when the Auth tab is never opened.
try {
  localStorage.removeItem('ai_agent_creds');
} catch {
  // Storage can be unavailable in hardened/private browser contexts.
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
