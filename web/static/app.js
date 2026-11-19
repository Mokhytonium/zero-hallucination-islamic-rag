/* ============================================================
   پژوهش مستند قرآن — research workbench logic
   judge-only RAG · byte-exact hydration · zero text hallucination
   All scripture, translations, context, concordance and metrics
   are fetched from the real backend; nothing is generated here.
   ============================================================ */
"use strict";

const $ = (id) => document.getElementById(id);

const SAMPLES = [
  { label: "اخلاق فردی", text: "نیکی و احترام به پدر و مادر یکی از مهم‌ترین وظایف اخلاقی انسان است." },
  { label: "عدالت اجتماعی", text: "انباشت ثروت در دست عده‌ای خاص و عدم گردش پول در جامعه، شکاف طبقاتی و فساد ایجاد می‌کند." },
  { label: "مفاهیم مرکب", text: "تغییرات ظاهری ملاک نیکی نیست؛ نیکی واقعی ایمان، انفاق به نیازمندان و پایبندی به عهد است." },
  { label: "تله تضاد و نفی", text: "در معاملات تجاری، گرفتن سود اضافی در قبال مهلت دادن به بدهکار هیچ فرقی با خرید و فروش عادی ندارد." },
  { label: "تله شأن نزول", text: "در جلسات کاری مدرن، کارمندان نباید بدون اجازه مدیر از جلسه خارج شوند." },
];

const NEGATION_RE = /(نیست|نهی|حرام|نباید|هیچ فرقی|اجبار|مخالف)/;
const DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u08F0-\u08F3\u0640]/g;

const LABELS = {
  Direct_Match: "تطبیق مستقیم",
  Conditional_Match: "شاهد پشتیبان",
  Contradiction: "دیدگاه مخالف / نقد",
  Unverified: "بازیابی‌شده · بدون داوری",
};

const GROUPS = [
  { key: "main", title: "تطبیق اصلی", badge: "v-primary", filter: "تطبیق اصلی" },
  { key: "supporting", title: "شواهد پشتیبان", badge: "v-support", filter: "شواهد پشتیبان" },
  { key: "opposing", title: "دیدگاه مخالف / نقد", badge: "v-contra", filter: "دیدگاه مخالف" },
  { key: "unverified", title: "نتایج بازیابی (بدون داوری)", badge: "v-unverified", filter: "بدون داوری" },
];

const LS = { hist: "qr_history", pins: "qr_pins", prefs: "qr_prefs" };

const state = {
  mode: "fast",
  judge: true,
  current: null,
  items: [],
  filter: "all",
  prefs: { trans: true, plain: false, scale: 1, translator: "fa.makarem" },
  pins: [],
  translators: [],
  gold: [],
  eval: null,
  abort: null,
  searching: false,
  runReq: 0,
  pipeTimer: null,
  pipeT0: 0,
  drawer: null,
  drawerTrigger: null,
  drawerReq: 0,
  wordReq: 0,
  judgeError: null,
  status: null,
};

/* ---------- helpers ---------- */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toFa(v) {
  return String(v).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function stripDiacritics(s) { return String(s).replace(DIACRITICS_RE, ""); }
function placeFa(p) { return p === "Meccan" ? "مکی" : p === "Medinan" ? "مدنی" : ""; }
function loadLS(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch (e) { return fallback; }
}
function loadArr(key) { const v = loadLS(key, []); return Array.isArray(v) ? v : []; }
function saveLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("کپی شد"); return; } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? "کپی شد" : "کپی ناموفق بود");
  } catch (e) { toast("کپی ناموفق بود"); }
}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("دریافت شد: " + filename);
}
async function getJSON(url) {
  const r = await fetch(url);
  return r.json();
}

/* ---------- view routing ---------- */
function showView(name) {
  document.querySelectorAll(".view-section").forEach((v) => v.classList.remove("active"));
  const el = $("view-" + name);
  if (el) el.classList.add("active");
  closeDrawer();
  $("trustBtn").classList.toggle("active", name === "trust");
  $("pinCounterBtn").classList.toggle("active", name === "collection");
  $("resultsBtn").classList.toggle("active", name === "results");
  window.scrollTo({ top: 0, behavior: "auto" });
}
function goComposer() { showView("composer"); $("queryInput").focus(); }
function updateResultsNav() { $("resultsBtn").hidden = !(state.items && state.items.length); }

