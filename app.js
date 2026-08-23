// ── CONFIG ──
const BACKEND_URL = 'http://localhost:3001';

// ── STATE ──
let currentFile = null, currentMode = null, urlModeActive = false;
let analysisHistory = []; // [{id, name, thumb, verdict, aiPct, result, mode}]

// SIH26204 — blockchain layer state (kept separate from the existing
// AI-detection state above; never influences currentFile/currentMode/etc.)
let currentAnalysisResult = null;
let currentAnalysisName   = null;
let currentBcRecord       = null;
let bcRegistering         = false;

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop();
  checkBackend();
  setupIntro();
  setupExtensionImage();
});

/* ── CHROME EXTENSION INTEGRATION ──
   If Aletheia was opened by the browser extension with:
   ?extensionImage=<image-url>
   automatically put that URL into the existing URL analyzer
   and start the normal analysis pipeline.
*/
function setupExtensionImage() {
  const params = new URLSearchParams(window.location.search);
  const imageUrl = params.get('extensionImage');

  if (!imageUrl) return;

  // Only accept absolute HTTP(S) URLs.
  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    showError('The extension supplied an invalid image URL.');
    return;
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    showError('The extension supplied an unsupported image URL.');
    return;
  }

  const urlInput = document.getElementById('urlInput');
  if (!urlInput) return;

  // Switch the existing analyzer to URL mode.
  if (!urlModeActive) toggleUrl();

  urlInput.value = imageUrl;

  // Remove the parameter from the visible browser URL so a refresh
  // does not accidentally submit the same image again.
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('extensionImage');
  window.history.replaceState({}, document.title, cleanUrl.toString());

  // Let the page finish rendering before starting the normal analyzer.
  setTimeout(() => {
    startAnalysis();
  }, 250);
}

async function checkBackend() {
  const el = document.getElementById('backendStatus');
  try {
    const r = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
    el.innerHTML = r.ok
      ? `<span style="color:var(--green);font-family:var(--font-mono);font-size:10px">● connected</span>`
      : `<span style="color:var(--warn);font-family:var(--font-mono);font-size:10px">⚠ degraded</span>`;
  } catch {
    el.innerHTML = `<span style="color:var(--danger);font-family:var(--font-mono);font-size:10px">✕ offline</span>`;
  }
}

// ── URL TOGGLE ──
function toggleUrl() {
  urlModeActive = !urlModeActive;
  document.getElementById('urlRow').style.display = urlModeActive ? 'flex' : 'none';
  document.getElementById('urlToggle').classList.toggle('active', urlModeActive);
  if (urlModeActive && currentFile) clearMedia();
}

// ── FILE HANDLING ──
function handleFile(event, type) {
  const file = event.target.files[0];
  if (!file) return;
  setMedia(file, type);
  event.target.value = '';
}

