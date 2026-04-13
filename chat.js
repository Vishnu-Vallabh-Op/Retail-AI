/* ═══════════════════════════════════════════════════════════════════════════
   Retail AI — Decision Intelligence
   chat.js  —  AI Chat Manager  (Supabase-driven, no localStorage sessions)
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const SIDEBAR_KEY      = 'retailAi_sidebarOpen';   // collapse state only
const LAST_SESSION_KEY = 'retailAi_lastSession';    // restore active tab on refresh

class ChatManager {
  constructor() {
    this.isLoading        = false;
    this.currentSessionId = null;
    this.sessions         = [];   // populated from Supabase

    this.chatContainer = document.getElementById('chatMessages');
    this.chatInput     = document.getElementById('chatInput');
    this.chatSendBtn   = document.getElementById('chatSendBtn');
    this.sidebarEl     = document.getElementById('chatSidebar');
    this.sidebarList   = document.getElementById('chatSidebarList');
    this.expandBtn     = document.getElementById('sidebarExpandBtn');
    this.sessionTitle  = document.getElementById('chatSessionTitle');

    this.apiBase        = (window.CHAT_API_ENDPOINT || 'http://localhost:3001/chat')
      .replace(/\/chat$/, '');
    this.providerSelect = document.getElementById('aiProviderSelect');

    this._initEvents();
    this._restoreSidebarState();
    this._restoreProvider();
    this._loadSessionsFromServer();
  }

  // ─── Event Wiring ──────────────────────────────────────────────────────────

  _initEvents() {
    this.chatSendBtn.addEventListener('click', () => this.sendMessage());
    this.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
    });
    this.providerSelect?.addEventListener('change', () => {
      localStorage.setItem('retailAi_provider', this.providerSelect.value);
    });
  }

  _restoreProvider() {
    const saved = localStorage.getItem('retailAi_provider');
    if (saved && this.providerSelect) this.providerSelect.value = saved;
  }

  _getProvider() {
    return this.providerSelect?.value || 'groq';
  }

  // ─── Sidebar Collapse/Expand ───────────────────────────────────────────────

  toggleSidebar() {
    const collapsed = this.sidebarEl.classList.toggle('collapsed');
    this.expandBtn.style.display = collapsed ? 'flex' : 'none';
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '0' : '1');
  }

  _restoreSidebarState() {
    if (localStorage.getItem(SIDEBAR_KEY) === '0') {
      this.sidebarEl.classList.add('collapsed');
      this.expandBtn.style.display = 'flex';
    }
  }

  // ─── Load Sessions from Supabase ───────────────────────────────────────────

  // Called once on boot — fetches sessions AND restores last active chat
  async _loadSessionsFromServer() {
    await this._fetchSessions();
    this._renderSidebar();

    const lastId = localStorage.getItem(LAST_SESSION_KEY);
    const match  = lastId && this.sessions.find(s => s.sessionId === lastId);
    if (match) {
      this._setActiveSession(match.sessionId, match.title);
      this._loadHistoryFromServer(match.sessionId);
    } else {
      this._showWelcome();
    }
  }

  // Called after sending a message — only refreshes the sidebar list, never touches chat messages
  async _refreshSidebar() {
    await this._fetchSessions();
    this._renderSidebar();
  }

  async _fetchSessions() {
    try {
      const res = await fetch(`${this.apiBase}/chat/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.sessions = data.sessions || [];
    } catch (err) {
      console.warn('Could not load sessions from server:', err.message);
      this.sessions = [];
    }
  }

  // ─── Sidebar Rendering ─────────────────────────────────────────────────────

  _renderSidebar() {
    if (!this.sessions.length) {
      this.sidebarList.innerHTML = `
        <div class="sidebar-empty">
          <div class="sidebar-empty-icon">💬</div>
          No conversations yet.<br>Start a new chat!
        </div>`;
      return;
    }

    // Group by relative date (using updatedAt from server)
    const now    = Date.now();
    const groups = {};
    this.sessions.forEach(s => {
      const ts    = new Date(s.updatedAt || s.createdAt).getTime();
      const label = this._dateGroup(ts, now);
      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    });

    const ORDER = ['Today', 'Yesterday', 'Last 7 days', 'Last 30 days', 'Older'];
    this.sidebarList.innerHTML = ORDER
      .filter(l => groups[l])
      .map(label => `
        <div class="sidebar-group-label">${label}</div>
        ${groups[label].map(s => this._sessionItemHtml(s)).join('')}
      `).join('');

    // Attach click & delete events
    this.sidebarList.querySelectorAll('.sidebar-session-item').forEach(el => {
      const id = el.dataset.id;
      el.addEventListener('click', e => {
        if (e.target.closest('.sidebar-session-delete')) return;
        const s = this.sessions.find(x => x.sessionId === id);
        if (s) {
          this._setActiveSession(s.sessionId, s.title);
          this._loadHistoryFromServer(s.sessionId);
        }
      });
      el.querySelector('.sidebar-session-delete')?.addEventListener('click', e => {
        e.stopPropagation();
        this._deleteSession(id);
      });
    });
  }

  _sessionItemHtml(s) {
    const active  = this.currentSessionId === s.sessionId ? 'active' : '';
    const title   = this._esc(s.title || '(no messages yet)');
    const dateStr = this._relativeDate(new Date(s.updatedAt || s.createdAt).getTime());
    const num     = this._sessionNumber(s.sessionId);
    const count   = s.messageCount ? `${s.messageCount} msg${s.messageCount !== 1 ? 's' : ''}` : '';
    return `
      <div class="sidebar-session-item ${active}" data-id="${s.sessionId}">
        <div class="sidebar-session-text">
          <div class="sidebar-session-title-row">
            ${num ? `<span class="sidebar-session-num">${num}</span>` : ''}
            <span class="sidebar-session-title">${title}</span>
          </div>
          <div class="sidebar-session-date">${dateStr}${count ? ' · ' + count : ''}</div>
        </div>
        <button class="sidebar-session-delete" title="Delete conversation">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>`;
  }

  _sessionNumber(id) {
    const m = (id || '').match(/conversation_(\d+)$/i);
    if (m) return `#${m[1]}`;
    return '';
  }

  _dateGroup(ts, now) {
    const diff = now - ts;
    const day  = 86400000;
    if (diff < day)       return 'Today';
    if (diff < 2 * day)   return 'Yesterday';
    if (diff < 7 * day)   return 'Last 7 days';
    if (diff < 30 * day)  return 'Last 30 days';
    return 'Older';
  }

  _relativeDate(ts) {
    const diff = Date.now() - ts;
    const m    = Math.floor(diff / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ─── Session Activation ────────────────────────────────────────────────────

  _setActiveSession(sessionId, title) {
    this.currentSessionId = sessionId;
    localStorage.setItem(LAST_SESSION_KEY, sessionId);
    if (this.sessionTitle) {
      this.sessionTitle.textContent = title || 'AI Chat Assistant';
    }
    // Re-render sidebar to highlight active item
    this._renderSidebar();
  }

  async _loadHistoryFromServer(sessionId) {
    try {
      const res = await fetch(`${this.apiBase}/chat/history/${encodeURIComponent(sessionId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.chatContainer.innerHTML = '';
      (data.history || []).forEach(m => this._renderMessage(m.role, m.message || m.content, false));
      this.scrollToBottom();
    } catch (err) {
      console.warn('Could not load history:', err.message);
    }
  }

  // ─── Session Numbering (derive next ID from Supabase list) ─────────────────

  _nextSessionId() {
    const nums = this.sessions
      .map(s => { const m = (s.sessionId || '').match(/^conversation_(\d+)$/); return m ? parseInt(m[1]) : 0; })
      .filter(Boolean);
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `conversation_${next}`;
  }

  // ─── Public Controls ───────────────────────────────────────────────────────

  newChat() {
    this.currentSessionId = null;
    localStorage.removeItem(LAST_SESSION_KEY);
    if (this.sessionTitle) this.sessionTitle.textContent = 'AI Chat Assistant';
    this._showWelcome();
    this._renderSidebar();
    setTimeout(() => this.chatInput.focus(), 80);
  }

  async clearChat() {
    if (!this.currentSessionId) { this._showWelcome(); return; }
    await this._deleteSession(this.currentSessionId);
  }

  async _deleteSession(sessionId) {
    // Immediately clear UI if it's the active session
    if (this.currentSessionId === sessionId) {
      this.currentSessionId = null;
      localStorage.removeItem(LAST_SESSION_KEY);
      if (this.sessionTitle) this.sessionTitle.textContent = 'AI Chat Assistant';
      this._showWelcome();
    }

    // Delete from Supabase
    try {
      const res = await fetch(
        `${this.apiBase}/chat/session/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) console.warn('Server delete failed for:', sessionId);
    } catch (err) {
      console.warn('Could not reach server to delete session:', err.message);
    }

    // Reload sidebar from Supabase (without touching chat area)
    await this._refreshSidebar();
  }

  // ─── Messaging ─────────────────────────────────────────────────────────────

  async sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message || this.isLoading) return;

    // Assign session ID on first message of a new chat
    if (!this.currentSessionId) {
      this.currentSessionId = this._nextSessionId();
      localStorage.setItem(LAST_SESSION_KEY, this.currentSessionId);
      if (this.sessionTitle) {
        this.sessionTitle.textContent = message.length > 48
          ? message.slice(0, 48) + '…'
          : message;
      }
    }

    this.chatInput.value = '';
    this.chatInput.focus();
    this._renderMessage('user', message, true);
    this.setLoading(true);

    try {
      const res = await fetch(`${this.apiBase}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question:     message,
          sessionId:    this.currentSessionId,
          chartContext: this.buildChartContext(),
          provider:     this._getProvider(),
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          await res.json().catch(() => {});
          this._renderMessage('assistant',
            `**${this._getProvider()}** is rate-limited. Use the provider dropdown in the header to switch to Gemini, Mistral, or Cohere and continue chatting instantly.`,
            true, true);
          this.setLoading(false);
          return;
        }
        throw new Error(`API returned ${res.status}`);
      }
      const data = await res.json();
      if (!data.answer) throw new Error('No answer received from API');

      this._renderMessage('assistant', data.answer, true);

      // Refresh only the sidebar list — never touch the chat messages
      await this._refreshSidebar();

    } catch (err) {
      console.error('Chat error:', err);
      this._renderMessage('assistant',
        `Sorry, I encountered an error. Please try again.\n\nError: ${err.message}`,
        true, true);
    } finally {
      this.setLoading(false);
    }
  }

  // ─── Message Rendering ─────────────────────────────────────────────────────

  _renderMessage(role, content, animate = true, isError = false) {
    const wrap = document.createElement('div');
    wrap.className = `chat-message ${role}`;
    if (!animate) wrap.style.animation = 'none';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (isError) bubble.classList.add('chat-error');
    bubble.innerHTML = this.formatMessageHtml(content, role);
    wrap.appendChild(bubble);

    if (role === 'assistant' && !isError) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.title     = 'Copy to clipboard';
      copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      });
      wrap.appendChild(copyBtn);
    }

    this.chatContainer.appendChild(wrap);
    this.scrollToBottom();
  }

  // keep old name for compatibility
  addMessage(role, content, animate = true, isError = false) {
    this._renderMessage(role, content, animate, isError);
  }

  // ─── Loading Indicator ─────────────────────────────────────────────────────

  setLoading(loading) {
    this.isLoading = loading;
    this.chatSendBtn.disabled = loading;

    if (loading) {
      const div = document.createElement('div');
      div.className = 'chat-message assistant';
      div.id = 'chat-loading-indicator';
      div.innerHTML = `<div class="chat-loading">
        <div class="chat-spinner"></div>
        <span class="typing-dots"><span></span><span></span><span></span></span>
      </div>`;
      this.chatContainer.appendChild(div);
      this.scrollToBottom();
    } else {
      document.getElementById('chat-loading-indicator')?.remove();
    }
  }

  scrollToBottom() {
    setTimeout(() => { this.chatContainer.scrollTop = this.chatContainer.scrollHeight; }, 0);
  }

  _showWelcome() {
    this.chatContainer.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🤖</div>
        <div class="chat-welcome-title">Retail AI Assistant</div>
        <div class="chat-welcome-sub">Ask me about trends, risk, revenue, or any retail insight from your data.</div>
      </div>`;
  }

  // ─── Chart Context ─────────────────────────────────────────────────────────

  buildChartContext() {
    const data = window.parsedData;
    if (!data || !data.length) return null;

    const keys    = Object.keys(data[0]);
    const catKey  = keys.find(k => k.toLowerCase().includes('categor') || k.toLowerCase().includes('product'));
    const amtKey  = keys.find(k => k.toLowerCase().includes('amount') || k.toLowerCase().includes('revenue') || k.toLowerCase().includes('total'));
    const dateKey = keys.find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('month'));

    const ctx = { totalRows: data.length, columns: keys };

    if (catKey && amtKey) {
      const totals = {};
      data.forEach(r => {
        const cat = String(r[catKey] || 'Other');
        totals[cat] = (totals[cat] || 0) + (Number(r[amtKey]) || 0);
      });
      const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
      ctx.categoryBreakdown = Object.entries(totals)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, total]) => {
          const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : '0.0';
          return `${cat}: $${total.toLocaleString()} (${pct}%)`;
        }).join(' | ');
      ctx.grandTotal = `$${grandTotal.toLocaleString()}`;
    }

    if (dateKey && amtKey) {
      const monthly = {};
      data.forEach(r => {
        const m = r[dateKey] ? String(r[dateKey]).substring(0, 7) : 'Unknown';
        monthly[m] = (monthly[m] || 0) + (Number(r[amtKey]) || 0);
      });
      ctx.monthlyTrend = Object.entries(monthly)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, v]) => `${m}: $${v.toLocaleString()}`).join(' | ');
    }

    return ctx;
  }

  // ─── Formatting ────────────────────────────────────────────────────────────

  formatMessageHtml(text, role = 'assistant') {
    if (role === 'user') {
      return `<p>${this._esc(text).replace(/\n/g, '<br>')}</p>`;
    }
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      return marked.parse(text);
    }
    return `<p>${this._esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')}</p>`;
  }

  _esc(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  escapeHtml(str) { return this._esc(str); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { window.chatManager = new ChatManager(); });
} else {
  window.chatManager = new ChatManager();
}