/* ---------- composer ---------- */
function renderSamples() {
  $("sampleChips").innerHTML = SAMPLES.map((s, i) =>
    `<button class="chip" data-sample="${i}">${esc(s.label)}</button>`).join("");
}
function applySuggestion(text) {
  const input = $("queryInput");
  input.value = text;
  input.dispatchEvent(new Event("input"));
  $("acBox").classList.remove("visible");
  input.focus();
}
function setMode(mode) {
  state.mode = mode;
  $("modeFast").classList.toggle("active", mode === "fast");
  $("modeAccurate").classList.toggle("active", mode === "accurate");
}
function toggleJudge() {
  state.judge = !state.judge;
  const t = $("judgeToggle");
  t.classList.toggle("on", state.judge);
  t.setAttribute("aria-checked", String(state.judge));
}
function updateComposer() {
  const val = $("queryInput").value;
  $("charCounter").textContent = `${toFa(val.length)} / ۵۰۰۰`;
  $("negationBanner").classList.toggle("visible", NEGATION_RE.test(val));
  renderAutocomplete(val);
}
function renderAutocomplete(val) {
  const box = $("acBox");
  const q = val.trim();
  if (q.length === 0 || q.length >= 25) { box.classList.remove("visible"); box.innerHTML = ""; return; }
  const hist = loadArr(LS.hist).filter((h) => typeof h === "string" && h !== q && h.includes(q)).slice(0, 2);
  const gold = state.gold.filter((g) => g.statement.includes(q)).slice(0, 4);
  const rows = [
    ...hist.map((h) => ({ text: h, src: "تاریخچه" })),
    ...gold.map((g) => ({ text: g.statement, src: "مجموعه طلایی" })),
  ];
  if (!rows.length) { box.classList.remove("visible"); box.innerHTML = ""; return; }
  box.innerHTML = rows.map((r) =>
    `<div class="ac-item" data-ac="${esc(r.text)}"><span>${esc(r.text)}</span><span class="ac-source">${esc(r.src)} ↵</span></div>`).join("");
  box.classList.add("visible");
}
function saveHistory(q) {
  let h = loadArr(LS.hist).filter((x) => typeof x === "string" && x !== q);
  h.unshift(q);
  saveLS(LS.hist, h.slice(0, 20));
}

