/**
 * Fatawa Bot Admin Dashboard — Premium UI v4
 * Glassmorphism dark UI with sidebar nav, Chart.js analytics,
 * KB CRUD + Gemini re-embedding, real-time SSE monitoring.
 */
import { DASH_CSS } from './dashboard-css';
import { DASH_JS } from './dashboard-js';

export function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatawa Bot Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
${DASH_CSS}
</head>
<body>
<div class="app">
  <!-- ═══════════ SIDEBAR ═══════════ -->
  <aside class="sidebar">
    <div class="sb-brand">
      <div class="sb-icon">🕌</div>
      <div class="sb-title">Fatawa <span>Bot</span></div>
    </div>
    <div class="sb-conn">
      <div class="sb-dot on" id="sb-dot"></div>
      <span id="sb-lbl">Checking…</span>
    </div>
    <nav class="sb-nav">
      <div class="nav-sec">Dashboard</div>
      <button class="nav-btn active" id="nav-overview" onclick="gp('overview')">
        <span class="nb-icon">🏠</span>Overview
      </button>
      <button class="nav-btn" id="nav-monitor" onclick="gp('monitor')">
        <span class="nb-icon">📡</span>Live Monitor
      </button>
      <div class="nav-sec">Bot</div>
      <button class="nav-btn" id="nav-setup" onclick="gp('setup')">
        <span class="nb-icon">⚙️</span>Setup
      </button>
      <button class="nav-btn" id="nav-approvals" onclick="gp('approvals')">
        <span class="nb-icon">✅</span>Approvals
        <span class="badge" id="pb" style="display:none">0</span>
      </button>
      <div class="nav-sec">Knowledge</div>
      <button class="nav-btn" id="nav-kb" onclick="gp('kb')">
        <span class="nb-icon">🗄️</span>Knowledge Base
      </button>
    </nav>
    <div class="sb-footer">
      <div class="kb-stat">
        <span>🗄️ KB Records</span>
        <span id="sb-kb">—</span>
      </div>
    </div>
  </aside>

  <!-- ═══════════ MAIN ═══════════ -->
  <div class="main">
    <!-- Top bar -->
    <div class="topbar">
      <span id="crumb" style="font-size:.82rem;font-weight:600;">📊 Overview</span>
      <div class="topbar-right">
        <div class="tpill">📢 <code id="tb-pub" style="margin-left:4px;font-size:.72rem">—</code></div>
        <div class="tpill">🔐 <code id="tb-adm" style="margin-left:4px;font-size:.72rem">—</code></div>
        <div class="tpill" id="tb-time">—</div>
      </div>
    </div>

    <!-- ═══ OVERVIEW PANEL ═══ -->
    <div class="panel active" id="panel-overview">
      <div class="ov-wrap">
        <div class="ov-hdr">
          <div>
            <div class="ov-title">📊 Dashboard Overview</div>
            <div class="ov-sub" id="ov-upd">Loading analytics…</div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="loadAnalytics()">🔄 Refresh</button>
        </div>
        <div class="stat-grid">
          <div class="sc gn" style="animation-delay:.00s">
            <div style="font-size:1.4rem;margin-bottom:4px">🗄️</div>
            <div class="sc-val gn" id="ov-total">—</div>
            <div class="sc-lbl">Total KB Records</div>
          </div>
          <div class="sc te" style="animation-delay:.06s">
            <div style="font-size:1.4rem;margin-bottom:4px">🎵</div>
            <div class="sc-val te" id="ov-audio">—</div>
            <div class="sc-lbl">Audio Answers</div>
          </div>
          <div class="sc pu" style="animation-delay:.12s">
            <div style="font-size:1.4rem;margin-bottom:4px">🤖</div>
            <div class="sc-val pu" id="ov-v3">—</div>
            <div class="sc-lbl">V3 Embedded</div>
          </div>
          <div class="sc am" style="animation-delay:.18s">
            <div style="font-size:1.4rem;margin-bottom:4px">⏳</div>
            <div class="sc-val am" id="ov-pend">—</div>
            <div class="sc-lbl">Pending Approval</div>
          </div>
          <div class="sc bl" style="animation-delay:.24s">
            <div style="font-size:1.4rem;margin-bottom:4px">📝</div>
            <div class="sc-val bl" id="ov-text">—</div>
            <div class="sc-lbl">Text Answers</div>
          </div>
          <div class="sc gn" style="animation-delay:.30s">
            <div style="font-size:1.4rem;margin-bottom:4px">🔌</div>
            <div class="sc-val gn" id="ov-conn">—</div>
            <div class="sc-lbl">WhatsApp Status</div>
          </div>
        </div>
        <div class="charts-grid">
          <div class="cc">
            <div class="cc-title">🕋 Topics Distribution</div>
            <div class="cc-wrap"><canvas id="ch-topics"></canvas></div>
          </div>
          <div class="cc">
            <div class="cc-title">🌐 Language Breakdown</div>
            <div class="cc-wrap"><canvas id="ch-lang"></canvas></div>
          </div>
          <div class="cc">
            <div class="cc-title">📈 Confidence Levels</div>
            <div class="cc-wrap"><canvas id="ch-conf"></canvas></div>
          </div>
        </div>
        <div class="qa-grid">
          <div class="qa" onclick="gp('kb');kbLoad()">
            <div class="qa-ic gn">🗄️</div>
            <div class="qa-tx"><strong>Browse Knowledge Base</strong><span>View, search &amp; edit all fatawa records</span></div>
          </div>
          <div class="qa" onclick="openAdd()">
            <div class="qa-ic te">➕</div>
            <div class="qa-tx"><strong>Add New KB Record</strong><span>Create and auto-embed with Gemini AI</span></div>
          </div>
          <div class="qa" onclick="gp('approvals');loadPending()">
            <div class="qa-ic am">✅</div>
            <div class="qa-tx"><strong>Review Approvals</strong><span>Pending questions awaiting Sheikh</span></div>
          </div>
          <div class="qa" onclick="gp('monitor')">
            <div class="qa-ic pu">📡</div>
            <div class="qa-tx"><strong>Live Monitor</strong><span>Real-time WhatsApp messages via SSE</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ SETUP PANEL ═══ -->
    <div class="panel" id="panel-setup">
      <div class="setup-wrap">
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">🔍 Bot Status</div>
          <div id="dbg" style="font-size:.82rem;color:var(--muted)">Loading…</div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">📌 Active Routing</div>
          <div class="sel-row">
            <div class="sel-box unset" id="box-pub">
              <strong>📢 PUBLIC (Questions from users)</strong>
              <span id="pub-val">Not configured</span>
            </div>
            <div class="sel-box unset" id="box-adm">
              <strong>🔐 ADMIN (Approvals — Sheikh)</strong>
              <span id="adm-val">Not configured</span>
            </div>
          </div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">📋 WhatsApp Groups</div>
          <div class="leg">
            <span><div class="ld" style="background:var(--green)"></div>Click once → Set as Public</span>
            <span><div class="ld" style="background:var(--amber)"></div>Click twice → Set as Admin</span>
            <span><div class="ld" style="background:var(--s4)"></div>Click thrice → Deselect</span>
          </div>
          <button class="btn btn-ghost" id="lg-btn" onclick="loadGroups()" style="margin-bottom:8px">
            🔄 Load Groups from WhatsApp
          </button>
          <div id="grp-alert" style="margin-top:4px"></div>
          <div class="group-grid" id="grp-grid"></div>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn btn-green" onclick="saveSettings()">💾 Save Settings</button>
          <div id="save-alert" style="flex:1"></div>
        </div>
      </div>
    </div>

    <!-- ═══ MONITOR PANEL ═══ -->
    <div class="panel" id="panel-monitor">
      <div class="mon-layout">
        <div class="feed-wrap">
          <div class="feed-hdr">
            <h3>📡 Live Feed</h3>
            <span class="cpill" id="msg-cnt">0 msgs</span>
            <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="clearFeed()">Clear</button>
          </div>
          <div class="feed" id="feed">
            <div class="sys-msg">Listening for messages via SSE…</div>
          </div>
        </div>
        <div class="send-panel">
          <div class="send-hdr">
            <h3>✉️ Manual Send</h3>
            <div style="font-size:.72rem;color:var(--muted);margin-top:2px">Send messages from the bot</div>
          </div>
          <div class="send-body">
            <div class="field">
              <label>Target Group</label>
              <select id="snd-tgt" class="inp-sel">
                <option value="">— Select —</option>
                <option value="pub">📢 Public Group (Questions)</option>
                <option value="adm">🔐 Admin Group (Approvals)</option>
                <option value="cus">✏️ Custom JID…</option>
              </select>
            </div>
            <div class="field" id="cjf" style="display:none">
              <label>Custom JID</label>
              <input type="text" id="cji" class="inp" placeholder="1234567890@g.us">
            </div>
            <div class="field">
              <label>Message</label>
              <textarea id="snd-txt" class="inp-ta" style="min-height:80px" placeholder="Type message to send…"></textarea>
            </div>
          </div>
          <div class="send-footer">
            <button class="btn btn-green" style="width:100%;justify-content:center" id="snd-btn" onclick="sendMsg()">
              📤 Send Message
            </button>
            <div style="font-size:.74rem;text-align:center;margin-top:5px;color:var(--muted)" id="snd-st"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ APPROVALS PANEL ═══ -->
    <div class="panel" id="panel-approvals">
      <div class="app-layout">
        <div class="pend-wrap">
          <div class="pend-hdr">
            <h3>⏳ Pending Queue</h3>
            <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="loadPending()">🔄</button>
          </div>
          <div id="pend-list">
            <div class="pend-empty">
              <div style="font-size:3rem;margin-bottom:12px">⏳</div>
              <div>Loading pending questions…</div>
            </div>
          </div>
        </div>
        <div class="det-panel">
          <div class="det-hdr"><h3>📋 Question Detail</h3></div>
          <div class="det-body" id="det-body">
            <div class="det-empty">
              <div style="font-size:2.5rem;margin-bottom:12px">👆</div>
              <div>Select a question from the list</div>
            </div>
          </div>
          <div class="det-footer" id="det-foot" style="display:none">
            <div class="act-row">
              <button class="btn btn-green" onclick="doApprove()">✅ Approve &amp; Send</button>
              <button class="btn btn-red" onclick="doReject()">❌ Reject</button>
            </div>
            <div id="act-st" style="font-size:.75rem;text-align:center;color:var(--muted)"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ KB PANEL ═══ -->
    <div class="panel" id="panel-kb">
      <div class="kb-layout">
        <div class="kb-sidebar">
          <div class="kb-stitle">Filter by Topic</div>
          <button class="kbt active" id="kbt-ALL" onclick="kbTopic('')">
            📚 All <span class="kbt-cnt" id="kbc-ALL">—</span>
          </button>
          <div id="kbt-list"></div>
        </div>
        <div class="kb-main">
          <div class="kb-tb">
            <input class="kb-srch" id="kb-srch" placeholder="🔍 Search questions, rulings, audio files…" oninput="kbSearch()">
            <button class="btn btn-green btn-sm" onclick="openAdd()">➕ Add New</button>
            <button class="btn btn-ghost btn-sm" onclick="kbLoad()">🔄</button>
            <span class="kb-cnt" id="kb-cnt">—</span>
          </div>
          <div class="kb-tw">
            <table class="kb-t">
              <thead>
                <tr>
                  <th style="width:34px">#</th>
                  <th style="width:260px">Question</th>
                  <th style="width:80px">Topic</th>
                  <th style="width:65px">Lang</th>
                  <th style="width:75px">Conf</th>
                  <th style="width:150px">Ruling</th>
                  <th style="width:120px">Audio</th>
                  <th style="width:60px">Edit</th>
                </tr>
              </thead>
              <tbody id="kb-body"></tbody>
            </table>
          </div>
          <div class="kb-pg">
            <button class="pgb" id="kb-prev" onclick="kbPage(-1)" disabled>← Prev</button>
            <span id="kb-pglbl" style="flex:1;text-align:center;color:var(--muted)">Page 1</span>
            <button class="pgb" id="kb-next" onclick="kbPage(1)">Next →</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Status bar -->
    <div class="sbar">
      <div class="st"><div class="sdot ok" id="sb-d2"></div><span id="sb-l2">WhatsApp Connected</span></div>
      <div class="st">KB: <strong style="color:var(--green);margin-left:3px" id="sb-k2">—</strong></div>
      <div class="st" style="margin-left:auto">Updated: <span id="sb-t2">—</span></div>
    </div>
  </div><!-- end .main -->
