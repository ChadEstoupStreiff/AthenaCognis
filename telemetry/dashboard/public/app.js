"use strict";

const STATS_URL = "api/stats";
const REFRESH_MS = 5 * 60 * 1000;
const RETENTION_WINDOW_DAYS = 30;
const SPARSE_THRESHOLD_DAYS = 7;
const COUNT_UP_MS = 1100;
const ROLLING_WINDOW_DAYS = 7;

const RETENTION_KEYS = [
  ["d1", "D1"], ["d7", "D7"], ["d30", "D30"], ["d90", "D90"], ["d365", "D365"],
];

const FOOTPRINT = [
  { key: "nbr_files", label: "Documents managed" },
  { key: "disk_files_bytes", label: "Of knowledge stored", format: "bytes" },
  { key: "nbr_summaries", label: "AI summaries written" },
  { key: "nbr_chat_messages", label: "Chat messages exchanged" },
  { key: "nbr_hours", label: "Hours of work tracked" },
  { key: "nbr_validated_tasks", label: "Tasks completed" },
  { key: "nbr_sota_papers", label: "Research papers curated" },
  { key: "nbr_notes", label: "Notes written" },
  { key: "nbr_embeddings", label: "Semantic embeddings" },
  { key: "nbr_contacts", label: "Contacts organised" },
  { key: "nbr_calendars", label: "Calendar records" },
  { key: "nbr_transcriptions", label: "Audio transcriptions" },
];
const FOOTPRINT_MAX = 8;
const FOOTPRINT_COLUMNS = 4;

const RATIOS = [
  { label: "Files organised into a project", part: "files_without_project", whole: "nbr_files", invert: true },
  { label: "Files carrying at least one tag", part: "files_without_tag", whole: "nbr_files", invert: true },
  { label: "Tasks completed", part: "nbr_validated_tasks", whole: "nbr_tasks" },
  { label: "Papers enriched with metadata", part: "nbr_sota_with_metadata", whole: "nbr_sota_papers" },
  { label: "Instances with a research subject", share: "research_subject_set" },
];

const AI_FIELDS = {
  nbr_summaries: "Summaries",
  nbr_ocr: "OCR",
  nbr_transcriptions: "Transcriptions",
  nbr_embeddings: "Embeddings",
  nbr_chat_sessions: "Chat sessions",
  nbr_chat_messages: "Chat messages",
};

const LIBRARY_FIELDS = {
  nbr_files: "Files",
  nbr_notes: "Notes",
  nbr_links: "File links",
  nbr_tasks: "Tasks",
  nbr_contacts: "Contacts",
  nbr_tags: "Tags",
  nbr_projects: "Projects",
  nbr_pinned_files: "Pinned files",
};

const FIELD_GROUPS = {
  Library: {
    nbr_files: "Files", disk_files_bytes: "Storage used", nbr_projects: "Projects",
    nbr_tags: "Tags", files_without_tag: "Files without tag", files_without_project: "Files without project",
    nbr_links: "File links", nbr_pinned_files: "Pinned files", nbr_notes: "Notes",
  },
  "AI processing": {
    nbr_summaries: "Summaries", nbr_ocr: "OCR results", nbr_transcriptions: "Transcriptions",
    nbr_embeddings: "Semantic search embeddings", nbr_chat_sessions: "Chat sessions",
    nbr_chat_messages: "Chat messages sent",
  },
  Work: {
    nbr_calendars: "Calendar records", nbr_hours: "Hours tracked", nbr_tasks: "Tasks",
    nbr_validated_tasks: "Completed tasks", nbr_task_dependencies: "Task dependencies",
    nbr_kanban_boards: "Kanban boards", nbr_kanban_columns: "Kanban columns", nbr_contacts: "Contacts",
  },
  Research: {
    nbr_sota_papers: "Papers in the research library", nbr_sota_with_metadata: "Papers with metadata",
    nbr_sota_with_references: "Papers with extracted references",
    research_subject_set: "Research subject set", research_searches: "Paper searches (since previous report)",
    research_discoveries: "Related-paper discoveries (since previous report)",
    research_imports: "Papers imported from search (since previous report)",
  },
};
const SHARE_KEYS = new Set(["research_subject_set"]);
const BYTE_KEYS = new Set(["disk_files_bytes"]);

const state = { data: null, rangeDays: 0, tab: Object.keys(FIELD_GROUPS)[0], charts: {} };

/* ── Formatting ─────────────────────────────────────────── */