function setMedia(file, type) {
  currentFile = file; currentMode = type;
  if (urlModeActive) toggleUrl();
  const pa = document.getElementById('previewArea');
  pa.style.display = 'flex';

  const pi = document.getElementById('previewInner');
  pi.innerHTML = '';
  pi.className = '';
  pi.removeAttribute('style');

  if (type === 'image') {
    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb-wrap';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    const rmBtn = document.createElement('button');
    rmBtn.className = 'rm-btn';
    rmBtn.title = 'Remove';
    rmBtn.onclick = clearMedia;
    rmBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    wrap.appendChild(img);
    wrap.appendChild(rmBtn);
    pi.appendChild(wrap);
  } else if (type === 'video') {
    const wrap = document.createElement('div');
    wrap.className = 'preview-thumb-wrap';
    const vid = document.createElement('video');
    vid.src = URL.createObjectURL(file);
    vid.muted = true; vid.playsInline = true;
    vid.currentTime = 0.1;
    const badge = document.createElement('div');
    badge.className = 'preview-play-badge';
    badge.innerHTML = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="9" fill="rgba(0,0,0,.5)"/><path d="M8 7l6 3-6 3V7z" fill="white"/></svg>`;
    const rmBtn = document.createElement('button');
    rmBtn.className = 'rm-btn';
    rmBtn.title = 'Remove';
    rmBtn.onclick = clearMedia;
    rmBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    wrap.appendChild(vid);
    wrap.appendChild(badge);
    wrap.appendChild(rmBtn);
    pi.appendChild(wrap);
  } else if (type === 'audio') {
    const outer = document.createElement('div');
    outer.className = 'preview-audio-outer';
    const wrap = document.createElement('div');
    wrap.className = 'preview-audio-wrap';
    wrap.innerHTML = `
      <div class="audio-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 3L3 13M5 1L5 15M7 4.5L7 11.5M9 1L9 15M11 3L11 13" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="audio-text">
        <span class="audio-name">${file.name}</span>
        <span class="audio-label">AUDIO FILE</span>
      </div>`;
    const rmBtn2 = document.createElement('button');
    rmBtn2.className = 'rm-btn';
    rmBtn2.title = 'Remove';
    rmBtn2.onclick = clearMedia;
    rmBtn2.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    outer.appendChild(wrap);
    outer.appendChild(rmBtn2);
    pi.appendChild(outer);
  }
}

function clearMedia() {
  currentFile = null; currentMode = null;
  const pa = document.getElementById('previewArea');
  pa.style.display = 'none';
  const pi = document.getElementById('previewInner');
  pi.innerHTML = '';
  pi.className = '';
  pi.removeAttribute('style');
  ['fileImg','fileVideo','fileAudio'].forEach(id => {
    const e = document.getElementById(id); if (e) e.value = '';
  });
}

// ── DRAG & DROP ──
function setupDragDrop() {
  const box = document.getElementById('inputBox');
  const ov = document.getElementById('dragOverlay');
  box.addEventListener('dragover', e => {
    e.preventDefault(); box.classList.add('drag-active'); ov.classList.add('active');
  });
  box.addEventListener('dragleave', e => {
    if (!box.contains(e.relatedTarget)) {
      box.classList.remove('drag-active'); ov.classList.remove('active');
    }
  });
  box.addEventListener('drop', e => {
    e.preventDefault(); box.classList.remove('drag-active'); ov.classList.remove('active');
    const file = e.dataTransfer.files[0]; if (!file) return;
    const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
    setMedia(file, type);
  });
}

// ── ANALYSIS ──
async function startAnalysis() {
  const urlVal = document.getElementById('urlInput').value.trim();
  if (!currentFile && !urlVal) { shakeBox(); return; }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  document.getElementById('resultsArea').style.display = 'block';
  document.getElementById('loadingPanel').style.display = 'flex';
  document.getElementById('resultsContent').style.display = 'none';
  setTimeout(() => document.getElementById('resultsArea').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  const steps = [
    'Connecting to forensic engine…',
    'Uploading media…',
    'Scanning pixel signatures…',
    'Querying AI intelligence…',
    'Compiling verdict…'
  ];
  animateSteps(steps);

  try {
    let result;
    if (urlVal) {
      result = await analyzeUrl(urlVal);
    } else {
      result = await analyzeFile(currentFile);
    }
    if (urlVal && !result.mediaType) {
      const ext = urlVal.split('?')[0].split('.').pop().toLowerCase();
      result.mediaType = ['mp4','mov','webm','avi'].includes(ext) ? 'VIDEO'
        : ['mp3','wav','ogg','aac'].includes(ext) ? 'AUDIO' : 'IMAGE';
    }
    showResults(result, urlVal || currentFile?.name || 'analysis', urlVal ? 'url' : currentMode);
    addToHistory(result, urlVal || currentFile?.name || 'file', urlVal ? 'url' : currentMode);
  } catch (err) {
    showError(err.message || 'Analysis failed. Check backend connection.');
  } finally {
    btn.disabled = false;
  }
}

async function analyzeFile(file) {
  const fd = new FormData(); fd.append('image', file);
  const r = await fetch(`${BACKEND_URL}/api/analyze/upload`, { method: 'POST', body: fd });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Server error' })); throw new Error(e.error || `HTTP ${r.status}`); }
  return r.json();
}

async function analyzeUrl(url) {
  const r = await fetch(`${BACKEND_URL}/api/analyze/url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({ error: 'Server error' })); throw new Error(e.error || `HTTP ${r.status}`); }
  return r.json();
}