/* ---------- pipeline ---------- */
function stagePlan() {
  const accurate = state.mode === "accurate";
  return [
    { label: "۱. بازیابی ترکیبی", sub: "۱۵ کاندید · RRF", dur: 0.9, on: true },
    { label: "۲. رتبه‌بند عصبی", sub: accurate ? "Cross-Encoder · CPU" : "غیرفعال", dur: accurate ? (state.status?.rerank_pool ?? 80) : 0, on: accurate },
    { label: "۳. داوری هوشمند", sub: state.judge ? "بررسی شأن نزول · دمای ۰.۰" : "غیرفعال", dur: state.judge ? 3.5 : 0, on: state.judge },
    { label: "۴. واکشی بایت‌دقیق", sub: "تطابق بایت‌به‌بایت", dur: 0.4, on: true },
  ];
}
function buildSteps() {
  $("stepsGrid").innerHTML = stagePlan().map((s, i) =>
    `<div class="step-item${s.on ? "" : " skipped"}" data-step="${i}">${esc(s.label)}<span class="step-sub">${esc(s.sub)}</span></div>`).join("");
  $("pipeFill").style.width = "0%";
  const accurate = state.mode === "accurate";
  const pool = state.status?.rerank_pool ?? 80;
  const latencyNote = accurate ? `رتبه‌بند عصبی روی CPU حدود ${toFa(pool)} ثانیه زمان می‌برد (استخر ${toFa(pool)} کاندید). ` : "";
  $("abortNote").textContent = latencyNote + (state.judge
    ? "در حال بررسی تضاد منطقی و سیاق تاریخی کاندیدها با دمای ۰.۰"
    : "داوری غیرفعال است؛ نتایج خام بازیابی بدون تأیید مدل نمایش داده می‌شوند.");
}
function fmtElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec * 10) % 10);
  return toFa(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`);
}
function animatePipeline() {
  const plan = stagePlan();
  const onStages = plan.filter((s) => s.on);
  const total = onStages.reduce((a, s) => a + s.dur, 0) || 1;
  const cells = [...$("stepsGrid").children];
  let cum = 0;
  const bounds = plan.map((s) => {
    if (!s.on) return null;
    const b = { start: cum, end: cum + s.dur };
    cum += s.dur;
    return b;
  });
  const tick = () => {
    const elapsed = (performance.now() - state.pipeT0) / 1000;
    $("pipeTimer").textContent = "زمان سپری‌شده: " + fmtElapsed(elapsed);
    const frac = Math.min(1, elapsed / total);
    $("pipeFill").style.width = (92 * frac).toFixed(1) + "%";
    plan.forEach((s, i) => {
      const cell = cells[i];
      if (!s.on) { cell.className = "step-item skipped"; return; }
      const b = bounds[i];
      if (elapsed >= b.end) cell.className = "step-item done";
      else if (elapsed >= b.start) cell.className = "step-item active";
      else cell.className = "step-item";
    });
  };
  tick();
  clearInterval(state.pipeTimer);
  state.pipeTimer = setInterval(tick, 100);
}
function completePipeline() {
  clearInterval(state.pipeTimer);
  state.pipeTimer = null;
  [...$("stepsGrid").children].forEach((cell) => {
    if (!cell.classList.contains("skipped")) cell.className = "step-item done";
  });
  $("pipeFill").style.width = "100%";
}
function stopPipeline() { clearInterval(state.pipeTimer); state.pipeTimer = null; }

/* ---------- search ---------- */
async function runSearch() {
  const text = $("queryInput").value.trim();
  if (!text) { toast("گزاره خالی است"); $("queryInput").focus(); return; }
  if (state.searching) { toast("جست‌وجوی قبلی هنوز در حال اجراست؛ صبر کنید یا آن را لغو کنید"); showView("pipeline"); return; }
  const req = ++state.runReq;
  state.searching = true;
  saveHistory(text);
  $("acBox").classList.remove("visible");
  state.current = null;
  state.filter = "all";
  showView("pipeline");
  buildSteps();
  state.pipeT0 = performance.now();
  animatePipeline();
  state.abort = new AbortController();
  let data;
  try {
    const r = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: text, use_judge: state.judge, use_reranker: state.mode === "accurate" }),
      signal: state.abort.signal,
    });
    data = await r.json();
  } catch (err) {
    if (req !== state.runReq) return;
    stopPipeline();
    state.searching = false;
    if (err.name === "AbortError") { showView("composer"); toast("جست‌وجو لغو شد"); return; }
    renderError("ارتباط با سرور برقرار نشد.");
    showView("results");
    return;
  }
  if (req !== state.runReq) return;
  state.searching = false;
  completePipeline();
  refreshCost();
  setTimeout(() => {
    if (req !== state.runReq) return;
    if (data.status === "ok") { renderResults(data); showView("results"); }
    else if (data.status === "no_match") { renderNoMatch(text); showView("results"); }
    else if (data.status === "error" && data.code === "reranker_memory") { renderMemoryError(text); showView("results"); }
    else { renderError(data.message || "خطای داخلی در پردازش گزاره.", text); showView("results"); }
  }, 220);
}
function abortSearch() {
  if (state.abort) state.abort.abort();
  stopPipeline();
}

/* ---------- results ---------- */
function flatItems(data) {
  const out = [];
  for (const g of GROUPS) for (const it of (data.sections?.[g.key] || [])) out.push({ ...it, group: g.key });
  return out;
}
function findItem(id) { return state.items.find((x) => x.id === id) || null; }

function renderResults(data) {
  state.current = data;
  state.items = flatItems(data);
  state.judgeError = data.meta?.judge_error || null;
  $("queryPreview").textContent = `گزاره: «${data.statement}»`;
  $("stickyToolbar").style.display = "";
  renderFilters();
  renderCards();
  renderMeta(data.meta || {}, data.cached);
  updateResultsNav();
}
function renderFilters() {
  const counts = { all: state.items.length };
  for (const g of GROUPS) counts[g.key] = state.items.filter((i) => i.group === g.key).length;
  const pills = [{ key: "all", label: "همه" }, ...GROUPS.map((g) => ({ key: g.key, label: g.filter }))];
  $("filterPills").innerHTML = pills
    .filter((p) => p.key === "all" || counts[p.key] > 0)
    .map((p) => `<button class="f-pill${state.filter === p.key ? " active" : ""}" data-filter="${p.key}">${esc(p.label)} (${toFa(counts[p.key])})</button>`)
    .join("");
}
function signalBars(it) {
  const bars = [];
  const sem = it.signals?.semantic, lex = it.signals?.lexical;
  if (sem != null) bars.push(`<span class="sig-bar">بردار معنایی <span class="sig-meter"><span class="sig-fill semantic" style="width:${Math.round(sem * 100)}%"></span></span> <span class="sig-val">${toFa(Math.round(sem * 100))}٪</span></span>`);
  if (lex != null) bars.push(`<span class="sig-bar">تطابق واژگانی <span class="sig-meter"><span class="sig-fill lexical" style="width:${Math.round(lex * 100)}%"></span></span> <span class="sig-val">${toFa(Math.round(lex * 100))}٪</span></span>`);
  if (it.rerank_score != null) {
    const p = Math.round(sigmoid(it.rerank_score) * 100);
    bars.push(`<span class="sig-bar" title="امتیاز خام رتبه‌بند: ${it.rerank_score}">رتبه‌بند عصبی <span class="sig-meter"><span class="sig-fill rerank" style="width:${p}%"></span></span> <span class="sig-val">${toFa(p)}٪</span></span>`);
  }
  if (!bars.length) return "";
  const score = it.rerank_score != null
    ? `امتیاز رتبه‌بند: <span class="mono">${it.rerank_score}</span>`
    : `امتیاز بازیابی RRF: <span class="mono">${it.rrf_score}</span>`;
  return `<div class="signals-row"><span>چرا این آیه؟</span>${bars.join("")}</div><div class="signals-row">${score}</div>`;
}
function quranURL(sura, ayaStart, ayaEnd) {
  const aya = ayaEnd && ayaEnd !== ayaStart ? `${ayaStart}-${ayaEnd}` : `${ayaStart}`;
  return `https://quran.com/${sura}/${aya}`;
}
function retrievalReason(it) {
  const sem = it.signals?.semantic, lex = it.signals?.lexical;
  const parts = [];
  if (sem != null && lex != null) {
    parts.push(`بازیابی ترکیبی این آیه را با سهم شباهت معنایی ${toFa(Math.round(sem * 100))}٪ و تطابق واژگانی ${toFa(Math.round(lex * 100))}٪ پیشنهاد کرد`);
  } else {
    parts.push("این آیه از مسیر بازیابی ترکیبی (RRF) پیشنهاد شد");
  }
  if (it.rerank_score != null) parts.push(`رتبه‌بند عصبی آن را با امتیاز <span class="mono">${it.rerank_score}</span> تقویت کرد`);
  return parts.join("؛ ") + ". این آیه تأیید داوری ندارد؛ تطبیق نهایی را خودتان بررسی کنید.";
}
function cardHTML(it) {
  const g = GROUPS.find((x) => x.key === it.group);
  const aya = it.aya_end && it.aya_end !== it.aya_start ? `${it.aya_start}-${it.aya_end}` : `${it.aya_start}`;
  const metaBits = [placeFa(it.revelation_place), it.page ? "صفحه " + toFa(it.page) : "", it.juz ? "جزء " + toFa(it.juz) : ""].filter(Boolean).join(" · ");
  const full = it.text_display;
  const plain = stripDiacritics(full);
  const shown = state.prefs.plain ? plain : full;
  const reasonBlock = it.reason
    ? `<div><strong>استدلال داور:</strong> ${esc(it.reason)}</div>`
    : `<div class="reason-retrieval">${retrievalReason(it)}</div>`;
  const pinned = state.pins.some((p) => p.id === it.id);
  const qurl = quranURL(it.sura, it.aya_start, it.aya_end);
  return `<article class="ayah-card" data-id="${esc(it.id)}">
    <div class="card-top">
      <div class="surah-meta">
        <span>سوره ${esc(it.surah_name)} · آیه ${toFa(aya)}</span>
        <span class="verdict-badge ${g.badge}">${esc(LABELS[it.label] || it.label)}</span>
        ${metaBits ? `<span class="byte-badge">${esc(metaBits)}</span>` : ""}
      </div>
      <span class="byte-badge ok">✓ واکشی بایت‌دقیق</span>
    </div>
    <div class="quran-text" data-full="${esc(full)}" data-plain="${esc(plain)}">${esc(shown)}</div>
    <div class="translation-text${state.prefs.trans ? "" : " hidden"}">${esc(it.translation_fa || "")}</div>
    <div class="reasoning-box"><div class="reason-title">دلیل انتخاب این آیه</div>${reasonBlock}${signalBars(it)}</div>
    <div class="card-actions">
      <div class="action-btns">
        <button class="tool-btn" data-act="drawer">مطالعه بافت و واژه‌ها</button>
        <button class="tool-btn${pinned ? " active" : ""}" data-act="pin">${pinned ? "✓ پین شد" : "پین در مجموعه پژوهش"}</button>
      </div>
      <div class="action-btns">
        <button class="tool-btn" data-act="cite">کپی استناد</button>
        <button class="tool-btn" data-act="json">JSON</button>
        <a class="tool-btn quran-link" href="${qurl}" target="_blank" rel="noopener noreferrer" title="مشاهده این آیه در quran.com">مشاهده در quran.com <span class="ext">↗</span></a>
      </div>
    </div>
  </article>`;
}
function renderCards() {
  const out = $("resultsContainer");
  const visible = GROUPS.filter((g) => state.filter === "all" || state.filter === g.key);
  let html = state.judgeError
    ? `<div class="edge-card amber"><div class="edge-title">داوری کامل انجام نشد</div><div class="edge-body"><span>${esc(state.judgeError)} نتایج زیر بدون تأیید داور هستند و در کش ذخیره نمی‌شوند؛ پس از رفع مشکل، دوباره جست‌وجو کنید.</span></div></div>`
    : "";
  let total = 0;
  for (const g of visible) {
    const items = state.items.filter((i) => i.group === g.key);
    if (!items.length) continue;
    total += items.length;
    html += `<div class="group-label">${esc(g.title)} <span class="group-count">(${toFa(items.length)})</span></div>`;
    html += items.map(cardHTML).join("");
  }
  if (!total) {
    html = `<div class="ayah-card empty-card"><div class="empty-title">همه‌ی کاندیدها توسط داور رد شدند</div><div class="empty-sub">می‌توانید داوری را بردارید تا نتایج خام بازیابی را ببینید، یا گزاره را بازنویسی کنید.</div></div>`;
  }
  out.innerHTML = html;
  out.setAttribute("aria-busy", "false");
}
function renderMeta(m, cached) {
  const bits = [
    m.judge_model ? `داور: <b>${esc(m.judge_model)}</b>` : "بدون داوری",
    m.reranker ? `رتبه‌بند: <b>${esc(m.reranker)}</b> (استخر ${toFa(m.rerank_pool)})` : "رتبه‌بند: غیرفعال (RRF)",
    `کاندیدهای بررسی‌شده: <b>${toFa(m.candidates_considered ?? 0)}</b>`,
    m.translation ? `ترجمه: <b>${esc(m.translation)}</b>` : "",
    m.latency_s != null ? `زمان: <b>${toFa(m.latency_s)} ثانیه</b>` : "",
    m.retrieval_s != null ? `بازیابی+رتبه‌بندی: <b>${toFa(m.retrieval_s)}s</b>` : "",
    m.judge_s ? `داوری: <b>${toFa(m.judge_s)}s</b>` : "",
    cached ? "<b>از کش</b>" : "",
  ].filter(Boolean);
  $("resultMeta").innerHTML = bits.join(" · ");
  $("resultMeta").style.display = "";
}
function renderNoMatch(text) {
  state.current = null; state.items = []; state.judgeError = null;
  updateResultsNav();
  $("queryPreview").textContent = `گزاره: «${text}»`;
  $("stickyToolbar").style.display = "none";
  $("resultMeta").style.display = "none";
  $("resultsContainer").innerHTML = `<div class="ayah-card empty-card"><div class="empty-title">آیه‌ای با تطابق معتبر یافت نشد</div><div class="empty-sub">بازیابی ترکیبی هیچ کاندیدی را به آستانه شباهت نرساند. سامانه به‌جای نمایش سند نامرتبط، نتیجه‌ی خالی را صادقانه گزارش می‌کند؛ گزاره را بازنویسی کنید یا از نمونه‌های آماده شروع کنید.</div></div>`;
}
function renderMemoryError(text) {
  state.current = null; state.items = []; state.judgeError = null;
  updateResultsNav();
  $("queryPreview").textContent = `گزاره: «${text}»`;
  $("stickyToolbar").style.display = "none";
  $("resultMeta").style.display = "none";
  $("resultsContainer").innerHTML = `<div class="edge-card amber"><div class="edge-title">هشدار کمبود حافظه در حالت دقیق</div><div class="edge-body"><span>حافظه برای اجرای رتبه‌بند عصبی کافی نبود. می‌توانید بلافاصله از حالت سریع (بازیابی ترکیبی RRF) استفاده کنید.</span><button class="tool-btn edge-action" id="memFastBtn">انتخاب حالت سریع</button></div></div>`;
  $("memFastBtn").onclick = () => { setMode("fast"); goComposer(); toast("حالت سریع انتخاب شد"); };
}
function renderError(msg, text) {
  state.current = null; state.items = []; state.judgeError = null;
  updateResultsNav();
  $("queryPreview").textContent = text ? `گزاره: «${text}»` : "خطا";
  $("stickyToolbar").style.display = "none";
  $("resultMeta").style.display = "none";
  $("resultsContainer").innerHTML = `<div class="edge-card amber"><div class="edge-title">پردازش گزاره ناموفق بود</div><div class="edge-body"><span>${esc(msg)}</span></div></div>`;
}

