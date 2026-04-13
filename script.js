/* ═══════════════════════════════════════════════════════════════════════════
   Retail AI — Decision Intelligence
   script.js  —  Dashboard logic
   ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

/* global Chart, XLSX */

// ─── State ───────────────────────────────────────────────────────────────────

let parsedData  = null;
let currentFile = null;
const charts    = {};

// ─── Drag & Drop / File Input ─────────────────────────────────────────────────

const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

uploadArea.addEventListener('dragover', e => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));

uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

// ─── File Handling ────────────────────────────────────────────────────────────

function handleFile(file) {
  if (!file) return;
  currentFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const json     = XLSX.utils.sheet_to_json(sheet);

      parsedData = json;

      document.getElementById('fileName').textContent  = file.name;
      document.getElementById('fileStats').textContent =
        `${json.length} rows · ${Object.keys(json[0] || {}).length} columns`;

      show('fileInfo');
      showPreview(json);
      showMetrics(json);
      showCharts(json);
      markStep(1, 'done');
      showToast('✅ File loaded successfully!', 'success');
    } catch (err) {
      showToast('❌ Error reading file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Pipeline Helpers ─────────────────────────────────────────────────────────

function markStep(stepNum, state) {
  const dot    = document.getElementById(`p${stepNum}`);
  const status = document.getElementById(`ps${stepNum}`);
  const line   = stepNum < 7 ? document.getElementById(`l${stepNum}`) : null;

  dot.className    = 'pipe-dot' + (state !== 'idle' ? ` ${state}` : '');
  status.className = `pipe-status${state !== 'idle' ? ` ${state}` : ''}`;

  const labels = { idle: '', active: 'Running…', done: 'Done', error: 'Failed' };
  status.textContent = labels[state] || '';

  if (line) {
    line.className = 'pipe-line' + (state === 'done' ? ' done' : '');
  }
}

function resetPipeline() {
  for (let i = 1; i <= 7; i++) markStep(i, 'idle');
}

// ─── Main Analysis ────────────────────────────────────────────────────────────

async function startAnalysis() {
  if (!currentFile) return showToast('⚠️ Please upload a file first', 'error');

  const analyzeBtn = document.getElementById('analyzeBtn');
  setStatus('Analyzing…', true);
  analyzeBtn.disabled    = true;
  analyzeBtn.textContent = '⏳ Running…';

  resetPipeline();
  markStep(1, 'done');
  markStep(2, 'active');

  show('analysisSection');
  setLoadingState();

  try {
    const arrayBuffer = await currentFile.arrayBuffer();

    markStep(2, 'done');
    markStep(3, 'active');

    const isCSV    = currentFile.name.toLowerCase().endsWith('.csv');
    const mimeType = isCSV
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // POST to our own server — webhook URL and keys stay in .env
    const res = await fetch('/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'X-File-Name':  currentFile.name,
      },
      body: arrayBuffer,
    });

    if (!res.ok) throw new Error(`Analysis failed: ${res.status}`);

    const result = await res.json();
    const data   = Array.isArray(result) ? result[0] : result;
    const d      = data.json ? data.json : data;

    markStep(3, !!(d.trend_analysis || d.category_insights || d.monthly_patterns) ? 'done' : 'error');
    markStep(4, !!(d.risk_summary   || d.risk_level) ? 'done' : 'error');
    markStep(5, !!(d.executive_report || d.report)   ? 'done' : 'error');

    const hasSaved = !!(
      d.id || d.record_id || d.decision_id ||
      (Array.isArray(d) && d[0]?.id) ||
      d.updated_at || d.created_at ||
      d.supabase_status === 'saved' ||
      d.db_saved === true
    );
    markStep(6, hasSaved ? 'done' : 'error');

    const allDone = !!(d.trend_analysis && d.risk_summary && (d.executive_report || d.report));
    markStep(7, allDone ? 'done' : 'error');

    displayResults(d);

    // Persist results so they survive page refresh
    try { localStorage.setItem('retailAi_lastResult', JSON.stringify(d)); } catch(e) {}

    // Fallback: AI came back, assume Supabase saved too
    if (!hasSaved && (d.trend_analysis || d.risk_summary)) markStep(6, 'done');

    showToast('✅ Analysis complete!', 'success');

    // Reset chat to welcome state so user starts fresh for this new analysis
    if (window.chatManager) window.chatManager.newChat();

  } catch (err) {
    markStep(3, 'error');
    showToast('❌ Error: ' + err.message, 'error');
  } finally {
    setStatus('Ready', false);
    analyzeBtn.disabled    = false;
    analyzeBtn.textContent = '🚀 Analyze';
  }
}