// ── LOADING ──
let stepTimers = [];
function animateSteps(steps) {
  const c = document.getElementById('loadingStepsList');
  c.innerHTML = ''; stepTimers.forEach(clearTimeout); stepTimers = [];
  steps.forEach(t => {
    const d = document.createElement('div');
    d.className = 'lstep';
    d.innerHTML = `<div class="lstep-dot"></div><span>${t}</span>`;
    c.appendChild(d);
  });
  const els = c.querySelectorAll('.lstep');
  let cur = 0;
  function advance() {
    if (cur > 0) els[cur - 1].className = 'lstep done';
    if (cur < els.length) {
      els[cur].className = 'lstep active'; cur++;
      if (cur < els.length) stepTimers.push(setTimeout(advance, 800 + Math.random() * 400));
    }
  }
  advance();
}

// ── SHOW RESULTS ──
function showResults(data, name, mode) {
  document.getElementById('loadingPanel').style.display = 'none';
  const rc = document.getElementById('resultsContent');
  rc.style.display = 'flex';

  if (!document.getElementById('summaryText')) { resetAll(); return; }

  const ai = Math.round(data.aiProbability ?? 50);
  const real = 100 - ai;
  const verdict = data.verdict || (ai > 65 ? 'ai' : ai < 38 ? 'real' : 'uncertain');

  const header = document.getElementById('verdictHeader');
  header.className = `verdict-header v-${verdict}`;

  const icons  = { ai: '🤖', real: '✓', uncertain: '⚠' };
  const labels = { ai: 'AI GENERATED', real: 'AUTHENTIC MEDIA', uncertain: 'INCONCLUSIVE' };
  document.getElementById('verdictIcon').textContent = icons[verdict] || '⚠';
  document.getElementById('verdictMain').textContent = labels[verdict] || verdict.toUpperCase();

  setTimeout(() => { document.getElementById('scaleNeedle').style.left = `${ai}%`; }, 120);
  document.getElementById('realPct').textContent = `${real}%`;
  document.getElementById('aiPct').textContent   = `${ai}%`;

  const conf   = data.confidence || '—';
  const confEl = document.getElementById('confidenceVal');
  confEl.textContent = conf;
  confEl.className   = 'meta-value' + (conf === 'High' ? ' conf-high' : conf === 'Low' ? ' conf-low' : conf === 'Medium' ? ' conf-med' : '');

  document.getElementById('generatorVal').textContent = data.estimatedGenerator || '—';

  let mt = data.mediaType;
  if (!mt) {
    if (mode === 'url') mt = 'URL';
    else mt = (mode || 'IMAGE').toUpperCase();
  }
  document.getElementById('mediaTypeVal').textContent = mt;

  document.getElementById('summaryText').textContent = data.summary || 'No summary available.';

  // ── AI INDICATORS ──
  const aiSec  = document.getElementById('aiSection');
  const aiList = document.getElementById('aiIndicators');
  aiList.innerHTML = '';
  if (data.aiIndicators?.length) {
    // Section intro line
    aiList.appendChild(buildSectionIntro(
      verdict === 'ai'
        ? `${data.aiIndicators.length} reason${data.aiIndicators.length > 1 ? 's' : ''} why this image appears AI-generated:`
        : `Potential AI signals detected (${data.aiIndicators.length}):`,
      'ai'
    ));
    data.aiIndicators.forEach((ind, i) => aiList.appendChild(buildInd(ind, 'ai-ind', i + 1)));
    aiSec.style.display = 'block';
  } else {
    aiSec.style.display = 'none';
  }

  // ── REAL INDICATORS ──
  const realSec  = document.getElementById('realSection');
  const realList = document.getElementById('realIndicators');
  realList.innerHTML = '';
  if (data.realIndicators?.length) {
    // Section intro line
    realList.appendChild(buildSectionIntro(
      verdict === 'real'
        ? `${data.realIndicators.length} reason${data.realIndicators.length > 1 ? 's' : ''} why this image appears authentic:`
        : `Authentic signals detected (${data.realIndicators.length}):`,
      'real'
    ));
    data.realIndicators.forEach((ind, i) => realList.appendChild(buildInd(ind, 'real-ind', i + 1)));
    realSec.style.display = 'block';
  } else {
    realSec.style.display = 'none';
  }

  document.getElementById('technicalText').textContent = data.technicalDetails || '— No technical data —';

  // ── SIH26204: Blockchain Authenticity section ──
  // Purely additive — reads data.mediaHash produced by the existing
  // analyze() pipeline; never affects the AI verdict rendered above.
  currentAnalysisResult = data;
  currentAnalysisName   = name;
  initBlockchainSection(data);
}