/* ---------- reading tools ---------- */
function applyPrefs() {
  document.documentElement.style.setProperty("--quran-scale", state.prefs.scale);
  $("toggleTransBtn").classList.toggle("active", state.prefs.trans);
  $("toggleDiacriticsBtn").classList.toggle("active", state.prefs.plain);
}
function toggleTranslation() {
  state.prefs.trans = !state.prefs.trans;
  saveLS(LS.prefs, state.prefs);
  $("toggleTransBtn").classList.toggle("active", state.prefs.trans);
  document.querySelectorAll("#resultsContainer .translation-text").forEach((el) => el.classList.toggle("hidden", !state.prefs.trans));
}
function toggleDiacritics() {
  state.prefs.plain = !state.prefs.plain;
  saveLS(LS.prefs, state.prefs);
  $("toggleDiacriticsBtn").classList.toggle("active", state.prefs.plain);
  document.querySelectorAll("#resultsContainer .quran-text[data-plain]").forEach((el) => {
    el.textContent = state.prefs.plain ? el.getAttribute("data-plain") : el.getAttribute("data-full");
  });
}
function changeFontSize(delta) {
  state.prefs.scale = Math.min(1.5, Math.max(0.8, Math.round((state.prefs.scale + delta) * 10) / 10));
  saveLS(LS.prefs, state.prefs);
  document.documentElement.style.setProperty("--quran-scale", state.prefs.scale);
}

