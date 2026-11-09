'use strict';

// App de coach: arma la progresión semanal (carga y RIR por ejercicio), la envía a la app de cada persona
// y muestra la planilla de progreso con lo que registra. El plan (rutinas, comidas) depende de la persona elegida.
(function () {
  const { ROUTINES, ROUTINE_ORDER, schedule: PLAN_SCHEDULE, kcal: PLAN_KCAL, pain: PAIN } = window.DATA;
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

  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* opcional */ } };

  // ---------- Datos ----------
  function settings() {
    const s = (A && A.settings) || {};
    return {
      startDate: s.startDate || null,
      upperDay: s.upperDay || (PLAN_SCHEDULE.flex ? PLAN_SCHEDULE.flex.defaultId : ''),
      coachName: s.coachName || 'Franco',
      kcal: Object.assign({}, PLAN_KCAL.defaults, s.kcal || {}),
      swaps: Object.assign({}, s.swaps || {}),
      inc: Object.assign({}, s.inc || {})
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
      // Cada persona tiene su plan: si el cargado no es el de ella, se cambia y la app se recarga.
      if (A && window.DATA.switchPlan((A.settings || {}).plan || 'paola')) return;
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

  async function saveSettings(patch, quiet) {
    const next = Object.assign({}, A.settings || {}, patch);
    const { error } = await sb.from('athletes').update({ settings: next, updated_at: new Date().toISOString() }).eq('id', A.id);
    if (error) { toast('No se pudo guardar: ' + error.message); return false; }
    A.settings = next;
    if (!quiet) toast(`Guardado. ${A.name} lo ve al abrir su app.`);
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
  const draftTimers = {};
  function editDraft(w, fn) {
    if (!editing[w]) editing[w] = draftOf(w);
    fn(editing[w]);
    weeks[w] = Object.assign({ week: w, published: null, published_at: null }, weeks[w], { draft: clone(editing[w]) });
    clearTimeout(draftTimers[w]);
    draftTimers[w] = setTimeout(() => saveDraft(w), 700);
    paintSaving('Guardando…');
  }
  const pendingWeeks = () => Object.keys(draftTimers).map(Number);
  function paintSaving(txt) { document.querySelectorAll('[data-saving]').forEach(el => { el.textContent = txt; }); }
  function paintStatus(w) {
    const st = weekStatus(w);
    document.querySelectorAll(`[data-wstatus="${w}"]`).forEach(el => { el.textContent = st.label; el.className = 'tag ' + statusClass(st.key); });
  }
  async function saveDraft(w) {
    clearTimeout(draftTimers[w]); delete draftTimers[w];
    const { error } = await sb.from('plan_weeks').upsert({ athlete_id: A.id, week: w, draft: weeks[w].draft, updated_at: new Date().toISOString() });
    if (error) { toast('No se pudo guardar el borrador: ' + error.message); paintSaving('Error al guardar'); return; }
    const el = document.getElementById('draft-state');
    if (el) el.textContent = 'Borrador guardado';
    if (!pendingWeeks().length) paintSaving('Cambios guardados');
    paintStatus(w);
  }
  // Mantiene kg (serie 1) y kgs (todas las series) coherentes.
  function setKgs(p, arr) {
    p.kgs = arr;
    p.kg = arr.length && arr[0] !== null && arr[0] !== undefined ? arr[0] : null;
  }
  async function publishWeek(w) {
    if (draftTimers[w]) await saveDraft(w);
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
  function openSheet(html) {
    closeSheet();
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
    w.addEventListener('click', e => { if (e.target === w) closeSheet(); });
    document.body.appendChild(w);
  }
  function closeSheet() { document.querySelectorAll('.sheet-wrap').forEach(n => n.remove()); }

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
        <p class="muted">Entraste como ${esc(user.email)}. Corre el archivo supabase/link-athlete.sql en el SQL Editor de Supabase con tu correo y el de la persona, y vuelve a cargar.</p>
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
      ${PAIN ? `<div class="stat"><span class="k">${esc(PAIN.label)}</span><span class="v">${fmtN(cs.hombro)}</span><span class="s">dolor promedio /10</span></div>` : ''}
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
          <div class="pr-inputs">${showKg ? `<label class="field kg"><input inputmode="decimal" autocomplete="off" id="kg-${ex.id}" data-pkg="${ex.id}" value="${C.presKgAt(p, 0) !== null ? esc(String(C.presKgAt(p, 0)).replace('.', ',')) : ''}" placeholder="${sug.kg ? nf(sug.kg, 2) : 'kg'}" aria-label="Carga de ${esc(rx.name)}"><span class="u">kg</span></label>` : ''}
            ${rx.type === 'time' ? '' : rirChips(ex.id, p.rir || '')}</div>
          <input class="inp note-in" id="pn-${ex.id}" data-pnote="${ex.id}" value="${esc(p.note || '')}" placeholder="Nota para ${esc(A.name)} (opcional)" aria-label="Nota del ejercicio">
        </div>`;
      }).join('');
      parts.push(`<section class="card flush pr-card ${r.kind}"><div class="pr-head">${kindTag(rid)}<span class="small muted">${esc(r.day)}</span></div>${rows}</section>`);
    });
    parts.push(`<div class="sendbar"><button class="btn block upper" data-a="publish" data-w="${w}">Enviar semana ${w} a ${esc(A.name)}</button></div>`);
    return { title: 'Progresión', html: parts.join(''), wide: true };
  }

  const incFor = (ex, rx) => { const v = settings().inc[ex.id]; return v !== undefined && v !== null && v !== '' ? Math.abs(Number(v)) : rx.inc; };
  const incChosen = (ex, rx) => { const v = settings().inc[ex.id]; return v !== undefined && v !== null && v !== '' ? Number(v) : rx.inc; };

  // Aplica una progresión a la semana actual: peso de la semana anterior (lo que levantó, o si no lo indicado) + la progresión, en todas las series.
  // Queda como carga puesta a mano, así «Calcular progresiones» no la pisa.
  function prevWeekSets(exId, rx, w) {
    const ses = sessionsSorted().filter(x => x.week === w - 1 && x.ex[exId] && x.ex[exId].sets.length).pop();
    if (ses) return { src: 'hizo', kgs: ses.ex[exId].sets.map(x => num(x.kg)).filter(v => v) };
    if (w > 1) {
      const pp = (editing[w - 1] || draftOf(w - 1)).exercises[exId];
      const kgs = Array.from({ length: C.presSets(pp, rx) }, (_, i) => C.presKgAt(pp, i)).filter(v => v);
      if (kgs.length) return { src: 'indicado', kgs };
    }
    const last = lastBefore(rx, w);
    return { src: 'último registro', kgs: last ? last.sets.map(x => num(x.kg)).filter(v => v) : [] };
  }
  // Peso nuevo de la semana w: la serie base elegida de la semana anterior + la progresión, igual en todas las series.
  function flatKgs(exId, rx, w, p) {
    const prev = prevWeekSets(exId, rx, w);
    if (!prev.kgs.length) return null;
    const base = prev.kgs[Math.min(p.baseSet || 0, prev.kgs.length - 1)];
    const next = Math.max(0, Math.round((base + (Number(p.delta) || 0)) * 100) / 100);
    return { base, next, kgs: Array(C.presSets(p, rx)).fill(next) };
  }

  // Progresión tocada en la columna izquierda: se aplica a la semana actual sobre la serie base elegida.
  // Queda como carga puesta a mano, así «Calcular progresiones» no la pisa.
  function applyDelta(exId, delta) {
    const exInfo = C.findExercise(exId);
    if (!exInfo) return;
    const rx = C.resolveEx(exInfo.ex, !!settings().swaps[exId]);
    const w = Math.max(1, currentWeek() || 1);
    const p0 = Object.assign({}, (editing[w] || draftOf(w)).exercises[exId], { delta });
    const f = flatKgs(exId, rx, w, p0);
    if (!f) { toast(`No hay peso de la semana ${w - 1} para ${rx.name}`); return; }
    editDraft(w, d => {
      const p = d.exercises[exId] = d.exercises[exId] || {};
      p.delta = delta;
      setKgs(p, f.kgs);
      delete p.auto;
    });
    toast(`${rx.name} · semana ${w}: S${(p0.baseSet || 0) + 1} ${nf(f.base, 2)} → ${nf(f.next, 2)} kg en todas las series`);
  }
  const ACTION = { up: ['up', '↑ Subir'], keep: ['keep', '= Mantener'], down: ['down', '↓ Bajar'], mix: ['mix', '↕ Ajustar'] };
  const kgTxt = v => (v === null || v === undefined || v === '' ? '' : nf(v, 2));

  function planillaWeeks() {
    const cw = currentWeek() || 1;
    const maxSession = Math.max(0, ...recs.session.map(s => s.week || 0));
    const maxPlan = Math.max(0, ...Object.keys(weeks).map(Number));
    const last = Math.max(4, cw + 1, maxSession, maxPlan);
    return Array.from({ length: last }, (_, i) => i + 1);
  }

  function weekHeaderCell(w, cw) {
    const st = weekStatus(w);
    const d = editing[w] || draftOf(w);
    const rirs = new Set(Object.values(d.exercises).map(p => p.rir).filter(Boolean));
    const rirVal = rirs.size === 1 ? [...rirs][0] : '';
    return `<th class="wk ${w === cw ? 'cur' : ''}"><div class="wkh">
      <span class="wkt">Semana ${w}${w === cw ? ' · actual' : ''}</span>
      <span class="muted">${esc(phaseLabel(w))} · ${esc(fmtShort(weekMonday(w)))}–${esc(fmtShort(addDays(weekMonday(w), 6)))}</span>
      <span class="tag ${statusClass(st.key)}" data-wstatus="${w}">${esc(st.label)}</span>
      <div class="wkrir"><label for="wrir-${w}">RIR</label><input id="wrir-${w}" class="mini" value="${esc(rirVal)}" placeholder="${C.defaultScheme(w)}" maxlength="5"><button class="btn small upper" data-a="apply-rir" data-w="${w}">Aplicar RIR</button></div>
      <button class="btn small ghost" data-a="publish" data-w="${w}">Enviar semana ${w}</button></div></th>`;
  }

  function planCell(r, ex, w, cw) {
    const st = settings();
    const rx = C.resolveEx(ex, !!st.swaps[ex.id]);
    const d = editing[w] || draftOf(w);
    const p = d.exercises[ex.id] || {};
    const sets = C.presSets(p, rx);
    const scheme = p.rir || C.defaultScheme(w);
    const repsTxt = rx.type === 'time' ? 'máx. s' : `${rx.reps[0]}–${rx.reps[1]}`;
    const withKg = rx.type !== 'time' && !C.isBodyweight(rx);
    const parts = [`<div class="ch">${sets}s ${repsTxt} · RIR ${esc(scheme)} · 2-1-X-1</div>`];
    const sAll = sessionsSorted();
    const ses = sAll.filter(x => x.week === w && x.routine === r.id && x.ex[ex.id] && x.ex[ex.id].sets.length).pop();
    const e = ses && ses.ex[ex.id];
    if (e) {
      const erx = C.resolveEx(ex, e.alt);
      const prev = C.lastPerfIn(sAll.filter(x => x.finishedAt < ses.finishedAt), e.histKey);
      const lines = (e.warm || []).map(x => `<div class="lg warm">~ ${esc(C.setText(erx, x))}</div>`)
        .concat(e.sets.map((x, i) => {
          const dl = prev ? C.setDelta(x, prev.sets[Math.min(i, prev.sets.length - 1)]) : '';
          return `<div class="lg"><b>${esc(C.setText(erx, x))}</b>${x.rir !== undefined && x.rir !== '' ? ` <span class="muted">RIR ${esc(x.rir)}</span>` : ''}${dl ? `<span class="dl ${dl.includes('+') ? 'pos' : 'neg'}">${esc(dl)}</span>` : ''}</div>`;
        }));
      const maxKg = Math.max(0, ...e.sets.map(x => num(x.kg) || 0));
      parts.push(`<div class="logs">${lines.join('')}<div class="sum">${e.sets.length}/${sets} series${maxKg ? ' · ' + nf(maxKg, 2) + ' kg' : ''}</div></div>`);
      if (e.setup) parts.push(`<div class="nt setup">Setup · ${esc(e.setup)}</div>`);
      if (e.note) parts.push(`<div class="nt msg">${esc(e.note)}</div>`);
    } else {
      parts.push(`<div class="logs muted">Sin registro</div>`);
    }
    // Edición de la semana: kilos por serie, series, RIR y nota.
    const ed = [];
    if (withKg) {
      const prog = C.progressFrom(rx, lastBefore(rx, w), incFor(ex, rx), sets);
      const auto = p.auto && ACTION[p.auto];
      const hint = prog && ACTION[prog.action];
      const badge = auto || (C.hasKg(p) ? null : hint);
      const prevRef = i => C.presKgAt((editing[w - 1] || draftOf(w - 1)).exercises[ex.id], i);
      ed.push(`<div class="edtop">${badge ? `<span class="act ${badge[0]}">${badge[1]}</span>` : '<span></span>'}${!C.hasKg(p) && prog ? `<span class="muted">sugerido ${nf(prog.kgs[0], 2)} kg</span>` : ''}</div>`);
      // Base: qué serie de la semana anterior se usa para progresar. Los kg por serie se pueden cambiar a mano.
      const prev = prevWeekSets(ex.id, rx, w);
      const baseIdx = Math.min(p.baseSet || 0, Math.max(0, prev.kgs.length - 1));
      const perSet = Array.from({ length: sets }, (_, i) => C.presKgAt(p, i));
      const uneven = perSet.some(x => x !== perSet[0]);
      if (prev.kgs.length) {
        ed.push(`<div class="basepick"><span class="muted">Base semana ${w - 1} (${prev.src}):</span>${prev.kgs.map((k, i) => `<button class="${i === baseIdx ? 'on' : ''}" data-a="pick-base" data-w="${w}" data-ex="${ex.id}" data-i="${i}">S${i + 1} ${nf(k, 2)}</button>`).join('')}
          ${p.delta !== undefined && p.delta !== null ? `<span class="act ${p.delta > 0 ? 'up' : (p.delta < 0 ? 'down' : 'keep')}">${p.delta > 0 ? '+' : ''}${nf(p.delta, 2)} kg</span>` : ''}</div>`);
      }
      ed.push(`<div class="kgs">${perSet.map((v, i) => {
        const ref = prev.kgs.length ? prev.kgs[Math.min(i, prev.kgs.length - 1)] : null;
        const diff = v !== null && ref !== null ? Math.round((v - ref) * 100) / 100 : 0;
        return `<label class="kgcell"><span class="muted">S${i + 1}${diff ? ` <i class="${diff > 0 ? 'pos' : 'neg'}">${diff > 0 ? '↑' : '↓'}${nf(Math.abs(diff), 2)}</i>` : ''}</span>
          <input inputmode="decimal" autocomplete="off" data-cw="${w}" data-cex="${ex.id}" data-cf="kg${i}" value="${esc(kgTxt(v).replace('.', ','))}" placeholder="${prog ? nf(prog.kgs[i] !== undefined ? prog.kgs[i] : prog.kgs[0], 2) : 'kg'}" aria-label="Kilos serie ${i + 1}, semana ${w}"></label>`;
      }).join('')}</div>`);
      if (uneven || (prev.kgs.length && C.hasKg(p))) ed.push(`<button class="linkbtn small" data-a="flatten" data-w="${w}" data-ex="${ex.id}">Aplanar: todas las series a S${baseIdx + 1} ${p.delta ? (p.delta > 0 ? '+' : '') + nf(p.delta, 2) + ' kg' : ''}</button>`);
    }
    ed.push(`<div class="sr"><label><span class="muted">Series</span><input inputmode="numeric" data-cw="${w}" data-cex="${ex.id}" data-cf="sets" value="${esc(p.sets || '')}" placeholder="${rx.sets}" aria-label="Series"></label>
      ${rx.type === 'time' ? '' : `<label><span class="muted">RIR</span><input data-cw="${w}" data-cex="${ex.id}" data-cf="rir" value="${esc(p.rir || '')}" placeholder="${C.defaultScheme(w)}" maxlength="5" aria-label="RIR"></label>`}</div>`);
    ed.push(`<input class="cnote" data-cw="${w}" data-cex="${ex.id}" data-cf="note" value="${esc(p.note || '')}" placeholder="Nota para ${esc(A.name)}" aria-label="Nota">`);
    parts.push(`<div class="ed">${ed.join('')}</div>`);
    return `<td class="pc ${w === cw ? 'cur' : ''}">${parts.join('')}</td>`;
  }

  function viewPlanilla() {
    const st = settings();
    if (!st.startDate) return { title: 'Planilla', html: `<a class="notice" href="#/ajustes" style="text-decoration:none"><div><b>Falta la fecha de inicio de ${esc(A.name)}.</b> Defínela en Ajustes.</div></a>` };
    const ws = planillaWeeks();
    const cw = currentWeek();
    const incs = [-2.5, -1.5, -1, 0, 1.25, 2.5, 5, 10];
    const jump = ROUTINE_ORDER.map(t => `<a href="#" data-a="jump" data-r="${t}">${ROUTINES[t].name}</a>`).join('');
    const head = `<tr><th class="stick exh">Ejercicio</th>${ws.map(w => weekHeaderCell(w, cw)).join('')}</tr>`;
    const body = ROUTINE_ORDER.map(rid => {
      const r = ROUTINES[rid];
      const secRow = `<tr class="rsec" id="rsec-${rid}"><th class="stick">${r.name}<span class="muted"> · ${esc(r.day)}</span></th><td colspan="${ws.length}"></td></tr>`;
      return secRow + r.exercises.map(ex => {
        const rx = C.resolveEx(ex, !!st.swaps[ex.id]);
        const inc = incChosen(ex, rx);
        const left = `<th class="stick exn"><b>${esc(rx.name)}</b><span class="muted">${esc(rx.group)}${rx.alt ? ' · variante' : ''}</span>
          <a class="linkbtn" href="${esc(rx.video || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(rx.name + ' técnica'))}" target="_blank" rel="noopener">Ver video</a>
          ${rx.type === 'time' || !rx.inc ? '<span class="muted small">Sin carga</span>' : `<span class="muted small">Progresión kg</span>
          <div class="incs">${incs.map(v => `<button class="${inc === v ? 'on' : ''}" data-a="set-inc" data-ex="${ex.id}" data-v="${v}">${nf(v, 2)}</button>`).join('')}<input class="mini" data-inc="${ex.id}" value="${incs.includes(inc) ? '' : nf(inc, 2)}" placeholder="otro" aria-label="Otro incremento"></div>
          <span class="muted small">Se aplica a la semana ${Math.max(1, cw || 1)} sobre el peso de la anterior</span>`}</th>`;
        return `<tr>${left}${ws.map(w => planCell(r, ex, w, cw)).join('')}</tr>`;
      }).join('');
    }).join('');
    const html = `<div class="ptools"><div class="seg-links"><span class="small muted">Ir a:</span>${jump}</div>
        <div class="row"><span class="small muted" data-saving>${pendingWeeks().length ? 'Guardando…' : 'Los cambios se guardan solos'}</span><button class="btn small upper" data-a="calc-prog">Calcular progresiones</button></div></div>
      <section class="card flush"><div class="sheet-scroll"><table class="grid plan">${head}${body}</table></div></section>
      <p class="small muted">Están todas las rutinas de la semana. «Enviar semana N» manda las cuatro de una vez. Las series son lineales: un mismo peso para todas las series del ejercicio. «Calcular progresiones» rellena las cargas vacías de esta semana y la próxima: sube el incremento elegido si todas las series llegaron al tope del rango, baja si el promedio quedó bajo el mínimo y si no mantiene. Nada le llega hasta que toques «Enviar semana».</p>`;
    return { title: 'Planilla', html, wide: true };
  }

  // Check-in semanal: días en columnas, campos en filas, con colores y promedio.
  function viewCheckin(arg) {
    const st = settings();
    if (!st.startDate) return { title: 'Check-in', html: `<a class="notice" href="#/ajustes" style="text-decoration:none"><div><b>Falta la fecha de inicio.</b> Defínela en Ajustes.</div></a>` };
    const cw = Math.max(1, currentWeek() || 1);
    const w = Math.min(cw, Math.max(1, parseInt(arg, 10) || cw));
    const monday = weekMonday(w);
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const map = C.scheduleFor(st.upperDay);
    const chips = Array.from({ length: cw }, (_, i) => i + 1).map(x => `<a href="#/registros/${x}" class="${x === w ? 'on' : ''}">Semana ${x}<span>${esc(fmtShort(weekMonday(x)))}–${esc(fmtShort(addDays(weekMonday(x), 6)))}</span></a>`).join('');
    const info = days.map((d, i) => {
      const c = recs.checkin[d] || null;
      const ses = recs.session.filter(x => x.date === d);
      const phase = C.blockFor(st.startDate, d).phase;
      const food = recs.food[d];
      return { d, i, c, ses, tg: C.targetsFor(st, phase), it: food ? C.dayIntake(phase === 'cut', food) : null, plan: map[i] };
    });
    const cell = (txt, cls) => `<td class="${cls || ''}">${txt === '' || txt === null || txt === undefined ? '<span class="muted">—</span>' : txt}</td>`;
    const avgCell = (vals, f) => { const v = vals.filter(x => x !== null && x !== undefined && Number.isFinite(x)); return `<td class="avg">${v.length ? f(C.avg(v)) : ''}</td>`; };
    const ratio = (v, goal, lo, hi) => (v / goal >= lo && v / goal <= hi ? 'good' : 'bad');
    const rows = [];
    const sec = t => rows.push(`<tr class="sec"><td colspan="9">${t}</td></tr>`);
    const row = (label, cells, avg) => rows.push(`<tr><th class="stick">${label}</th>${cells.join('')}${avg || '<td class="avg"></td>'}</tr>`);
    sec('Check-in');
    row('Check-in del día', info.map(x => {
      if (x.d > today()) return cell('');
      const miss = C.checkinMissing(x.c);
      return cell(miss.length ? `Faltan ${miss.length}<br><span class="small">${esc(miss.join(', '))}</span>` : 'Completo ✓', miss.length ? 'bad' : 'good');
    }), `<td class="avg">${info.filter(x => x.d <= today() && !C.checkinMissing(x.c).length).length}/${info.filter(x => x.d <= today()).length}</td>`);
    sec('Biofeedback');
    row('Peso en ayunas', info.map(x => cell(x.c ? (x.c.noPeso ? 'No se pesó' : (num(x.c.peso) ? nf(num(x.c.peso), 2) : '')) : '')), avgCell(info.map(x => (x.c && !x.c.noPeso ? num(x.c.peso) : null)), v => nf(v, 2) + ' kg'));
    row('Energía', info.map(x => { const v = x.c && x.c.energy; return cell(v ? { baja: 'Baja', promedio: 'Promedio', alta: 'Alta' }[v] : '', v === 'alta' ? 'good' : (v === 'baja' ? 'bad' : '')); }));
    if (PAIN) row('Dolor de hombro', info.map(x => { const v = x.c ? num(x.c.hombro) : null; return cell(v !== null ? v + '/10' : '', v === null ? '' : (v >= 4 ? 'bad' : (v <= 1 ? 'good' : ''))); }), avgCell(info.map(x => (x.c ? num(x.c.hombro) : null)), v => nf(v, 1)));
    sec('Entrenamiento');
    row('Entrenamiento (hecho / plan)', info.map(x => {
      const done = x.ses.map(s => `${ROUTINES[s.routine].name} ✓`).join('<br>');
      const plan = x.plan ? `<span class="muted small">plan: ${ROUTINES[x.plan].name}</span>` : '<span class="muted small">Descanso</span>';
      return cell(done ? `${done}<br>${plan}` : plan, done ? 'good' : '');
    }));
    // Más de 4 horas suele ser un entrenamiento que quedó abierto: se marca para revisarlo.
    row('Duración', info.map(x => cell(x.ses.map(s => `${Math.floor(s.minutes / 60) ? Math.floor(s.minutes / 60) + ' h ' : ''}${s.minutes % 60} m${s.minutes > 240 ? ' <span class="small">(quedó abierto)</span>' : ''}`).join('<br>'), x.ses.some(s => s.minutes > 240) ? 'bad' : '')));
    row('Dificultad', info.map(x => cell(x.ses.filter(s => s.difficulty).map(s => s.difficulty + '/5').join('<br>'))));
    if (PAIN) row('Hombro al terminar', info.map(x => { const v = x.ses.map(s => s.shoulder).filter(n => n !== null && n !== undefined); return cell(v.map(n => n + '/10').join('<br>'), v.some(n => n >= 4) ? 'bad' : ''); }));
    row('Pasos / meta', info.map(x => { const v = x.c ? num(x.c.pasos) : null; return cell(v !== null ? `${nf(v, 0)}<span class="muted">/${nf(x.tg.steps, 0)}</span>` : '', v === null ? '' : (v >= x.tg.steps ? 'good' : (v < x.tg.steps * 0.7 ? 'bad' : ''))); }), avgCell(info.map(x => (x.c ? num(x.c.pasos) : null)), v => nf(v, 0)));
    sec('Nutrición');
    row('Cumplimiento (1–10)', info.map(x => { const v = x.c ? num(x.c.adh) : null; return cell(v !== null ? v + '/10' : '', v === null ? '' : (v >= 8 ? 'good' : (v <= 5 ? 'bad' : ''))); }), avgCell(info.map(x => (x.c ? num(x.c.adh) : null)), v => nf(v, 1)));
    const logged = x => x.it && (x.it.eaten || x.it.extras);
    row('Kcal / meta', info.map(x => cell(logged(x) ? `${x.it.kcal}<span class="muted">/${x.tg.kcal}</span>` : '', logged(x) ? ratio(x.it.kcal, x.tg.kcal, 0.9, 1.1) : '')));
    row('Proteína / meta (g)', info.map(x => cell(logged(x) ? `${x.it.p}<span class="muted">/${x.tg.p}</span>` : '', logged(x) ? ratio(x.it.p, x.tg.p, 0.9, 1.5) : '')));
    row('Carbos / meta (g)', info.map(x => cell(logged(x) ? `${x.it.c}<span class="muted">/${x.tg.c}</span>` : '', logged(x) ? ratio(x.it.c, x.tg.c, 0.8, 1.2) : '')));
    row('Grasas / meta (g)', info.map(x => cell(logged(x) ? `${x.it.g}<span class="muted">/${x.tg.g}</span>` : '', logged(x) ? ratio(x.it.g, x.tg.g, 0.8, 1.2) : '')));
    row('Agua / meta (L)', info.map(x => { const v = x.it ? x.it.water / 1000 : null; return cell(v ? `${nf(v, 2)}<span class="muted">/2</span>` : '', v ? (v >= 2 ? 'good' : (v < 1.2 ? 'bad' : '')) : ''); }));
    row('Plan marcado', info.map(x => cell(x.it && x.it.planned ? `${Math.round(x.it.eaten / x.it.planned * 100)} %` : '', x.it && x.it.planned ? (x.it.eaten / x.it.planned >= 0.85 ? 'good' : (x.it.eaten / x.it.planned < 0.5 ? 'bad' : '')) : '')));
    row('Cambios y extras', info.map(x => cell(x.it && (x.it.swaps || x.it.extras) ? [x.it.swaps ? x.it.swaps + ' cambio' + (x.it.swaps > 1 ? 's' : '') : '', x.it.extras ? x.it.extras + ' extra' + (x.it.extras > 1 ? 's' : '') : ''].filter(Boolean).join(' · ') : '')));
    sec('Sueño');
    row('Calidad', info.map(x => { const v = x.c ? num(x.c.sleepQ) : null; return cell(v !== null ? v + '/5' : '', v === null ? '' : (v >= 4 ? 'good' : (v <= 2 ? 'bad' : ''))); }), avgCell(info.map(x => (x.c ? num(x.c.sleepQ) : null)), v => nf(v, 1)));
    const sleepMin = x => (x.c && x.c.sleepH !== undefined && x.c.sleepH !== '' ? (num(x.c.sleepH) || 0) * 60 + (num(x.c.sleepM) || 0) : null);
    row('Horas', info.map(x => { const v = sleepMin(x); return cell(v !== null ? fmtSleep(v) : '', v === null ? '' : (v >= 420 ? 'good' : (v < 360 ? 'bad' : ''))); }), avgCell(info.map(sleepMin), fmtSleep));
    sec('Notas');
    row('Nota del día', info.map(x => cell(x.c && x.c.nota ? esc(x.c.nota) : '', 'txt')));
    row('Mensajes de ejercicios', info.map(x => cell(x.ses.flatMap(s => Object.values(s.ex).filter(e => e.note).map(e => `<b>${esc(e.name)}:</b> ${esc(e.note)}`)).join('<br>'), 'txt')));
    const head = `<tr><th class="stick">Campo</th>${info.map(x => `<th class="${x.d === today() ? 'cur' : ''}">D${x.i + 1}<br>${DOW[x.i]}<br><span class="muted">${esc(fmtShort(x.d))}</span></th>`).join('')}<th>Prom.</th></tr>`;
    const ses = sessionsSorted().reverse();
    const ms = recs.measure.slice().sort((a, b2) => (a.date < b2.date ? 1 : -1));
    const html = `<div class="seg-links weeks">${chips}</div>
      <section class="card flush"><div class="sheet-scroll"><table class="grid ci">${head}${rows.join('')}</table></div></section>
      <section class="card flush"><div style="padding:14px 16px 4px" class="card-head"><h3>Entrenamientos</h3><span class="small muted">${ses.length}</span></div><div class="list">${ses.length ? ses.slice(0, 30).map(x => {
        const n = Object.values(x.ex).reduce((a, e) => a + e.sets.length, 0);
        return `<a class="li" href="#/sesion/${encodeURIComponent(x.id)}">${kindTag(x.routine)}<span class="grow"><span class="s">${esc(fmtDay(x.date))} · sem ${x.week} · ${x.minutes} min · ${n} series</span></span>${Object.values(x.ex).some(e => e.note) ? '<span class="tag upper">mensaje</span>' : ''}<span class="chev">›</span></a>`;
      }).join('') : '<div class="li"><span class="muted small">Todavía no hay entrenamientos.</span></div>'}</div></section>
      <section class="card flush"><div style="padding:14px 16px 4px"><h3>Medidas</h3></div>${ms.length ? `<div class="tbl"><table><thead><tr><th>Fecha</th><th>Cintura</th><th>Cadera</th></tr></thead><tbody>${ms.map(m => `<tr><td>${esc(fmtShort(m.date))}</td><td>${m.cintura ? nf(m.cintura, 1) + ' cm' : '—'}</td><td>${m.cadera ? nf(m.cadera, 1) + ' cm' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small" style="padding:0 16px 14px">Sin mediciones todavía.</p>'}</section>`;
    return { title: 'Check-in', html, wide: true };
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
        ${e.sets.some(x => x.rir !== undefined && x.rir !== '') ? `<span class="s">RIR real: ${e.sets.map(x => (x.rir === '' || x.rir === undefined ? '—' : x.rir)).join(' · ')}</span>` : ''}
        ${e.warm && e.warm.length ? `<span class="s">Aproximación: ${e.warm.map(x => esc(C.setText(rx, x))).join(' · ')}</span>` : ''}
        ${e.setup ? `<span class="s">Setup: ${esc(e.setup)}</span>` : ''}
        ${p ? `<span class="s">Indicado: ${p.kg != null && p.kg !== '' ? nf(p.kg, 2) + ' kg' : 'sin carga'}${p.rir ? ' · RIR ' + esc(p.rir) : ''}</span>` : ''}
        ${e.note ? `<span class="s" style="color:var(--upper)"><b>Mensaje:</b> ${esc(e.note)}</span>` : ''}</span></div>`;
    }).join('');
    const html = `<div class="wk-head ${r.kind}"><span class="eyebrow">${esc(fmtDay(s.date))} · semana ${s.week}</span><span class="rname">${r.name}</span></div>
      <div class="stats"><div class="stat"><span class="k">Duración</span><span class="v">${s.minutes} min</span></div>
      <div class="stat"><span class="k">Dificultad</span><span class="v">${s.difficulty || '—'}/5</span></div>
      ${PAIN ? `<div class="stat"><span class="k">${esc(PAIN.label)}</span><span class="v">${s.shoulder != null ? s.shoulder : '—'}/10</span></div>` : ''}
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
        ${C.flexDayHtml(st.upperDay)}
        ${C.kcalFieldsHtml(st.kcal)}
        <div class="q"><label for="c-name">Tu nombre en su app</label><input class="inp" id="c-name" value="${esc(st.coachName)}"></div>
      </section>
      ${C.hasVariants() ? `<section class="card flush"><div style="padding:14px 16px 4px" class="stack"><h3>${esc(PAIN ? PAIN.variantsTitle : 'Variantes de ejercicios')}</h3><p class="small muted">Se aplican desde su próximo entrenamiento.</p></div><div class="list">${swapRows}</div></section>` : ''}
      <section class="card"><p class="small muted">Entraste como ${esc(user.email)}.${loadedAt ? ' Datos cargados a las ' + new Date(loadedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + '.' : ''}</p>
        <a class="btn block ghost" href="../">Abrir la app de ${esc(A.name)}</a>
        <button class="btn block danger" data-a="logout">Cerrar sesión</button></section>`;
    return { title: 'Ajustes', html };
  }

  // ---------- Render ----------
  const TABS = [['inicio', 'Inicio'], ['planilla', 'Planilla'], ['semana', 'Semana'], ['registros', 'Check-in'], ['ajustes', 'Ajustes']];
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
        case 'registros': v = viewCheckin(arg); break;
        case 'sesion': v = viewSesion(arg); break;
        case 'ajustes': v = viewAjustes(); break;
        default: v = viewInicio();
      }
    }
    document.body.classList.toggle('wide', !!v.wide);
    document.getElementById('hdr').innerHTML = `${v.back ? `<a class="back" href="${v.back}">‹ Volver</a>` : ''}<span class="title">${esc(v.title)}</span>${user && A ? `<button class="reload" data-a="reload" aria-label="Actualizar datos">${loading ? 'Cargando…' : 'Actualizar'}</button>` : ''}`;
    const viewEl = document.getElementById('view');
    const sameRoute = key === lastRoute;
    const keepX = sameRoute && viewEl.querySelector('.sheet-scroll') ? viewEl.querySelector('.sheet-scroll').scrollLeft : 0;
    const keepY = sameRoute ? window.scrollY : 0;
    viewEl.innerHTML = v.html;
    if (sameRoute) {
      const sc = viewEl.querySelector('.sheet-scroll');
      if (sc) sc.scrollLeft = keepX;
      window.scrollTo(0, keepY);
    }
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
          if (C.hasKg(p)) return;
          const prog = C.progressFrom(rx, lastBefore(rx, w), incFor(ex, rx), C.presSets(p, rx));
          if (prog) { setKgs(p, prog.kgs); p.auto = prog.action; n += 1; }
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
    'set-inc': el => {
      const v = Number(el.dataset.v);
      applyDelta(el.dataset.ex, v);
      const inc = Object.assign({}, settings().inc, { [el.dataset.ex]: v });
      saveSettings({ inc }, true).then(() => render());
    },
    'apply-rir': el => {
      const w = Number(el.dataset.w);
      const v = document.getElementById('wrir-' + w).value.trim().replace(/\s/g, '');
      if (!C.parseRir(v)) { toast('Escribe un RIR como 2, 2-1, 1-0, 1 o 0'); return; }
      editDraft(w, d => {
        ROUTINE_ORDER.forEach(rid => ROUTINES[rid].exercises.forEach(ex => {
          const rx = C.resolveEx(ex, !!settings().swaps[ex.id]);
          if (rx.type === 'time') return;
          (d.exercises[ex.id] = d.exercises[ex.id] || {}).rir = v;
        }));
      });
      render(); toast(`RIR ${v} aplicado a toda la semana ${w}`);
    },
    'calc-prog': () => {
      const st = settings();
      const cw = Math.max(1, currentWeek() || 1);
      const filled = [], trained = [], noLoad = [], manual = [], noData = [];
      [cw, cw + 1].forEach(w => ROUTINE_ORDER.forEach(rid => ROUTINES[rid].exercises.forEach(ex => {
        const rx = C.resolveEx(ex, !!st.swaps[ex.id]);
        const label = `S${w} · ${ROUTINES[rid].name} · ${rx.name}`;
        if (rx.type === 'time' || !rx.inc) { noLoad.push(label); return; }
        if (recs.session.some(x => x.week === w && x.routine === rid && x.ex[ex.id] && x.ex[ex.id].sets.length)) { trained.push(label); return; }
        const p = (editing[w] || draftOf(w)).exercises[ex.id] || {};
        if (C.hasKg(p) && !p.auto) { manual.push(label); return; }
        const n = C.presSets(p, rx);
        const lastRaw = lastBefore(rx, w);
        const b = p.baseSet || 0;
        const last = lastRaw && lastRaw.sets[b] ? Object.assign({}, lastRaw, { sets: [lastRaw.sets[b]].concat(lastRaw.sets.filter((_, i) => i !== b)) }) : lastRaw;
        let prog = C.progressFrom(rx, last, incFor(ex, rx), n);
        if (!prog) {
          const pp = (editing[w - 1] || draftOf(w - 1)).exercises[ex.id];
          if (C.hasKg(pp)) prog = { kgs: Array.from({ length: n }, (_, i) => C.presKgAt(pp, i)), action: 'keep' };
        }
        if (!prog) { noData.push(label); return; }
        editDraft(w, dd => { const q = dd.exercises[ex.id] = dd.exercises[ex.id] || {}; setKgs(q, prog.kgs); q.auto = prog.action; });
        filled.push({ label, kg: prog.kgs[0], action: prog.action });
      })));
      render();
      const grp = (title, list, open) => `<details ${open ? 'open' : ''}><summary><b>${title}: ${list.length}</b></summary><ul>${list.map(x => `<li>${typeof x === 'string' ? esc(x) : `${esc(x.label)} → <b>${nf(x.kg, 2)} kg</b> <span class="act ${ACTION[x.action][0]}">${ACTION[x.action][1]}</span>`}</li>`).join('') || '<li class="muted">—</li>'}</ul></details>`;
      openSheet(`<h2>Detalle de progresiones</h2><p class="muted small">Semanas ${cw} y ${cw + 1}. Rellena las cargas vacías y recalcula las que puso el cálculo; lo que escribiste a mano no se toca.</p>
        ${grp('Rellenadas', filled, true)}${grp('Ya entrenado', trained)}${grp('Con carga puesta a mano', manual)}${grp('Sin registros previos', noData)}${grp('Sin carga (peso corporal o tiempo)', noLoad)}
        <button class="btn block ghost" data-a="close-sheet">Cerrar</button>`);
    },
    'close-sheet': () => closeSheet(),
    'pick-base': el => {
      const w = Number(el.dataset.w), id = el.dataset.ex, i = Number(el.dataset.i);
      const rx = C.resolveEx(C.findExercise(id).ex, !!settings().swaps[id]);
      editDraft(w, d => {
        const p = d.exercises[id] = d.exercises[id] || {};
        p.baseSet = i;
        if (p.delta !== undefined || C.hasKg(p)) { const f = flatKgs(id, rx, w, p); if (f) { setKgs(p, f.kgs); delete p.auto; } }
      });
      render();
    },
    flatten: el => {
      const w = Number(el.dataset.w), id = el.dataset.ex;
      const rx = C.resolveEx(C.findExercise(id).ex, !!settings().swaps[id]);
      editDraft(w, d => {
        const p = d.exercises[id] = d.exercises[id] || {};
        const f = flatKgs(id, rx, w, p);
        setKgs(p, f ? f.kgs : Array(C.presSets(p, rx)).fill(C.presKgAt(p, 0)));
        delete p.auto;
      });
      render();
    },
    jump: el => { const row = document.getElementById('rsec-' + el.dataset.r); if (row) row.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
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
    if (t.dataset.cw) {
      const cw = Number(t.dataset.cw), id = t.dataset.cex, f = t.dataset.cf;
      const exInfo = C.findExercise(id);
      const rx = C.resolveEx(exInfo.ex, !!settings().swaps[id]);
      const v = t.value.trim();
      if (f === 'rir') t.classList.toggle('bad', !!v && !C.parseRir(v));
      editDraft(cw, d => {
        const p = d.exercises[id] = d.exercises[id] || {};
        if (f === 'kg') {
          setKgs(p, Array(C.presSets(p, rx)).fill(v === '' ? null : num(v)));
          delete p.auto;
        } else if (/^kg\d+$/.test(f)) {
          const n = C.presSets(p, rx);
          const arr = Array.from({ length: n }, (_, i) => C.presKgAt(p, i));
          arr[Number(f.slice(2))] = v === '' ? null : num(v);
          setKgs(p, arr);
          delete p.auto;
        } else if (f === 'sets') {
          const n = parseInt(v, 10);
          if (n > 0 && n <= 8) p.sets = n; else delete p.sets;
          if (C.hasKg(p)) setKgs(p, Array(C.presSets(p, rx)).fill(C.presKgAt(p, 0)));
        } else if (f === 'rir') {
          p.rir = v.replace(/\s/g, '');
        } else if (f === 'note') {
          p.note = t.value;
        }
      });
      return;
    }
    if (t.dataset.inc) return;
    const w = routeWeek();
    if (t.dataset.pkg && w) {
      const v = t.value.trim();
      const exInfo = C.findExercise(t.dataset.pkg);
      editDraft(w, d => {
        const p = d.exercises[t.dataset.pkg] = d.exercises[t.dataset.pkg] || {};
        const n = C.presSets(p, C.resolveEx(exInfo.ex, !!settings().swaps[t.dataset.pkg]));
        setKgs(p, Array(n).fill(v === '' ? null : num(v)));
        delete p.auto;
      });
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
    } else if (t.dataset.inc) {
      const v = num(t.value);
      if (v === null || v < -20 || v > 50) { toast('Progresión fuera de rango'); return; }
      applyDelta(t.dataset.inc, v);
      saveSettings({ inc: Object.assign({}, settings().inc, { [t.dataset.inc]: v }) }, true).then(() => render());
    } else if (t.dataset.cf === 'sets') {
      render();
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
    if (!document.hidden && user && loadedAt && Date.now() - loadedAt > 120000 && !['semana', 'planilla'].includes(current().name) && !pendingWeeks().length) loadAll();
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

  C.pullToRefresh(async () => {
    for (const w of pendingWeeks()) await saveDraft(w);
    location.reload();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => { /* sin modo offline */ });
  }
})();
