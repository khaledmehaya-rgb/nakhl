/* نخل — تطبيق متابعة الأطفال. كل البيانات محفوظة على الجهاز فقط. */
'use strict';

// ───────── أدوات عامة ─────────
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const addMonths = (iso, n) => { const d = parseISO(iso); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return toISO(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const ageMonthsF = (birth, at = todayISO()) => daysBetween(birth, at) / 30.4375;
function fullMonths(birth, at = todayISO()) {
  const b = parseISO(birth), t = parseISO(at);
  let m = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
  if (t.getDate() < b.getDate()) m--;
  return Math.max(0, m);
}
const gFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const gShort = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
const hFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDate = iso => iso ? gFmt.format(parseISO(iso)) : '';
const fmtShort = iso => iso ? gShort.format(parseISO(iso)) : '';
const fmtHijri = iso => iso ? hFmt.format(parseISO(iso)).replace(' هـ', '') + ' هـ' : '';
const num = (x, d = 1) => Number(x).toLocaleString('en-US', { maximumFractionDigits: d });

function yearsWord(n) { return n === 1 ? 'سنة' : n === 2 ? 'سنتان' : n <= 10 ? `${n} سنوات` : `${n} سنة`; }
function monthsWord(n) { return n === 1 ? 'شهر' : n === 2 ? 'شهران' : n <= 10 ? `${n} أشهر` : `${n} شهراً`; }
function weeksWord(n) { return n === 1 ? 'أسبوع' : n === 2 ? 'أسبوعان' : n <= 10 ? `${n} أسابيع` : `${n} أسبوعاً`; }
function ageText(birth, at) {
  const m = fullMonths(birth, at);
  if (m < 1) { const d = daysBetween(birth, at || todayISO()); return d < 14 ? `${d} يوم` : weeksWord(Math.floor(d / 7)); }
  const y = Math.floor(m / 12), r = m % 12;
  if (!y) return monthsWord(r);
  return r ? `${yearsWord(y)} و${monthsWord(r)}` : yearsWord(y);
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200);
}

// ───────── التخزين (IndexedDB) ─────────
const DB = {
  db: null,
  open() {
    return new Promise((res) => {
      try {
        const r = indexedDB.open('nakhl', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => res();
      } catch { res(); }
    });
  },
  get(k) {
    return new Promise(res => {
      if (!this.db) { try { res(JSON.parse(localStorage.getItem('nakhl:' + k))); } catch { res(null); } return; }
      const q = this.db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null);
    });
  },
  set(k, v) {
    return new Promise(res => {
      if (!this.db) { try { localStorage.setItem('nakhl:' + k, JSON.stringify(v)); } catch {} res(); return; }
      const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
      tx.oncomplete = res; tx.onerror = res;
    });
  }
};
const blankState = () => ({ v: 1, children: [], measurements: [], quran: {}, quranLog: [], vaccines: {}, flu: {}, milestones: {}, activities: [], notes: [], pregnancy: {}, lastBackup: null, created: todayISO() });
let S = blankState();
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => DB.set('state', S), 150); }

// ───────── WHO ─────────
let WHO = null;
const Z_LINES = [[-1.881, 'P3'], [-1.036, 'P15'], [0, 'P50'], [1.036, 'P85'], [1.881, 'P97']];
function lms(ind, sex, mo) {
  const t = WHO?.[ind]?.[sex]; if (!t) return null;
  if (mo < 0 || mo > t.length - 1) return null;
  const i = Math.floor(mo), f = mo - i, a = t[i], b = t[Math.min(i + 1, t.length - 1)];
  return a.map((v, k) => v + (b[k] - v) * f);
}
function zScore(ind, sex, mo, x) {
  const p = lms(ind, sex, mo); if (!p || !x) return null;
  const [L, M, Sg] = p;
  return L === 0 ? Math.log(x / M) / Sg : (Math.pow(x / M, L) - 1) / (L * Sg);
}
function valAtZ(ind, sex, mo, z) {
  const p = lms(ind, sex, mo); if (!p) return null;
  const [L, M, Sg] = p;
  return L === 0 ? M * Math.exp(Sg * z) : M * Math.pow(1 + L * Sg * z, 1 / L);
}
function normCdf(z) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
const pct = z => Math.min(99.9, Math.max(0.1, normCdf(z) * 100));
const IND = {
  hfa: { label: 'الطول', unit: 'سم', cmp: 'أطول من', key: 'h' },
  wfa: { label: 'الوزن', unit: 'كجم', cmp: 'أثقل من', key: 'w' },
  bfa: { label: 'مؤشر كتلة الجسم', short: 'مؤشر الكتلة', unit: '', cmp: 'أعلى من', key: 'b' }
};
function classify(ind, z, mo) {
  if (z == null) return null;
  if (ind === 'bfa') {
    if (mo >= 61) {
      if (z > 2) return ['alert', 'سمنة حسب تصنيف منظمة الصحة العالمية — يُفضّل مراجعة الطبيب'];
      if (z > 1) return ['warn', 'زيادة وزن حسب تصنيف منظمة الصحة العالمية'];
      if (z < -2) return ['alert', 'نحافة — يُفضّل مراجعة الطبيب'];
      return ['ok', 'وزن مناسب للطول'];
    }
    if (z > 3) return ['alert', 'سمنة — يُفضّل مراجعة الطبيب'];
    if (z > 2) return ['warn', 'زيادة وزن — للمتابعة مع الطبيب'];
    if (z > 1) return ['info', 'احتمال زيادة الوزن — للمتابعة'];
    if (z < -2) return ['alert', 'نحافة — يُفضّل مراجعة الطبيب'];
    return ['ok', 'وزن مناسب للطول'];
  }
  if (z < -2) return ['alert', 'أقل من المعدل الطبيعي — يُفضّل مراجعة الطبيب'];
  if (z < -1) return ['info', 'في الجانب الأقل من الطبيعي'];
  if (z <= 1) return ['ok', 'ضمن المتوسط'];
  if (z <= 2) return ['info', 'في الجانب الأعلى من الطبيعي'];
  return ind === 'hfa' ? ['info', 'طويل بالنسبة لعمره'] : ['alert', 'أعلى من المعدل — يُفضّل مراجعة الطبيب'];
}

// ───────── بيانات الطفل ─────────
const COLORS = ['#2E6A52', '#B0613A', '#4D63A0', '#8A5296', '#2F7A82'];
const child = id => S.children.find(c => c.id === id);
const isBorn = c => c.status !== 'expected' && c.birthDate;
const he = (c, m, f) => c.sex === 'girl' ? f : m;
function avatar(c, lg) {
  const inner = c.photo ? `<img src="${c.photo}" alt="">` : esc((c.name || '؟').trim()[0]);
  return `<div class="avatar${lg ? ' lg' : ''}" style="background:${c.color || COLORS[0]}" aria-hidden="true">${inner}</div>`;
}
const measOf = id => S.measurements.filter(m => m.childId === id).sort((a, b) => a.date < b.date ? -1 : 1);
function measInterval(c) { return ageMonthsF(c.birthDate) < 12 ? 1 : 3; }
function nextMeasureDue(c) {
  const ms = measOf(c.id); if (!ms.length) return todayISO();
  return addMonths(ms[ms.length - 1].date, measInterval(c));
}

