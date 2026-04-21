const express   = require('express');
const cors      = require('cors');
const dotenv    = require('dotenv');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app  = express();
const port = process.env.PORT || 3001;

// ─── Trust Render/proxy X-Forwarded-For headers ───────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers (XSS, clickjacking, MIME sniffing, etc.) ───────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ─── Core middleware ──────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Rate limiters ────────────────────────────────────────────────────────────
app.use('/chat', rateLimit({
  windowMs: 60_000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many messages. Please wait a minute.' },
}));

app.use('/analyze', rateLimit({
  windowMs: 60_000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please wait a minute.' },
}));

// ─── Raw binary parser for file uploads ──────────────────────────────────────
app.use('/analyze', express.raw({ type: '*/*', limit: '50mb' }));

// Initialize Supabase client
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ Warning: SUPABASE_SERVICE_ROLE_KEY is not set. Using SUPABASE_KEY may fail when RLS is enabled.');
}

// Debug trap — logs every request to /analyze so we can confirm the route is reached
app.all('/analyze', (req, _res, next) => {
  console.log(`[analyze] ${req.method} — content-type: ${req.headers['content-type']} — body bytes: ${req.body?.length ?? 'not yet parsed'}`);
  next();
});

/**
 * POST /analyze
 * Receives the uploaded file binary and proxies it to the n8n webhook.
 * Keeps WEBHOOK_URL and ANALYSIS_MODE out of the browser entirely.
 */
app.post('/analyze', async (req, res) => {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    return res.status(500).json({ error: 'WEBHOOK_URL is not set in the server environment (.env)' });
  }

  try {
    const n8nRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type':    req.headers['content-type'] || 'application/octet-stream',
        'X-File-Name':     req.headers['x-file-name']  || 'upload',
        'X-Analysis-Mode': process.env.ANALYSIS_MODE   || 'trend,category,monthly',
      },
      body: req.body,
    });

    if (!n8nRes.ok) {
      const text = await n8nRes.text();
      throw new Error(`n8n returned ${n8nRes.status}: ${text}`);
    }

    const result = await n8nRes.json();
    res.json(result);
  } catch (error) {
    console.error('Analyze proxy error:', error);
    res.status(500).json({ error: 'Analysis failed', details: error.message });
  }
});

/**
 * GET /decisions
 * Returns recent retail_decisions rows for the History tab.
 * Supabase keys never leave the server.
 */
app.get('/decisions', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('retail_decisions')
      .select('created_at, risk_level, executive_report')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Decisions fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch decisions' });
    }

    res.json({ decisions: data || [] });
  } catch (error) {
    console.error('Decisions error:', error);
    res.status(500).json({ error: 'Failed to fetch decisions', details: error.message });
  }
});

/**
 * POST /chat
 * Handles AI chat requests
 * Body: { question: "user question" }
 * Returns: { answer: "AI response" }
 */
/* ─── Multi-Provider AI Router ───────────────────────────────────────────────
 * Supported providers: groq | gemini | mistral | cohere
 * Add the matching API key in .env to enable each provider.
 */