/* ---------- card actions ---------- */
function citation(it) { return `${it.address}\n${it.text_display}\n${it.translation_fa || ""}`; }
function onCardAction(btn) {
  const card = btn.closest(".ayah-card");
  const it = findItem(card.dataset.id);
  if (!it) return;
  const act = btn.dataset.act;
  if (act === "drawer") openDrawer(it, btn);
  else if (act === "pin") togglePin(it, btn);
  else if (act === "cite") copy(citation(it));
  else if (act === "json") copy(JSON.stringify(it, null, 2));
}

/* ---------- collection ---------- */
function togglePin(it, btn) {
  const idx = state.pins.findIndex((p) => p.id === it.id);
  if (idx >= 0) {
    state.pins.splice(idx, 1);
    if (btn) { btn.classList.remove("active"); btn.textContent = "پین در مجموعه پژوهش"; }
    toast("از مجموعه حذف شد");
  } else {
    state.pins.push(it);
    if (btn) { btn.classList.add("active"); btn.textContent = "✓ پین شد"; }
    toast("به مجموعه پژوهش افزوده شد");
  }
  saveLS(LS.pins, state.pins);
  updatePinCounter();
  if ($("view-collection").classList.contains("active")) renderCollection();
}
function updatePinCounter() {
  $("pinCounterBtn").textContent = `مجموعه پژوهش (${toFa(state.pins.length)})`;
}
function renderCollection() {
  const n = state.pins.length;
  $("collectionTitle").textContent = `مجموعه پژوهش و مقایسه کنار هم (${toFa(n)} آیه انتخاب‌شده)`;
  const grid = $("compareGrid");
  if (!n) {
    grid.innerHTML = `<div class="ayah-card empty-card" style="grid-column:1/-1"><div class="empty-title">هنوز آیه‌ای پین نشده است</div><div class="empty-sub">در صفحه نتایج، دکمه «پین در مجموعه پژوهش» را بزنید تا آیات برای مقایسه کنار هم اینجا جمع شوند.</div></div>`;
    return;
  }
  grid.innerHTML = state.pins.map((it) => {
    const g = GROUPS.find((x) => x.key === it.group) || GROUPS[3];
    const aya = it.aya_end && it.aya_end !== it.aya_start ? `${it.aya_start}-${it.aya_end}` : `${it.aya_start}`;
    return `<div class="ayah-card" data-id="${esc(it.id)}">
      <button class="tool-btn compare-remove" data-remove="${esc(it.id)}" title="حذف از مجموعه">حذف ✕</button>
      <div class="card-top">
        <span class="surah-meta">${esc(it.surah_name)} (${toFa(it.sura)}:${toFa(aya)})</span>
        <span class="verdict-badge ${g.badge}">${esc(LABELS[it.label] || it.label)}</span>
      </div>
      <div class="quran-text">${esc(it.text_display)}</div>
      <div class="translation-text">${esc(it.translation_fa || "")}</div>
      <a class="tool-btn quran-link" href="${quranURL(it.sura, it.aya_start, it.aya_end)}" target="_blank" rel="noopener noreferrer" title="مشاهده این آیه در quran.com">مشاهده در quran.com <span class="ext">↗</span></a>
    </div>`;
  }).join("");
}
function exportPins(kind) {
  if (!state.pins.length) { toast("مجموعه خالی است"); return; }
  if (kind === "json") download("quran-collection.json", JSON.stringify(state.pins, null, 2), "application/json");
  else if (kind === "bib") {
    const bib = state.pins.map((it) => {
      const key = it.id.replace(/[^0-9a-zA-Z]+/g, "_");
      return `@misc{${key},\n  title = {${it.address}},\n  author = {قرآن کریم},\n  note = {${LABELS[it.label] || it.label}},\n  text = {${it.text_display}}\n}`;
    }).join("\n\n");
    download("quran-collection.bib", bib, "application/x-bibtex");
  } else if (kind === "md") {
    const md = "# مجموعه پژوهش قرآنی\n\n" + state.pins.map((it) =>
      `## ${it.address}\n\n${it.text_display}\n\n> ${it.translation_fa || ""}\n\n_${LABELS[it.label] || it.label}_\n`).join("\n---\n\n");
    download("quran-collection.md", md, "text/markdown");
  }
}