// القرآن
const INTERVALS = [1, 3, 7, 14, 30, 60];
const qOf = id => (S.quran[id] ||= {});
const JUZ_AMMA = Array.from({ length: 37 }, (_, i) => 114 - i); // الناس ← النبأ
function dueReviews(id) {
  const q = qOf(id), t = todayISO();
  return Object.entries(q).filter(([, v]) => v.st === 'memorized' && v.next && v.next <= t).map(([k]) => +k).sort((a, b) => b - a);
}
function quranStats(id) {
  const q = qOf(id); let surahs = 0, ayahs = 0, juz = 0;
  for (const [k, v] of Object.entries(q)) if (v.st === 'memorized') { surahs++; ayahs += SURAHS[k - 1][1]; if (k >= 78) juz += SURAHS[k - 1][1]; }
  const juzTotal = JUZ_AMMA.reduce((s, n) => s + SURAHS[n - 1][1], 0);
  return { surahs, ayahs, juzPct: Math.round(juz / juzTotal * 100) };
}
function nextNewSurah(id) { const q = qOf(id); return JUZ_AMMA.find(n => !q[n] || q[n].st !== 'memorized'); }
function quranStreak(id) {
  const days = new Set(S.quranLog.filter(l => l.childId === id).map(l => l.date));
  let d = todayISO(), n = 0;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// التطعيمات
function visitsFor(c) {
  return VACCINE_VISITS.map(v => ({ ...v, items: c.sex === 'boy' ? v.items.filter(i => !i.includes('HPV')) : v.items }));
}
function vaxStatus(c, v) {
  const rec = (S.vaccines[c.id] ||= {})[v.key];
  if (rec?.done) return { st: 'done', due: addMonths(c.birthDate, v.m), rec };
  const due = addMonths(c.birthDate, v.m), t = todayISO();
  const lateBy = v.key === 'y4_6' ? addMonths(c.birthDate, 72) : addDays(due, 60);
  if (t > lateBy) return { st: 'over', due };
  if (t >= addDays(due, -30)) return { st: 'due', due };
  return { st: 'up', due };
}
function nextVax(c) { return visitsFor(c).map(v => ({ v, ...vaxStatus(c, v) })).find(x => x.st !== 'done'); }

// المعالم
function msGroups(c) {
  const age = ageMonthsF(c.birthDate);
  let cur = 0; MILESTONES.forEach((g, i) => { if (g.m <= age + 0.5) cur = i; });
  return { cur, age };
}

// ───────── التنقل ─────────
let route = { name: 'home' };
function go(hash) { location.hash = hash; }
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'child' && child(h[1])) return { name: 'child', id: h[1], tab: h[2] || 'summary' };
  if (h[0] === 'settings') return { name: 'settings' };
  if (h[0] === 'edit') return { name: 'edit', id: h[1] };
  return { name: 'home' };
}
window.addEventListener('hashchange', () => { route = parseRoute(); render(); window.scrollTo(0, 0); });

// ───────── العرض ─────────
const LOGO = `<svg viewBox="0 0 512 512" role="img" aria-label="شعار نخل"><rect width="512" height="512" rx="116" fill="#1E4A38"/><path d="M80 402 Q256 372 432 402" fill="none" stroke="#C8963E" stroke-width="10" stroke-linecap="round"/>${[[165, 398, 280], [272, 398, 220], [372, 398, 165]].map(([x, y, h]) => palmPath(x, y, h)).join('')}</svg>`;
function palmPath(cx, base, h) {
  const k = h / 180, top = base - 128 * k;
  const p = (d) => `<path d="${d}" fill="none" stroke="#F3EBDC" stroke-width="${10 * k}" stroke-linecap="round"/>`;
  const tr = (a, b) => `${(cx + a * k).toFixed(1)} ${(top + b * k).toFixed(1)}`;
  return `<path d="M${tr(0, 6)} C${tr(-6, 50)} ${tr(6, 90)} ${tr(0, 128)}" fill="none" stroke="#F3EBDC" stroke-width="${12 * k}" stroke-linecap="round"/>`
    + p(`M${tr(0, 0)} C${tr(-16, -16)} ${tr(-38, -16)} ${tr(-52, 4)}`) + p(`M${tr(0, 0)} C${tr(-10, -24)} ${tr(-26, -36)} ${tr(-40, -36)}`)
    + p(`M${tr(0, 0)} C${tr(2, -20)} ${tr(4, -36)} ${tr(0, -48)}`) + p(`M${tr(0, 0)} C${tr(12, -24)} ${tr(28, -34)} ${tr(42, -34)}`)
    + p(`M${tr(0, 0)} C${tr(18, -14)} ${tr(38, -14)} ${tr(52, 6)}`)
    + `<circle cx="${(cx - 7 * k).toFixed(1)}" cy="${(top + 12 * k).toFixed(1)}" r="${(7 * k).toFixed(1)}" fill="#C8963E"/><circle cx="${(cx + 7 * k).toFixed(1)}" cy="${(top + 12 * k).toFixed(1)}" r="${(7 * k).toFixed(1)}" fill="#C8963E"/>`;
}

function setBar(title, back) {
  $('#title').textContent = title;
  $('#back').hidden = !back;
  $('#back').onclick = () => back && go(back);
}

function render() {
  const app = $('#app');
  if (!S.children.length && route.name !== 'edit') { setBar('نخل', null); app.innerHTML = viewWelcome(); return; }
  if (route.name === 'child') { const c = child(route.id); setBar(c.name, '#/'); app.innerHTML = isBorn(c) ? viewChild(c, route.tab) : viewPregnancy(c); afterChild(c); return; }
  if (route.name === 'settings') { setBar('الإعدادات', '#/'); app.innerHTML = viewSettings(); return; }
  if (route.name === 'edit') { const c = child(route.id); setBar(c ? 'تعديل' : 'إضافة طفل', S.children.length ? '#/settings' : '#/'); app.innerHTML = viewEdit(c); return; }
  setBar('نخل', null); app.innerHTML = viewHome();
}

function viewWelcome() {
  return `<div class="hero" style="padding-top:28px">${LOGO}<div class="brand">نخل</div><div class="tag">نحفظ نموّهم خطوةً بخطوة</div></div>
  <div class="card stack" style="margin-top:20px">
    <p>مرحباً بك. هذا التطبيق يتابع حفظ القرآن والنمو والتطعيمات والتطور لكل طفل، وكل البيانات تبقى على جوالك فقط.</p>
    <label class="btn block" for="import-file">استيراد ملف البداية</label>
    <button class="btn secondary block" data-act="go" data-to="#/edit/new">إضافة طفل يدوياً</button>
  </div>
  <input type="file" id="import-file" accept="application/json,.json" hidden data-change="import">`;
}

function homeLine(c) {
  if (!isBorn(c)) {
    const left = daysBetween(todayISO(), c.expectedDate), gd = 280 - left;
    if (left < 0) return `<span class="pill warn">الموعد المتوقع مضى — سجّلي الولادة</span>`;
    return `<span class="pill info">الأسبوع ${Math.floor(gd / 7)} من الحمل</span> <span class="small muted">باقي ${weeksWord(Math.ceil(left / 7))}</span>`;
  }
  const out = [];
  const nv = nextVax(c);
  if (nv && nv.st === 'over') out.push(`<span class="pill alert">تطعيم متأخر: ${esc(nv.v.label)}</span>`);
  else if (nv && nv.st === 'due') out.push(`<span class="pill warn">تطعيم ${esc(nv.v.label)} قريب</span>`);
  const dr = dueReviews(c.id).length;
  if (dr) out.push(`<span class="pill info">${dr} للمراجعة اليوم</span>`);
  if (nextMeasureDue(c) <= todayISO()) out.push(`<span class="pill plain">وقت القياس</span>`);
  if (!out.length) out.push(`<span class="pill ok">كل شيء محدّث</span>`);
  return out.join(' ');
}

function viewHome() {
  const backupOld = !S.lastBackup || daysBetween(S.lastBackup, todayISO()) > 30;
  return `<div class="hero">${LOGO.replace('<svg', '<svg style="width:52px;height:52px"')}<div class="tag">${esc(fmtDate(todayISO()))} · ${esc(fmtHijri(todayISO()))}</div></div>
  ${S.children.map(c => `<button class="child-card" data-act="go" data-to="#/child/${c.id}">
    ${avatar(c)}<div class="grow"><div class="child-name">${esc(c.name)}</div>
    <div class="small muted">${isBorn(c) ? esc(ageText(c.birthDate)) : 'الموعد المتوقع ' + esc(fmtDate(c.expectedDate))}</div>
    <div class="row wrap" style="gap:6px;margin-top:6px">${homeLine(c)}</div></div>
    <svg class="chev" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>`).join('')}
  ${backupOld ? `<div class="card row between"><div class="grow"><b>نسخة احتياطية</b><div class="small muted">${S.lastBackup ? 'آخر نسخة ' + esc(fmtDate(S.lastBackup)) : 'لم تُحفظ نسخة بعد'}</div></div><button class="btn secondary" data-act="export">احفظي نسخة</button></div>` : ''}`;
}