async function callAI(provider, systemPrompt, question) {
  switch (provider) {

    // ── Groq (LLaMA) ──────────────────────────────────────────────────────────
    case 'groq':
    default: {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
          max_tokens: 600, temperature: 0.15,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Groq error ${res.status}`);
        err.status = res.status; err.body = txt; throw err;
      }
      const d = await res.json();
      return d.choices?.[0]?.message?.content ?? '';
    }

    // ── Google Gemini ─────────────────────────────────────────────────────────
    case 'gemini': {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY not set in .env');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: question }] }],
            generationConfig: { maxOutputTokens: 900, temperature: 0.15 },
          }),
        }
      );
      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Gemini error ${res.status}`);
        err.status = res.status; err.body = txt; throw err;
      }
      const d = await res.json();
      return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    // ── Mistral ───────────────────────────────────────────────────────────────
    case 'mistral': {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) throw new Error('MISTRAL_API_KEY not set in .env');
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
          max_tokens: 900, temperature: 0.15,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Mistral error ${res.status}`);
        err.status = res.status; err.body = txt; throw err;
      }
      const d = await res.json();
      return d.choices?.[0]?.message?.content ?? '';
    }

    // ── Cohere ────────────────────────────────────────────────────────────────
    case 'cohere': {
      const key = process.env.COHERE_API_KEY;
      if (!key) throw new Error('COHERE_API_KEY not set in .env');
      const res = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'command-r7b-12-2024',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
          max_tokens: 900, temperature: 0.15,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        const err = new Error(`Cohere error ${res.status}`);
        err.status = res.status; err.body = txt; throw err;
      }
      const d = await res.json();
      return d.message?.content?.[0]?.text ?? '';
    }
  }
}

// ─── Vectorless RAG — Page Index ─────────────────────────────────────────────

/**
 * Extract intent signals from the user's question.
 * Returns: { months, riskLevel, categories, isComparison, isRecent }
 */
function extractIntent(question) {
  const q = question.toLowerCase();

  const MONTH_MAP = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const CATEGORIES = [
    'electronics', 'clothing', 'apparel', 'food', 'grocery', 'groceries',
    'beauty', 'sports', 'furniture', 'books', 'toys', 'health', 'automotive',
  ];

  const months = Object.entries(MONTH_MAP)
    .filter(([name]) => q.includes(name))
    .map(([, num]) => num);

  const riskLevel =
    /\bhigh[\s-]?risk\b|\brisk.*high\b/.test(q) ? 'HIGH'   :
    /\bmedium[\s-]?risk\b|\brisk.*medium\b/.test(q) ? 'MEDIUM' :
    /\blow[\s-]?risk\b|\brisk.*low\b/.test(q) ? 'LOW'    : null;

  const categories = CATEGORIES.filter(c => q.includes(c));

  const isComparison = /compare|vs\.?|versus|difference|trend|over time|quarter|q[1-4]/.test(q);
  const isRecent     = /latest|recent|last|current|now|today|this (week|month|year)/.test(q);

  return { months, riskLevel, categories, isComparison, isRecent };
}

const CONTEXT_SELECT =
  'risk_level,risk_summary,risk_signals,mitigation_plan,trend_analysis,category_insights,recommendations,created_at';

/**
 * Smart context fetch — tries targeted queries first, falls back to recency.
 * Returns { data, error } matching Supabase client shape.
 */
async function smartFetchContext(question) {
  const intent = extractIntent(question);
  const { months, riskLevel, categories, isComparison, isRecent } = intent;

  const hasSignals = months.length > 0 || riskLevel || categories.length > 0;
  const limit      = isComparison ? 6 : 4;

  // ── Trace: intent ─────────────────────────────────────────────────────────
  console.log('\n┌─ [RAG] Question :', question);
  console.log('│  Intent parsed  :', JSON.stringify({
    months, riskLevel, categories, isComparison, isRecent, hasSignals
  }));

  // ── 1. Targeted search when clear signals exist ──────────────────────────
  if (hasSignals && !isRecent) {
    const sqlParts = [
      `SELECT risk_level, trend_analysis, category_insights, recommendations,`,
      `       risk_summary, risk_signals, mitigation_plan, created_at`,
      `FROM   retail_decisions`,
    ];

    const whereClauses = [];
    if (riskLevel)        whereClauses.push(`risk_level = '${riskLevel}'`);
    if (months.length)    whereClauses.push(`created_at ILIKE ANY(ARRAY[${months.map(m => `'%-${m}-%'`).join(', ')}])`);
    if (categories.length) whereClauses.push(
      `(${categories.map(c => `category_insights ILIKE '%${c}%' OR trend_analysis ILIKE '%${c}%'`).join(' OR ')})`
    );
    if (whereClauses.length) sqlParts.push(`WHERE  ${whereClauses.join('\n  AND  ')}`);
    sqlParts.push(`ORDER  BY created_at DESC\nLIMIT  ${limit};`);

    console.log('│  Strategy       : TARGETED');
    console.log('│  SQL equivalent :');
    sqlParts.forEach(l => console.log('│    ' + l));

    let query = supabase
      .from('retail_decisions')
      .select(CONTEXT_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (riskLevel)         query = query.eq('risk_level', riskLevel);
    if (months.length)     query = query.or(months.map(m => `created_at.ilike.%-${m}-%`).join(','));
    if (categories.length) query = query.or(
      categories.map(c => `category_insights.ilike.%${c}%,trend_analysis.ilike.%${c}%`).join(',')
    );

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      console.log('│  Result         :', data.length, 'records found');
      data.forEach((r, i) => console.log(`│    [${i+1}] ${r.created_at?.slice(0,10)}  risk=${r.risk_level}`));
      console.log('└─ [RAG] Using targeted results\n');
      return { data, error: null };
    }

    console.log('│  Result         : 0 records — falling back to recency');
  }

  // ── 2. Recency fallback ───────────────────────────────────────────────────
  const sql = [
    `SELECT risk_level, trend_analysis, category_insights, recommendations,`,
    `       risk_summary, risk_signals, mitigation_plan, created_at`,
    `FROM   retail_decisions`,
    `ORDER  BY created_at DESC`,
    `LIMIT  ${limit};`,
  ];

  console.log('│  Strategy       : RECENCY FALLBACK');
  console.log('│  SQL equivalent :');
  sql.forEach(l => console.log('│    ' + l));

  const { data, error } = await supabase
    .from('retail_decisions')
    .select(CONTEXT_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);

  console.log('│  Result         :', data?.length ?? 0, 'records found');
  (data || []).forEach((r, i) => console.log(`│    [${i+1}] ${r.created_at?.slice(0,10)}  risk=${r.risk_level}`));
  console.log('└─ [RAG] Using recency results\n');

  return { data, error };
}

// ─────────────────────────────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  try {
    const { question, chatHistory = [], sessionId, chartContext, provider = 'groq' } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Generate or use existing session ID
    const currentSessionId = sessionId || `conversation_${Date.now()}`;

    // ── Greeting shortcut — skip LLM entirely ──────────────────────────────
    const isGreeting = /^(hi+|hello+|hey+|howdy|greetings|sup|yo|hiya|what'?s\s*up)[\s!?.,]*$/i
      .test(question.trim());
    if (isGreeting) {
      return res.json({
        answer: "Hi! I'm your Retail AI Assistant. What would you like to know about your retail data? You can ask me about revenue trends, risk levels, category performance, or specific recommendations.",
        sessionId: currentSessionId,
      });
    }
    // ───────────────────────────────────────────────────────────────────────

    // Vectorless RAG — intent-aware context fetch
    const { data: contextData, error: contextError } = await smartFetchContext(question);

    if (contextError) {
      console.error('Supabase error:', contextError);
      return res.status(500).json({ error: 'Failed to fetch context' });
    }

    // Load last 6 chat exchanges (3 pairs) for context — keep it tight
    const { data: historyData, error: historyError } = await supabase
      .from('chat_history')
      .select('role, message')
      .eq('session_id', currentSessionId)
      .order('created_at', { ascending: false })
      .limit(6);

    if (historyError) {
      console.error('History fetch error:', historyError);
    }

    // Build context string from retail data
    const contextString = formatContextForLLM(contextData);

    // Build chat history string — reverse back to chronological order
    const chatHistoryString = formatChatHistory((historyData || []).reverse());

    // Build live chart context string from client-side parsed data
    const liveChartContext = chartContext ? `
Live Data from Uploaded File (${chartContext.totalRows} rows):
${chartContext.grandTotal ? `- Grand Total Revenue: ${chartContext.grandTotal}` : ''}
${chartContext.categoryBreakdown ? `- Revenue by Category: ${chartContext.categoryBreakdown}` : ''}
${chartContext.monthlyTrend ? `- Monthly Trend: ${chartContext.monthlyTrend}` : ''}
- Columns Available: ${(chartContext.columns || []).join(', ')}
` : '';

    // Build the system prompt
    const systemPrompt = `You are a senior retail analytics AI analyst embedded in a Decision Intelligence Dashboard. Your role is to deliver sharp, data-driven answers grounded exclusively in the data provided below.

${liveChartContext ? `═══ LIVE CHART DATA (source of truth from uploaded file) ═══\n${liveChartContext}` : ''}
═══ STORED ANALYSIS (from AI pipeline — most recent first) ═══
${contextString}

${chatHistoryString ? `═══ CONVERSATION HISTORY ═══\n${chatHistoryString}\n` : ''}

STRICT RULES — follow every one:
1. NEVER introduce yourself, say "Hello", "Hi", or greet the user. Jump directly into the data insight.
2. NEVER ask the user for more data or say "could you provide more information". You have the data — use it.
3. NEVER say "there is no explicit reason" — always reason from the numbers you have.
4. When risk is HIGH, identify the specific pattern causing it: concentration, volatility, category decline, low diversification, etc.
5. Always cite SPECIFIC numbers, percentages, and category names from the data (e.g. "Electronics is 47% of revenue").
6. Reference ALL categories present in the live chart data — never silently omit Groceries, Beauty, or smaller categories.
7. Structure answers clearly: state the finding, cite the evidence, give the recommendation.
8. Keep responses concise but complete — no filler phrases, no hedging.
9. If the user sends a bare greeting (hi, hello, hey, etc.), respond with exactly ONE short sentence like "Hi! What would you like to know about your retail data?" — do NOT dump data insights unprompted.`;

    // Call selected AI provider
    console.log(`🤖 Using provider: ${provider}`);
    let answer;
    try {
      answer = await callAI(provider, systemPrompt, question);
    } catch (aiErr) {
      console.error(`AI error (${provider}): status=${aiErr.status} msg=${aiErr.message}`);

      if (aiErr.status === 429) {
        // Return as a readable chat message so the client shows it inline
        return res.json({
          answer: `⚠️ **${provider}** is rate-limited (daily or per-minute quota reached). Use the provider dropdown in the chat header to switch to **Gemini**, **Mistral**, or **Cohere** and continue instantly.`,
          sessionId: currentSessionId,
        });
      }

      // Any other AI error — return as a friendly chat message, not a 500
      return res.json({
        answer: `⚠️ **${provider}** returned an error (${aiErr.status || 'unknown'}): ${aiErr.message}. Try switching to a different provider using the dropdown in the chat header.`,
        sessionId: currentSessionId,
      });
    }

    if (!answer || !answer.trim()) {
      answer = '⚠️ The AI returned an empty response. Please try again or switch providers.';
    }

    // Build or update the conversation row for this session
    const { data: existingRows, error: existingError } = await supabase
      .from('chat_history')
      .select('id, message')
      .eq('session_id', currentSessionId)
      .limit(1);

    if (existingError) {
      console.error('Supabase fetch session error:', existingError);
      return res.status(500).json({ error: 'Failed to load existing session', details: existingError.message });
    }

    const newTranscript = `User: ${question}\nAssistant: ${answer}`;

    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];
      const updatedMessage = `${existing.message}\n${newTranscript}`;
      const { error: updateError } = await supabase
        .from('chat_history')
        .update({ message: updatedMessage })
        .eq('id', existing.id);

      if (updateError) {
        console.error('Supabase update session error:', updateError);
        return res.status(500).json({ error: 'Failed to append to chat session', details: updateError.message });
      }
    } else {
      const { error: insertError } = await supabase
        .from('chat_history')
        .insert({
          session_id: currentSessionId,
          role: 'assistant',
          message: newTranscript
        });

      if (insertError) {
        console.error('Supabase insert session error:', insertError);
        return res.status(500).json({ error: 'Failed to save chat session', details: insertError.message });
      }
    }

    res.json({
      answer,
      sessionId: currentSessionId
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Failed to process chat request',
      details: error.message
    });
  }
});

/**
 * Format retail data for LLM context.
 * Exposes every non-empty field from the stored analysis so the AI
 * has full context — risk summary, signals, executive report, etc.
 */
function formatContextForLLM(data) {
  if (!data || data.length === 0) {
    return 'No stored analysis records found.';
  }

  // Only the fields the AI needs most — skip verbose executive_report to save tokens
  const FIELD_LABELS = {
    risk_level:        'Risk Level',
    risk_summary:      'Risk Summary',
    risk_signals:      'Risk Signals',
    mitigation_plan:   'Mitigation Plan',
    trend_analysis:    'Trend Analysis',
    category_insights: 'Category Insights',
    recommendations:   'Recommendations',
  };

  return data
    .map((row, index) => {
      const date = row.created_at
        ? new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown date';

      const lines = [`Record ${index + 1} — ${date}:`];

      for (const [field, label] of Object.entries(FIELD_LABELS)) {
        const value = row[field];
        if (value && String(value).trim() && field !== 'created_at') {
          // Truncate very long fields to keep context manageable
          const text = String(value).trim();
          lines.push(`  [${label}] ${text.length > 200 ? text.substring(0, 200) + '…' : text}`);
        }
      }

      // Include date at the end
      lines.push(`  [Date] ${date}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Format chat history for LLM context
 */
function formatChatHistory(history) {
  if (!history || history.length === 0) {
    return '';
  }

  return history
    .map((msg) => {
      if (typeof msg.message === 'string' && /^(User|Assistant):/.test(msg.message)) {
        return msg.message;
      }
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${msg.message}`;
    })
    .join('\n');
}

function parseCombinedHistoryRows(rows) {
  const parsed = [];
  rows.forEach((row) => {
    if (typeof row.message === 'string' && /^(User|Assistant):/m.test(row.message)) {
      const lines = row.message.split(/\r?\n/);
      let current = null;

      lines.forEach((line) => {
        const match = line.match(/^\s*(User|Assistant):\s*(.*)$/);
        if (match) {
          if (current) {
            parsed.push(current);
          }
          current = {
            role: match[1].toLowerCase(),
            message: match[2] || ''
          };
        } else if (current) {
          current.message += '\n' + line;
        }
      });

      if (current) {
        parsed.push(current);
      }
    } else {
      parsed.push({
        role: row.role,
        message: row.message
      });
    }
  });
  return parsed;
}

/**
 * GET /chat/history/:sessionId
 * Get chat history for a specific session
 */
app.get('/chat/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const { data: historyData, error: historyError } = await supabase
      .from('chat_history')
      .select('role, message, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (historyError) {
      console.error('History fetch error:', historyError);
      return res.status(500).json({ error: 'Failed to fetch chat history' });
    }

    const history = parseCombinedHistoryRows(historyData || []);
    res.json({ history });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({
      error: 'Failed to load chat history',
      details: error.message
    });
  }
});

/**
 * GET /chat/sessions
 * Get list of recent chat sessions
 */
app.get('/chat/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chat_history')
      .select('session_id, role, message, created_at')
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) {
      console.error('Sessions fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }

    // Group rows by session_id
    const map = {};
    (data || []).forEach(row => {
      if (!map[row.session_id]) {
        map[row.session_id] = {
          sessionId:    row.session_id,
          title:        null,        // first user message
          createdAt:    row.created_at,
          updatedAt:    row.created_at,
          messageCount: 0,
        };
      }
      const s = map[row.session_id];
      s.messageCount++;
      s.updatedAt = row.created_at;

      if (!s.title && row.message) {
        // Messages are stored as combined "User: ...\nAssistant: ..." transcript
        // Extract the first User line as the session title
        const userMatch = row.message.match(/^User:\s*(.+?)(?:\n|$)/im);
        const rawTitle  = userMatch ? userMatch[1].trim() : null;

        // Fallback: if stored as plain user message with role='user'
        const plainTitle = (!rawTitle && row.role === 'user') ? row.message.trim() : null;

        const title = rawTitle || plainTitle;
        if (title) {
          // Trim to 55 chars, clean up whitespace
          s.title = title.length > 55 ? title.slice(0, 52) + '…' : title;
        }
      }
    });

    const sessions = Object.values(map)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json({ sessions });
  } catch (error) {
    console.error('Sessions error:', error);
    res.status(500).json({ error: 'Failed to load sessions', details: error.message });
  }
});

/**
 * DELETE /chat/session/:sessionId
 * Permanently deletes all messages for a session from Supabase.
 */
app.delete('/chat/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const { error } = await supabase
      .from('chat_history')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('Delete session error:', error);
      return res.status(500).json({ error: 'Failed to delete session', details: error.message });
    }

    console.log(`🗑️  Deleted session from Supabase: ${sessionId}`);
    res.json({ success: true, sessionId });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session', details: error.message });
  }
});

/**
 * GET /providers
 * Returns which AI providers have API keys configured.
 * Frontend uses this to show only available providers in the dropdown.
 */
app.get('/providers', (_req, res) => {
  res.json({
    groq:    !!process.env.GROQ_API_KEY,
    gemini:  !!process.env.GEMINI_API_KEY,
    mistral: !!process.env.MISTRAL_API_KEY,
    cohere:  !!process.env.COHERE_API_KEY,
  });
});

/**
 * GET /status
 * Returns which env vars are configured (values hidden).
 * Visit http://localhost:3001/status in the browser to verify your .env.
 */
app.get('/status', (_req, res) => {
  res.json({
    server:   'Retail AI — Decision Intelligence',
    port,
    env: {
      SUPABASE_URL:              !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GROQ_API_KEY:              !!process.env.GROQ_API_KEY,
      WEBHOOK_URL:               !!process.env.WEBHOOK_URL,
      ANALYSIS_MODE:             process.env.ANALYSIS_MODE || '(not set — defaulting to trend,category,monthly)',
    },
  });
});

// Static files — must be LAST so API routes are never blocked by serve-static
app.use(express.static('.'));

/**
 * Start server
 */
app.listen(port, () => {
  console.log(`\n🚀  Retail AI server  →  http://localhost:${port}`);
  console.log(`📊  Status check      →  http://localhost:${port}/status\n`);
  console.log('Env vars loaded:');
  console.log(`  SUPABASE_URL              : ${process.env.SUPABASE_URL              ? '✅ set' : '❌ MISSING'}`);
  console.log(`  SUPABASE_SERVICE_ROLE_KEY : ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ set' : '❌ MISSING'}`);
  console.log(`  GROQ_API_KEY              : ${process.env.GROQ_API_KEY              ? '✅ set' : '❌ MISSING'}`);
  console.log(`  WEBHOOK_URL               : ${process.env.WEBHOOK_URL               ? '✅ set' : '❌ MISSING'}`);
  console.log(`  ANALYSIS_MODE             : ${process.env.ANALYSIS_MODE             || '(default: trend,category,monthly)'}`);
  console.log('');
});