/* ---------- reading drawer ---------- */
function openDrawer(it, trigger) {
  state.drawerTrigger = trigger || document.activeElement;
  const req = ++state.drawerReq;
  state.wordReq++;
  const backdrop = $("readingDrawer"), panel = $("drawerPanel");
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  panel.removeAttribute("inert");
  panel.innerHTML = `<div class="drawer-head"><strong class="drawer-title">مطالعه عمیق و بافت</strong><button class="ghost-btn" id="drawerClose">بستن ✕</button></div><div class="empty-sub">در حال واکشی از پایگاه داده...</div>`;
  $("drawerClose").onclick = closeDrawer;
  $("drawerClose").focus();
  getJSON("/api/verse?ids=" + encodeURIComponent(it.ids.join(",")))
    .then((v) => { if (req !== state.drawerReq) return; if (v.status === "error") throw new Error(v.message); renderDrawer(v, it); })
    .catch((e) => { if (req !== state.drawerReq) return; panel.innerHTML = `<div class="drawer-head"><strong class="drawer-title">مطالعه عمیق و بافت</strong><button class="ghost-btn" id="drawerClose">بستن ✕</button></div><div class="edge-card amber"><div class="edge-body"><span>${esc(e.message || "واکشی آیه ناموفق بود.")}</span></div></div>`; $("drawerClose").onclick = closeDrawer; });
}
function renderDrawer(v, it) {
  state.drawer = { verse: v, translator: state.prefs.translator };
  if (!v.translations[state.drawer.translator]) state.drawer.translator = Object.keys(v.translations)[0];
  const panel = $("drawerPanel");
  const aya = v.aya_end !== v.aya_start ? `${v.aya_start}-${v.aya_end}` : `${v.aya_start}`;
  const trButtons = state.translators.map((t) =>
    `<button class="tool-btn${t.id === state.drawer.translator ? " active" : ""}" data-tr="${esc(t.id)}">${esc(t.name)}</button>`).join("");
  const ctx = (block, label, current) => {
    if (!block && !current) return "";
    const tr = current ? v.translations[state.drawer.translator] : (block.translations[state.drawer.translator] || "");
    const ar = current ? v.text_display : block.text_display;
    const ref = current ? `آیه ${toFa(aya)} (آیه منتخب)` : label;
    return `<div class="context-verse${current ? " current" : ""}"><span class="ctx-ref">${esc(ref)}</span><div class="ctx-ar" dir="rtl">${esc(ar)}</div><div class="ctx-tr" data-ctx-tr="${current ? "current" : esc(block.id)}">${esc(tr)}</div></div>`;
  };
  const words = v.words.map((w) => `<span class="word-token" data-word="${esc(w.word)}">${esc(w.word)}</span>`).join("");
  panel.innerHTML = `
    <div class="drawer-head">
      <strong class="drawer-title">مطالعه عمیق و بافت · ${esc(v.surah_name)} (${toFa(v.sura)}:${toFa(aya)})</strong>
      <button class="ghost-btn" id="drawerClose">بستن ✕</button>
    </div>
    <a class="tool-btn quran-link drawer-quran" href="${quranURL(v.sura, v.aya_start, v.aya_end)}" target="_blank" rel="noopener noreferrer" title="مشاهده این آیه در quran.com">مشاهده در quran.com <span class="ext">↗</span></a>
    <div class="translator-row"><span class="lbl">مترجم:</span>${trButtons}</div>
    <div class="drawer-label">آیات بافت (پیش و پس)</div>
    ${ctx(v.before, "آیه پیش", false)}
    ${ctx(null, "", true)}
    ${ctx(v.after, "آیه پس", false)}
    <div class="drawer-label">واژه‌یابی در قرآن (کلیک کنید)</div>
    <div class="word-chips">${words}</div>
    <div class="reasoning-box concordance-result" id="concResult"><span class="conc-note">برای دیدن تعداد کاربرد هر صورت واژه در قرآن و نمونه آدرس‌ها، روی یکی از واژه‌ها کلیک کنید. داده مستقیماً از نمایه FTS5 پایگاه داده واکشی می‌شود.</span></div>`;
  $("drawerClose").onclick = closeDrawer;
  panel.querySelectorAll("[data-tr]").forEach((b) => b.onclick = () => switchTranslator(b.dataset.tr));
  panel.querySelectorAll("[data-word]").forEach((b) => b.onclick = () => lookupWord(b));
}
function switchTranslator(tid) {
  if (!state.drawer) return;
  state.drawer.translator = tid;
  state.prefs.translator = tid;
  saveLS(LS.prefs, state.prefs);
  const v = state.drawer.verse;
  $("drawerPanel").querySelectorAll("[data-tr]").forEach((b) => b.classList.toggle("active", b.dataset.tr === tid));
  $("drawerPanel").querySelectorAll("[data-ctx-tr]").forEach((el) => {
    const key = el.getAttribute("data-ctx-tr");
    if (key === "current") el.textContent = v.translations[tid] || "";
    else {
      const block = key === v.before?.id ? v.before : key === v.after?.id ? v.after : null;
      el.textContent = block ? (block.translations[tid] || "") : "";
    }
  });
}
async function lookupWord(chip) {
  const word = chip.dataset.word;
  const req = ++state.wordReq;
  $("drawerPanel").querySelectorAll("[data-word]").forEach((c) => c.classList.toggle("active", c === chip));
  const box = $("concResult");
  box.innerHTML = `<span class="conc-note">در حال واکشی «${esc(word)}»...</span>`;
  try {
    const d = await getJSON("/api/concordance?word=" + encodeURIComponent(word));
    if (req !== state.wordReq) return;
    const samples = d.samples.map((s) => `<span class="conc-sample">${esc(s.address)}</span>`).join("");
    box.innerHTML = `<div><strong>واژه «${esc(d.word)}»</strong> — <span class="conc-count">${toFa(d.count)} بار</span> در قرآن کریم آمده است.</div>${samples ? `<div class="conc-samples">${samples}</div>` : ""}<div class="conc-note">شمارش بر پایه صورت دقیق واژه در نمایه FTS5 است (نه ریشه صرفی); نمونه‌ها نخستین کاربردها هستند.</div>`;
  } catch (e) {
    if (req !== state.wordReq) return;
    box.innerHTML = `<span class="conc-note">واکشی کاربرد واژه ناموفق بود.</span>`;
  }
}
function closeDrawer() {
  const backdrop = $("readingDrawer"), panel = $("drawerPanel");
  if (!backdrop.classList.contains("open")) return;
  state.drawerReq++;
  state.wordReq++;
  if (panel.contains(document.activeElement)) document.activeElement.blur();
  panel.setAttribute("inert", "");
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.classList.remove("open");
  state.drawer = null;
  const t = state.drawerTrigger;
  if (t && document.body.contains(t) && !backdrop.contains(t)) t.focus();
}