// ── SIH26204: BLOCKCHAIN AUTHENTICITY ──────────────────────────
function initBlockchainSection(data) {
  currentBcRecord = null;
  const actions = document.getElementById('bcActions');
  const regPanel = document.getElementById('bcRegisteredPanel');
  const demoTag = document.getElementById('bcDemoTag');
  actions.style.display = 'none';
  regPanel.style.display = 'none';
  demoTag.style.display = 'none';
  setBcPill('bc-checking', 'Checking blockchain…');
  setBcNote('Verifying whether this exact media fingerprint is already registered on-chain.');

  if (!data.mediaHash) {
    setBcPill('bc-unavailable', '⚠ Fingerprint unavailable');
    setBcNote('Could not generate a media fingerprint for this analysis, so blockchain registration is unavailable for this item. Your AI detection result above is unaffected.');
    return;
  }

 fetch(`${BACKEND_URL || 'http://localhost:3001'}/api/blockchain/status/${encodeURIComponent(data.mediaHash)}`, {
  signal: AbortSignal.timeout(8000)
})
    .then(r => r.json())
    .then(status => {
      if (status.demoMode) demoTag.style.display = 'inline-block';
      if (status.error) {
        setBcPill('bc-unavailable', '⚠ Temporarily unavailable');
        setBcNote('Blockchain status check failed. Your AI detection result above is unaffected.');
        return;
      }
      if (status.registered) {
        // Already on-chain — fetch the full record to display it.
        fetchAndRenderRecordByHash(data.mediaHash, status.demoMode);
      } else {
        setBcPill('bc-not-registered', 'Not Registered');
        setBcNote('No matching blockchain record exists yet. "Not Registered" does not mean this media is fake — you can optionally create a tamper-evident record of the verdict above.');
        actions.style.display = 'flex';
      }
    })
    .catch(() => {
      setBcPill('bc-unavailable', '⚠ Temporarily unavailable');
      setBcNote('Could not reach the blockchain service. Your AI detection result above is unaffected.');
    });
}

function setBcPill(cls, text) {
  const pill = document.getElementById('bcStatusPill');
  pill.className = `bc-status-pill ${cls}`;
  pill.textContent = text;
}
function setBcNote(text) {
  document.getElementById('bcNote').textContent = text;
}