// ── صفحة الطفل
const TABS = [['summary', 'ملخص'], ['quran', 'القرآن'], ['growth', 'النمو'], ['vax', 'التطعيمات'], ['dev', 'التطور'], ['tips', 'رؤى المرحلة']];
function viewChild(c, tab) {
  const tabs = `<nav class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab" role="tab" aria-selected="${k === tab}" data-act="go" data-to="#/child/${c.id}/${k}">${l}</button>`).join('')}</nav>`;
  const body = { summary: tabSummary, quran: tabQuran, growth: tabGrowth, vax: tabVax, dev: tabDev, tips: tabTips }[tab] || tabSummary;
  return `<div class="row" style="margin-bottom:12px">${avatar(c, true)}<div class="grow"><div class="child-name" style="font-size:22px">${esc(c.name)}</div>
    <div class="muted small">${esc(ageText(c.birthDate))} · ${esc(fmtDate(c.birthDate))}</div><div class="muted small">${esc(fmtHijri(c.birthDate))}</div></div></div>${tabs}${body(c)}`;
}
function afterChild() {
  const tab = $('.tab[aria-selected="true"]'); if (tab) tab.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function tabSummary(c) {
  const ms = measOf(c.id), last = ms[ms.length - 1];
  const qs = quranStats(c.id), dr = dueReviews(c.id), nv = nextVax(c);
  const mo = last ? ageMonthsF(c.birthDate, last.date) : 0;
  const zh = last?.h ? zScore('hfa', c.sex, mo, last.h) : null, zw = last?.w ? zScore('wfa', c.sex, mo, last.w) : null;
  return `<div class="card"><div class="row between"><h3>القرآن</h3><button class="btn ghost" data-act="go" data-to="#/child/${c.id}/quran">فتح</button></div>
    <div class="row" style="gap:8px;margin-top:8px"><div class="stat"><b>${qs.surahs}</b><span>سورة محفوظة</span></div><div class="stat"><b>${qs.juzPct}%</b><span>من جزء عمّ</span></div><div class="stat"><b>${dr.length}</b><span>مراجعة اليوم</span></div></div></div>
  <div class="card"><div class="row between"><h3>النمو</h3><button class="btn ghost" data-act="add-meas" data-id="${c.id}">قياس جديد</button></div>
    ${last ? `<div class="kv"><span>آخر قياس</span><span>${esc(fmtDate(last.date))}</span></div>
      ${last.h ? `<div class="kv"><span>الطول</span><span>${num(last.h)} سم${zh != null ? ` · النسبة ${num(pct(zh), 0)}` : ''}</span></div>` : ''}
      ${last.w ? `<div class="kv"><span>الوزن</span><span>${num(last.w)} كجم${zw != null ? ` · النسبة ${num(pct(zw), 0)}` : ''}</span></div>` : ''}
      <div class="small muted">القياس القادم ${esc(fmtDate(nextMeasureDue(c)))}</div>` : `<p class="muted">لا توجد قياسات بعد.</p>`}</div>
  <div class="card"><div class="row between"><h3>التطعيمات</h3><button class="btn ghost" data-act="go" data-to="#/child/${c.id}/vax">فتح</button></div>
    ${nv ? `<p>القادم: <b>${esc(nv.v.label)}</b> — ${esc(fmtDate(nv.due))}</p>${nv.st === 'over' ? '<span class="pill alert">متأخر</span>' : nv.st === 'due' ? '<span class="pill warn">قريب</span>' : ''}` : '<p class="muted">اكتملت كل التطعيمات الأساسية.</p>'}</div>`;
}

// ── القرآن
function tabQuran(c) {
  const q = qOf(c.id), dr = dueReviews(c.id), nn = nextNewSurah(c.id), st = quranStats(c.id), young = ageMonthsF(c.birthDate) < 48;
  const learning = Object.entries(q).filter(([, v]) => v.st === 'learning').map(([k]) => +k);
  const cell = n => {
    const v = q[n], due = dr.includes(n);
    const cls = v?.st === 'memorized' ? 'memorized' : v?.st === 'learning' ? 'learning' : '';
    const lbl = v?.st === 'memorized' ? (due ? 'مراجعة اليوم' : 'محفوظة') : v?.st === 'learning' ? (young ? 'يرددها' : 'يحفظها الآن') : `${SURAHS[n - 1][1]} آية`;
    return `<button class="surah ${cls}${due ? ' due' : ''}" data-act="surah" data-id="${c.id}" data-n="${n}"><b>${SURAHS[n - 1][0]}</b><small>${lbl}</small></button>`;
  };
  const rest = Array.from({ length: 77 }, (_, i) => i + 1);
  return `${young ? `<div class="note" style="margin-bottom:12px">في هذا العمر الأنسب الاستماع والترديد بلا ضغط. سجّلي السورة التي ${he(c, 'يرددها', 'ترددها')} ${he(c, 'ويحبها', 'وتحبها')}.</div>` : ''}
  <div class="row" style="gap:8px;margin-bottom:12px"><div class="stat"><b>${st.surahs}</b><span>سورة</span></div><div class="stat"><b>${st.ayahs}</b><span>آية</span></div><div class="stat"><b>${quranStreak(c.id)}</b><span>أيام متتالية للحفظ</span></div></div>
  <div class="card"><h3>جزء عمّ</h3><div class="progress" aria-label="نسبة الإنجاز"><i style="width:${st.juzPct}%"></i></div><div class="small muted" style="margin-top:6px">${st.juzPct}% من آيات جزء عمّ</div></div>
  <div class="card"><h3>اليوم</h3>
    ${dr.length ? `<p class="small muted">مراجعة:</p><div class="stack" style="gap:8px;margin-bottom:10px">${dr.map(n => `<div class="row between"><b>${SURAHS[n - 1][0]}</b><div class="btn-row" style="flex:none"><button class="btn secondary" data-act="review" data-id="${c.id}" data-n="${n}" data-r="good" aria-label="مراجعة ممتازة">ممتاز</button><button class="btn ghost" data-act="review" data-id="${c.id}" data-n="${n}" data-r="weak" aria-label="تحتاج تثبيت">تحتاج تثبيت</button></div></div>`).join('')}</div>` : `<p class="muted small">لا توجد مراجعة مستحقة اليوم.</p>`}
    ${learning.length ? `<p class="small muted">${young ? 'يردد' : 'يحفظ'} الآن: ${learning.map(n => `<b>${SURAHS[n - 1][0]}</b>`).join('، ')}</p>` : ''}
    ${nn ? `<button class="btn block" data-act="surah" data-id="${c.id}" data-n="${learning[0] || nn}">${learning.length ? 'تحديث ' + SURAHS[(learning[0]) - 1][0] : 'البدء بسورة ' + SURAHS[nn - 1][0]}</button>` : ''}</div>
  <h2>سور جزء عمّ</h2><div class="surah-grid">${JUZ_AMMA.map(cell).join('')}</div>
  <details class="card" style="margin-top:14px"><summary>باقي السور</summary><div class="surah-grid" style="margin-top:10px">${rest.map(cell).join('')}</div></details>`;
}
function sheetSurah(id, n) {
  const c = child(id), v = qOf(id)[n], young = ageMonthsF(c.birthDate) < 48;
  const logs = S.quranLog.filter(l => l.childId === id && l.surah === n).slice(-5).reverse();
  openSheet(`<h3 style="font-size:20px">سورة ${SURAHS[n - 1][0]}</h3><p class="muted small">${SURAHS[n - 1][1]} آية${v?.last ? ' · آخر مراجعة ' + esc(fmtShort(v.last)) : ''}${v?.next && v.st === 'memorized' ? ' · المراجعة القادمة ' + esc(fmtShort(v.next)) : ''}</p>
    <div class="stack" style="margin-top:10px">
      <button class="btn${v?.st === 'learning' ? '' : ' secondary'} block" data-act="surah-set" data-id="${id}" data-n="${n}" data-st="learning">${young ? he(c, 'يرددها', 'ترددها') : he(c, 'يحفظها الآن', 'تحفظها الآن')}</button>
      <button class="btn${v?.st === 'memorized' ? '' : ' secondary'} block" data-act="surah-set" data-id="${id}" data-n="${n}" data-st="memorized">${he(c, 'حفظها', 'حفظتها')} ✓</button>
      ${v?.st === 'memorized' ? `<div class="btn-row"><button class="btn ghost" data-act="review" data-id="${id}" data-n="${n}" data-r="good">راجعها اليوم: ممتاز</button><button class="btn ghost" data-act="review" data-id="${id}" data-n="${n}" data-r="weak">تحتاج تثبيت</button></div>` : ''}
      ${v ? `<button class="btn danger block" data-act="surah-set" data-id="${id}" data-n="${n}" data-st="none">إلغاء التسجيل</button>` : ''}
    </div>
    ${logs.length ? `<h3 style="margin-top:16px">السجل</h3><ul class="list small">${logs.map(l => `<li><span class="grow">${l.type === 'new' ? 'حفظ' : l.type === 'start' ? 'بدأ' : l.r === 'weak' ? 'مراجعة — تحتاج تثبيت' : 'مراجعة — ممتاز'}</span><span class="muted">${esc(fmtShort(l.date))}</span></li>`).join('')}</ul>` : ''}`);
}

// ── النمو
let growthInd = 'hfa';
function tabGrowth(c) {
  const ms = measOf(c.id), last = ms[ms.length - 1], prev = ms[ms.length - 2];
  let summary = '<p class="muted">أضيفي أول قياس لترين موقع الطفل على منحنيات منظمة الصحة العالمية.</p>';
  if (last) {
    const mo = ageMonthsF(c.birthDate, last.date);
    const rows = ['hfa', 'wfa', 'bfa'].map(ind => {
      const x = ind === 'hfa' ? last.h : ind === 'wfa' ? last.w : (last.h && last.w ? last.w / Math.pow(last.h / 100, 2) : null);
      if (!x) return '';
      const z = zScore(ind, c.sex, mo, x);
      if (z == null) return `<div class="kv"><span>${IND[ind].label}</span><span>${num(x)} ${IND[ind].unit}</span></div>`;
      const [k, t] = classify(ind, z, mo), p = Math.round(pct(z));
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="kv" style="padding:0"><b>${IND[ind].label}</b><span>${num(x)} ${IND[ind].unit}</span></div>
        <div class="small muted">النسبة المئوية ${p} — ${IND[ind].cmp} ${p} من كل 100 ${he(c, 'طفل', 'طفلة')} بنفس العمر</div><span class="pill ${k}" style="margin-top:4px">${t}</span></div>`;
    }).join('');
    let extra = '';
    if (prev && last.h && prev.h) {
      const gap = daysBetween(prev.date, last.date);
      if (gap >= 120) extra += `<div class="kv"><span>سرعة النمو في الطول</span><span>${num((last.h - prev.h) / gap * 365.25)} سم / سنة</span></div>`;
      const z1 = zScore('hfa', c.sex, ageMonthsF(c.birthDate, prev.date), prev.h), z2 = zScore('hfa', c.sex, mo, last.h);
      if (z1 != null && z2 != null && Math.abs(z2 - z1) >= 1) extra += `<div class="note">تغيّر موقع الطول على المنحنى بشكل ملحوظ منذ القياس السابق. تأكدي من دقة القياس، وإن تكرر فاعرضيه على الطبيب.</div>`;
    }
    if (prev && last.w && prev.w) {
      const z1 = zScore('wfa', c.sex, ageMonthsF(c.birthDate, prev.date), prev.w), z2 = zScore('wfa', c.sex, mo, last.w);
      if (z1 != null && z2 != null && Math.abs(z2 - z1) >= 1) extra += `<div class="note">تغيّر موقع الوزن على المنحنى بشكل ملحوظ منذ القياس السابق — يستحق المتابعة مع الطبيب.</div>`;
    }
    summary = `<div class="small muted" style="margin-bottom:4px">قياس ${esc(fmtDate(last.date))} · عمر ${esc(ageText(c.birthDate, last.date))}</div>${rows}${extra}`;
  }
  const avail = ['hfa', 'wfa', 'bfa'].filter(i => WHO?.[i]?.[c.sex] && ageMonthsF(c.birthDate) <= WHO[i][c.sex].length - 1);
  if (!avail.includes(growthInd)) growthInd = avail[0] || 'hfa';
  return `<button class="btn block" data-act="add-meas" data-id="${c.id}" style="margin-bottom:12px">+ قياس جديد</button>
  <div class="card">${summary}</div>
  <div class="card"><div class="seg" role="group" aria-label="نوع المنحنى">${avail.map(i => `<button aria-pressed="${i === growthInd}" data-act="ind" data-ind="${i}">${IND[i].short || IND[i].label}</button>`).join('')}</div>
    <div style="margin-top:12px">${growthChart(c, growthInd)}</div>
    <div class="legend"><span>المحور الأفقي: العمر بالسنوات</span><span>الخط الأوسط = المتوسط (P50)</span><span>المنطقة المظللة = 15 إلى 85</span><span>الخطوط الخارجية = 3 و97</span></div></div>
  <h2>السجل</h2><div class="card">${ms.length ? `<ul class="list">${ms.slice().reverse().map(m => `<li><div class="grow"><b>${esc(fmtDate(m.date))}</b><div class="small muted">${m.h ? num(m.h) + ' سم' : ''}${m.h && m.w ? ' · ' : ''}${m.w ? num(m.w) + ' كجم' : ''}</div></div><button class="btn ghost" data-act="del-meas" data-mid="${m.id}" aria-label="حذف القياس">حذف</button></li>`).join('')}</ul>` : '<p class="empty">لا يوجد</p>'}</div>
  <p class="small muted">المرجع: معايير نمو الطفل من منظمة الصحة العالمية (حتى 5 سنوات) ومرجع النمو 2007 (5 إلى 19 سنة). ${growthInd === 'wfa' ? 'منحنى الوزن متاح حتى 10 سنوات.' : ''}</p>`;
}
function growthChart(c, ind) {
  const tbl = WHO?.[ind]?.[c.sex]; if (!tbl) return '<p class="muted">المنحنى غير متاح.</p>';
  const ms = measOf(c.id).map(m => ({ mo: ageMonthsF(c.birthDate, m.date), x: ind === 'hfa' ? m.h : ind === 'wfa' ? m.w : (m.h && m.w ? m.w / Math.pow(m.h / 100, 2) : null) })).filter(p => p.x);
  const now = ageMonthsF(c.birthDate), maxT = tbl.length - 1;
  let x0 = Math.max(0, Math.floor(Math.min(now, ...ms.map(p => p.mo)) - 12)), x1 = Math.min(maxT, Math.ceil(now + 12));
  if (x1 - x0 < 24) { x0 = Math.max(0, x1 - 24); }
  const W = 340, H = 230, L = 34, R = 8, T = 10, B = 26;
  const step = (x1 - x0) > 60 ? 3 : 1;
  const xs = []; for (let m = x0; m <= x1; m += step) xs.push(m); if (xs[xs.length - 1] !== x1) xs.push(x1);
  const curves = Z_LINES.map(([z]) => xs.map(m => valAtZ(ind, c.sex, m, z)));
  let y0 = Math.min(...curves[0], ...ms.map(p => p.x)), y1 = Math.max(...curves[4], ...ms.map(p => p.x));
  const padY = (y1 - y0) * 0.06; y0 -= padY; y1 += padY;
  const sx = m => L + (m - x0) / (x1 - x0) * (W - L - R), sy = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ');
  const band = line(curves[1]) + ' ' + curves[3].slice().reverse().map((v, i) => `L${sx(xs[xs.length - 1 - i]).toFixed(1)} ${sy(v).toFixed(1)}`).join(' ') + ' Z';
  const yTicks = 5, yt = Array.from({ length: yTicks }, (_, i) => y0 + (y1 - y0) * i / (yTicks - 1));
  const span = x1 - x0, xstep = span <= 30 ? 6 : span <= 60 ? 12 : 24;
  const xt = []; for (let m = Math.ceil(x0 / xstep) * xstep; m <= x1; m += xstep) xt.push(m);
  const xl = m => num(m / 12, 1);
  const pts = ms.sort((a, b) => a.mo - b.mo);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" direction="ltr" role="img" aria-label="منحنى ${IND[ind].label}">
    ${yt.map(v => `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 4}" y="${sy(v) + 4}" text-anchor="end">${num(v, ind === 'wfa' || ind === 'bfa' ? 1 : 0)}</text>`).join('')}
    ${xt.map(m => `<text x="${sx(m)}" y="${H - 8}" text-anchor="middle">${xl(m)}</text>`).join('')}<text x="${W - R}" y="${T + 10}" text-anchor="end">${IND[ind].unit || 'BMI'}</text>
    <path d="${band}" fill="var(--green)" opacity=".12"/>
    ${curves.map((cv, i) => `<path d="${line(cv)}" fill="none" stroke="var(--green)" stroke-width="${i === 2 ? 2 : 1}" opacity="${i === 2 ? .9 : .45}" ${i === 0 || i === 4 ? 'stroke-dasharray="4 3"' : ''}/>`).join('')}
    <line x1="${sx(now)}" x2="${sx(now)}" y1="${T}" y2="${H - B}" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="3 3"/>
    ${pts.length > 1 ? `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.mo).toFixed(1)} ${sy(p.x).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--gold)" stroke-width="2.5"/>` : ''}
    ${pts.map(p => `<circle cx="${sx(p.mo)}" cy="${sy(p.x)}" r="5" fill="var(--gold)" stroke="var(--card)" stroke-width="2"/>`).join('')}
  </svg>`;
}
function sheetMeas(id) {
  const c = child(id), last = measOf(id).slice(-1)[0];
  openSheet(`<h3 style="font-size:20px">قياس جديد — ${esc(c.name)}</h3>
    <div class="field"><label for="m-date">التاريخ</label><input id="m-date" type="date" value="${todayISO()}" max="${todayISO()}"></div>
    <div class="row" style="gap:10px"><div class="field grow"><label for="m-h">الطول (سم)</label><input id="m-h" type="number" inputmode="decimal" step="0.1" min="30" max="220" placeholder="${last?.h ?? ''}"></div>
    <div class="field grow"><label for="m-w">الوزن (كجم)</label><input id="m-w" type="number" inputmode="decimal" step="0.1" min="1" max="150" placeholder="${last?.w ?? ''}"></div></div>
    <p class="small muted">للدقة: الطول بدون حذاء وظهره على الجدار، والوزن صباحاً بملابس خفيفة.</p>
    <button class="btn block" data-act="save-meas" data-id="${id}">حفظ</button>`);
}

// ── التطعيمات
function tabVax(c) {
  const all = visitsFor(c).map(v => ({ v, s: vaxStatus(c, v) }));
  const row = ({ v, s }) => {
    const badge = s.st === 'done' ? `<span class="pill ok">تم${s.rec.date ? ' ' + esc(fmtShort(s.rec.date)) : ''}</span>` : s.st === 'over' ? '<span class="pill alert">متأخر</span>' : s.st === 'due' ? '<span class="pill warn">مستحق</span>' : '';
    const icon = s.st === 'done' ? '✓' : s.st === 'over' ? '!' : '•';
    return `<div class="vax ${s.st}"><div class="dot" aria-hidden="true">${icon}</div><div class="grow"><div class="row between wrap" style="gap:6px"><b>${esc(v.label)}</b>${badge}</div>
      <div class="small muted">${esc(fmtDate(s.due))}</div><div class="small">${v.items.map(esc).join('، ')}</div>
      ${s.st === 'done' ? `<button class="pill plain" style="border:0;margin-top:6px;cursor:pointer" data-act="vax-undo" data-id="${c.id}" data-k="${v.key}">تراجع</button>` : `<div class="btn-row" style="margin-top:8px"><button class="btn secondary" data-act="vax-done" data-id="${c.id}" data-k="${v.key}">تم التطعيم</button><button class="btn ghost" data-act="vax-ics" data-id="${c.id}" data-k="${v.key}">تذكير في التقويم</button></div>`}</div></div>`;
  };
  const doneL = all.filter(x => x.s.st === 'done'), todo = all.filter(x => x.s.st !== 'done');
  const list = (todo.length ? todo.map(row).join('') : '<p class="muted">اكتملت كل التطعيمات الأساسية.</p>')
    + (doneL.length ? `<details style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px"><summary>التطعيمات المكتملة (${doneL.length})</summary>${doneL.map(row).join('')}</details>` : '');
  const flu = (S.flu[c.id] ||= []).slice().sort().reverse();
  const season = (() => { const d = new Date(); const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-09-01`; })();
  const fluDone = flu.some(d => d >= season);
  return `<div class="card">${list}</div>
  <div class="card"><div class="row between"><h3>الإنفلونزا الموسمية</h3>${fluDone ? '<span class="pill ok">تم هذا الموسم</span>' : '<span class="pill plain">اختياري</span>'}</div>
    <p class="small muted">لقاح سنوي يوصى به للأطفال من عمر 6 أشهر، والقرار مع الطبيب.</p>
    ${flu.length ? `<p class="small">الجرعات: ${flu.map(d => esc(fmtShort(d)) + ' ' + parseISO(d).getFullYear()).join('، ')}</p>` : ''}
    <button class="btn secondary block" data-act="flu" data-id="${c.id}">تسجيل جرعة اليوم</button></div>
  <p class="small muted">${esc(VACCINE_SOURCE)}</p>`;
}
function sheetVaxDone(id, k) {
  const v = VACCINE_VISITS.find(x => x.key === k);
  openSheet(`<h3 style="font-size:20px">${esc(v.label)}</h3><div class="field"><label for="v-date">تاريخ التطعيم (اختياري)</label><input id="v-date" type="date" value="${todayISO()}" max="${todayISO()}"></div>
    <div class="field"><label for="v-place">المكان (اختياري)</label><input id="v-place" type="text" placeholder="المركز الصحي"></div>
    <button class="btn block" data-act="vax-save" data-id="${id}" data-k="${k}">حفظ</button>`);
}

// ── التطور
function tabDev(c) {
  const { cur, age } = msGroups(c), done = (S.milestones[c.id] ||= {});
  const group = (g, gi, title) => {
    const missing = g.items.filter((_, i) => !done[`${g.m}-${i}`]).length;
    const late = gi < cur && missing && age - (MILESTONES[gi + 1]?.m ?? g.m) >= 3;
    return `<div class="card"><div class="row between"><h3>${title}${esc(g.label)}</h3><span class="pill ${missing ? 'plain' : 'ok'}">${g.items.length - missing}/${g.items.length}</span></div>
      ${g.items.map(([a, t], i) => { const k = `${g.m}-${i}`; return `<label class="check"><input type="checkbox" data-change="ms" data-id="${c.id}" data-k="${k}" ${done[k] ? 'checked' : ''}><span class="grow">${esc(t)}<div class="area">${AREA_LABEL[a]}${done[k] ? ' · ' + esc(fmtShort(done[k])) : ''}</div></span></label>`; }).join('')}
      ${late ? `<div class="note" style="margin-top:8px">بعض مهارات هذه المرحلة لم تُسجَّل بعد. إن لم ${he(c, 'يكتسبها', 'تكتسبها')} فالأفضل مناقشتها مع طبيب الأطفال.</div>` : ''}</div>`;
  };
  const prevGroups = MILESTONES.slice(0, cur);
  const acts = S.activities.filter(a => a.childId === c.id), notes = S.notes.filter(n => n.childId === c.id).sort((a, b) => a.date < b.date ? 1 : -1);
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return `${group(MILESTONES[cur], cur, 'المرحلة الحالية: ')}
  ${MILESTONES[cur + 1] ? `<details class="card"><summary>المرحلة القادمة: ${esc(MILESTONES[cur + 1].label)}</summary><ul class="list small" style="margin-top:8px">${MILESTONES[cur + 1].items.map(([a, t]) => `<li><span class="grow">${esc(t)}</span><span class="muted">${AREA_LABEL[a]}</span></li>`).join('')}</ul></details>` : ''}
  ${prevGroups.length ? `<details class="card"><summary>المراحل السابقة</summary><div style="margin-top:8px">${prevGroups.map((g, i) => group(g, i, '')).join('')}</div></details>` : ''}
  <h2>الأنشطة والأندية</h2>
  <div class="card">${acts.length ? `<ul class="list">${acts.map(a => `<li><div class="grow"><b>${esc(a.title)}</b><div class="small muted">${a.days?.length ? a.days.map(d => DAYS[d]).join('، ') : ''}${a.time ? ' · ' + esc(a.time) : ''}</div>${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}</div>
    ${a.days?.length && a.time ? `<button class="btn ghost" data-act="act-ics" data-aid="${a.id}">تقويم</button>` : ''}<button class="btn ghost" data-act="del-act" data-aid="${a.id}" aria-label="حذف">حذف</button></li>`).join('')}</ul>` : '<p class="muted">لا توجد أنشطة.</p>'}
    <button class="btn secondary block" data-act="add-act" data-id="${c.id}" style="margin-top:8px">+ نشاط أو نادي</button></div>
  <h2>ملاحظات التطور</h2>
  <div class="card">${notes.length ? `<ul class="list">${notes.map(n => `<li><div class="grow"><div class="small muted">${esc(fmtDate(n.date))} · ${AREA_LABEL[n.area] || 'عام'}</div><div>${esc(n.text)}</div></div><button class="btn ghost" data-act="del-note" data-nid="${n.id}" aria-label="حذف">حذف</button></li>`).join('')}</ul>` : '<p class="muted">سجّلي أي ملاحظة: كلمة جديدة، مهارة، أو شيء تودين سؤال الطبيب عنه.</p>'}
    <button class="btn secondary block" data-act="add-note" data-id="${c.id}" style="margin-top:8px">+ ملاحظة</button></div>
  <p class="small muted">قائمة المهارات مبنية على قوائم CDC للمعالم التطورية، وكل طفل له إيقاعه الخاص.</p>`;
}
function sheetAct(id) {
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  openSheet(`<h3 style="font-size:20px">نشاط أو نادي</h3>
   <div class="field"><label for="a-title">الاسم</label><input id="a-title" type="text" placeholder="مثل: نادي رياضي، جلسات نطق، سباحة"></div>
   <div class="field"><label>الأيام</label><div class="row wrap" style="gap:6px">${DAYS.map((d, i) => `<label class="pill plain" style="min-height:40px;cursor:pointer"><input type="checkbox" class="a-day" value="${i}" style="accent-color:var(--green)"> ${d}</label>`).join('')}</div></div>
   <div class="field"><label for="a-time">الوقت</label><input id="a-time" type="time"></div>
   <div class="field"><label for="a-note">ملاحظات</label><textarea id="a-note" placeholder="المدرب، المكان، الهدف…"></textarea></div>
   <button class="btn block" data-act="save-act" data-id="${id}">حفظ</button>`);
}
function sheetNote(id) {
  openSheet(`<h3 style="font-size:20px">ملاحظة</h3>
   <div class="field"><label for="n-area">المجال</label><select id="n-area">${Object.entries(AREA_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}<option value="g">عام</option></select></div>
   <div class="field"><label for="n-text">الملاحظة</label><textarea id="n-text"></textarea></div>
   <button class="btn block" data-act="save-note" data-id="${id}">حفظ</button>`);
}

// ── رؤى المرحلة
function tabTips(c) {
  const mo = ageMonthsF(c.birthDate), st = STAGES.find(s => mo >= s.from && mo < s.to) || STAGES[STAGES.length - 1];
  const nx = STAGES[STAGES.indexOf(st) + 1];
  return `<div class="card"><h3>${esc(st.title)}</h3><p class="small muted">${esc(c.name)} الآن ${esc(ageText(c.birthDate))}</p></div>
  ${st.cards.map(([t, x]) => `<div class="card insight"><h3>${esc(t)}</h3><p>${esc(x)}</p></div>`).join('')}
  ${nx ? `<details class="card"><summary>المرحلة القادمة: ${esc(nx.title)}</summary>${nx.cards.map(([t, x]) => `<p style="margin-top:8px"><b>${esc(t)}:</b> ${esc(x)}</p>`).join('')}</details>` : ''}
  <p class="small muted">إرشادات عامة مبنية على توصيات منظمة الصحة العالمية والأكاديمية الأمريكية لطب الأطفال وCDC، وطبيب الأطفال هو المرجع.</p>`;
}

// ── الحمل
function viewPregnancy(c) {
  const p = (S.pregnancy[c.id] ||= { appts: [], notes: [] });
  const left = daysBetween(todayISO(), c.expectedDate), gd = Math.max(0, 280 - left), wk = Math.floor(gd / 7), dy = gd % 7;
  const card = PREG_CARDS.find(x => wk + 1 >= x.from && wk + 1 <= x.to) || PREG_CARDS[2];
  const appts = p.appts.slice().sort((a, b) => a.date < b.date ? -1 : 1), up = appts.filter(a => a.date >= todayISO()), past = appts.filter(a => a.date < todayISO());
  return `<div class="row" style="margin-bottom:12px">${avatar(c, true)}<div class="grow"><div class="child-name" style="font-size:22px">${esc(c.name)}</div><div class="muted small">الموعد المتوقع ${esc(fmtDate(c.expectedDate))}</div><div class="muted small">${esc(fmtHijri(c.expectedDate))}</div></div></div>
  <div class="card"><div class="row" style="gap:8px"><div class="stat"><b>${wk}${dy ? `<small style="font-size:14px"> و${dy} أيام</small>` : ''}</b><span>أسبوع</span></div><div class="stat"><b>${Math.max(0, left)}</b><span>يوم متبقٍ</span></div></div>
    <div class="progress" style="margin-top:12px"><i style="width:${Math.min(100, gd / 280 * 100)}%"></i></div>
    <p class="small muted" style="margin-top:8px">${card.title}: ${esc(card.text)}</p></div>
  <h2>المواعيد</h2><div class="card">${up.length ? `<ul class="list">${up.map(a => `<li><div class="grow"><b>${esc(a.title)}</b><div class="small muted">${esc(fmtDate(a.date))}${a.time ? ' · ' + esc(a.time) : ''}</div></div><button class="btn ghost" data-act="appt-ics" data-id="${c.id}" data-aid="${a.id}">تقويم</button><button class="btn ghost" data-act="del-appt" data-id="${c.id}" data-aid="${a.id}" aria-label="حذف">حذف</button></li>`).join('')}</ul>` : '<p class="muted">لا توجد مواعيد قادمة.</p>'}
    <button class="btn secondary block" data-act="add-appt" data-id="${c.id}" style="margin-top:8px">+ موعد</button>
    ${past.length ? `<details style="margin-top:8px"><summary>مواعيد سابقة (${past.length})</summary><ul class="list small">${past.reverse().map(a => `<li><span class="grow">${esc(a.title)}</span><span class="muted">${esc(fmtShort(a.date))}</span></li>`).join('')}</ul></details>` : ''}</div>
  <h2>ملاحظات</h2><div class="card">${p.notes.length ? `<ul class="list">${p.notes.slice().reverse().map(n => `<li><div class="grow"><div class="small muted">${esc(fmtDate(n.date))}</div>${esc(n.text)}</div></li>`).join('')}</ul>` : '<p class="muted">مكان لأي ملاحظة أو سؤال للطبيبة.</p>'}
    <div class="field" style="margin-top:8px"><label for="pn-text" class="small">ملاحظة جديدة</label><textarea id="pn-text"></textarea></div><button class="btn secondary block" data-act="preg-note" data-id="${c.id}">حفظ الملاحظة</button></div>
  <button class="btn block" data-act="born" data-id="${c.id}" style="margin-top:8px">تمت الولادة 🌴</button>`;
}
function sheetAppt(id) {
  openSheet(`<h3 style="font-size:20px">موعد جديد</h3><div class="field"><label for="ap-title">العنوان</label><input id="ap-title" type="text" placeholder="متابعة مع الطبيبة"></div>
   <div class="row" style="gap:10px"><div class="field grow"><label for="ap-date">التاريخ</label><input id="ap-date" type="date" value="${todayISO()}"></div><div class="field grow"><label for="ap-time">الوقت</label><input id="ap-time" type="time"></div></div>
   <button class="btn block" data-act="save-appt" data-id="${id}">حفظ</button>`);
}
function sheetBorn(id) {
  const c = child(id);
  openSheet(`<h3 style="font-size:20px">مبروك! حمداً لله على السلامة</h3><p class="muted small">سجّلي بيانات ${esc(c.name)} ليبدأ ملفها.</p>
   <div class="field"><label for="b-date">تاريخ الولادة</label><input id="b-date" type="date" value="${todayISO()}" max="${todayISO()}"></div>
   <div class="field"><label>الجنس</label><div class="seg" role="group"><button aria-pressed="${c.sex !== 'boy'}" data-act="seg" data-v="girl" data-for="b-sex">بنت</button><button aria-pressed="${c.sex === 'boy'}" data-act="seg" data-v="boy" data-for="b-sex">ولد</button></div><input type="hidden" id="b-sex" value="${c.sex === 'boy' ? 'boy' : 'girl'}"></div>
   <div class="row" style="gap:10px"><div class="field grow"><label for="b-w">الوزن (كجم)</label><input id="b-w" type="number" inputmode="decimal" step="0.01"></div><div class="field grow"><label for="b-h">الطول (سم)</label><input id="b-h" type="number" inputmode="decimal" step="0.1"></div></div>
   <button class="btn block" data-act="save-born" data-id="${id}">بدء ملف ${esc(c.name)}</button>`);
}

// ── الإعدادات
function viewSettings() {
  return `<h2>الأطفال</h2><div class="card"><ul class="list">${S.children.map(c => `<li>${avatar(c)}<div class="grow"><b>${esc(c.name)}</b><div class="small muted">${isBorn(c) ? esc(fmtDate(c.birthDate)) : 'متوقع ' + esc(fmtDate(c.expectedDate))}</div></div><button class="btn ghost" data-act="go" data-to="#/edit/${c.id}">تعديل</button></li>`).join('')}</ul>
    <button class="btn secondary block" data-act="go" data-to="#/edit/new" style="margin-top:8px">+ إضافة طفل</button></div>
  <h2>النسخ الاحتياطي</h2><div class="card stack"><p class="small muted">البيانات محفوظة على هذا الجوال فقط. احفظي نسخة في iCloud Drive أو أرسليها لنفسك حتى لا تضيع إذا تغيّر الجوال.${S.lastBackup ? ' آخر نسخة: ' + esc(fmtDate(S.lastBackup)) : ''}</p>
    <button class="btn block" data-act="export">حفظ نسخة احتياطية</button>
    <label class="btn secondary block" for="import-file">استرجاع من نسخة</label><input type="file" id="import-file" accept="application/json,.json" hidden data-change="import"></div>
  <h2>عن التطبيق</h2><div class="card small"><p><b>نخل</b> — من الحروف الأولى لأسماء نورة وخليفة ولولوة.</p>
    <p class="muted">المراجع: معايير النمو من منظمة الصحة العالمية، جدول التطعيمات الوطني من وزارة الصحة، معالم التطور من CDC. المعلومات إرشادية، وطبيب الأطفال هو المرجع.</p></div>
  <button class="btn danger block" data-act="reset" style="margin-top:8px">مسح كل البيانات من هذا الجوال</button>`;
}
function viewEdit(c) {
  const isNew = !c; c = c || { name: '', sex: 'boy', status: 'born' };
  return `<div class="card">
   <div class="row" style="justify-content:center;margin-bottom:12px"><label for="e-photo" style="cursor:pointer;text-align:center">${avatar({ ...c, name: c.name || '+' }, true)}<div class="small muted">صورة</div></label><input id="e-photo" type="file" accept="image/*" hidden data-change="photo"></div>
   <div class="field"><label for="e-name">الاسم</label><input id="e-name" type="text" value="${esc(c.name)}"></div>
   <div class="field"><label>الجنس</label><div class="seg" role="group"><button aria-pressed="${c.sex === 'boy'}" data-act="seg" data-v="boy" data-for="e-sex">ولد</button><button aria-pressed="${c.sex === 'girl'}" data-act="seg" data-v="girl" data-for="e-sex">بنت</button></div><input type="hidden" id="e-sex" value="${c.sex}"></div>
   <div class="field"><label>الحالة</label><div class="seg" role="group"><button aria-pressed="${c.status !== 'expected'}" data-act="seg" data-v="born" data-for="e-status">مولود</button><button aria-pressed="${c.status === 'expected'}" data-act="seg" data-v="expected" data-for="e-status">حمل</button></div><input type="hidden" id="e-status" value="${c.status === 'expected' ? 'expected' : 'born'}"></div>
   <div class="field"><label for="e-date" id="e-date-l">${c.status === 'expected' ? 'الموعد المتوقع للولادة' : 'تاريخ الميلاد (ميلادي)'}</label><input id="e-date" type="date" value="${esc(c.status === 'expected' ? c.expectedDate || '' : c.birthDate || '')}"></div>
   <input type="hidden" id="e-photo-data" value="">
   <button class="btn block" data-act="save-child" data-id="${isNew ? 'new' : c.id}">حفظ</button>
   ${isNew ? '' : `<button class="btn danger block" data-act="del-child" data-id="${c.id}" style="margin-top:10px">حذف ${esc(c.name)} وكل بياناته</button>`}</div>`;
}

// ───────── النوافذ السفلية ─────────
function openSheet(html) { $('#sheet').innerHTML = `<div class="grab"></div>${html}`; $('#sheet-wrap').hidden = false; }
function closeSheet() { $('#sheet-wrap').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheet-bg').addEventListener('click', closeSheet);

// ───────── التقويم (ics) ─────────
function icsDate(iso, time) { const d = iso.replace(/-/g, ''); return time ? `${d}T${time.replace(':', '')}00` : d; }
function icsEsc(s) { return String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n'); }
function makeICS(events) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nakhl//AR', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${uid()}@nakhl`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`);
    if (e.time) { lines.push(`DTSTART:${icsDate(e.date, e.time)}`, `DURATION:PT${e.mins || 60}M`); }
    else { lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`); }
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push(`SUMMARY:${icsEsc(e.title)}`);
    if (e.desc) lines.push(`DESCRIPTION:${icsEsc(e.desc)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, `TRIGGER:${e.alarm || (e.time ? '-PT2H' : '-P1D')}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
async function openICS(events, name) {
  const text = makeICS(events);
  const file = new File([text], name + '.ics', { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
}

// ───────── النسخ الاحتياطي ─────────
async function exportData() {
  S.lastBackup = todayISO(); save();
  const text = JSON.stringify({ app: 'nakhl', ...S }, null, 1);
  const name = `nakhl-backup-${todayISO()}.json`;
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'نسخة نخل' }); toast('تم حفظ النسخة'); render(); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast('تم حفظ النسخة'); render();
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.app !== 'nakhl' || !Array.isArray(d.children)) throw 0;
      if (S.children.length && !confirm('سيتم استبدال البيانات الحالية بالنسخة المختارة. متابعة؟')) return;
      delete d.app; S = Object.assign(blankState(), d); save(); toast('تم الاسترجاع'); go('#/'); render();
    } catch { alert('الملف غير صالح'); }
  };
  r.readAsText(file);
}
function resizePhoto(file) {
  return new Promise(res => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = 300, cv = document.createElement('canvas'); cv.width = cv.height = s;
      const k = Math.max(s / img.width, s / img.height), w = img.width * k, h = img.height * k;
      cv.getContext('2d').drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => res(null); img.src = url;
  });
}