</div><!-- end .app -->

<!-- ═══ KB EDIT/ADD MODAL ═══ -->
<div class="mbg" id="kb-modal" style="display:none" onclick="if(event.target.id==='kb-modal')mcl()">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="mhdr">
      <h3 id="m-title">✏️ Edit KB Record</h3>
      <button class="mclose" onclick="mcl()">✕</button>
    </div>
    <div class="mbody">
      <input type="hidden" id="m-id">
      <div class="g2">
        <div class="field">
          <label>Record ID</label>
          <input type="text" id="m-id-d" class="inp inp-ro" readonly>
        </div>
        <div class="field">
          <label>Topic</label>
          <select id="m-topic" class="inp-sel">
            <option>GENERAL</option><option>IHRAM</option><option>TAWAF</option>
            <option>SAEE</option><option>ARAFAT</option><option>MINA</option>
            <option>JAMARAT</option><option>QURBANI</option><option>HALQ</option>
            <option>SALAH</option><option>UMRAH</option><option>MADINAH</option>
            <option>MENSTRUATION</option><option>HAIZ</option><option>WUDU</option>
          </select>
        </div>
      </div>
      <div class="g2">
        <div class="field">
          <label>Language</label>
          <select id="m-lang" class="inp-sel">
            <option>English</option><option>Urdu</option><option>Hinglish</option><option>Mixed</option>
          </select>
        </div>
        <div class="field">
          <label>Accuracy Label</label>
          <input type="text" id="m-label" class="inp" placeholder="e.g. Hadith reference">
        </div>
      </div>
      <div class="field">
        <label>Question</label>
        <textarea id="m-q" class="inp-ta" rows="3" placeholder="Enter the question text (any language)…"></textarea>
      </div>
      <div class="field">
        <label>⚖️ Authentic Islamic Ruling</label>
        <textarea id="m-ruling" class="inp-ta" rows="2" placeholder="Short ruling statement e.g. 'Wajib', 'Sunnah'…"></textarea>
      </div>
      <div class="field">
        <label>📋 Ruling Key Points (one per line)</label>
        <textarea id="m-kp" class="inp-ta" rows="3" placeholder="• Point 1&#10;• Point 2"></textarea>
      </div>
      <div class="field">
        <label>📝 Answer Text (text reply)</label>
        <textarea id="m-ans" class="inp-ta" rows="3" placeholder="Full answer for text-only reply…"></textarea>
      </div>
      <div class="field">
        <label>🎙️ Urdu Transcript (of audio answer)</label>
        <textarea id="m-tr" class="inp-ta" rows="3" dir="rtl" placeholder="آڈیو کا متن یہاں لکھیں…"></textarea>
      </div>
      <div class="g2">
        <div class="field">
          <label>🎵 Audio File (GCS filename)</label>
          <input type="text" id="m-audio" class="inp" placeholder="PTT-20250101-WA0001.opus">
        </div>
        <div class="field">
          <label>Confidence Score (0–1)</label>
          <input type="number" id="m-conf" class="inp" min="0" max="1" step="0.01" placeholder="0.85">
        </div>
      </div>
      <div class="g2">
        <div class="field">
          <label>🌐 English Translation (AI-generated — read only)</label>
          <input type="text" id="m-en" class="inp inp-ro" readonly placeholder="Generated by Gemini…">
        </div>
        <div class="field">
          <label>🔑 Keywords (read only)</label>
          <input type="text" id="m-kw" class="inp inp-ro" readonly placeholder="Generated by Gemini…">
        </div>
      </div>
      <div class="eprog" id="eprog" style="display:none">
        <span id="epl">🤖 Generating embedding…</span>
        <div class="epbw"><div class="epb" id="epb"></div></div>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn btn-red btn-sm" id="m-del" onclick="mDel()" style="margin-right:auto;display:none">🗑️ Delete</button>
      <button class="btn btn-teal btn-sm" id="m-emb" onclick="mEmbed()" style="display:none">🤖 Re-Embed</button>
      <span class="mst" id="m-st"></span>
      <button class="btn btn-ghost btn-sm" onclick="mcl()">Cancel</button>
      <button class="btn btn-green btn-sm" id="m-save" onclick="mSave()">💾 Save</button>
    </div>
  </div>
</div>

${DASH_JS}
</body>
</html>`;
}