async function registerOnBlockchain() {
  if (bcRegistering || !currentAnalysisResult?.mediaHash) return;
  bcRegistering = true;
  const btn = document.getElementById('bcRegisterBtn');
  btn.disabled = true;
  btn.textContent = 'Registering…';
  setBcPill('bc-checking', 'Submitting to blockchain…');

  const data = currentAnalysisResult;
  const verdict = data.verdict || 'uncertain';
  const confidenceMap = { High: 95, Medium: 70, Low: 40 };
  const confidencePct = Math.round(data.aiProbability != null
    ? (verdict === 'ai' ? data.aiProbability : 100 - data.aiProbability)
    : (confidenceMap[data.confidence] ?? 50));

  try {
    const r = await fetch(`${'http://localhost:3001'}/api/blockchain/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaHash: data.mediaHash,
        verdict,
        confidence: Math.max(0, Math.min(100, confidencePct)),
        mediaType: data.mediaType || 'IMAGE',
        modelVersion: 'sightengine-genai+gemini',
        reportData: {
          summary: data.summary,
          technicalDetails: data.technicalDetails,
          aiIndicators: data.aiIndicators,
          realIndicators: data.realIndicators,
        },
      }),
    });
    const out = await r.json();

    if (!r.ok || !out.success) {
      if (out.error?.code === 'DUPLICATE') {
        fetchAndRenderRecordByHash(data.mediaHash, out.demoMode);
        return;
      }
      setBcPill('bc-unavailable', '⚠ Registration failed');
      setBcNote(out.error?.message || 'Blockchain registration is temporarily unavailable. Your AI detection result above is unaffected.');
      btn.disabled = false;
      btn.textContent = 'Register on Blockchain';
      return;
    }

    fetchAndRenderRecordByHash(data.mediaHash, out.demoMode);
  } catch (err) {
    setBcPill('bc-unavailable', '⚠ Registration failed');
    setBcNote('Could not reach the blockchain service. Your AI detection result above is unaffected.');
    btn.disabled = false;
    btn.textContent = 'Register on Blockchain';
  } finally {
    bcRegistering = false;
  }
}

async function fetchAndRenderRecordByHash(mediaHash, demoModeHint) {
  // Registration responses always carry a deterministic Verification ID
  // (first 8 hex chars of the hash, uppercased) — the same rule the
  // backend uses — so we can look the record up directly without
  // re-uploading the file.
  const clean = mediaHash.replace(/^0x/, '');
  const verificationId = `ALT-${clean.slice(0, 8).toUpperCase()}`;
  try {
    const r = await fetch(`${'http://localhost:3001'}/api/blockchain/record/${verificationId}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('lookup failed');
    const { record, demoMode } = await r.json();
    renderBcRegistered(record, demoMode ?? demoModeHint);
  } catch {
    setBcPill('bc-unavailable', '⚠ Registered, but record lookup failed');
    setBcNote('This media was registered, but the record could not be retrieved right now. Try again shortly.');
  }
}

function renderBcRegistered(record, demoMode) {
  currentBcRecord = record;
  document.getElementById('bcActions').style.display = 'none';
  document.getElementById('bcDemoTag').style.display = demoMode ? 'inline-block' : 'none';
  setBcPill('bc-registered', '✓ Registered');
  setBcNote('This media has a tamper-evident authenticity record on the blockchain.');

  document.getElementById('bcVerId').textContent    = record.verificationId || '—';
  document.getElementById('bcNetwork').textContent  = demoMode ? 'Demo Blockchain Mode' : 'Ethereum Sepolia Testnet';
  document.getElementById('bcTimestamp').textContent = record.timestamp
    ? new Date(record.timestamp * 1000).toLocaleString()
    : '—';
  const tx = record.txHash || record.mediaHash || '—';
  document.getElementById('bcTxHash').textContent = tx.length > 24 ? `${tx.slice(0, 14)}…${tx.slice(-8)}` : tx;

  document.getElementById('bcRegisteredPanel').style.display = 'block';

  const btn = document.getElementById('bcRegisterBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Register on Blockchain'; }
}

function openVerifyPage() {
  if (!currentBcRecord?.verificationId) return;
  window.open(`verify.html?id=${encodeURIComponent(currentBcRecord.verificationId)}`, '_blank');
}

function openCertificate() {
  if (!currentBcRecord) return;
  const rec = currentBcRecord;
  const data = currentAnalysisResult || {};

  const rows = [
    ['Media Name', currentAnalysisName || '—'],
    ['Media Type', rec.mediaType || data.mediaType || '—'],
    ['ALETHEIA Verdict', (rec.verdict || data.verdict || '—').toUpperCase()],
    ['Confidence', `${rec.confidence ?? data.aiProbability ?? '—'}%`],
    ['SHA-256', rec.mediaHash || data.mediaHash || '—'],
    ['Blockchain Network', rec.demoMode ? 'Demo Blockchain Mode' : 'Ethereum Sepolia Testnet'],
    ['Transaction / Reference', rec.txHash || '—'],
    ['Timestamp', rec.timestamp ? new Date(rec.timestamp * 1000).toLocaleString() : '—'],
    ['Verification ID', rec.verificationId || '—'],
    ['Blockchain Status', '✓ Registered'],
  ];

  const grid = document.getElementById('certGrid');
  grid.innerHTML = '';
  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'cert-row';
    row.innerHTML = `<span class="cert-row-label">${label}</span><span class="cert-row-value">${value}</span>`;
    grid.appendChild(row);
  });

  const qrEl = document.getElementById('certQr');
  qrEl.innerHTML = '';
  const verifyUrl = `${window.location.origin}/verify/${encodeURIComponent(rec.verificationId || '')}`;
  if (window.QRCode) {
    new QRCode(qrEl, { text: verifyUrl, width: 84, height: 84, colorDark: '#0f172a', colorLight: '#ffffff' });
  } else {
    qrEl.textContent = 'QR unavailable';
  }

  document.getElementById('certModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCertModal() {
  document.getElementById('certModalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ── BUILD SECTION INTRO ──
function buildSectionIntro(text, type) {
  const d = document.createElement('div');
  d.style.cssText = `
    font-size: 11px;
    font-family: var(--font-mono);
    letter-spacing: 0.5px;
    color: ${type === 'ai' ? 'var(--warn)' : 'var(--green)'};
    opacity: 0.85;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  `;
  d.textContent = text;
  return d;
}

// ── BUILD INDICATOR CARD ──
function buildInd(ind, cls, num) {
  const name        = ind.name        || 'Signal';
  const description = ind.description || '';
  const severity    = ind.severity    || 'Medium';
  const whyText     = ind.why         || '';   // optional extra "why" field from server

  const isAi   = cls === 'ai-ind';
  const bullet  = isAi ? '⚠' : '✓';
  const numStr  = num ? `${num}.` : '';

  // Severity colour
  const sevColor = severity === 'High'
    ? 'var(--danger)'
    : severity === 'Medium'
    ? 'var(--warn)'
    : 'var(--text3)';

  const d = document.createElement('div');
  d.className = `ind ${cls}`;

  // Build inner HTML
  d.innerHTML = `
    <div class="ind-top">
      <div class="ind-title-row">
        <span class="ind-bullet" style="color:${isAi ? 'var(--warn)' : 'var(--green)'};font-size:11px;margin-right:6px;flex-shrink:0;">${bullet}</span>
        <span class="ind-num" style="color:var(--text3);font-family:var(--font-mono);font-size:10px;margin-right:5px;flex-shrink:0;">${numStr}</span>
        <span class="ind-name">${name}</span>
      </div>
      <span class="sev ${severity}" style="color:${sevColor};border-color:${sevColor};">${severity}</span>
    </div>
    <p class="ind-desc">${description}</p>
    ${whyText ? `<p class="ind-why">${whyText}</p>` : ''}
  `;

  return d;
}

function showError(msg) {
  document.getElementById('loadingPanel').style.display = 'none';
  const rc = document.getElementById('resultsContent');
  rc.style.display = 'flex';
  rc.innerHTML = `
    <div style="padding:22px;background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.25);border-radius:12px;color:var(--danger);font-family:var(--font-mono);font-size:12px;line-height:1.6;">
      <div style="font-size:9px;letter-spacing:2px;margin-bottom:8px;color:var(--text3)">ERROR</div>${msg}
    </div>
    <button class="reset-btn" onclick="resetAll()">↺ Try Again</button>`;
}

// ── HISTORY ──
function addToHistory(result, name, mode) {
  const ai      = Math.round(result.aiProbability ?? 50);
  const verdict = result.verdict || (ai > 65 ? 'ai' : ai < 38 ? 'real' : 'uncertain');
  const item    = { id: Date.now(), name: name || 'file', verdict, aiPct: ai, result, mode };

  if (currentFile && (mode === 'image')) {
    item.thumbUrl = URL.createObjectURL(currentFile);
  }

  analysisHistory.unshift(item);
  if (analysisHistory.length > 3) analysisHistory = analysisHistory.slice(0, 3);
  renderHistory();
}

function removeFromHistory(id) {
  analysisHistory = analysisHistory.filter(i => i.id !== id);
  renderHistory();
}

function renderHistory() {
  const verdictColors = { ai: 'var(--danger)', real: 'var(--green)', uncertain: 'var(--warn)' };
  const verdictLabels = { ai: 'AI GEN', real: 'AUTHENTIC', uncertain: 'UNCERTAIN' };

  const list = document.getElementById('histList');
  if (!analysisHistory.length) {
    list.innerHTML = '<div class="hist-empty" id="histEmpty">No recent analyses</div>';
    return;
  }
  list.innerHTML = '';
  analysisHistory.forEach(item => {
    const el = document.createElement('div');
    el.className = 'hist-item';
    const thumbHTML = item.thumbUrl
      ? `<div class="hist-thumb"><img src="${item.thumbUrl}" alt=""/></div>`
      : `<div class="hist-thumb">${item.mode === 'video' ? '🎬' : item.mode === 'audio' ? '🎵' : '🔗'}</div>`;
    el.innerHTML = `
      ${thumbHTML}
      <div class="hist-info">
        <div class="hist-name">${item.name.length > 18 ? item.name.slice(0, 17) + '…' : item.name}</div>
        <div class="hist-verdict ${item.verdict}">${verdictLabels[item.verdict] || item.verdict.toUpperCase()}</div>
      </div>
      <button class="hist-rm" onclick="removeFromHistory(${item.id})" title="Remove">✕</button>`;
    el.querySelector('.hist-info').addEventListener('click', () => {
      document.getElementById('resultsArea').style.display = 'block';
      document.getElementById('loadingPanel').style.display = 'none';
      document.getElementById('resultsContent').style.display = 'flex';
      showResults(item.result, item.name, item.mode);
      document.getElementById('resultsArea').scrollIntoView({ behavior: 'smooth' });
    });
    list.appendChild(el);
  });

  // Mobile pills
  const mob = document.getElementById('historyMobile');
  mob.innerHTML = '';
  analysisHistory.forEach(item => {
    const pill = document.createElement('div');
    pill.className = 'hist-pill';
    pill.innerHTML = `<div class="hist-pill-dot" style="background:${verdictColors[item.verdict] || 'var(--warn)'}"></div><span class="hist-pill-name">${item.name.length > 14 ? item.name.slice(0, 13) + '…' : item.name}</span><button class="hist-pill-rm" onclick="event.stopPropagation();removeFromHistory(${item.id})">✕</button>`;
    pill.addEventListener('click', () => {
      document.getElementById('resultsArea').style.display = 'block';
      document.getElementById('loadingPanel').style.display = 'none';
      document.getElementById('resultsContent').style.display = 'flex';
      showResults(item.result, item.name, item.mode);
      document.getElementById('resultsArea').scrollIntoView({ behavior: 'smooth' });
    });
    mob.appendChild(pill);
  });
}

// ── RESET ──
function resetAll() {
  clearMedia();
  document.getElementById('urlInput').value = '';
  if (urlModeActive) toggleUrl();
  document.getElementById('resultsArea').style.display = 'none';
  // SIH26204: clear blockchain state so a fresh analysis starts clean
  currentAnalysisResult = null;
  currentAnalysisName   = null;
  currentBcRecord       = null;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── SHAKE ──
function shakeBox() {
  const box = document.getElementById('inputBox');
  const positions = [0, -6, 6, -5, 5, -3, 3, 0];
  let i = 0;
  const iv = setInterval(() => {
    box.style.transform = `translateX(${positions[i]}px)`;
    i++; if (i >= positions.length) { clearInterval(iv); box.style.transform = ''; }
  }, 50);
}

// ── MODAL ──
function closeModal() {
  const modal = document.getElementById('modalOverlay');
  const iframe = document.getElementById('modalVideo');

  modal.classList.remove('open');
  document.body.style.overflow = '';

  if (iframe) {
    iframe.src = iframe.src;
  }
}
function openModal() {
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ── INTRO SECTION ──
// The URL form / upload buttons that used to live in the intro hero have
// been removed from the page. This function is kept (guarded with a null
// check) so nothing breaks if they're ever reintroduced.
function setupIntro() {
  const form = document.getElementById('introUrlForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const introInput = document.getElementById('introUrlInput');
      const val = introInput.value.trim();
      if (!val) return;

      // Push the URL into the real analyzer, enabling URL mode if needed.
      if (!urlModeActive) toggleUrl();
      document.getElementById('urlInput').value = val;
      introInput.value = '';

      startAnalysis();
    });
  }
}

// Scrolls to the analyzer box and, optionally, opens the matching file picker.
// No longer wired to any button in the intro section, kept for potential reuse.
function scrollToUploader(type) {
  const box = document.getElementById('inputBox');
  if (!box) return;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const pickerId = type === 'video' ? 'fileVideo' : type === 'audio' ? 'fileAudio' : 'fileImg';
  setTimeout(() => {
    const picker = document.getElementById(pickerId);
    if (picker) picker.click();
  }, 450);
}