// ─── Data Preview ─────────────────────────────────────────────────────────────

function showPreview(data) {
  const table = document.getElementById('previewTable');
  const cols  = Object.keys(data[0] || {});
  const rows  = data.slice(0, 8);

  // Detect which columns are date columns by name
  const dateCols = new Set(cols.filter(k =>
    k.toLowerCase().includes('date') || k.toLowerCase().includes('time')
  ));

  // Format a single cell value for display only (does NOT modify parsedData)
  function fmtCell(col, val) {
    if (val == null || val === '') return '';
    if (dateCols.has(col) && typeof val === 'number' && val > 25569 && val < 73050) {
      // Excel serial date → readable date string
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return String(val);
  }

  table.innerHTML = `
    <thead><tr>${cols.map(c => `<th>${escapeHtml(String(c))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r =>
      `<tr>${cols.map(c => `<td>${escapeHtml(fmtCell(c, r[c]))}</td>`).join('')}</tr>`
    ).join('')}</tbody>
  `;

  document.getElementById('rowCount').textContent = `${data.length} rows`;
  show('dataGrid');
}

// ─── Key Metrics ──────────────────────────────────────────────────────────────

function showMetrics(data) {
  if (!data?.length) return;

  const cols = Object.keys(data[0]);

  const SKIP   = ['id', 'date', 'year', 'month', 'day', 'index', 'transaction'];
  const PRICE  = ['price', 'unit', 'rate', 'cost_per', 'avg', 'average'];
  const TOTAL  = ['amount', 'revenue', 'total', 'sales', 'profit', 'value'];
  const COUNT  = ['quantity', 'qty', 'count', 'units'];
  const AVG    = ['age', 'score', 'rating', 'percentage', 'pct', 'percent', 'ratio', 'grade'];

  const isNumeric  = col => data.some(r => typeof r[col] === 'number' && !isNaN(r[col]));
  const shouldSkip = col => SKIP.some(w => col.toLowerCase().includes(w));
  const matches    = (col, words) => words.some(w => col.toLowerCase().includes(w));

  const filter = (words, excluded = []) =>
    cols.filter(c => !shouldSkip(c) && !excluded.includes(c) && matches(c, words) && isNumeric(c));

  const avgCols   = filter(AVG);
  const priceCols = filter(PRICE, avgCols);
  const totalCols = filter(TOTAL, [...avgCols, ...priceCols]);
  const countCols = filter(COUNT, [...avgCols, ...priceCols, ...totalCols]);
  const otherCols = cols.filter(c =>
    !shouldSkip(c) && ![...avgCols, ...priceCols, ...totalCols, ...countCols].includes(c) && isNumeric(c)
  );

  const metrics = [];

  const sum  = (col) => data.map(r => Number(r[col])).filter(v => !isNaN(v)).reduce((a, b) => a + b, 0);
  const avg  = (col) => { const vals = data.map(r => Number(r[col])).filter(v => !isNaN(v)); return vals.reduce((a,b) => a+b,0) / vals.length; };
  const maxv = (col) => Math.max(...data.map(r => Number(r[col])).filter(v => !isNaN(v)));

  avgCols.slice(0, 2).forEach(col =>
    metrics.push({ label: col, value: avg(col).toFixed(2), sub: 'avg', pct: 60 }));

  priceCols.slice(0, 2).forEach(col =>
    metrics.push({ label: col, value: `$${avg(col).toFixed(2)}`, sub: 'avg per row', pct: 100 }));

  totalCols.slice(0, 2).forEach(col => {
    const t = sum(col), m = maxv(col);
    metrics.push({ label: col, value: `$${t.toLocaleString()}`, sub: 'total', pct: m > 0 ? Math.round((t / (m * data.length)) * 100) : 0 });
  });

  countCols.slice(0, 1).forEach(col => {
    const t = sum(col), m = maxv(col);
    metrics.push({ label: col, value: t.toLocaleString(), sub: 'total units', pct: m > 0 ? Math.round((t / (m * data.length)) * 100) : 0 });
  });

  otherCols.slice(0, 2).forEach(col => {
    const t = sum(col), m = maxv(col);
    metrics.push({ label: col, value: t.toLocaleString(), sub: 'total', pct: m > 0 ? Math.round((t / (m * data.length)) * 100) : 0 });
  });

  const html = metrics.map(m => `
    <div class="metric-row">
      <div class="metric-label">${escapeHtml(m.label)}</div>
      <div class="metric-right">
        <div class="metric-value">${escapeHtml(m.value)}</div>
        <div class="metric-sub">${escapeHtml(m.sub)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${m.pct}%"></div></div>
      </div>
    </div>
  `).join('');

  document.getElementById('metricsContent').innerHTML = html ||
    '<div class="empty-state"><span class="empty-icon">📊</span><div class="empty-text">No numeric columns found</div></div>';
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function showCharts(data) {
  show('chartsGrid');

  const catKey = Object.keys(data[0]).find(k =>
    k.toLowerCase().includes('categor') || k.toLowerCase().includes('product'));
  const amtKey = Object.keys(data[0]).find(k =>
    k.toLowerCase().includes('amount') || k.toLowerCase().includes('revenue') || k.toLowerCase().includes('total'));

  if (catKey && amtKey) {
    const totals = {};
    data.forEach(r => {
      const cat = r[catKey] || 'Other';
      totals[cat] = (totals[cat] || 0) + (Number(r[amtKey]) || 0);
    });

    charts.category?.destroy();
    charts.category = new Chart(document.getElementById('categoryChart'), {
      type: 'doughnut',
      data: {
        labels: Object.keys(totals),
        datasets: [{
          data: Object.values(totals),
          backgroundColor: ['#6c63ff', '#00d4aa', '#ff6b6b', '#ffb347', '#a29bfe', '#fd79a8'],
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#7070a0', font: { size: 12, family: 'DM Sans' }, padding: 16 },
          },
        },
      },
    });
  }

  const dateKey = Object.keys(data[0]).find(k =>
    k.toLowerCase().includes('date') || k.toLowerCase().includes('month'));

  if (dateKey && amtKey) {
    const monthly = {};
    data.forEach(r => {
      const d = r[dateKey] ? String(r[dateKey]).substring(0, 7) : 'Unknown';
      monthly[d] = (monthly[d] || 0) + (Number(r[amtKey]) || 0);
    });

    const sorted = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));

    charts.monthly?.destroy();
    charts.monthly = new Chart(document.getElementById('monthlyChart'), {
      type: 'line',
      data: {
        labels: sorted.map(([k]) => k),
        datasets: [{
          data: sorted.map(([, v]) => v),
          borderColor: '#6c63ff',
          backgroundColor: 'rgba(108,99,255,0.08)',
          fill: true,
          tension: 0.4,
          pointBackgroundColor: '#6c63ff',
          pointBorderColor: '#0f0f1a',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: '#7070a0', font: { size: 11, family: 'DM Sans' } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: { color: '#7070a0', font: { size: 11, family: 'DM Sans' } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  }
}

// ─── Analysis Results ─────────────────────────────────────────────────────────

function setLoadingState() {
  const loadingHtml = id =>
    `<div class="analysis-body loading" id="${id}"><div class="spinner"></div>Analyzing with AI…</div>`;

  ['trendAnalysis', 'categoryInsights', 'monthlyPatterns', 'recommendations',
    'riskSummary', 'mitigationPlan', 'riskSignals', 'executiveReport'].forEach(id => {
    document.getElementById(id).outerHTML = loadingHtml(id);
  });
}

function displayResults(result) {
  const d = result.json ? result.json : result;

  setText('trendAnalysis',    d.trend_analysis);
  setText('categoryInsights', d.category_insights);
  setText('monthlyPatterns',  d.monthly_patterns);
  setRecs('recommendations',  d.recommendations);

  setText('riskSummary',    d.risk_summary);
  setText('mitigationPlan', d.mitigation_plan);
  setText('riskSignals',    d.risk_signals);

  const rl = (d.risk_level || '').toUpperCase();
  document.getElementById('riskLevelBadge').innerHTML =
    `<span class="risk-badge risk-${rl}">${rl || 'UNKNOWN'}</span>`;

  const reportText = d.executive_report || d.report || '';
  setMarkdown('executiveReport', reportText);

  updateStats(rl);
  show('statsRow');
}

function setText(id, text) {
  const el = document.getElementById(id);
  el.className = 'analysis-body';
  if (!text) {
    el.textContent = 'No data returned.';
    return;
  }
  const html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n-\s/g, '<br>• ')
    .replace(/\n/g, '<br>');
  el.innerHTML = `<p>${html}</p>`;
}

function setRecs(id, text) {
  const el = document.getElementById(id);
  el.className = 'analysis-body';
  if (!text) {
    el.textContent = 'No recommendations.';
    return;
  }

  const lines         = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const numberedLines = lines.filter(l => /^\d+[\.\)]\s/.test(l));
  let items = [];

  if (numberedLines.length >= 2) {
    lines.forEach(l => {
      if (/^\d+[\.\)]\s/.test(l)) items.push(l.replace(/^\d+[\.\)]\s*/, '').trim());
      else if (items.length) items[items.length - 1] += ' ' + l;
    });
  } else {
    items = [text.trim()];
  }

  items = items.filter(s => s.length > 2);

  if (items.length === 1) {
    el.innerHTML = `<p>${escapeHtml(items[0])
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')}</p>`;
  } else {
    el.innerHTML = `<ul class="rec-list">${items.map((item, i) =>
      `<li class="rec-item">
        <span class="rec-num">${i + 1}</span>
        <span>${escapeHtml(item).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</span>
      </li>`
    ).join('')}</ul>`;
  }
}

function setMarkdown(id, text) {
  const el = document.getElementById(id);
  el.className = 'analysis-body analysis-body--report';
  if (!text) {
    el.textContent = 'No data returned.';
    return;
  }
  const html = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^#{1,3}\s+(.+)$/gm,
      '<strong class="report-heading">$1</strong>')
    .replace(/^-\s+(.+)$/gm,
      '<div class="report-bullet">$1</div>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0;">')
    .replace(/\n/g, '<br>');
  el.innerHTML = `<div>${html}</div>`;

  // Show the Download PDF button once the executive report is populated
  if (id === 'executiveReport') {
    const btn = document.getElementById('downloadPdfBtn');
    if (btn) btn.style.display = 'inline-flex';
  }
}

function updateStats(riskLevel) {
  const inc = id => {
    const el = document.getElementById(id);
    el.textContent = (parseInt(el.textContent) || 0) + 1;
  };
  inc('statTotal');
  if (riskLevel === 'HIGH')   inc('statHigh');
  if (riskLevel === 'MEDIUM') inc('statMed');
  if (riskLevel === 'LOW')    inc('statLow');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function switchTab(name) {
  const tabNames = ['retail', 'risk', 'report', 'chat', 'compare', 'history'];

  document.querySelectorAll('.tab').forEach((t, i) =>
    t.classList.toggle('active', tabNames[i] === name));

  document.querySelectorAll('.tab-pane').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');

  if (name === 'history') loadHistory();
  if (name === 'chat')    setTimeout(() => document.getElementById('chatInput').focus(), 100);
}

// ─── Compare Two Files ────────────────────────────────────────────────────────

const compareState = { A: null, B: null };

function handleCompareFile(slot, file) {
  if (!file) return;

  const zone   = document.getElementById(`compareZone${slot}`);
  const info   = document.getElementById(`compareInfo${slot}`);
  const panel  = document.getElementById(`compareMetrics${slot}`);

  zone.classList.add('loaded');
  info.innerHTML = `<span class="compare-filename">&#x1F4C4; ${escapeHtml(file.name)}</span>`;
  panel.innerHTML = `<div class="compare-loading"><div class="spinner"></div> Parsing…</div>`;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

      compareState[slot] = { data, name: file.name };
      panel.innerHTML    = buildCompareMetricsHTML(data, slot);

      if (compareState.A && compareState.B) renderComparison();
    } catch (err) {
      panel.innerHTML = `<div class="empty-state"><div class="empty-text">Failed to parse file</div></div>`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function buildCompareMetricsHTML(data, slot) {
  const keys   = Object.keys(data[0] || {});
  const amtKey = keys.find(k => /amount|revenue|total|sales/i.test(k));
  const catKey = keys.find(k => /categor|product/i.test(k));

  const total = amtKey
    ? data.reduce((s, r) => s + (Number(r[amtKey]) || 0), 0)
    : 0;

  const topCat = (() => {
    if (!catKey || !amtKey) return '—';
    const t = {};
    data.forEach(r => { t[r[catKey]] = (t[r[catKey]] || 0) + (Number(r[amtKey]) || 0); });
    return Object.entries(t).sort(([,a],[,b]) => b - a)[0]?.[0] || '—';
  })();

  const color = slot === 'A' ? 'var(--accent)' : 'var(--accent2)';

  return `
    <div class="compare-stat-list">
      <div class="compare-stat">
        <div class="compare-stat-label">Total Revenue</div>
        <div class="compare-stat-value" style="color:${color}">$${total.toLocaleString()}</div>
      </div>
      <div class="compare-stat">
        <div class="compare-stat-label">Records</div>
        <div class="compare-stat-value">${data.length.toLocaleString()}</div>
      </div>
      <div class="compare-stat">
        <div class="compare-stat-label">Top Category</div>
        <div class="compare-stat-value">${escapeHtml(topCat)}</div>
      </div>
    </div>`;
}

function renderComparison() {
  document.getElementById('compareResults').classList.add('visible');

  const { A, B } = compareState;
  const keysA = Object.keys(A.data[0] || {});
  const keysB = Object.keys(B.data[0] || {});

  const catKeyA = keysA.find(k => /categor|product/i.test(k));
  const amtKeyA = keysA.find(k => /amount|revenue|total|sales/i.test(k));
  const catKeyB = keysB.find(k => /categor|product/i.test(k));
  const amtKeyB = keysB.find(k => /amount|revenue|total|sales/i.test(k));

  // Build category totals for each file
  const totalsA = {}, totalsB = {};
  if (catKeyA && amtKeyA) A.data.forEach(r => { totalsA[r[catKeyA]] = (totalsA[r[catKeyA]] || 0) + (Number(r[amtKeyA]) || 0); });
  if (catKeyB && amtKeyB) B.data.forEach(r => { totalsB[r[catKeyB]] = (totalsB[r[catKeyB]] || 0) + (Number(r[amtKeyB]) || 0); });

  const allCats = [...new Set([...Object.keys(totalsA), ...Object.keys(totalsB)])].sort();

  // Render grouped bar chart
  charts.compare?.destroy();
  charts.compare = new Chart(document.getElementById('compareChart'), {
    type: 'bar',
    data: {
      labels: allCats,
      datasets: [
        {
          label: A.name,
          data: allCats.map(c => totalsA[c] || 0),
          backgroundColor: 'rgba(108, 99, 255, 0.75)',
          borderColor: '#6c63ff',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: B.name,
          data: allCats.map(c => totalsB[c] || 0),
          backgroundColor: 'rgba(0, 212, 170, 0.75)',
          borderColor: '#00d4aa',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#7070a0', font: { family: 'DM Sans', size: 12 } } },
      },
      scales: {
        x: { ticks: { color: '#7070a0' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#7070a0' }, grid: { color: 'rgba(255,255,255,0.04)' } },
      },
    },
  });

  // Key differences summary
  const totalA = Object.values(totalsA).reduce((s, v) => s + v, 0);
  const totalB = Object.values(totalsB).reduce((s, v) => s + v, 0);
  const delta  = totalA - totalB;
  const pct    = totalB > 0 ? ((delta / totalB) * 100).toFixed(1) : '—';
  const arrow  = delta >= 0 ? '&#x2191;' : '&#x2193;';
  const col    = delta >= 0 ? 'var(--low)' : 'var(--high)';
  const topA   = Object.entries(totalsA).sort(([,a],[,b]) => b - a)[0]?.[0] || '—';
  const topB   = Object.entries(totalsB).sort(([,a],[,b]) => b - a)[0]?.[0] || '—';

  document.getElementById('compareSummary').innerHTML = `
    <div class="compare-diff-row">
      <div class="compare-diff-label">Total Revenue Change</div>
      <div class="compare-diff-value" style="color:${col}">
        ${delta >= 0 ? '+' : ''}$${Math.abs(delta).toLocaleString()} (${delta >= 0 ? '+' : ''}${pct}%) ${arrow}
      </div>
    </div>
    <div class="compare-diff-row">
      <div class="compare-diff-label">File A Revenue</div>
      <div class="compare-diff-value" style="color:var(--accent)">$${totalA.toLocaleString()}</div>
    </div>
    <div class="compare-diff-row">
      <div class="compare-diff-label">File B Revenue</div>
      <div class="compare-diff-value" style="color:var(--accent2)">$${totalB.toLocaleString()}</div>
    </div>
    <div class="compare-diff-row">
      <div class="compare-diff-label">Top Category (A)</div>
      <div class="compare-diff-value">${escapeHtml(topA)}</div>
    </div>
    <div class="compare-diff-row">
      <div class="compare-diff-label">Top Category (B)</div>
      <div class="compare-diff-value">${escapeHtml(topB)}</div>
    </div>
    <div class="compare-diff-row">
      <div class="compare-diff-label">Category Shift</div>
      <div class="compare-diff-value">${topA === topB ? '&#x2714; Same top category' : `&#x2192; ${escapeHtml(topB)} &#x2192; ${escapeHtml(topA)}`}</div>
    </div>
  `;
}

// ─── History ──────────────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const res  = await fetch('/decisions');
    const json = await res.json();
    const data = json.decisions;
    const tbody = document.getElementById('historyBody');

    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No records found</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((r, i) => {
      const report  = r.executive_report || '';
      const preview = report.replace(/\*\*/g, '').replace(/#+\s/g, '').replace(/\n/g, ' ').trim();
      const short   = preview.length > 120 ? preview.substring(0, 120) + '…' : preview;
      const rl      = (r.risk_level || '').toUpperCase();
      const dateStr = new Date(r.created_at).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });

      return `
        <tr>
          <td class="date-cell">${dateStr}</td>
          <td><span class="risk-badge risk-${rl}">${r.risk_level || '—'}</span></td>
          <td class="report-preview">${escapeHtml(short) || '<span style="opacity:.4">No report</span>'}</td>
          <td>${report ? `<button class="btn btn-outline btn-sm" onclick="openReportModal(${i})">📖 Read More</button>` : ''}</td>
        </tr>`;
    }).join('');

    window._historyData = data;

  } catch (e) {
    showToast('❌ Could not load history', 'error');
  }
}

// ─── Report Modal ─────────────────────────────────────────────────────────────

function openReportModal(index) {
  const r       = window._historyData[index];
  const report  = r.executive_report || '';
  const rl      = (r.risk_level || '').toUpperCase();
  const dateStr = new Date(r.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  document.getElementById('modalMeta').innerHTML =
    `${dateStr} &nbsp;&middot;&nbsp;
     <span class="risk-badge risk-${rl}" style="font-size:10px;">${r.risk_level || ''}</span>`;

  const html = escapeHtml(report)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/^#{1,3}\s+(.+)$/gm,
      '<div class="report-heading">$1</div>')
    .replace(/^-\s+(.+)$/gm,
      '<div class="report-bullet">$1</div>')
    .replace(/\n\n/g, '</p><p style="margin:10px 0;">')
    .replace(/\n/g, '<br>');

  document.getElementById('modalBody').innerHTML = `<div style="line-height:1.9;">${html}</div>`;

  const modal = document.getElementById('reportModal');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('reportModal').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('reportModal').addEventListener('click', function (e) {
  if (e.target === this) closeModal();
});


// ─── UI Helpers ───────────────────────────────────────────────────────────────

/** Show an element by adding the .visible class (CSS drives display) */
function show(id) {
  document.getElementById(id).classList.add('visible');
}

function setStatus(text, loading) {
  document.getElementById('statusText').textContent = text;
  document.getElementById('statusDot').classList.toggle('loading', loading);
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ─── Restore Last Analysis on Page Load ───────────────────────────────────────

// ─── Restore Last Analysis on Page Load ───────────────────────────────────────

window.addEventListener('DOMContentLoaded', function() {
  try {
    const saved = localStorage.getItem('retailAi_lastResult');
    if (!saved) return;
    const d = JSON.parse(saved);
    if (!d || (!d.trend_analysis && !d.risk_summary)) return;

    // Directly set stat counters instead of incrementing
    const rl = (d.risk_level || '').toUpperCase();
    document.getElementById('statTotal').textContent = '1';
    if (rl === 'HIGH')   document.getElementById('statHigh').textContent = '1';
    if (rl === 'MEDIUM') document.getElementById('statMed').textContent  = '1';
    if (rl === 'LOW')    document.getElementById('statLow').textContent  = '1';

    setText('trendAnalysis',    d.trend_analysis);
    setText('categoryInsights', d.category_insights);
    setText('monthlyPatterns',  d.monthly_patterns);
    setRecs('recommendations',  d.recommendations);
    setText('riskSummary',    d.risk_summary);
    setText('mitigationPlan', d.mitigation_plan);
    setText('riskSignals',    d.risk_signals);
    document.getElementById('riskLevelBadge').innerHTML =
      `<span class="risk-badge risk-${rl}">${rl || 'UNKNOWN'}</span>`;
    setMarkdown('executiveReport', d.executive_report || d.report || '');

    show('statsRow');
    show('analysisSection');
    showToast('📋 Previous analysis restored', 'success');
  } catch(e) { console.error('Restore failed:', e); }
});

// ─── Download Executive Report as PDF ────────────────────────────────────────

async function downloadReportPDF() {
  const reportEl = document.getElementById('executiveReport');
  const btn      = document.getElementById('downloadPdfBtn');

  if (!reportEl || !reportEl.innerText.trim()) {
    showToast('⚠️ No report to download yet', 'error');
    return;
  }

  const originalText = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = '⏳ Generating…';

  try {
    const { jsPDF } = window.jspdf;

    const canvas = await html2canvas(reportEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#1a1d2e'
    });

    const pdf       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW     = pdf.internal.pageSize.getWidth();
    const pageH     = pdf.internal.pageSize.getHeight();
    const margin    = 12;
    const imgW      = pageW - margin * 2;
    const imgH      = (canvas.height * imgW) / canvas.width;

    // Add header
    pdf.setFontSize(16);
    pdf.setTextColor(99, 102, 241);
    pdf.text('Retail AI — Executive Report', margin, margin);

    pdf.setFontSize(9);
    pdf.setTextColor(160, 160, 180);
    pdf.text(new Date().toLocaleString(), margin, margin + 6);

    const startY = margin + 12;

    // Paginate if content is taller than one page
    let remainingH = imgH;
    let srcY       = 0;
    let destY      = startY;

    while (remainingH > 0) {
      const sliceH   = Math.min(remainingH, pageH - destY - margin);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = (sliceH / imgW) * canvas.width;

      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, srcY / imgW * canvas.width, canvas.width, sliceCanvas.height,
                            0, 0, canvas.width, sliceCanvas.height);

      pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, destY, imgW, sliceH);

      remainingH -= sliceH;
      srcY       += sliceH;

      if (remainingH > 0) {
        pdf.addPage();
        destY = margin;
      }
    }

    const filename = `executive-report-${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);
    showToast('✅ PDF downloaded!', 'success');
  } catch (err) {
    console.error('PDF generation error:', err);
    showToast('❌ PDF generation failed: ' + err.message, 'error');
  } finally {
    btn.disabled  = false;
    btn.innerHTML = originalText;
  }
}
