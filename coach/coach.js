'use strict';

// App de coach: arma la progresión semanal (carga y RIR por ejercicio), la envía a la app de Paola
// y muestra la planilla de progreso con lo que ella registra.
(function () {
  const { ROUTINES, ROUTINE_ORDER } = window.DATA;
  const C = window.CORE;
  const { esc, nf, num, today, addDays, fmtDay, fmtShort, mondayOf, DOW } = C;

  const CFG = window.PLAN_CONFIG || {};
  const sb = CFG.url && CFG.anonKey && window.supabase
    ? window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'plan-coach-auth' } })
    : null;

  let user = null;
  let authReady = false;
  let athletes = [];
  let A = null;
  let weeks = {};
  let recs = { session: [], checkin: {}, food: {}, measure: [] };
  let loading = false;
  let loadError = '';
  let loadedAt = null;
  let planillaTab = 'LA';

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* opcional */ } };

  // ---------- Datos ----------
  function settings() {
    const s = (A && A.settings) || {};
    return {
      startDate: s.startDate || null,
      upperDay: s.upperDay || 'mar',
      coachName: s.coachName || 'Franco',
      kcal: Object.assign({ recomp: 1800, cut: 1500 }, s.kcal || {}),
      swaps: Object.assign({}, s.swaps || {})
    };
  }
  const currentWeek = () => { const st = settings(); return st.startDate ? C.blockFor(st.startDate, today()).week : null; };
  const weekMonday = w => C.weekStart(settings().startDate, w);
  const sessionsSorted = () => recs.session.slice().sort((a, b) => a.finishedAt - b.finishedAt);

  async function loadAll() {
    if (!sb || !user) return;
    loading = true; render();
    try {
      const { data: aths, error } = await sb.from('athletes').select('id, name, settings').eq('coach_id', user.id).order('name');
      if (error) throw error;
      athletes = aths || [];
      const saved = lsGet('plan-coach-athlete');
      A = athletes.find(a => a.id === saved) || athletes[0] || null;
      if (A) await loadAthlete();
      loadError = '';
      loadedAt = Date.now();
    } catch (e) {
      loadError = e.message || String(e);
    }
    loading = false;
    render();
  }

  async function loadAthlete() {
    const [w, r] = await Promise.all([
      sb.from('plan_weeks').select('week, draft, published, published_at, updated_at').eq('athlete_id', A.id),
      sb.from('records').select('kind, key, data, updated_at').eq('athlete_id', A.id)
    ]);
    if (w.error) throw w.error;
    if (r.error) throw r.error;
    weeks = {};
    (w.data || []).forEach(x => { weeks[x.week] = x; });
    recs = { session: [], checkin: {}, food: {}, measure: [] };
    (r.data || []).forEach(x => {
      if (x.kind === 'session') recs.session.push(x.data);
      else if (x.kind === 'checkin') recs.checkin[x.key] = x.data;
      else if (x.kind === 'food') recs.food[x.key] = x.data;
      else if (x.kind === 'measure') recs.measure.push(x.data);
    });
  }

  async function saveSettings(patch) {
    const next = Object.assign({}, A.settings || {}, patch);
    const { error } = await sb.from('athletes').update({ settings: next, updated_at: new Date().toISOString() }).eq('id', A.id);
    if (error) { toast('No se pudo guardar: ' + error.message); return false; }
    A.settings = next;
    toast('Guardado. Paola lo ve al abrir su app.');
    return true;
  }

  // ---------- Progresión semanal ----------
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  function draftOf(w) {
    const row = weeks[w];
    const d = clone(row && row.draft);
    d.exercises = d.exercises || {};
    d.note = d.note || '';
    return d;
  }
  function weekStatus(w) {
    const row = weeks[w];
    if (!row || (!row.published_at && !Object.keys((row.draft && row.draft.exercises) || {}).length && !(row.draft && row.draft.note))) return { key: 'empty', label: 'Sin armar' };
    if (!row.published_at) return { key: 'draft', label: 'Borrador sin enviar' };
    if (JSON.stringify(row.draft || {}) !== JSON.stringify(row.published || {})) return { key: 'changed', label: 'Cambios sin enviar' };
    return { key: 'sent', label: 'Enviada el ' + fmtShort(C.ymd(new Date(row.published_at))) };
  }
  const editing = {};
  let draftTimer = null;
  function editDraft(w, fn) {
    if (!editing[w]) editing[w] = draftOf(w);
    fn(editing[w]);
    weeks[w] = Object.assign({ week: w, published: null, published_at: null }, weeks[w], { draft: clone(editing[w]) });
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(w), 700);
  }
  async function saveDraft(w) {
    const { error } = await sb.from('plan_weeks').upsert({ athlete_id: A.id, week: w, draft: weeks[w].draft, updated_at: new Date().toISOString() });
    const el = document.getElementById('draft-state');
    if (error) { toast('No se pudo guardar el borrador: ' + error.message); return; }
    if (el) { el.textContent = 'Borrador guardado'; }
    const st = document.getElementById('week-status');
    if (st) { const s = weekStatus(w); st.textContent = s.label; st.className = 'tag ' + statusClass(s.key); }
  }
  async function publishWeek(w) {
    clearTimeout(draftTimer);
    const draft = (weeks[w] && weeks[w].draft) || draftOf(w);
    const now = new Date().toISOString();
    const { error } = await sb.from('plan_weeks').upsert({ athlete_id: A.id, week: w, draft, published: draft, published_at: now, updated_at: now });
    if (error) { toast('No se pudo enviar: ' + error.message); return; }
    weeks[w] = Object.assign({}, weeks[w], { week: w, draft, published: clone(draft), published_at: now });
    delete editing[w];
    toast(`Semana ${w} enviada a ${A.name}`);
    render();
  }
  const statusClass = k => ({ sent: 'ok', changed: 'warn', draft: 'warn', empty: 'line' }[k]);

  // Último registro de un ejercicio antes de la semana w, y la sugerencia por doble progresión.
  function lastBefore(rx, w) {
    const list = sessionsSorted().filter(s => (s.week || 0) < w);
    return C.lastPerfIn(list, rx.histKey);
  }

  // ---------- Utilidades de interfaz ----------
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  const ICONS = {
    inicio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/></svg>',
    semana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
    planilla: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15"/></svg>',
    registros: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8.5 13l2.5 2.5 4.5-5"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'
  };
  const phaseLabel = w => {
    const st = settings();
    if (!st.startDate || !w) return '';
    const b = C.blockFor(st.startDate, weekMonday(w));
    return `${b.info.name}${b.weekIn ? ' · sem ' + b.weekIn : ''}`;
  };
  const kindTag = rid => `<span class="tag ${ROUTINES[rid].kind}">${ROUTINES[rid].name}</span>`;

  function checkinStats(monday) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const cs = days.map(d => recs.checkin[d]).filter(Boolean);
    const vals = f => cs.map(f).filter(v => v !== null && v !== undefined && Number.isFinite(v));
    const pesoOf = c => (c.noPeso ? null : num(c.peso));
    const prev = Array.from({ length: 7 }, (_, i) => recs.checkin[addDays(monday, i - 7)]).filter(Boolean);
    const peso = C.avg(vals(pesoOf));
    const prevPeso = C.avg(prev.map(pesoOf).filter(v => v !== null));
    return {
      peso, delta: peso !== null && prevPeso !== null ? peso - prevPeso : null,
      pasos: C.avg(vals(c => num(c.pasos))),
      sleep: C.avg(vals(c => (c.sleepH === '' || c.sleepH === undefined ? null : (num(c.sleepH) || 0) * 60 + (num(c.sleepM) || 0)))),
      sleepQ: C.avg(vals(c => num(c.sleepQ))),
      adh: C.avg(vals(c => num(c.adh))),
      hombro: C.avg(vals(c => num(c.hombro))),
      registered: cs.filter(c => c.pasos && c.adh).length
    };
  }
  const fmtSleep = m => (m == null ? '—' : `${Math.floor(m / 60)} h ${C.pad(Math.round(m % 60))}`);
  const fmtN = (v, d = 1) => (v === null || v === undefined ? '—' : nf(v, d));

  // ---------- Vistas ----------
  function viewLogin() {
    if (!sb) {
      return { title: 'Coach', bare: true, html: `<section class="card"><h3>Falta conectar Supabase</h3><p class="muted">Completa la URL y la anon key en config.js y vuelve a publicar.</p></section>` };
    }
    return {
      title: 'Coach', bare: true, html: `<form class="card form" id="login-form" novalidate><h2>Entrar como coach</h2>
        <p class="muted small">Con tu correo y contraseña de Supabase.</p>
        <div class="q"><label for="lg-email">Correo</label><input class="inp" id="lg-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off"></div>
        <div class="q"><label for="lg-pass">Contraseña</label><input class="inp" id="lg-pass" type="password" autocomplete="current-password"></div>
        <button class="btn block upper" type="submit" id="lg-btn">Entrar</button></form>`
    };
  }

  function viewNoAthlete() {
    return {
      title: 'Coach', html: `<section class="card"><h3>No tienes atletas conectadas</h3>
        <p class="muted">Entraste como ${esc(user.email)}. Corre el archivo supabase/link-athlete.sql en el SQL Editor de Supabase con tu correo y el de Paola, y vuelve a cargar.</p>
        <button class="btn block" data-a="reload">Volver a cargar</button>
        <button class="btn block danger" data-a="logout">Cerrar sesión</button></section>`
    };
  }

  function viewInicio() {
    const st = settings();
    const w = currentWeek();
    const parts = [];
    if (!st.startDate) {
      parts.push(`<a class="notice" href="#/ajustes" style="text-decoration:none"><div><b>Falta la fecha de inicio.</b> Defínela en Ajustes para numerar las semanas.</div></a>`);
      return { title: A.name, html: parts.join('') };
    }
    const b = C.blockFor(st.startDate, today());
    const pre = b.phase === 'pre';
    const monday = pre ? st.startDate : mondayOf(today());
    const map = C.scheduleFor(st.upperDay);
    const wkSessions = sessionsSorted().filter(s => s.week === w);
    const done = new Set(wkSessions.map(s => s.routine));
    const strip = DOW.map((d, i) => {
      const r = map[i];
      const rr = r && ROUTINES[r];
      return `<div class="wd ${rr ? rr.kind : ''} ${rr && rr.optional ? 'opt' : ''} ${r && done.has(r) ? 'done' : ''} ${addDays(monday, i) === today() ? 'today' : ''}"><span class="d">${d}</span><span class="s">${rr ? rr.name.replace(' ', '<br>') : '·'}</span><span class="m">${r && done.has(r) ? '✓' : ''}</span></div>`;
    }).join('');
    parts.push(`<section class="card"><div class="card-head"><span class="eyebrow">${esc(A.name)} · ${pre ? 'todavía no empieza' : `semana ${w} del plan`}</span><span class="small muted">${pre ? 'parte el' : 'desde'} ${esc(fmtShort(st.startDate))}</span></div>
      <h2>${pre ? `Parte el ${esc(fmtDay(st.startDate))}` : `${esc(b.info.name)}${b.weekIn ? ` · semana ${b.weekIn}${b.weeksTotal ? ' de ' + b.weeksTotal : ''}` : ''}`}</h2>
      <div class="progress"><span style="width:${Math.min(100, Math.max(0, w) / 10 * 100)}%"></span></div>
      <div class="weekstrip">${strip}</div></section>`);

    const cs = checkinStats(monday);
    parts.push(`<section class="card"><div class="card-head"><h3>Esta semana</h3><a class="linkbtn" href="#/registros">Ver registros</a></div><div class="stats">
      <div class="stat"><span class="k">Peso prom.</span><span class="v">${cs.peso !== null ? nf(cs.peso, 1) + ' kg' : '—'}</span><span class="s">${cs.delta !== null ? (cs.delta >= 0 ? '+' : '') + nf(cs.delta, 2) + ' kg vs anterior' : 'sin comparación'}</span></div>
      <div class="stat"><span class="k">Pasos</span><span class="v">${fmtN(cs.pasos, 0)}</span><span class="s">promedio diario</span></div>
      <div class="stat"><span class="k">Sueño</span><span class="v">${fmtSleep(cs.sleep)}</span><span class="s">${cs.sleepQ !== null ? 'calidad ' + nf(cs.sleepQ, 1) + '/5' : 'promedio'}</span></div>
      <div class="stat"><span class="k">Dieta</span><span class="v">${fmtN(cs.adh)}</span><span class="s">cumplimiento /10</span></div>
      <div class="stat"><span class="k">Hombro</span><span class="v">${fmtN(cs.hombro)}</span><span class="s">dolor promedio /10</span></div>
      <div class="stat"><span class="k">Entrenos</span><span class="v">${wkSessions.length}</span><span class="s">${cs.registered}/7 días con check-in</span></div>
    </div></section>`);

    const alerts = [];
    const since = addDays(today(), -14);
    sessionsSorted().filter(s => s.date >= since).reverse().forEach(s => {
      Object.values(s.ex).forEach(e => { if (e.note) alerts.push({ date: s.date, html: `${kindTag(s.routine)} <b>${esc(e.name)}:</b> ${esc(e.note)}` }); });
      if (s.shoulder >= 4) alerts.push({ date: s.date, html: `${kindTag(s.routine)} Molestia de hombro ${s.shoulder}/10 al terminar.` });
    });
    Object.entries(recs.checkin).filter(([d]) => d >= addDays(today(), -7)).sort().reverse().forEach(([d, c]) => {
      if (c.nota) alerts.push({ date: d, html: `<b>Nota del día:</b> ${esc(c.nota)}` });
      if (num(c.hombro) >= 4) alerts.push({ date: d, html: `Dolor de hombro ${c.hombro}/10 en el check-in.` });
    });
    parts.push(`<section class="card flush"><div style="padding:14px 16px 4px"><h3>Mensajes y alertas</h3></div><div class="list">${alerts.length
      ? alerts.sort((a, b2) => (a.date < b2.date ? 1 : -1)).slice(0, 12).map(a => `<div class="li" style="align-items:flex-start"><span class="small muted num" style="min-width:3.6em">${esc(fmtShort(a.date))}</span><span class="grow"><span class="s" style="color:var(--ink)">${a.html}</span></span></div>`).join('')
      : '<div class="li"><span class="muted small">Sin mensajes en las últimas dos semanas.</span></div>'}</div></section>`);

    const rows = (pre ? [1, 2] : [w, w + 1]).map(x => {
      const s = weekStatus(x);
      const tag = pre ? (x === 1 ? ' (primera)' : '') : (x === w ? ' (actual)' : ' (próxima)');
      return `<a class="li" href="#/semana/${x}"><span class="grow"><span class="t">Semana ${x}${tag}</span><span class="s">${esc(phaseLabel(x))} · ${esc(fmtShort(weekMonday(x)))}</span></span><span class="tag ${statusClass(s.key)}">${esc(s.label)}</span><span class="chev">›</span></a>`;
    }).join('');
    parts.push(`<section class="card flush"><div style="padding:14px 16px 4px"><h3>Progresión</h3></div><div class="list">${rows}</div></section>`);
    return { title: A.name, html: parts.join('') };
  }

  function rirChips(exId, value) {
    const custom = value && !C.RIR_SCHEMES.includes(value);
    return `<div class="rirs" role="group" aria-label="RIR">${C.RIR_SCHEMES.map(sc => `<button type="button" class="${value === sc ? 'on' : ''}" data-a="p-rir" data-ex="${exId}" data-v="${sc}">${sc}</button>`).join('')}
      <input class="rir-in ${custom && !C.parseRir(value) ? 'bad' : ''}" data-prir="${exId}" id="rir-${exId}" maxlength="5" placeholder="otro" value="${custom ? esc(value) : ''}" aria-label="RIR personalizado"></div>`;
  }

  function viewSemana(arg) {
    const st = settings();
    if (!st.startDate) return { title: 'Semana', html: `<a class="notice" href="#/ajustes" style="text-decoration:none"><div><b>Falta la fecha de inicio.</b> Defínela en Ajustes.</div></a>` };
    const cw = currentWeek();
    const w = Math.max(1, parseInt(arg, 10) || Math.max(1, cw));
    const d = editing[w] || draftOf(w);
    editing[w] = d;
    const status = weekStatus(w);
    const parts = [];
    parts.push(`<div class="daynav"><a class="navbtn" href="#/semana/${Math.max(1, w - 1)}" aria-label="Semana anterior">‹</a>
      <span class="dl">Semana ${w}<br><span class="small muted">${esc(phaseLabel(w))} · ${esc(fmtShort(weekMonday(w)))}–${esc(fmtShort(addDays(weekMonday(w), 6)))}</span></span>
      <a class="navbtn" href="#/semana/${w + 1}" aria-label="Semana siguiente">›</a></div>`);
    parts.push(`<section class="card"><div class="card-head"><span id="week-status" class="tag ${statusClass(status.key)}">${esc(status.label)}</span><span class="small muted" id="draft-state">${w === cw ? 'Semana actual' : (w > cw ? 'Próxima' : 'Pasada')}</span></div>
      <div class="q"><label for="w-note">Nota de la semana para ${esc(A.name)}</label><textarea id="w-note" data-wnote="1" placeholder="Ej.: esta semana subimos cargas en pierna. Si el hombro molesta, avísame.">${esc(d.note)}</textarea></div>
      <div class="row">${w > 1 ? `<button class="btn small ghost" data-a="copy-prev">Copiar semana ${w - 1}</button>` : ''}<button class="btn small ghost" data-a="fill-sug">Rellenar con sugerencias</button></div>
      <p class="small muted">RIR: «2-1» = primera serie RIR 2 y las demás RIR 1. Sin RIR, la app usa ${esc(C.defaultScheme(w))}. Sin carga, le sugiere la doble progresión.</p></section>`);
    ROUTINE_ORDER.forEach(rid => {
      const r = ROUTINES[rid];
      const rows = r.exercises.map(ex => {
        const rx = C.resolveEx(ex, !!st.swaps[ex.id]);
        const p = d.exercises[ex.id] || {};
        const last = lastBefore(rx, w);
        const sug = C.autoSuggest(rx, last, C.rirForSet(p.rir, w, 0));
        const showKg = rx.type !== 'time' && !C.isBodyweight(rx);
        const repsTxt = rx.type === 'time' ? 'máx. s' : `${rx.reps[0]}–${rx.reps[1]}`;
        return `<div class="pr-row">
          <div class="pr-name"><b>${esc(rx.name)}</b>${rx.alt ? ' <span class="tag warn">hombro</span>' : ''}<span class="small muted">${rx.sets} × ${repsTxt}${rx.perSide ? ' · cada lado' : ''}</span></div>
          <div class="pr-last small">${last ? `<span class="muted">Sem ${last.week || '?'}:</span> ${esc(C.setsText(rx, last.sets))}` : '<span class="muted">Sin registros</span>'}${sug.kg ? ` · <span class="${sug.up ? 'up' : ''}">sugerido ${nf(sug.kg, 2)} kg</span>` : ''}</div>
          <div class="pr-inputs">${showKg ? `<label class="field kg"><input inputmode="decimal" autocomplete="off" id="kg-${ex.id}" data-pkg="${ex.id}" value="${p.kg != null ? esc(String(p.kg).replace('.', ',')) : ''}" placeholder="${sug.kg ? nf(sug.kg, 2) : 'kg'}" aria-label="Carga de ${esc(rx.name)}"><span class="u">kg</span></label>` : ''}
            ${rx.type === 'time' ? '' : rirChips(ex.id, p.rir || '')}</div>
          <input class="inp note-in" id="pn-${ex.id}" data-pnote="${ex.id}" value="${esc(p.note || '')}" placeholder="Nota para ${esc(A.name)} (opcional)" aria-label="Nota del ejercicio">
        </div>`;
      }).join('');
      parts.push(`<section class="card flush pr-card ${r.kind}"><div class="pr-head">${kindTag(rid)}<span class="small muted">${esc(r.day)}</span></div>${rows}</section>`);
    });
    parts.push(`<div class="sendbar"><button class="btn block upper" data-a="publish" data-w="${w}">Enviar semana ${w} a ${esc(A.name)}</button></div>`);
    return { title: 'Progresión', html: parts.join(''), wide: true };
  }

  function planillaWeeks() {
    const cw = currentWeek() || 1;
    const maxSession = Math.max(0, ...recs.session.map(s => s.week || 0));
    const maxPlan = Math.max(0, ...Object.keys(weeks).map(Number));
    const last = Math.max(4, cw + 1, maxSession, maxPlan);
    return Array.from({ length: last }, (_, i) => i + 1);
  }

  function viewPlanilla(arg) {
    if (arg) planillaTab = arg;
    const st = settings();
    const ws = planillaWeeks();
    const cw = currentWeek();
    const tabs = ROUTINE_ORDER.concat(['CI']).map(t => `<a href="#/planilla/${t}" class="${planillaTab === t ? 'on' : ''}">${t === 'CI' ? 'Check-in' : ROUTINES[t].name}</a>`).join('');
    const parts = [`<div class="seg-links">${tabs}</div>`];
    if (planillaTab === 'CI') {
      const rowsDef = [
        ['Peso prom.', s => (s.peso !== null ? nf(s.peso, 1) : '—')],
        ['Δ peso', s => (s.delta !== null ? (s.delta >= 0 ? '+' : '') + nf(s.delta, 2) : '—')],
        ['Pasos', s => fmtN(s.pasos, 0)],
        ['Sueño', s => fmtSleep(s.sleep)],
        ['Calidad sueño', s => fmtN(s.sleepQ)],
        ['Dieta /10', s => fmtN(s.adh)],
        ['Hombro /10', s => fmtN(s.hombro)],
        ['Días registrados', s => `${s.registered}/7`]
      ];
      const stats = ws.map(w => (st.startDate ? checkinStats(weekMonday(w)) : null));
      const head = `<tr><th class="stick">Semana</th>${ws.map(w => `<th class="${w === cw ? 'cur' : ''}">${w}<br><span class="muted">${st.startDate ? esc(fmtShort(weekMonday(w))) : ''}</span></th>`).join('')}</tr>`;
      const body = rowsDef.map(([label, f]) => `<tr><th class="stick">${label}</th>${stats.map((s, i) => `<td class="${ws[i] === cw ? 'cur' : ''}">${s ? f(s) : '—'}</td>`).join('')}</tr>`).join('');
      const ses = `<tr><th class="stick">Entrenos</th>${ws.map(w => `<td class="${w === cw ? 'cur' : ''}">${recs.session.filter(s => s.week === w).length}</td>`).join('')}</tr>`;
      parts.push(`<section class="card flush"><div class="sheet-scroll"><table class="sheet">${head}${body}${ses}</table></div></section>`);
      const ms = recs.measure.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
      parts.push(`<section class="card flush"><div style="padding:14px 16px 4px"><h3>Medidas</h3></div>${ms.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Cintura</th><th>Cadera</th></tr></thead><tbody>${ms.map(m => `<tr><td>${esc(fmtShort(m.date))}</td><td>${m.cintura ? nf(m.cintura, 1) + ' cm' : '—'}</td><td>${m.cadera ? nf(m.cadera, 1) + ' cm' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="padding:0 16px 14px">Sin mediciones todavía.</p>'}</section>`);
      return { title: 'Planilla', html: parts.join(''), wide: true };
    }
    const r = ROUTINES[planillaTab];
    const head = `<tr><th class="stick">Ejercicio</th>${ws.map(w => `<th class="${w === cw ? 'cur' : ''}"><a href="#/semana/${w}">Sem ${w}</a><br><span class="muted">${esc(phaseLabel(w).replace('Recomposición', 'Recomp'))}</span></th>`).join('')}</tr>`;
    const body = r.exercises.map(ex => {
      const cells = ws.map(w => {
        const row = weeks[w];
        const pub = row && row.published && row.published.exercises && row.published.exercises[ex.id];
        const dr = row && row.draft && row.draft.exercises && row.draft.exercises[ex.id];
        const p = pub || dr;
        const presTxt = p && (p.kg != null || p.rir) ? `${p.kg != null && p.kg !== '' ? nf(p.kg, 2) + ' kg' : ''}${p.kg != null && p.kg !== '' && p.rir ? ' · ' : ''}${p.rir ? 'RIR ' + esc(p.rir) : ''}` : '';
        const s = sessionsSorted().filter(x => x.week === w && x.routine === r.id).pop();
        const e = s && s.ex[ex.id];
        let act = '';
        let cls = '';
        if (e && e.sets.length) {
          const rx = C.resolveEx(ex, e.alt);
          act = esc(C.setsText(rx, e.sets).replace(/ kg × /, '×').replace(/ · /g, '·'));
          if (rx.type !== 'time' && e.sets.length >= rx.sets && e.sets.every(x => (num(x.reps) || 0) >= rx.reps[1])) cls = 'top';
          if (e.note) cls += ' msg';
        }
        return `<td class="${w === cw ? 'cur' : ''} ${cls}">${presTxt ? `<span class="pres ${pub ? '' : 'draft'}">${presTxt}</span>` : ''}${act ? `<span class="act">${act}</span>` : (presTxt ? '' : '<span class="muted">—</span>')}</td>`;
      }).join('');
      const rx0 = C.resolveEx(ex, !!st.swaps[ex.id]);
      return `<tr><th class="stick">${esc(rx0.name)}<br><span class="muted">${rx0.sets} × ${rx0.type === 'time' ? 'máx.' : rx0.reps.join('–')}</span></th>${cells}</tr>`;
    }).join('');
    parts.push(`<section class="card flush"><div class="sheet-scroll"><table class="sheet">${head}${body}</table></div></section>`);
    parts.push(`<p class="small muted">Arriba de cada celda, lo indicado (en gris si es borrador). Abajo, lo que hizo. Verde: llegó al tope del rango en todas las series y toca subir. Borde azul: dejó un mensaje.</p>`);
    return { title: 'Planilla', html: parts.join(''), wide: true };
  }

  function viewRegistros() {
    const parts = [];
    const ses = sessionsSorted().reverse();
    parts.push(`<section class="card flush"><div style="padding:14px 16px 4px" class="card-head"><h3>Entrenamientos</h3><span class="small muted">${ses.length}</span></div><div class="list">${ses.length ? ses.slice(0, 30).map(s => {
      const n = Object.values(s.ex).reduce((a, e) => a + e.sets.length, 0);
      const msg = Object.values(s.ex).some(e => e.note);
      return `<a class="li" href="#/sesion/${encodeURIComponent(s.id)}">${kindTag(s.routine)}<span class="grow"><span class="s">${esc(fmtDay(s.date))} · sem ${s.week} · ${s.minutes} min · ${n} series</span></span>${msg ? '<span class="tag upper">mensaje</span>' : ''}<span class="chev">›</span></a>`;
    }).join('') : '<div class="li"><span class="muted small">Todavía no hay entrenamientos.</span></div>'}</div></section>`);
    const days = Array.from({ length: 14 }, (_, i) => addDays(today(), -i));
    const rows = days.map(d => {
      const c = recs.checkin[d];
      if (!c) return `<tr><td>${esc(fmtShort(d))}</td><td colspan="6" class="muted">sin registro</td></tr>`;
      return `<tr><td>${esc(fmtShort(d))}</td><td>${c.noPeso ? 'no' : (num(c.peso) ? nf(num(c.peso), 1) : '—')}</td><td>${num(c.pasos) !== null ? nf(num(c.pasos), 0) : '—'}</td><td>${c.sleepH !== undefined && c.sleepH !== '' ? `${c.sleepH} h ${C.pad(num(c.sleepM) || 0)}` : '—'}${c.sleepQ ? ` (${c.sleepQ}/5)` : ''}</td><td>${c.adh || '—'}</td><td>${c.hombro !== undefined && c.hombro !== '' ? c.hombro : '—'}</td><td>${c.energy ? esc(c.energy) : '—'}</td></tr>${c.nota ? `<tr class="note-row"><td></td><td colspan="6">${esc(c.nota)}</td></tr>` : ''}`;
    }).join('');
    parts.push(`<section class="card flush"><div style="padding:14px 16px 4px"><h3>Check-ins de las últimas 2 semanas</h3></div><div class="tbl"><table><thead><tr><th>Día</th><th>Peso</th><th>Pasos</th><th>Sueño</th><th>Dieta</th><th>Hombro</th><th>Energía</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
    return { title: 'Registros', html: parts.join(''), wide: true };
  }

  function viewSesion(id) {
    const s = recs.session.find(x => x.id === decodeURIComponent(id || ''));
    if (!s) return { title: 'Sesión', back: '#/registros', html: '<section class="card"><p>No encontré esa sesión.</p></section>' };
    const r = ROUTINES[s.routine];
    const pub = weeks[s.week] && weeks[s.week].published && weeks[s.week].published.exercises;
    const rows = r.exercises.map(ex => {
      const e = s.ex[ex.id];
      if (!e) return '';
      const rx = C.resolveEx(ex, e.alt);
      const p = pub && pub[ex.id];
      return `<div class="li" style="align-items:flex-start"><span class="grow"><span class="t">${esc(e.name)}${e.alt ? ' <span class="tag warn">hombro</span>' : ''}</span>
        <span class="num">${e.sets.length ? esc(C.setsText(rx, e.sets)) : 'No registrado'}</span>
        ${p ? `<span class="s">Indicado: ${p.kg != null && p.kg !== '' ? nf(p.kg, 2) + ' kg' : 'sin carga'}${p.rir ? ' · RIR ' + esc(p.rir) : ''}</span>` : ''}
        ${e.note ? `<span class="s" style="color:var(--upper)"><b>Mensaje:</b> ${esc(e.note)}</span>` : ''}</span></div>`;
    }).join('');
    const html = `<div class="wk-head ${r.kind}"><span class="eyebrow">${esc(fmtDay(s.date))} · semana ${s.week}</span><span class="rname">${r.name}</span></div>
      <div class="stats"><div class="stat"><span class="k">Duración</span><span class="v">${s.minutes} min</span></div>
      <div class="stat"><span class="k">Dificultad</span><span class="v">${s.difficulty || '—'}/5</span></div>
      <div class="stat"><span class="k">Hombro</span><span class="v">${s.shoulder != null ? s.shoulder : '—'}/10</span></div>
      <div class="stat"><span class="k">Series</span><span class="v">${Object.values(s.ex).reduce((a, e) => a + e.sets.length, 0)}</span></div></div>
      <section class="card flush"><div class="list">${rows}</div></section>`;
    return { title: 'Sesión', back: '#/registros', html };
  }

  function viewAjustes() {
    const st = settings();
    const swapRows = ROUTINE_ORDER.map(rid => ROUTINES[rid].exercises.filter(ex => ex.shoulder).map(ex => {
      const on = !!st.swaps[ex.id];
      return `<div class="li">${kindTag(rid)}<span class="grow"><span class="t">${esc(on ? ex.shoulder.name : ex.name)}</span><span class="s">${on ? 'En vez de: ' + esc(ex.name) : 'Variante: ' + esc(ex.shoulder.name)}</span></span>
        <button class="btn small ${on ? 'upper' : 'ghost'}" data-a="swap" data-id="${ex.id}" aria-pressed="${on}">${on ? 'Variante' : 'Original'}</button></div>`;
    }).join('')).join('');
    const picker = athletes.length > 1 ? `<div class="q"><label for="c-ath">Atleta</label><select class="inp" id="c-ath">${athletes.map(a => `<option value="${a.id}" ${a.id === A.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>` : '';
    const html = `<section class="card form"><h3>Plan de ${esc(A.name)}</h3>${picker}
        <div class="q"><label for="c-start">Fecha de inicio (lunes de la semana 1)</label><input class="inp" type="date" id="c-start" value="${st.startDate || ''}"></div>
        <div class="q"><span class="ql">Día del Upper A</span><div class="seg">
          <button type="button" class="${st.upperDay === 'mar' ? 'on' : ''}" data-a="upper-day" data-v="mar">Martes</button>
          <button type="button" class="${st.upperDay === 'mie' ? 'on' : ''}" data-a="upper-day" data-v="mie">Miércoles</button></div></div>
        <div class="two"><div class="q"><label for="c-kr">Recomposición</label><div class="inp-u"><input class="inp" id="c-kr" inputmode="numeric" value="${st.kcal.recomp}" data-kcal="recomp"><span class="u">kcal</span></div></div>
        <div class="q"><label for="c-kc">Mini cut</label><div class="inp-u"><input class="inp" id="c-kc" inputmode="numeric" value="${st.kcal.cut}" data-kcal="cut"><span class="u">kcal</span></div></div></div>
        <div class="q"><label for="c-name">Tu nombre en su app</label><input class="inp" id="c-name" value="${esc(st.coachName)}"></div>
      </section>
      <section class="card flush"><div style="padding:14px 16px 4px" class="stack"><h3>Variantes para el hombro</h3><p class="small muted">Se aplican desde su próximo entrenamiento.</p></div><div class="list">${swapRows}</div></section>
      <section class="card"><p class="small muted">Entraste como ${esc(user.email)}.${loadedAt ? ' Datos cargados a las ' + new Date(loadedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}</p>
        <a class="btn block ghost" href="../">Abrir la app de ${esc(A.name)}</a>
        <button class="btn block danger" data-a="logout">Cerrar sesión</button></section>`;
    return { title: 'Ajustes', html };
  }

  // ---------- Render ----------
  const TABS = [['inicio', 'Inicio'], ['semana', 'Semana'], ['planilla', 'Planilla'], ['registros', 'Registros'], ['ajustes', 'Ajustes']];
  const TAB_OF = { inicio: 'inicio', semana: 'semana', planilla: 'planilla', registros: 'registros', sesion: 'registros', ajustes: 'ajustes' };
  let lastRoute = null;
  const current = () => {
    const h = location.hash.replace(/^#\/?/, '') || 'inicio';
    const [name, arg] = h.split('/');
    return { name, arg, key: h };
  };

  function render() {
    const { name, arg, key } = current();
    let v;
    if (!authReady) v = { title: 'Coach', bare: true, html: '<p class="muted">Cargando…</p>' };
    else if (!user) v = viewLogin();
    else if (loading && !A) v = { title: 'Coach', bare: true, html: '<p class="muted">Cargando datos…</p>' };
    else if (loadError && !A) v = { title: 'Coach', bare: true, html: `<section class="card"><h3>No se pudieron cargar los datos</h3><p class="muted small">${esc(loadError)}</p><button class="btn block" data-a="reload">Reintentar</button><button class="btn block danger" data-a="logout">Cerrar sesión</button></section>` };
    else if (!A) v = viewNoAthlete();
    else {
      switch (name) {
        case 'semana': v = viewSemana(arg); break;
        case 'planilla': v = viewPlanilla(arg); break;
        case 'registros': v = viewRegistros(); break;
        case 'sesion': v = viewSesion(arg); break;
        case 'ajustes': v = viewAjustes(); break;
        default: v = viewInicio();
      }
    }
    document.body.classList.toggle('wide', !!v.wide);
    document.getElementById('hdr').innerHTML = `${v.back ? `<a class="back" href="${v.back}">‹ Volver</a>` : ''}<span class="title">${esc(v.title)}</span>${user && A ? `<button class="reload" data-a="reload" aria-label="Actualizar datos">${loading ? 'Cargando…' : 'Actualizar'}</button>` : ''}`;
    document.getElementById('view').innerHTML = v.html;
    const tabs = document.getElementById('tabs');
    tabs.hidden = !!v.bare;
    const tab = TAB_OF[name] || 'inicio';
    tabs.innerHTML = v.bare ? '' : TABS.map(([id, label]) => `<a href="#/${id}" class="${tab === id ? 'on' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span></a>`).join('');
    document.title = `${v.title} · Coach`;
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  }

  // ---------- Acciones ----------
  const routeWeek = () => { const { name, arg } = current(); return name === 'semana' ? Math.max(1, parseInt(arg, 10) || Math.max(1, currentWeek() || 1)) : null; };
  const actions = {
    reload: () => { Object.keys(editing).forEach(k => delete editing[k]); loadAll(); },
    logout: async el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez para cerrar sesión'; return; }
      try { await sb.auth.signOut(); } catch (e) { /* se cierra igual */ }
      user = null; A = null; athletes = []; render();
    },
    'p-rir': el => {
      const w = routeWeek(), id = el.dataset.ex, v = el.dataset.v;
      editDraft(w, d => {
        const p = d.exercises[id] = d.exercises[id] || {};
        p.rir = p.rir === v ? '' : v;
      });
      el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === editing[w].exercises[id].rir));
      const inp = document.getElementById('rir-' + id); if (inp) { inp.value = ''; inp.classList.remove('bad'); }
    },
    'copy-prev': () => {
      const w = routeWeek();
      if (w <= 1) { toast('No hay semana anterior'); return; }
      const src = weeks[w - 1] && (weeks[w - 1].published || weeks[w - 1].draft);
      if (!src || !src.exercises || !Object.keys(src.exercises).length) { toast(`La semana ${w - 1} está vacía`); return; }
      editDraft(w, d => { d.exercises = clone(src.exercises); });
      render(); toast(`Copiada la semana ${w - 1}`);
    },
    'fill-sug': () => {
      const w = routeWeek();
      const st = settings();
      let n = 0;
      editDraft(w, d => {
        ROUTINE_ORDER.forEach(rid => ROUTINES[rid].exercises.forEach(ex => {
          const rx = C.resolveEx(ex, !!st.swaps[ex.id]);
          const p = d.exercises[ex.id] = d.exercises[ex.id] || {};
          if (p.kg != null && p.kg !== '') return;
          const sug = C.autoSuggest(rx, lastBefore(rx, w), C.rirForSet(p.rir, w, 0));
          if (sug.kg) { p.kg = sug.kg; n += 1; }
        }));
      });
      render(); toast(n ? `${n} cargas rellenadas` : 'No hay sugerencias nuevas: faltan registros previos');
    },
    publish: el => {
      const w = Number(el.dataset.w);
      const d = weeks[w] && weeks[w].draft;
      const bad = d && Object.values(d.exercises || {}).find(p => p.rir && !C.parseRir(p.rir));
      if (bad) { toast('Hay un RIR mal escrito. Usa números separados por guion, como 2-1.'); return; }
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = `Toca otra vez para enviar a ${A.name}`; return; }
      publishWeek(w);
    },
    'upper-day': el => { saveSettings({ upperDay: el.dataset.v }).then(ok => ok && render()); },
    swap: el => {
      const swaps = Object.assign({}, settings().swaps);
      if (swaps[el.dataset.id]) delete swaps[el.dataset.id]; else swaps[el.dataset.id] = true;
      saveSettings({ swaps }).then(ok => ok && render());
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = actions[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    const w = routeWeek();
    if (t.dataset.pkg && w) {
      const v = t.value.trim();
      editDraft(w, d => { const p = d.exercises[t.dataset.pkg] = d.exercises[t.dataset.pkg] || {}; p.kg = v === '' ? null : num(v); });
    } else if (t.dataset.prir && w) {
      const v = t.value.trim().replace(/\s/g, '');
      t.classList.toggle('bad', !!v && !C.parseRir(v));
      editDraft(w, d => { const p = d.exercises[t.dataset.prir] = d.exercises[t.dataset.prir] || {}; p.rir = v; });
      t.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    } else if (t.dataset.pnote && w) {
      editDraft(w, d => { const p = d.exercises[t.dataset.pnote] = d.exercises[t.dataset.pnote] || {}; p.note = t.value; });
    } else if (t.dataset.wnote && w) {
      editDraft(w, d => { d.note = t.value; });
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'c-start' && t.value) {
      const monday = mondayOf(t.value);
      saveSettings({ startDate: monday }).then(ok => { if (ok) { render(); toast('Inicio: ' + fmtDay(monday)); } });
    } else if (t.dataset.kcal) {
      const v = num(t.value);
      if (!v || v < 1000 || v > 3500) { toast('Calorías fuera de rango'); return; }
      saveSettings({ kcal: Object.assign({}, settings().kcal, { [t.dataset.kcal]: Math.round(v) }) });
    } else if (t.id === 'c-name') {
      saveSettings({ coachName: t.value.trim() || 'Franco' });
    } else if (t.id === 'c-ath') {
      lsSet('plan-coach-athlete', t.value);
      loadAll();
    }
  });

  document.addEventListener('submit', async e => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const email = document.getElementById('lg-email').value.trim();
    const password = document.getElementById('lg-pass').value;
    if (!email || !password) { toast('Escribe tu correo y tu contraseña'); return; }
    const btn = document.getElementById('lg-btn');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { btn.disabled = false; btn.textContent = 'Entrar'; toast('Correo o contraseña incorrectos'); return; }
    user = data.user;
    loadAll();
  });

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user && loadedAt && Date.now() - loadedAt > 120000 && current().name !== 'semana') loadAll();
  });

  (async function boot() {
    if (sb) {
      try {
        const { data } = await sb.auth.getSession();
        user = data && data.session ? data.session.user : null;
      } catch (e) { user = null; }
      sb.auth.onAuthStateChange((_ev, session) => { user = session ? session.user : null; });
    }
    authReady = true;
    render();
    if (user) loadAll();
  })();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => { /* sin modo offline */ });
  }
})();