const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function compact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${oneDecFmt.format(value / 1e9)}B`;
  if (abs >= 1e6) return `${oneDecFmt.format(value / 1e6)}M`;
  if (abs >= 1e4) return `${oneDecFmt.format(value / 1e3)}k`;
  return abs < 10 && !Number.isInteger(value) ? oneDecFmt.format(value) : intFmt.format(value);
}

function bytesParts(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return [value, units[unit]];
}

function formatBytes(bytes) {
  const [value, unit] = bytesParts(bytes);
  return `${oneDecFmt.format(value)} ${unit}`;
}

function formatField(key, value) {
  if (value === null || value === undefined) return "—";
  if (BYTE_KEYS.has(key)) return formatBytes(value);
  if (SHARE_KEYS.has(key)) return `${Math.round(value * 100)}%`;
  return Number.isInteger(value) ? intFmt.format(value) : oneDecFmt.format(value);
}

function percent(value) {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ── Theme ──────────────────────────────────────────────── */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette() {
  return {
    ink: cssVar("--ink"), ink2: cssVar("--ink-2"), muted: cssVar("--muted"),
    grid: cssVar("--grid"), axis: cssVar("--axis"), surface: cssVar("--surface"),
    s1: cssVar("--series-1"), s2: cssVar("--series-2"), s3: cssVar("--series-3"),
  };
}

function isDark() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("ac-theme", next); } catch (_) { /* storage unavailable */ }
  renderCharts();
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ── Count-up ───────────────────────────────────────────── */

function countUp(el, target, format) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !Number.isFinite(target)) { el.textContent = format(target); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / COUNT_UP_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(t < 1 ? target * eased : target);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ── Data helpers ───────────────────────────────────────── */

function latestDay(daily) {
  return daily.length ? daily[daily.length - 1] : null;
}

function visibleDaily() {
  const { daily } = state.data;
  if (!state.rangeDays || !daily.length) return daily;
  const last = new Date(`${daily[daily.length - 1].date}T00:00:00`);
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - state.rangeDays);
  return daily.filter((d) => new Date(`${d.date}T00:00:00`) > cutoff);
}

function retentionAverage(daily, key) {
  const values = daily.slice(-RETENTION_WINDOW_DAYS).map((d) => d.retention[key]).filter((v) => v !== null && v !== undefined);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rollingAverage(values) {
  return values.map((value, i) => {
    if (value === null || value === undefined) return null;
    const window = values.slice(Math.max(0, i - ROLLING_WINDOW_DAYS + 1), i + 1).filter((v) => v !== null && v !== undefined);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

function fieldStat(fields, key, stat) {
  const entry = fields[key];
  return entry && entry[stat] !== undefined ? entry[stat] : null;
}

/* ── KPIs ───────────────────────────────────────────────── */

function setKpi(name, value, format, sub) {
  const el = document.querySelector(`[data-kpi="${name}"]`);
  countUp(el, value, format);
  document.querySelector(`[data-kpi-sub="${name}"]`).innerHTML = sub;
}

function renderKpis() {
  const { daily, summary } = state.data;
  const last = latestDay(daily);
  const prevWeek = daily.length > 7 ? daily[daily.length - 8] : null;
  const growth = prevWeek ? summary.all_time_users - prevWeek.total_users : null;
  const growthSub = growth > 0 ? `<span class="up">+${intFmt.format(growth)}</span> in the last 7 days` : "Unique UUIDs ever seen";
  const activeShare = last && summary.all_time_users ? last.unique_users / summary.all_time_users : null;

  setKpi("all_time", summary.all_time_users, (v) => intFmt.format(Math.round(v)), growthSub);
  setKpi("active", last ? last.unique_users : 0, (v) => intFmt.format(Math.round(v)),
    last ? `${percent(activeShare)} of all instances · ${shortDate(last.date)}` : "");
  setKpi("avg_dau", summary.avg_dau, (v) => oneDecFmt.format(v), "Instances per day, all time");
  setKpi("days", summary.days_tracked, (v) => intFmt.format(Math.round(v)),
    daily.length ? `Since ${longDate(daily[0].date)}` : "");
}

/* ── Footprint & ratios ─────────────────────────────────── */

function footprintTile(item, total) {
  if (item.format === "bytes") {
    const [value, unit] = bytesParts(total);
    return { html: `<span class="fp-value"><span data-v></span><span class="fp-unit">${unit}</span></span>`, value, format: (v) => oneDecFmt.format(v) };
  }
  return { html: `<span class="fp-value" data-v></span>`, value: total, format: (v) => compact(Math.round(v)) };
}

function renderFootprint() {
  const last = latestDay(state.data.daily);
  const fields = (last && last.fields) || {};
  const items = FOOTPRINT.filter((f) => fieldStat(fields, f.key, "sum")).slice(0, FOOTPRINT_MAX);
  const root = document.getElementById("footprint");
  root.innerHTML = "";
  if (!items.length) {
    root.innerHTML = `<div class="fp"><span class="fp-label">No usage counters received yet.</span></div>`;
    return;
  }
  for (const item of items) {
    const tile = footprintTile(item, fieldStat(fields, item.key, "sum"));
    const el = document.createElement("div");
    el.className = "fp";
    el.innerHTML = `${tile.html}<span class="fp-label">${escapeHtml(item.label)}</span>`;
    root.appendChild(el);
    countUp(el.querySelector("[data-v]"), tile.value, tile.format);
  }
  const filler = (FOOTPRINT_COLUMNS - (items.length % FOOTPRINT_COLUMNS)) % FOOTPRINT_COLUMNS;
  for (let i = 0; i < filler; i += 1) {
    const pad = document.createElement("div");
    pad.className = "fp fp-empty";
    root.appendChild(pad);
  }
}

function ratioValue(rule, fields) {
  if (rule.share) return fieldStat(fields, rule.share, "avg");
  const part = fieldStat(fields, rule.part, "sum");
  const whole = fieldStat(fields, rule.whole, "sum");
  if (part === null || !whole) return null;
  const ratio = part / whole;
  return Math.max(0, Math.min(1, rule.invert ? 1 - ratio : ratio));
}

function renderRatios() {
  const last = latestDay(state.data.daily);
  const fields = (last && last.fields) || {};
  const root = document.getElementById("ratios");
  root.innerHTML = "";
  for (const rule of RATIOS) {
    const value = ratioValue(rule, fields);
    if (value === null) continue;
    const el = document.createElement("div");
    el.className = "card ratio";
    el.innerHTML = `
      <div class="ratio-top"><span class="ratio-label">${escapeHtml(rule.label)}</span><span class="ratio-value">${percent(value)}</span></div>
      <div class="bar" role="img" aria-label="${percent(value)}"><span></span></div>`;
    root.appendChild(el);
    requestAnimationFrame(() => { el.querySelector(".bar > span").style.width = `${value * 100}%`; });
  }
}

/* ── Charts ─────────────────────────────────────────────── */

function chart(id) {
  const el = document.getElementById(id);
  if (!state.charts[id]) state.charts[id] = echarts.init(el, null, { renderer: "svg" });
  return state.charts[id];
}

function tooltipBase(p) {
  return {
    trigger: "axis",
    backgroundColor: p.surface,
    borderColor: p.axis,
    borderWidth: 1,
    textStyle: { color: p.ink, fontSize: 13 },
    extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;",
  };
}

function axisBase(p) {
  return {
    axisLine: { lineStyle: { color: p.axis } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontSize: 12 },
    splitLine: { lineStyle: { color: p.grid } },
  };
}

function tooltipRows(params, valueFormat) {
  const head = `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(params[0].axisValueLabel)}</div>`;
  const rows = params.map((s) => `<div style="display:flex;gap:16px;justify-content:space-between;align-items:center">
    <span>${s.marker}${escapeHtml(s.seriesName)}</span><b>${valueFormat(Array.isArray(s.value) ? s.value[1] : s.value)}</b></div>`);
  return head + rows.join("");
}

function renderGrowth(p) {
  const rows = visibleDaily();
  const dates = rows.map((d) => d.date);
  const few = rows.length <= 2;
  chart("chart-growth").setOption({
    animationDuration: 900,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(p), axisPointer: { type: "line", lineStyle: { color: p.axis } },
      formatter: (ps) => tooltipRows(ps, (v) => intFmt.format(v)) },
    xAxis: { type: "category", data: dates, boundaryGap: false, ...axisBase(p), splitLine: { show: false },
      axisLabel: { color: p.muted, fontSize: 12, formatter: shortDate, hideOverlap: true } },
    yAxis: { type: "value", minInterval: 1, ...axisBase(p), axisLine: { show: false } },
    series: [
      { name: "Active that day", type: "line", smooth: 0.25, data: rows.map((d) => d.unique_users),
        showSymbol: few, symbolSize: 8, lineStyle: { width: 2, color: p.s1 }, itemStyle: { color: p.s1 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: withAlpha(p.s1, 0.35) }, { offset: 1, color: withAlpha(p.s1, 0) }]) } },
      { name: "Cumulative instances", type: "line", smooth: 0.25, data: rows.map((d) => d.total_users),
        showSymbol: few, symbolSize: 8, lineStyle: { width: 2, color: p.s2 }, itemStyle: { color: p.s2 } },
    ],
  }, true);
}

function renderSpark(id, values, color) {
  chart(id).setOption({
    animationDuration: 900,
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: (v) => v.min * 0.9 },
    tooltip: { show: false },
    series: [{ type: "line", data: values, smooth: 0.3, showSymbol: false, silent: true,
      lineStyle: { width: 2, color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: withAlpha(color, 0.25) }, { offset: 1, color: withAlpha(color, 0) }]) } }],
  }, true);
}

function emptyNotice(p, show) {
  return show ? [{ type: "text", left: "center", top: "middle",
    style: { text: "Not enough history yet", fill: p.muted, fontSize: 14 } }] : [];
}

function renderRetention(p) {
  const { daily } = state.data;
  const values = RETENTION_KEYS.map(([key]) => retentionAverage(daily, key));
  chart("chart-retention").setOption({
    animationDuration: 900,
    grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(p), axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(p.s1, 0.08) } },
      formatter: (ps) => `<b>${ps[0].name} retention</b><br>${ps[0].value === null ? "Not enough history yet" : `${oneDecFmt.format(ps[0].value * 100)}% came back`}` },
    xAxis: { type: "category", data: RETENTION_KEYS.map(([, label]) => label), ...axisBase(p), splitLine: { show: false } },
    yAxis: { type: "value", min: 0, max: 1, ...axisBase(p), axisLine: { show: false },
      axisLabel: { color: p.muted, fontSize: 12, formatter: (v) => `${Math.round(v * 100)}%` } },
    series: [{ type: "bar", name: "Retention", barMaxWidth: 56,
      data: values.map((v) => ({ value: v, itemStyle: { color: p.s1, borderRadius: [4, 4, 0, 0] } })),
      label: { show: true, position: "top", color: p.ink2, fontSize: 12, fontWeight: 600,
        formatter: (x) => (x.value === null || x.value === undefined ? "n/a" : percent(x.value)) } }],
    graphic: emptyNotice(p, values.every((v) => v === null)),
  }, true);
}

function renderRetentionTrend(p) {
  const rows = visibleDaily();
  const colors = [p.s1, p.s2, p.s3];
  const few = rows.length <= 2;
  chart("chart-retention-trend").setOption({
    animationDuration: 900,
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(p), axisPointer: { type: "line", lineStyle: { color: p.axis } },
      formatter: (ps) => tooltipRows(ps, (v) => (v === null || v === undefined ? "—" : percent(v))) },
    xAxis: { type: "category", data: rows.map((d) => d.date), boundaryGap: false, ...axisBase(p), splitLine: { show: false },
      axisLabel: { color: p.muted, fontSize: 12, formatter: shortDate, hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: 1, ...axisBase(p), axisLine: { show: false },
      axisLabel: { color: p.muted, fontSize: 12, formatter: (v) => `${Math.round(v * 100)}%` } },
    series: RETENTION_KEYS.slice(0, 3).map(([key, label], i) => ({
      name: label, type: "line", smooth: 0.25, connectNulls: false, showSymbol: few, symbolSize: 8,
      data: rollingAverage(rows.map((d) => d.retention[key])), lineStyle: { width: 2, color: colors[i] }, itemStyle: { color: colors[i] },
    })),
    graphic: emptyNotice(p, rows.every((d) => d.retention.d1 === null && d.retention.d7 === null && d.retention.d30 === null)),
  }, true);
}

function renderMedianBars(id, labels, p) {
  const last = latestDay(state.data.daily);
  const fields = (last && last.fields) || {};
  const rows = Object.entries(labels)
    .map(([key, label]) => ({ label, value: fieldStat(fields, key, "median") }))
    .filter((r) => r.value !== null)
    .sort((a, b) => a.value - b.value);
  chart(id).setOption({
    animationDuration: 900,
    grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(p), axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(p.s1, 0.08) } },
      formatter: (ps) => `<b>${escapeHtml(ps[0].name)}</b><br>Median ${intFmt.format(ps[0].value)} per instance` },
    xAxis: { type: "value", ...axisBase(p), axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: { type: "category", data: rows.map((r) => r.label), ...axisBase(p), axisLine: { show: false },
      axisLabel: { color: p.ink2, fontSize: 13 } },
    series: [{ type: "bar", barMaxWidth: 18, data: rows.map((r) => r.value),
      itemStyle: { color: p.s1, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: p.ink2, fontSize: 12, fontWeight: 600, formatter: (x) => compact(x.value) } }],
    graphic: rows.length ? [] : [{ type: "text", left: "center", top: "middle",
      style: { text: "No data yet", fill: p.muted, fontSize: 14 } }],
  }, true);
}

function renderCharts() {
  if (!state.data) return;
  const p = palette();
  const { daily } = state.data;
  renderGrowth(p);
  renderSpark("spark-total", daily.map((d) => d.total_users), p.s2);
  renderSpark("spark-active", daily.map((d) => d.unique_users), p.s1);
  renderRetention(p);
  renderRetentionTrend(p);
  renderMedianBars("chart-ai", AI_FIELDS, p);
  renderMedianBars("chart-library", LIBRARY_FIELDS, p);
}

/* ── Table ──────────────────────────────────────────────── */

function renderTabs() {
  const root = document.getElementById("tabs");
  root.innerHTML = "";
  for (const group of Object.keys(FIELD_GROUPS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = group;
    btn.className = group === state.tab ? "on" : "";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(group === state.tab));
    btn.addEventListener("click", () => { state.tab = group; renderTabs(); renderTable(); });
    root.appendChild(btn);
  }
}

function renderTable() {
  const last = latestDay(state.data.daily);
  const fields = (last && last.fields) || {};
  const rows = Object.entries(FIELD_GROUPS[state.tab])
    .filter(([key]) => fields[key])
    .map(([key, label]) => `<tr><td>${escapeHtml(label)}</td>
      <td>${formatField(key, fieldStat(fields, key, "median"))}</td>
      <td>${formatField(key, fieldStat(fields, key, "avg"))}</td>
      <td>${SHARE_KEYS.has(key) ? "—" : formatField(key, fieldStat(fields, key, "sum"))}</td></tr>`);
  const body = rows.length ? rows.join("") : `<tr><td class="empty" colspan="4">No instance has reported these counters yet.</td></tr>`;
  document.getElementById("table").innerHTML =
    `<thead><tr><th>Metric</th><th>Median</th><th>Average</th><th>Total</th></tr></thead><tbody>${body}</tbody>`;
}

/* ── Status & loading ───────────────────────────────────── */

function setStatus(ok) {
  const live = document.getElementById("live");
  live.classList.toggle("ok", ok);
  live.classList.toggle("down", !ok);
  document.getElementById("error").hidden = ok;
  const last = state.data && latestDay(state.data.daily);
  const text = ok ? (last ? `Live · data for ${shortDate(last.date)}` : "Live") : "Offline";
  document.getElementById("live-text").textContent = text;
  if (last && last.computed_at) {
    document.getElementById("foot-updated").textContent = `Aggregated ${new Date(`${last.computed_at}Z`).toLocaleString("en-US")}`;
  }
}

function validate(payload) {
  if (!payload || !Array.isArray(payload.daily) || typeof payload.summary !== "object") {
    throw new Error("Unexpected /stats payload");
  }
  return payload;
}

function renderAll() {
  document.getElementById("sparse").hidden = state.data.daily.length >= SPARSE_THRESHOLD_DAYS;
  renderKpis();
  renderFootprint();
  renderRatios();
  renderCharts();
  renderTabs();
  renderTable();
}

async function load() {
  try {
    const res = await fetch(STATS_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = validate(await res.json());
    renderAll();
    setStatus(true);
  } catch (err) {
    console.error("Telemetry fetch failed:", err);
    setStatus(false);
  }
}

function bindControls() {
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderCharts);
  document.getElementById("range").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    state.rangeDays = Number(btn.dataset.days);
    document.querySelectorAll("#range button").forEach((b) => b.classList.toggle("on", b === btn));
    renderGrowth(palette());
    renderRetentionTrend(palette());
  });
  window.addEventListener("resize", () => Object.values(state.charts).forEach((c) => c.resize()));
}

bindControls();
load();
setInterval(load, REFRESH_MS);