/* ---------- trust & evaluation ---------- */
function metricCard(val, lbl) {
  return `<div class="metric-card"><div class="metric-val">${val}</div><div class="metric-lbl">${esc(lbl)}</div></div>`;
}
function detailRow(k, v) {
  return `<div class="detail-row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;
}
function renderTrust() {
  const e = state.eval;
  if (!e || !e.available) {
    $("trustGrid").innerHTML = metricCard("—", "داده ارزیابی در دسترس نیست");
    $("trustDetails").innerHTML = "";
  } else {
    const hall = Math.round((e.hallucination_rate ?? 0) * 100);
    $("trustGrid").innerHTML =
      metricCard(toFa(hall) + "٪", `توهم متنی (${toFa(e.byte_checked)} بررسی بایت‌به‌بایت)`) +
      metricCard(toFa((e.judge_accuracy ?? 0).toFixed(2)), `دقت داور (${toFa(e.judged_items)} کاندید)`) +
      metricCard(toFa((e.recall_at_15 ?? 0).toFixed(2)), "Recall@15 بازیابی ترکیبی");
    const rows = [
      detailRow("تطابق بایت‌به‌بایت متن با دیتابیس", `${toFa(e.byte_checked)} بررسی · ${toFa(e.byte_mismatches)} خطا`),
      detailRow("Recall@10 / Recall@3", `${toFa((e.recall_at_10 ?? 0).toFixed(3))} / ${toFa((e.recall_at_3 ?? 0).toFixed(3))}`),
      detailRow("MRR / Success@15", `${toFa((e.mrr ?? 0).toFixed(3))} / ${toFa((e.success_at_15 ?? 0).toFixed(2))}`),
      detailRow("تأیید نادرست در تله‌ها", toFa(e.false_approvals_on_traps ?? 0)),
      detailRow("تأییدهای خارج از هدف (داور)", `${toFa(e.off_target_approvals ?? 0)} مورد در ${toFa(e.items_with_off_target_approval ?? 0)} گزاره`),
      detailRow("میانگین تأخیر داور", `${toFa(e.avg_judge_latency_s ?? 0)} ثانیه`),
    ];
    if (e.rerank) {
      const rr = e.rerank.rrf_only, rk = e.rerank.reranker;
      rows.push(detailRow("Recall@15: RRF تنها → با رتبه‌بند", `${toFa((rr["recall@15"] ?? 0).toFixed(3))} → ${toFa((rk["recall@15"] ?? 0).toFixed(3))}`));
      rows.push(detailRow("زمان کوئری: RRF → رتبه‌بند (CPU)", `${toFa(rr.avg_query_s ?? 0)}s → ${toFa(rk.avg_query_s ?? 0)}s`));
      rows.push(detailRow("موارد بازیابی‌شده توسط رتبه‌بند", `${toFa(e.rerank.recovered)} مورد · از دست رفته: ${toFa(e.rerank.newly_lost)}`));
    }
    rows.push(detailRow("نسخه خط لوله / دیتاست طلایی", `${esc(e.pipeline_version)} · ${toFa(e.gold_items)} گزاره`));
    $("trustDetails").innerHTML = rows.join("");
    $("footAccuracy").textContent = "دقت داور: " + toFa((e.judge_accuracy ?? 0).toFixed(2));
  }
  $("edgeStates").innerHTML = `
    <div class="edge-card amber">
      <div class="edge-title">هشدار کمبود حافظه در حالت دقیق</div>
      <div class="edge-body"><span>اگر حافظه برای اجرای رتبه‌بند عصبی کافی نباشد، این هشدار در صفحه نتایج نمایش داده می‌شود و می‌توانید بلافاصله به حالت سریع کوچ کنید.</span><button class="tool-btn edge-action" id="trustFastBtn">انتخاب حالت سریع</button></div>
    </div>
    <div class="edge-card center">
      <div class="edge-title">آیه‌ای با تطابق معتبر یافت نشد</div>
      <div class="edge-body">بازیابی ترکیبی هیچ کاندیدی را به آستانه شباهت نرساند؛ سامانه به‌جای نمایش سند نامرتبط، نتیجه‌ی خالی را صادقانه گزارش می‌کند.</div>
    </div>`;
  $("trustFastBtn").onclick = () => { setMode("fast"); goComposer(); toast("حالت سریع انتخاب شد"); };
}

/* ---------- cost ---------- */
async function refreshCost() {
  try {
    const d = await getJSON("/api/cost");
    $("footCost").textContent = `هزینه نشست: $${d.spent_usd} / $${d.cap_usd}`;
  } catch (e) { $("footCost").textContent = "هزینه نشست: —"; }
}

/* ---------- init ---------- */
function bindEvents() {
  $("brandBtn").onclick = goComposer;
  $("brandBtn").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goComposer(); } };
  $("statusPill").onclick = () => showView("trust");
  $("statusPill").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showView("trust"); } };
  $("trustBtn").onclick = () => showView("trust");
  $("resultsBtn").onclick = () => showView("results");
  $("pinCounterBtn").onclick = () => { renderCollection(); showView("collection"); };
  $("editQueryBtn").onclick = goComposer;

  $("queryInput").addEventListener("input", updateComposer);
  $("queryInput").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runSearch(); } });
  $("runBtn").onclick = runSearch;
  $("modeFast").onclick = () => setMode("fast");
  $("modeAccurate").onclick = () => setMode("accurate");
  $("judgeToggle").onclick = toggleJudge;
  $("judgeToggle").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleJudge(); } };
  $("sampleChips").onclick = (e) => { const b = e.target.closest("[data-sample]"); if (b) applySuggestion(SAMPLES[+b.dataset.sample].text); };
  $("acBox").onclick = (e) => { const b = e.target.closest("[data-ac]"); if (b) applySuggestion(b.dataset.ac); };

  $("abortBtn").onclick = abortSearch;
  $("filterPills").onclick = (e) => { const b = e.target.closest("[data-filter]"); if (b) { state.filter = b.dataset.filter; renderFilters(); renderCards(); } };
  $("toggleTransBtn").onclick = toggleTranslation;
  $("toggleDiacriticsBtn").onclick = toggleDiacritics;
  $("fontMinusBtn").onclick = () => changeFontSize(-0.1);
  $("fontPlusBtn").onclick = () => changeFontSize(0.1);
  $("resultsContainer").onclick = (e) => { const b = e.target.closest("[data-act]"); if (b) onCardAction(b); };

  $("compareGrid").onclick = (e) => { const b = e.target.closest("[data-remove]"); if (b) { const it = state.pins.find((p) => p.id === b.dataset.remove); if (it) togglePin(it, null); } };
  $("expBibBtn").onclick = () => exportPins("bib");
  $("expMdBtn").onclick = () => exportPins("md");
  $("expJsonBtn").onclick = () => exportPins("json");

  $("readingDrawer").onclick = (e) => { if (e.target === $("readingDrawer")) closeDrawer(); };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); goComposer(); }
  });
}
async function init() {
  const storedPrefs = loadLS(LS.prefs, {});
  const safePrefs = storedPrefs && typeof storedPrefs === "object" && !Array.isArray(storedPrefs) ? storedPrefs : {};
  state.prefs = { ...state.prefs, ...safePrefs };
  const scale = Number(state.prefs.scale);
  state.prefs.scale = Number.isFinite(scale) ? Math.min(1.5, Math.max(0.8, scale)) : 1;
  state.pins = loadArr(LS.pins).filter((p) => p && typeof p === "object" && typeof p.id === "string");
  applyPrefs();
  renderSamples();
  updatePinCounter();
  bindEvents();
  updateComposer();
  $("queryInput").focus();

  const [status, translators, gold, evalData] = await Promise.all([
    getJSON("/api/status").catch(() => null),
    getJSON("/api/translators").catch(() => ({ translators: [] })),
    getJSON("/api/gold").catch(() => ({ items: [] })),
    getJSON("/api/eval").catch(() => null),
  ]);
  state.translators = translators.translators || [];
  state.gold = gold.items || [];
  state.eval = evalData;
  state.status = status;
  if (status && !status.reranker_active) {
    $("modeAccurate").title = "رتبه‌بند عصبی در دسترس نیست — حالت دقیق به سریع برمی‌گردد";
  }
  renderTrust();
  refreshCost();
}
document.addEventListener("DOMContentLoaded", init);