// ───────── الأحداث ─────────
const val = id => $('#' + id)?.value?.trim();
const ACT = {
  go: d => go(d.to),
  export: () => exportData(),
  ind: d => { growthInd = d.ind; render(); },
  seg: (d, el) => {
    el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === el));
    $('#' + d.for).value = d.v;
    if (d.for === 'e-status') $('#e-date-l').textContent = d.v === 'expected' ? 'الموعد المتوقع للولادة' : 'تاريخ الميلاد (ميلادي)';
  },
  surah: d => sheetSurah(d.id, +d.n),
  'surah-set': d => {
    const q = qOf(d.id), n = +d.n;
    if (d.st === 'none') delete q[n];
    else if (d.st === 'learning') { q[n] = { st: 'learning', since: todayISO() }; S.quranLog.push({ id: uid(), childId: d.id, date: todayISO(), surah: n, type: 'start' }); }
    else { q[n] = { st: 'memorized', box: 0, last: todayISO(), next: addDays(todayISO(), INTERVALS[0]), since: q[n]?.since }; S.quranLog.push({ id: uid(), childId: d.id, date: todayISO(), surah: n, type: 'new' }); toast(`ما شاء الله! حفظ سورة ${SURAHS[n - 1][0]}`); }
    save(); closeSheet(); render();
  },
  review: d => {
    const q = qOf(d.id), n = +d.n, v = q[n]; if (!v) return;
    v.box = d.r === 'good' ? Math.min((v.box || 0) + 1, INTERVALS.length - 1) : 0;
    v.last = todayISO(); v.next = addDays(todayISO(), INTERVALS[v.box]);
    S.quranLog.push({ id: uid(), childId: d.id, date: todayISO(), surah: n, type: 'review', r: d.r });
    save(); closeSheet(); toast(d.r === 'good' ? 'أحسنت!' : 'نعيدها قريباً'); render();
  },
  'add-meas': d => sheetMeas(d.id),
  'save-meas': d => {
    const date = val('m-date') || todayISO(), h = parseFloat(val('m-h')), w = parseFloat(val('m-w'));
    if (!h && !w) { toast('أدخلي الطول أو الوزن'); return; }
    S.measurements.push({ id: uid(), childId: d.id, date, h: h || null, w: w || null });
    save(); closeSheet(); toast('تم الحفظ'); render();
  },
  'del-meas': d => { if (!confirm('حذف هذا القياس؟')) return; S.measurements = S.measurements.filter(m => m.id !== d.mid); save(); render(); },
  'vax-done': d => sheetVaxDone(d.id, d.k),
  'vax-save': d => { (S.vaccines[d.id] ||= {})[d.k] = { done: true, date: val('v-date') || null, place: val('v-place') || '' }; save(); closeSheet(); toast('تم التسجيل'); render(); },
  'vax-undo': d => { delete (S.vaccines[d.id] ||= {})[d.k]; save(); render(); },
  'vax-ics': d => {
    const c = child(d.id), v = visitsFor(c).find(x => x.key === d.k), due = addMonths(c.birthDate, v.m);
    openICS([{ date: due < todayISO() ? todayISO() : due, title: `تطعيم ${c.name} — ${v.label}`, desc: v.items.join('، '), alarm: '-P3D' }], `تطعيم-${c.name}`);
  },
  flu: d => { (S.flu[d.id] ||= []).push(todayISO()); save(); toast('تم التسجيل'); render(); },
  'add-act': d => sheetAct(d.id),
  'save-act': d => {
    const title = val('a-title'); if (!title) { toast('اكتبي اسم النشاط'); return; }
    const days = [...document.querySelectorAll('.a-day:checked')].map(x => +x.value);
    S.activities.push({ id: uid(), childId: d.id, title, days, time: val('a-time') || '', note: val('a-note') || '', start: todayISO() });
    save(); closeSheet(); render();
  },
  'del-act': d => { if (!confirm('حذف النشاط؟')) return; S.activities = S.activities.filter(a => a.id !== d.aid); save(); render(); },
  'act-ics': d => {
    const a = S.activities.find(x => x.id === d.aid), c = child(a.childId), BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    let first = todayISO(); while (!a.days.includes(parseISO(first).getDay())) first = addDays(first, 1);
    openICS([{ date: first, time: a.time, title: `${a.title} — ${c.name}`, rrule: `FREQ=WEEKLY;BYDAY=${a.days.map(x => BY[x]).join(',')}`, alarm: '-PT1H' }], a.title);
  },
  'add-note': d => sheetNote(d.id),
  'save-note': d => { const t = val('n-text'); if (!t) return; S.notes.push({ id: uid(), childId: d.id, date: todayISO(), area: val('n-area'), text: t }); save(); closeSheet(); render(); },
  'del-note': d => { if (!confirm('حذف الملاحظة؟')) return; S.notes = S.notes.filter(n => n.id !== d.nid); save(); render(); },
  'add-appt': d => sheetAppt(d.id),
  'save-appt': d => { const t = val('ap-title') || 'موعد متابعة', date = val('ap-date'); if (!date) return; S.pregnancy[d.id].appts.push({ id: uid(), title: t, date, time: val('ap-time') || '' }); save(); closeSheet(); render(); },
  'del-appt': d => { if (!confirm('حذف الموعد؟')) return; const p = S.pregnancy[d.id]; p.appts = p.appts.filter(a => a.id !== d.aid); save(); render(); },
  'appt-ics': d => { const a = S.pregnancy[d.id].appts.find(x => x.id === d.aid); openICS([{ date: a.date, time: a.time, title: a.title }], a.title); },
  'preg-note': d => { const t = val('pn-text'); if (!t) return; S.pregnancy[d.id].notes.push({ date: todayISO(), text: t }); save(); render(); },
  born: d => sheetBorn(d.id),
  'save-born': d => {
    const c = child(d.id), date = val('b-date'); if (!date) return;
    c.status = 'born'; c.birthDate = date; c.sex = val('b-sex') || 'girl';
    const w = parseFloat(val('b-w')), h = parseFloat(val('b-h'));
    if (w || h) S.measurements.push({ id: uid(), childId: c.id, date, w: w || null, h: h || null });
    save(); closeSheet(); toast(`أهلاً ${c.name} 🌴`); render();
  },
  'save-child': d => {
    const name = val('e-name'), date = val('e-date'), status = val('e-status'), sex = val('e-sex'), photo = val('e-photo-data');
    if (!name || !date) { toast('أدخلي الاسم والتاريخ'); return; }
    let c = d.id === 'new' ? null : child(d.id);
    if (!c) { c = { id: uid(), color: COLORS[S.children.length % COLORS.length] }; S.children.push(c); }
    Object.assign(c, { name, sex, status }, status === 'expected' ? { expectedDate: date, birthDate: null } : { birthDate: date });
    if (photo) c.photo = photo;
    save(); toast('تم الحفظ'); go(S.children.length === 1 ? '#/' : '#/settings');
  },
  'del-child': d => {
    const c = child(d.id); if (!confirm(`حذف ${c.name} وكل بياناته نهائياً؟`)) return;
    S.children = S.children.filter(x => x.id !== d.id);
    ['measurements', 'quranLog', 'activities', 'notes'].forEach(k => S[k] = S[k].filter(x => x.childId !== d.id));
    ['quran', 'vaccines', 'flu', 'milestones', 'pregnancy'].forEach(k => delete S[k][d.id]);
    save(); go('#/settings');
  },
  reset: () => { if (!confirm('سيتم مسح كل البيانات من هذا الجوال. هل حفظتِ نسخة احتياطية؟')) return; if (!confirm('تأكيد نهائي: مسح كل شيء؟')) return; S = blankState(); save(); go('#/'); render(); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  e.preventDefault(); ACT[el.dataset.act]?.(el.dataset, el);
});
document.addEventListener('change', async e => {
  const el = e.target.closest('[data-change]'); if (!el) return;
  const k = el.dataset.change;
  if (k === 'import' && el.files[0]) importData(el.files[0]);
  if (k === 'ms') { const m = (S.milestones[el.dataset.id] ||= {}); if (el.checked) m[el.dataset.k] = todayISO(); else delete m[el.dataset.k]; save(); render(); }
  if (k === 'photo' && el.files[0]) { const data = await resizePhoto(el.files[0]); if (data) { $('#e-photo-data').value = data; const av = el.parentElement.querySelector('.avatar'); av.innerHTML = `<img src="${data}" alt="">`; } }
});
$('#settings').addEventListener('click', () => go('#/settings'));

// ───────── التشغيل ─────────
(async function start() {
  await DB.open();
  const saved = await DB.get('state');
  if (saved) S = Object.assign(blankState(), saved);
  try { navigator.storage?.persist?.(); } catch {}
  try { WHO = await (await fetch('who.json')).json(); } catch { WHO = null; }
  route = parseRoute(); render();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
