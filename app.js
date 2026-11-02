'use strict';

(function () {
  const { ROUTINES, ROUTINE_ORDER, PHASES, MEALS, NUTRITION_TIPS, planId, person: PERSON, schedule: PLAN_SCHEDULE, kcal: PLAN_KCAL, pain: PAIN } = window.DATA;
  const FOODS = window.FOODS || [];
  // Los datos locales van por plan (Paola conserva su clave de siempre). La sesión de Supabase es una sola por teléfono:
  // así, al entrar por primera vez, la app puede cambiar al plan de la persona sin pedir la contraseña de nuevo.
  const KEY = planId === 'paola' ? 'plan-paola-v1' : `plan-${planId}-v1`;
  document.title = `Plan ${PERSON}`;
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', `Plan ${PERSON}`);
  const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const DOW_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ---------- Fechas (hora local, formato AAAA-MM-DD) ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const dowIdx = s => (parse(s).getDay() + 6) % 7;
  const mondayOf = s => addDays(s, -dowIdx(s));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmtDay = s => { const d = parse(s); return `${DOW_LONG[dowIdx(s)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const fmtShort = s => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const nf = (n, max = 1) => Number(n).toLocaleString('es-CL', { maximumFractionDigits: max });
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const fmtRest = r => `${Math.round(r[0] / 60)}–${Math.round(r[1] / 60)} min`;
  const fmtClock = sec => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Estado ----------
  function defaults() {
    return {
      v: 1,
      settings: { startDate: mondayOf(today()), upperDay: PLAN_SCHEDULE.flex ? PLAN_SCHEDULE.flex.defaultId : '', coachName: 'Franco', coachPin: '', kcal: Object.assign({}, PLAN_KCAL.defaults), hideInstall: false },
      swaps: {}, sessions: [], active: null, checkins: {}, food: {}, measures: [], sent: {},
      plan: {}, dirty: {}, deletes: [], syncedUser: null, myFoods: [], recentFoods: []
    };
  }
  function hydrate(s) {
    const d = defaults();
    return Object.assign(d, s, {
      settings: Object.assign(d.settings, s.settings || {}, { kcal: Object.assign(d.settings.kcal, (s.settings && s.settings.kcal) || {}) })
    });
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return hydrate(JSON.parse(raw));
    } catch (e) { /* sin almacenamiento: se parte de cero */ }
    return defaults();
  }
  let S = load();
  let saveWarned = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { if (!saveWarned) { toast('No se pudo guardar en este teléfono'); saveWarned = true; } }
  }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* opcional */ }

  let coachUnlocked = false;

  // ---------- Conexión con la app de coach (Supabase) ----------
  // Sin url ni anonKey en config.js, la app funciona solo en el teléfono, como antes.
  const CFG = window.PLAN_CONFIG || {};
  const sb = CFG.url && CFG.anonKey && window.supabase
    ? window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'plan-paola-auth' } })
    : null;
  let user = null;
  let authReady = !sb;
  let notLinked = false;
  const syncInfo = { state: 'idle', at: null, error: '' };
  S.dirty = S.dirty || {};
  S.deletes = S.deletes || [];
  S.plan = S.plan || {};
  S.myFoods = S.myFoods || [];
  S.recentFoods = S.recentFoods || [];

  function recordData(kind, key) {
    if (kind === 'session') return S.sessions.find(x => x.id === key) || null;
    if (kind === 'checkin') return S.checkins[key] || null;
    if (kind === 'food') return S.food[key] || null;
    if (kind === 'measure') return S.measures.find(m => m.id === key) || null;
    if (kind === 'customfood') return S.myFoods.find(f => f.id === key) || null;
    return null;
  }
  let pushTimer = null;
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => { push(); }, 1500); }
  function markDirty(kind, key) {
    if (!sb) return;
    (S.dirty[kind] = S.dirty[kind] || {})[key] = true;
    save(); schedulePush();
  }
  function markDeleted(kind, key) {
    if (!sb) return;
    if (S.dirty[kind]) delete S.dirty[kind][key];
    S.deletes.push({ kind, key });
    save(); schedulePush();
  }
  function markAllDirty() {
    if (!sb) return;
    S.dirty = { session: {}, checkin: {}, food: {}, measure: {}, customfood: {} };
    S.sessions.forEach(x => { S.dirty.session[x.id] = true; });
    Object.keys(S.checkins).forEach(d => { S.dirty.checkin[d] = true; });
    Object.keys(S.food).forEach(d => { S.dirty.food[d] = true; });
    S.measures.forEach(m => { S.dirty.measure[m.id] = true; });
    S.myFoods.forEach(f => { S.dirty.customfood[f.id] = true; });
    save();
  }
  const pendingCount = () => Object.values(S.dirty).reduce((a, k) => a + Object.keys(k).length, 0) + S.deletes.length;

  // Sube lo pendiente. Si algo cambió mientras se subía, queda marcado para la próxima vez.
  async function push() {
    if (!sb || !user || notLinked) return;
    const rows = [], sent = [];
    Object.entries(S.dirty).forEach(([kind, keys]) => Object.keys(keys).forEach(key => {
      const data = recordData(kind, key);
      if (data) rows.push({ athlete_id: user.id, kind, key, data, updated_at: new Date().toISOString() });
      sent.push([kind, key, JSON.stringify(data)]);
    }));
    const deletes = S.deletes.slice();
    if (!rows.length && !deletes.length) return;
    try {
      if (rows.length) { const { error } = await sb.from('records').upsert(rows); if (error) throw error; }
      for (const d of deletes) {
        const { error } = await sb.from('records').delete().match({ athlete_id: user.id, kind: d.kind, key: d.key });
        if (error) throw error;
      }
      sent.forEach(([kind, key, snap]) => { if (S.dirty[kind] && JSON.stringify(recordData(kind, key)) === snap) delete S.dirty[kind][key]; });
      S.deletes = S.deletes.slice(deletes.length);
      save();
      Object.assign(syncInfo, { state: 'ok', at: Date.now(), error: '' });
    } catch (e) {
      Object.assign(syncInfo, { state: navigator.onLine ? 'error' : 'offline', error: e.message || String(e) });
    }
  }

  // Baja ajustes y semanas enviadas por el coach. En un teléfono vacío, recupera todo lo registrado.
  async function pull() {
    const { data: ath, error } = await sb.from('athletes').select('name, settings').eq('id', user.id).maybeSingle();
    if (error) throw error;
    notLinked = !ath;
    if (!ath) return;
    const rs = ath.settings || {};
    // Si la ficha dice que el plan es otro, se recuerda y se recarga con el plan correcto.
    if (rs.plan && rs.plan !== planId && window.DATA.switchPlan(rs.plan)) return;
    ['startDate', 'upperDay', 'coachName'].forEach(k => { if (rs[k]) S.settings[k] = rs[k]; });
    if (rs.kcal) S.settings.kcal = Object.assign({}, S.settings.kcal, rs.kcal);
    if (rs.swaps) S.swaps = Object.assign({}, rs.swaps);
    const { data: weeks, error: e2 } = await sb.from('plan_weeks').select('week, published, published_at').not('published_at', 'is', null);
    if (e2) throw e2;
    S.plan = {};
    (weeks || []).forEach(w => { S.plan[w.week] = Object.assign({}, w.published, { publishedAt: w.published_at }); });
    if (!S.sessions.length && !Object.keys(S.checkins).length) {
      const { data: recs, error: e3 } = await sb.from('records').select('kind, key, data');
      if (e3) throw e3;
      (recs || []).forEach(r => {
        if (r.kind === 'session') S.sessions.push(r.data);
        else if (r.kind === 'checkin') S.checkins[r.key] = r.data;
        else if (r.kind === 'food') S.food[r.key] = r.data;
        else if (r.kind === 'measure') S.measures.push(r.data);
        else if (r.kind === 'customfood' && !S.myFoods.some(f => f.id === r.key)) S.myFoods.push(r.data);
      });
    }
    save();
  }

  let syncing = false;
  async function sync() {
    if (!sb || !user || syncing) return;
    if (!navigator.onLine) { syncInfo.state = 'offline'; return; }
    syncing = true;
    syncInfo.state = 'syncing';
    try {
      await pull();
      await push();
      if (syncInfo.state === 'syncing') Object.assign(syncInfo, { state: 'ok', at: Date.now(), error: '' });
    } catch (e) {
      Object.assign(syncInfo, { state: navigator.onLine ? 'error' : 'offline', error: e.message || String(e) });
    }
    syncing = false;
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (!typing) render();
  }

  async function initAuth() {
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      user = data && data.session ? data.session.user : null;
    } catch (e) { user = null; }
    sb.auth.onAuthStateChange((_ev, session) => { user = session ? session.user : null; });
    authReady = true;
    render();
    if (user) sync();
  }

  // ---------- Bloque, fase y metas ----------
  const block = (date = today()) => CORE.blockFor(S.settings.startDate, date);
  function targets(date) {
    const b = block(date);
    const kcal = Number(S.settings.kcal[b.info.kcalKey]) || PLAN_KCAL.defaults[b.info.kcalKey] || 1800;
    const { p, g } = b.info.macros;
    return { kcal, p, g, c: Math.max(0, Math.round((kcal - p * 4 - g * 9) / 4)), steps: b.info.steps || 8000, phase: b.phase };
  }
  // Indicación del coach para un ejercicio en una semana: { kg, rir: "2-1", note }, si la envió.
  const presFor = (week, exId) => (S.plan[week] && S.plan[week].exercises && S.plan[week].exercises[exId]) || null;
  const rirFor = (week, i, scheme) => CORE.rirForSet(scheme, week, i);
  const rirLabel = (week, n, scheme) => CORE.rirList(scheme, week, n).join(' · ');

  function resolveEx(ex, alt) {
    if (alt && ex.shoulder) {
      return Object.assign({}, ex, ex.shoulder, { id: ex.id, alt: true, histKey: (ex.shoulder.history || ex.history || ex.id) + ':alt' });
    }
    return Object.assign({}, ex, { alt: false, histKey: ex.history || ex.id });
  }
  const isBodyweight = rx => !rx.inc;

  const schedule = () => CORE.scheduleFor(S.settings.upperDay);
  const sortedSessions = () => S.sessions.slice().sort((a, b) => a.finishedAt - b.finishedAt);
  function weekSessions(monday) {
    const end = addDays(monday, 6);
    return sortedSessions().filter(s => s.date >= monday && s.date <= end);
  }
  function nextRoutine(monday) {
    const done = new Set(weekSessions(monday).map(s => s.routine));
    return ROUTINE_ORDER.find(r => !done.has(r)) || null;
  }
  function lastPerf(histKey, before) {
    const list = sortedSessions().filter(s => before == null || s.finishedAt < before);
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      for (const e of Object.values(s.ex)) {
        if (e.histKey === histKey && e.sets.length) return { date: s.date, week: s.week, sets: e.sets };
      }
    }
    return null;
  }
  const setText = (rx, s) => {
    if (rx.type === 'time') return `${s.reps} s`;
    const kg = num(s.kg);
    return kg ? `${nf(kg, 2)} kg × ${s.reps}` : `${s.reps} reps`;
  };
  const setsText = (rx, sets) => {
    if (!sets.length) return '—';
    const kgs = sets.map(s => num(s.kg) || 0);
    if (rx.type !== 'time' && kgs.every(k => k === kgs[0]) && kgs[0]) return `${nf(kgs[0], 2)} kg × ${sets.map(s => s.reps).join(' · ')}`;
    return sets.map(s => setText(rx, s)).join(' · ');
  };
  function suggestion(rx, last, week) {
    const rir = rirFor(week, 0);
    if (rx.type === 'time') {
      return last ? { text: 'Hoy: intenta sumar 5–10 segundos.' } : { text: 'Mantener la posición el máximo tiempo con buena técnica.' };
    }
    const range = `${rx.reps[0]}–${rx.reps[1]}`;
    if (!last) {
      return { text: isBodyweight(rx) ? `Primera vez: apunta a ${range} repeticiones con buena técnica.` : `Primera vez: elige un peso con el que llegues a ${range} repeticiones dejando ${rir} en reserva.` };
    }
    const top = rx.reps[1];
    const allTop = last.sets.length >= rx.sets && last.sets.every(s => (num(s.reps) || 0) >= top);
    const kg = num(last.sets[0].kg) || 0;
    if (!kg || isBodyweight(rx)) {
      return { text: allTop ? `Llegaste a ${top}. Hoy hazlo más lento y controlado.` : 'Hoy: sumar 1 repetición en cada serie.' };
    }
    if (allTop) {
      const nk = Math.round((kg + rx.inc) * 100) / 100;
      return { kg: nk, text: `Hoy: subir a ${nf(nk, 2)} kg${rx.incLabel ? ' ' + rx.incLabel : ''} y volver a ${rx.reps[0]} reps.` };
    }
    return { kg, text: `Hoy: repetir ${nf(kg, 2)} kg e intentar sumar repeticiones.` };
  }

  // ---------- Check-in ----------
  function dayComplete(c) {
    return !!(c && c.pasos !== undefined && c.pasos !== '' && c.sleepH !== undefined && c.sleepH !== '' && c.adh);
  }
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  function weekStats(monday) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const cs = days.map(d => S.checkins[d]).filter(Boolean);
    const pick = f => cs.map(f).filter(v => v !== null && v !== undefined && Number.isFinite(v));
    const peso = avg(pick(c => (c.noPeso ? null : num(c.peso))));
    const prevCs = Array.from({ length: 7 }, (_, i) => S.checkins[addDays(monday, i - 7)]).filter(Boolean);
    const prevPeso = avg(prevCs.map(c => (c.noPeso ? null : num(c.peso))).filter(v => v !== null));
    const sleepMin = pick(c => (c.sleepH === '' || c.sleepH === undefined ? null : (num(c.sleepH) || 0) * 60 + (num(c.sleepM) || 0)));
    return {
      days, registered: days.filter(d => dayComplete(S.checkins[d])).length,
      peso, pesoDelta: peso !== null && prevPeso !== null ? peso - prevPeso : null,
      pasos: avg(pick(c => num(c.pasos))),
      sleep: avg(sleepMin), sleepQ: avg(pick(c => num(c.sleepQ))),
      adh: avg(pick(c => num(c.adh))),
      hombro: avg(pick(c => num(c.hombro))),
      sessions: weekSessions(monday)
    };
  }
  const fmtSleep = min => (min == null ? '—' : `${Math.floor(min / 60)} h ${pad(Math.round(min % 60))} min`);
  const ENERGY = { baja: 'Baja', promedio: 'Promedio', alta: 'Alta' };

  function weekSummaryText(monday) {
    const b = block(monday);
    const st = weekStats(monday);
    const L = [];
    L.push(`Resumen semanal de ${PERSON} · ${fmtShort(monday)} al ${fmtShort(addDays(monday, 6))}`);
    L.push(`${b.info.name}${b.weekIn ? ` · semana ${b.weekIn}${b.weeksTotal ? ' de ' + b.weeksTotal : ''}` : ''}`);
    L.push('');
    L.push('NÚMEROS');
    L.push(`Peso promedio: ${st.peso !== null ? nf(st.peso, 2) + ' kg' : 'sin datos'}${st.pesoDelta !== null ? ` (${st.pesoDelta >= 0 ? '+' : ''}${nf(st.pesoDelta, 2)} kg vs semana anterior)` : ''}`);
    L.push(`Pasos promedio: ${st.pasos !== null ? nf(st.pasos, 0) : 'sin datos'}`);
    L.push(`Sueño promedio: ${fmtSleep(st.sleep)}${st.sleepQ !== null ? ` · calidad ${nf(st.sleepQ, 1)}/5` : ''}`);
    L.push(`Días registrados: ${st.registered}/7`);
    L.push(`Adherencia a la dieta: ${st.adh !== null ? nf(st.adh, 1) + '/10' : 'sin datos'}`);
    L.push(`Dolor de hombro promedio: ${st.hombro !== null ? nf(st.hombro, 1) + '/10' : 'sin datos'}`);
    L.push(`Entrenamientos: ${st.sessions.length} (${st.sessions.map(s => ROUTINES[s.routine].name).join(', ') || 'ninguno'})`);
    L.push('');
    L.push('DÍA A DÍA');
    st.days.forEach(d => {
      if (d > today()) return;
      const c = S.checkins[d];
      if (!c) { L.push(`${DOW[dowIdx(d)]} ${parse(d).getDate()}: sin registro`); return; }
      const parts = [];
      if (c.noPeso) parts.push('no se pesó'); else if (num(c.peso)) parts.push(`${nf(num(c.peso), 2)} kg`);
      if (num(c.pasos) !== null) parts.push(`${nf(num(c.pasos), 0)} pasos`);
      if (c.sleepH !== undefined && c.sleepH !== '') parts.push(`sueño ${c.sleepH} h ${pad(num(c.sleepM) || 0)}${c.sleepQ ? ` (${c.sleepQ}/5)` : ''}`);
      if (c.adh) parts.push(`dieta ${c.adh}/10`);
      if (c.hombro !== undefined && c.hombro !== '') parts.push(`hombro ${c.hombro}/10`);
      if (c.energy) parts.push(`energía ${ENERGY[c.energy].toLowerCase()}`);
      L.push(`${DOW[dowIdx(d)]} ${parse(d).getDate()}: ${parts.join(' · ')}`);
      if (c.nota) L.push(`   Nota: ${c.nota}`);
    });
    if (st.sessions.length) {
      L.push('');
      L.push('ENTRENAMIENTOS');
      st.sessions.forEach(s => {
        L.push(`${ROUTINES[s.routine].name} · ${fmtDay(s.date)} · ${s.minutes} min · dificultad ${s.difficulty || '—'}/5 · hombro ${s.shoulder != null ? s.shoulder : '—'}/10`);
        ROUTINES[s.routine].exercises.forEach(ex => {
          const e = s.ex[ex.id];
          if (!e || !e.sets.length) return;
          const rx = resolveEx(ex, e.alt);
          L.push(` · ${e.name}${e.alt ? ' (variante hombro)' : ''}: ${setsText(rx, e.sets)}`);
          if (e.note) L.push(`   Mensaje: ${e.note}`);
        });
      });
    }
    return L.join('\n');
  }

  // ---------- Utilidades de interfaz ----------
  let toastTimer;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
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

  async function shareText(text, title) {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Copiado. Pégalo en WhatsApp.'); return; }
    catch (e) { /* se muestra el texto para copiarlo a mano */ }
    openSheet(`<h2>${esc(title)}</h2><p class="muted small">Mantén presionado el texto, selecciona todo y cópialo.</p><textarea readonly rows="14">${esc(text)}</textarea><button class="btn block ghost" data-a="close">Cerrar</button>`);
  }

  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function beep() {
    if (!actx) return;
    try {
      [0, 0.25, 0.5].forEach(t => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, actx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.18);
        o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.2);
      });
    } catch (e) { /* sin sonido */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  // ---------- Íconos de la barra ----------
  const ICONS = {
    entrenar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
    nutricion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="7"/><path d="M12 6c0-2 1-3 3-3"/></svg>',
    checkin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8.5 13l2.5 2.5 4.5-5"/></svg>',
    mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'
  };

  // ---------- Vistas ----------
  function phasePill(date) {
    const b = block(date);
    const label = b.phase === 'pre' ? 'Parte pronto' : `${b.info.short}${b.weekIn ? ' · sem ' + b.weekIn : ''}`;
    return `<span class="phase-pill ${b.phase === 'cut' ? 'cut' : ''}">${esc(label)}</span>`;
  }

  function viewEntrenar() {
    const t = today();
    const monday = mondayOf(t);
    const b = block(t);
    const map = schedule();
    const done = {};
    weekSessions(monday).forEach(s => { done[s.routine] = s; });
    const parts = [];

    if (!isStandalone() && !S.settings.hideInstall) {
      parts.push(`<div class="notice"><div><b>Instálala en el iPhone.</b> En Safari toca Compartir y luego «Agregar a inicio». <a class="linkbtn" href="#/instalar">Ver pasos</a></div><button class="x" data-a="hide-install" aria-label="Cerrar aviso">×</button></div>`);
    }

    const totalWeeks = CORE.totalWeeks;
    const pct = b.phase === 'pre' ? 0 : Math.min(100, Math.round((Math.min(b.week, totalWeeks) / totalWeeks) * 100));
    const strip = DOW.map((d, i) => {
      const date = addDays(monday, i);
      const r = map[i];
      const rr = r && ROUTINES[r];
      const cls = ['wd', rr ? rr.kind : '', rr && rr.optional ? 'opt' : '', date === t ? 'today' : '', r && done[r] ? 'done' : ''].join(' ');
      const inner = `<span class="d">${d}</span><span class="s">${rr ? rr.name.replace(' ', '<br>') : '·'}</span><span class="m">${r && done[r] ? '✓' : ''}</span>`;
      return rr ? `<a class="${cls}" href="#/workout/${r}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
    }).join('');
    const weekLine = b.phase === 'pre'
      ? `Parte el ${fmtDay(S.settings.startDate)}`
      : `${b.weekIn ? `Semana ${b.weekIn}${b.weeksTotal ? ' de ' + b.weeksTotal : ''}` : ''} · semana ${b.week} del plan`;
    parts.push(`<section class="card block-card">
      <div class="card-head"><span class="eyebrow">Bloque activo</span><span class="small muted num">${esc(weekLine)}</span></div>
      <h2>${esc(b.info.name)}</h2>
      <div class="progress" aria-label="Avance del plan"><span style="width:${pct}%"></span></div>
      <div class="weekstrip">${strip}</div>
    </section>`);

    const wkPlan = S.plan[b.week];
    if (wkPlan && wkPlan.note) parts.push(`<div class="notice ok"><div><b>${esc(S.settings.coachName)} · semana ${b.week}:</b> ${esc(wkPlan.note)}</div></div>`);

    if (!dayComplete(S.checkins[t])) {
      parts.push(`<a class="notice" href="#/checkin/${t}" style="text-decoration:none"><div><b>Registro de hoy pendiente.</b> Pasos, sueño y dieta. Toma menos de un minuto.</div></a>`);
    }

    if (S.active) {
      const r = ROUTINES[S.active.routine];
      parts.push(`<section class="card next ${r.kind}"><span class="eyebrow">En curso</span><span class="rname">${r.name}</span>
        <p class="muted small">Empezaste a las ${new Date(S.active.startedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}.</p>
        <a class="btn block ${r.kind}" href="#/workout/${r.id}">Continuar entrenamiento</a></section>`);
    } else {
      const nr = nextRoutine(monday);
      if (nr) {
        const r = ROUTINES[nr];
        parts.push(`<section class="card next ${r.kind}"><span class="eyebrow">Próximo${r.optional ? ' · optativo' : ''}</span><span class="rname">${r.name}</span>
          <p class="muted small">${esc(r.day)} · ≈${r.minutes} min · ${r.exercises.length} ejercicios</p>
          <a class="btn block ${r.kind}" href="#/workout/${r.id}">Ver y comenzar</a></section>`);
      } else {
        parts.push(`<div class="notice ok"><div><b>Semana completa.</b> Hiciste las cuatro sesiones. Descanso y a caminar.</div></div>`);
      }
    }

    const rows = ROUTINE_ORDER.map(rid => {
      const r = ROUTINES[rid];
      const s = done[rid];
      const status = s ? `<span class="tag ok">Hecho</span>` : `<span class="tag ${r.optional ? 'line' : 'warn'}">${r.optional ? 'Optativo' : 'Pendiente'}</span>`;
      const sub = s ? `${fmtDay(s.date)} · ${s.minutes} min · ${Object.values(s.ex).reduce((a, e) => a + e.sets.length, 0)} series` : esc(r.day);
      return `<a class="li" href="${s ? '#/session/' + s.id : '#/workout/' + rid}"><span class="tag ${r.kind}">${r.name}</span><span class="grow"><span class="s">${sub}</span></span>${status}</a>`;
    }).join('');
    parts.push(`<section class="card flush"><div style="padding:14px 16px 4px" class="card-head"><h3>Esta semana</h3><a class="linkbtn" href="#/historial">Historial</a></div><div class="list">${rows}</div></section>`);
    return { title: 'Entrenamiento', html: parts.join(''), pill: phasePill(t) };
  }

  function exNumbering(r) {
    const labels = {};
    let n = 0;
    r.exercises.forEach(ex => {
      if (ex.supersetOf) { labels[ex.id] = labels[ex.supersetOf].replace('a', '') + 'b'; return; }
      n += 1;
      labels[ex.id] = ex.superset ? `${n}a` : String(n);
    });
    return labels;
  }

  // Tempo de todas las series: 2 s bajando, 1 s de pausa, subida explosiva controlada, 1 s arriba.
  const TEMPO = '2-1-X-1';
  const INFO = {
    rir: ['RIR: repeticiones en reserva', 'Cuántas repeticiones te quedarían con buena técnica al terminar la serie. RIR 2 = paras cuando todavía podrías hacer 2 más. RIR 0 = hasta que no sale otra con buena técnica. «2-1» significa: primera serie a RIR 2 y las demás a RIR 1.'],
    tempo: ['Tempo ' + TEMPO, 'Bajas el peso en 2 segundos, haces 1 segundo de pausa abajo, subes rápido pero controlado (la X) y aguantas 1 segundo arriba.'],
    approach: ['Series de aproximación', 'Son series livianas antes de las de trabajo, para calentar el músculo y practicar el movimiento. Por ejemplo, ≈50 % del peso × 10 y ≈75 % × 5. No deben cansarte y no cuentan como series de trabajo. Si quieres, anótalas con el botón «Aproximación».']
  };
  const getSetup = key => {
    if (S.setups && S.setups[key] !== undefined) return S.setups[key];
    for (let i = S.sessions.length - 1; i >= 0; i--) {
      const e = Object.values(S.sessions[i].ex).find(x => x.histKey === key && x.setup);
      if (e) return e.setup;
    }
    return '';
  };
  const videoUrl = rx => rx.video || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(rx.name + ' técnica');
  const rirTxt = r => (r === '' || r === undefined || r === null ? '' : ` · RIR ${r}`);

  // Deja la entrada del ejercicio en curso con series registradas una a una (las versiones antiguas guardaban filas fijas).
  function normEntry(e) {
    if (e.sets.some(x => 'done' in x)) e.sets = e.sets.filter(x => x.done).map(x => ({ kg: x.kg, reps: x.reps, rir: '' }));
    e.warm = e.warm || [];
    e.draft = e.draft || {};
    return e;
  }

  function exerciseCard(r, ex, label, opts) {
    const { active, week, before } = opts;
    const entry = active ? normEntry(S.active.ex[ex.id]) : null;
    const pres = presFor(week, ex.id);
    const rx = resolveEx(ex, entry ? entry.alt : !!S.swaps[ex.id]);
    rx.sets = CORE.presSets(pres, rx);
    const last = lastPerf(rx.histKey, before);
    const scheme = pres && pres.rir;
    const presKg = CORE.presKgAt(pres, 0);
    const sug = presKg !== null ? { kg: presKg, text: `Indicada por ${S.settings.coachName}` } : suggestion(rx, last, week);
    const repsChip = rx.type === 'time' ? 'máx. s' : `${rx.reps[0]}–${rx.reps[1]}`;
    const partner = ex.superset ? r.exercises.find(e => e.id === ex.superset) : null;
    const withKg = rx.type !== 'time' && !isBodyweight(rx);
    const parts = [];

    parts.push(`<div class="ex-top"><span class="ex-n">${label}</span><div class="stack" style="gap:2px;min-width:0;flex:1">
      <span class="ex-name">${esc(rx.name)}${ex.superset || ex.supersetOf ? ' <span class="superset-flag">Superserie</span>' : ''}</span>
      <span class="ex-sub">${esc(rx.group)}${rx.perSide ? ' · cada lado' : ''}</span></div>
      <a class="vidbtn" href="${esc(videoUrl(rx))}" target="_blank" rel="noopener">Ver video</a></div>`);
    if (rx.alt) parts.push(`<span class="alt-flag">Variante para el hombro (en vez de ${esc(ex.name.toLowerCase())})</span>`);
    parts.push(`<div class="chips">
      <div class="chip"><span class="k">Series</span><span class="v">${rx.sets}</span></div>
      <div class="chip"><span class="k">Reps</span><span class="v">${repsChip}</span></div>
      <button class="chip hl" data-a="info" data-k="rir"><span class="k">RIR <i class="ib">i</i></span><span class="v">${rx.type === 'time' ? '—' : esc(scheme || CORE.defaultScheme(week))}</span></button>
      <div class="chip"><span class="k">Desc.</span><span class="v">${partner ? '0 → b' : fmtRest(rx.rest)}</span></div></div>`);
    if (rx.type !== 'time') parts.push(`<button class="tempo" data-a="info" data-k="tempo"><span class="k">Tempo</span><span class="v">${TEMPO} <i class="ib">i</i></span></button>`);
    parts.push(`<div class="setup"><label class="k" for="setup-${ex.id}">📌 Tu setup</label>
      <input class="inp" id="setup-${ex.id}" data-setup="${esc(rx.histKey)}" value="${esc(getSetup(rx.histKey))}" placeholder="Banco, máquina, agarre…" autocomplete="off">
      <span class="small muted">Se guarda para tu próxima sesión</span></div>`);
    if (rx.note) parts.push(`<p class="ex-note">${esc(rx.note)}</p>`);
    if (pres && pres.note) parts.push(`<p class="coach-note"><b>${esc(S.settings.coachName)}:</b> ${esc(pres.note)}</p>`);

    // Rendimiento anterior
    parts.push(`<div class="blk"><div class="blk-head"><b>Rendimiento anterior</b>${last ? `<button class="pillbtn" data-a="history" data-k="${esc(rx.histKey)}" data-n="${esc(rx.name)}">Semanas anteriores</button>` : ''}</div>
      ${last ? `<span class="small muted">Semana ${last.week || '—'} · ${esc(fmtDay(last.date))}</span>
        <div class="setchips">${last.sets.map((x, i) => `<span class="sc">Serie ${i + 1} · <b>${esc(setText(rx, x))}</b>${esc(rirTxt(x.rir))}</span>`).join('')}</div>`
      : '<span class="small muted">Todavía no hay registros de este ejercicio.</span>'}</div>`);

    // Carga de hoy, serie por serie
    const done = entry ? entry.sets.length : 0;
    const kgFor = i => { const v = CORE.presKgAt(pres, i) !== null ? CORE.presKgAt(pres, i) : sug.kg; return v ? nf(v, 2) + ' kg' : ''; };
    parts.push(`<div class="blk"><b>Carga de hoy</b><span class="sug">${esc(sug.text)}</span>
      ${rx.approach ? `<div class="row" style="justify-content:space-between"><span class="small muted">${rx.approach === 1 ? '1 serie' : '1–' + rx.approach + ' series'} de aproximación sin fatigar</span><button class="pillbtn" data-a="info" data-k="approach">¿Qué son?</button></div>` : ''}
      <div class="setchips">${Array.from({ length: rx.sets }, (_, i) => {
        const st = !active ? '' : (i < done ? 'done' : (i === done ? 'now' : 'next'));
        const rir = rx.type === 'time' ? 'máx.' : 'RIR ' + rirFor(week, i, scheme);
        return `<span class="sc pres ${st}">Serie ${i + 1}${kgFor(i) ? ' · <b>' + kgFor(i) + '</b>' : ''} · ${rir}</span>`;
      }).join('')}</div></div>`);

    if (active) {
      if (entry.sets.length || entry.warm.length) {
        const best = entry.sets.reduce((bst, x) => { const k = num(x.kg) || 0, n = num(x.reps) || 0; return !bst || k > bst.k || (k === bst.k && n > bst.n) ? { k, n, x } : bst; }, null);
        const maxKg = Math.max(0, ...entry.sets.map(x => num(x.kg) || 0));
        parts.push(`<div class="blk"><b class="eyebrow">Series registradas (hoy)</b>
          ${entry.warm.map((x, i) => `<button class="logged warm" data-a="edit-set" data-ex="${ex.id}" data-kind="warm" data-i="${i}"><span>Aprox. ${i + 1} · <b>${esc(setText(rx, x))}</b></span><span class="ed">Editar</span></button>`).join('')}
          ${entry.sets.map((x, i) => `<button class="logged" data-a="edit-set" data-ex="${ex.id}" data-kind="work" data-i="${i}"><span>Serie ${i + 1} · <b>${esc(setText(rx, x))}</b>${esc(rirTxt(x.rir))}</span><span class="ed">Editar</span></button>`).join('')}
          ${entry.sets.length ? `<p class="small muted">${entry.sets.length} ${entry.sets.length === 1 ? 'serie' : 'series'}${withKg && maxKg ? ` · ${nf(maxKg, 2)} kg máx` : ''}${best && best.n ? ` · Mejor: ${esc(setText(rx, best.x))}` : ''}</p>` : ''}</div>`);
      }
      const complete = entry.sets.length >= rx.sets && !entry.more;
      if (complete) {
        parts.push(`<div class="complete">✓ Series completas <button class="linkbtn" data-a="more-set" data-ex="${ex.id}">Agregar otra serie</button></div>`);
      } else {
        const n = entry.sets.length;
        const d = entry.draft;
        const presN = CORE.presKgAt(pres, n);
        const kgVal = d.kg !== undefined ? d.kg : (presN !== null ? String(presN) : (n ? entry.sets[n - 1].kg : (sug.kg ? String(sug.kg) : '')));
        const fields = [];
        if (withKg) fields.push(`<label class="field"><input inputmode="decimal" autocomplete="off" id="dkg-${ex.id}" data-draft="${ex.id}:kg" value="${esc(String(kgVal).replace('.', ','))}" placeholder="kg" aria-label="Kilos"><span class="u">kg</span></label>`);
        fields.push(`<label class="field"><input inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="dreps-${ex.id}" data-draft="${ex.id}:reps" value="${esc(d.reps || '')}" placeholder="${rx.type === 'time' ? 'seg' : 'Reps'}" aria-label="${rx.type === 'time' ? 'Segundos' : 'Repeticiones'}">${rx.type === 'time' ? '<span class="u">s</span>' : ''}</label>`);
        if (rx.type !== 'time') fields.push(`<label class="field"><input inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="drir-${ex.id}" data-draft="${ex.id}:rir" value="${esc(d.rir || '')}" placeholder="RIR ${rirFor(week, Math.min(n, rx.sets - 1), scheme)}" aria-label="RIR real"></label>`);
        parts.push(`<div class="entry"><b class="eyebrow">${n < rx.sets ? `Serie ${n + 1} de ${rx.sets}` : 'Serie extra'}</b>
          <div class="entry-fields f${fields.length}">${fields.join('')}</div>
          <div class="entry-btns">${rx.approach || withKg ? `<button class="btn warmbtn" data-a="reg-set" data-ex="${ex.id}" data-kind="warm">Aproximación</button>` : ''}<button class="btn ${r.kind}" data-a="reg-set" data-ex="${ex.id}" data-kind="work">Registrar serie</button></div></div>`);
      }
      parts.push(`<div class="blk"><label class="eyebrow" for="note-${ex.id}">Mensaje a ${esc(S.settings.coachName)}</label>
        <textarea id="note-${ex.id}" data-note="${ex.id}" placeholder="¿Algo que reportar? Molestias, sensaciones, dudas sobre el ejercicio…">${esc(entry.note)}</textarea>
        <span class="small muted">${esc(S.settings.coachName)} lo verá al revisar esta sesión</span></div>`);
      parts.push(`<button class="sharerow" data-a="share-ex" data-ex="${ex.id}">Compartir ejercicio <span aria-hidden="true">↗</span></button>`);
    }
    return `<article class="card ex-card ${r.kind}" id="card-${ex.id}">${parts.join('')}</article>`;
  }

  function viewWorkout(rid) {
    const r = ROUTINES[rid];
    if (!r) return viewNotFound();
    const active = S.active && S.active.routine === rid;
    const week = active ? S.active.week : block().week;
    const labels = exNumbering(r);
    const parts = [];
    const rxs = r.exercises.map(ex => { const x = resolveEx(ex, active ? S.active.ex[ex.id].alt : !!S.swaps[ex.id]); x.sets = CORE.presSets(presFor(week, ex.id), x); return x; });
    const totalSets = rxs.reduce((a, x) => a + x.sets, 0);
    const groups = {};
    rxs.forEach(x => { groups[x.group] = (groups[x.group] || 0) + x.sets; });
    const groupsTxt = Object.entries(groups).map(([g, n]) => `${g} ${n}`).join(' · ');
    if (active) {
      const st = new Date(S.active.startedAt);
      const doneSets = Object.values(S.active.ex).reduce((a, e) => a + normEntry(e).sets.length, 0);
      parts.push(`<section class="card session-head ${r.kind}"><span class="eyebrow live">En curso</span><span class="rname">${r.name}</span>
        <span class="muted">Semana ${week} · ${esc(fmtDay(S.active.date))} · ${st.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
        <b>${r.exercises.length} ejercicios · ${doneSets} de ${totalSets} series</b><span class="small muted">${esc(groupsTxt)}</span></section>`);
    } else {
      parts.push(`<div class="wk-head ${r.kind}"><span class="eyebrow">${esc(r.day)} · ≈${r.minutes} min</span><span class="rname">${r.name}</span>
        <p class="muted small">${r.exercises.length} ejercicios · ${totalSets} series · ${esc(groupsTxt)}</p>
        <p class="muted small">${r.exercises.some(ex => presFor(week, ex.id)) ? `Cargas y RIR indicados por ${esc(S.settings.coachName)} para la semana ${week}.` : (week <= 2 ? 'Semanas 1–2: todas las series a RIR 2, para aprender la técnica.' : 'Primera serie a RIR 2 y las demás a RIR 1.')}</p></div>`);
    }
    if (S.active && !active) {
      const ar = ROUTINES[S.active.routine];
      parts.push(`<div class="notice"><div><b>Tienes ${ar.name} en curso.</b> Termínalo o descártalo antes de empezar otro. <a class="linkbtn" href="#/workout/${ar.id}">Ir a ${ar.name}</a></div></div>`);
    }
    if (!active && !S.active) {
      parts.push(`<button class="btn block ${r.kind}" data-a="start" data-r="${rid}">Comenzar entrenamiento</button>`);
    }
    parts.push(`<p class="small muted">Calentamiento: 5 min de caminata o bici suave antes del primer ejercicio.</p>`);
    r.exercises.forEach(ex => parts.push(exerciseCard(r, ex, labels[ex.id], { active, week })));
    if (active) {
      parts.push(`<button class="btn block ${r.kind}" data-a="finish">Terminar entrenamiento</button>`);
      parts.push(`<button class="btn block danger" data-a="discard">Descartar entrenamiento</button>`);
    } else if (!S.active) {
      parts.push(`<button class="btn block ${r.kind}" data-a="start" data-r="${rid}">Comenzar entrenamiento</button>`);
    }
    return { title: r.name, back: '#/entrenar', html: parts.join(''), pill: phasePill() };
  }

  function viewSession(id) {
    const s = S.sessions.find(x => x.id === id);
    if (!s) return viewNotFound();
    const r = ROUTINES[s.routine];
    const labels = exNumbering(r);
    const parts = [];
    parts.push(`<div class="wk-head ${r.kind}"><span class="eyebrow">${esc(fmtDay(s.date))}</span><span class="rname">${r.name}</span></div>`);
    parts.push(`<div class="stats">
      <div class="stat"><span class="k">Duración</span><span class="v">${s.minutes} min</span></div>
      <div class="stat"><span class="k">Series</span><span class="v">${Object.values(s.ex).reduce((a, e) => a + e.sets.length, 0)}</span></div>
      <div class="stat"><span class="k">Dificultad</span><span class="v">${s.difficulty || '—'}/5</span></div>
      <div class="stat"><span class="k">Hombro</span><span class="v">${s.shoulder != null ? s.shoulder : '—'}/10</span></div></div>`);
    const rows = r.exercises.map(ex => {
      const e = s.ex[ex.id];
      if (!e) return '';
      const rx = resolveEx(ex, e.alt);
      const prev = lastPerf(e.histKey, s.finishedAt);
      return `<div class="li" style="align-items:flex-start"><span class="ex-n" style="color:var(--${r.kind})">${labels[ex.id]}</span><span class="grow">
        <span class="t">${esc(e.name)}${e.alt ? ' <span class="tag warn">hombro</span>' : ''}</span>
        <span class="num">${e.sets.length ? esc(setsText(rx, e.sets)) : 'No registrado'}</span>
        ${e.sets.some(x => x.rir !== undefined && x.rir !== '') ? `<span class="s">RIR real: ${e.sets.map(x => (x.rir === '' || x.rir === undefined ? '—' : x.rir)).join(' · ')}</span>` : ''}
        ${prev ? `<span class="s">Antes (${fmtShort(prev.date)}): ${esc(setsText(rx, prev.sets))}</span>` : ''}
        ${e.note ? `<span class="s">Mensaje: ${esc(e.note)}</span>` : ''}</span></div>`;
    }).join('');
    parts.push(`<section class="card flush"><div class="list">${rows}</div></section>`);
    parts.push(`<button class="btn block ghost" data-a="share-session" data-id="${s.id}">Enviar a ${esc(S.settings.coachName)}</button>`);
    parts.push(`<button class="btn block danger" data-a="delete-session" data-id="${s.id}">Eliminar este entrenamiento</button>`);
    return { title: 'Sesión', back: '#/entrenar', html: parts.join('') };
  }

  function sessionText(s) {
    const r = ROUTINES[s.routine];
    const L = [`${r.name} · ${fmtDay(s.date)} · ${s.minutes} min · dificultad ${s.difficulty || '—'}/5 · hombro ${s.shoulder != null ? s.shoulder : '—'}/10`];
    r.exercises.forEach(ex => {
      const e = s.ex[ex.id];
      if (!e || !e.sets.length) return;
      L.push(`· ${e.name}${e.alt ? ' (variante hombro)' : ''}: ${setsText(resolveEx(ex, e.alt), e.sets)}`);
      if (e.note) L.push(`  Mensaje: ${e.note}`);
    });
    return L.join('\n');
  }

  function viewHistorial() {
    const list = sortedSessions().reverse();
    if (!list.length) {
      return { title: 'Historial', back: '#/entrenar', html: `<section class="card"><h3>Todavía no hay entrenamientos</h3><p class="muted">Cuando termines tu primera sesión aparece aquí, con los pesos y repeticiones de cada serie.</p><a class="btn block lower" href="#/entrenar">Ir a entrenar</a></section>` };
    }
    const groups = {};
    list.forEach(s => { const m = mondayOf(s.date); (groups[m] = groups[m] || []).push(s); });
    const html = Object.keys(groups).sort().reverse().map(m => {
      const b = block(m);
      const rows = groups[m].map(s => {
        const r = ROUTINES[s.routine];
        return `<a class="li" href="#/session/${s.id}"><span class="tag ${r.kind}">${r.name}</span><span class="grow"><span class="s">${fmtDay(s.date)} · ${s.minutes} min</span></span><span class="chev">›</span></a>`;
      }).join('');
      return `<section class="card flush"><div style="padding:14px 16px 4px" class="card-head"><h3>Semana del ${fmtShort(m)}</h3><span class="small muted">${esc(b.info.name)}${b.weekIn ? ' · sem ' + b.weekIn : ''}</span></div><div class="list">${rows}</div></section>`;
    }).join('');
    return { title: 'Historial', back: '#/entrenar', html };
  }

  // ---------- Comidas: plan del día, cambios de alimento y alimentos extra ----------
  const norm = x => String(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const r1 = n => Math.round(n * 10) / 10;
  const fmtM = n => String(n >= 10 ? Math.round(n) : r1(n)).replace('.', ',');
  // Macro que se iguala al cambiar un alimento según su grupo; el resto se iguala por calorías.
  const MATCH = { carbo: 'c', fruta: 'c', proteina: 'p', lacteo: 'p', grasa: 'g' };
  const MATCH_LABEL = { c: 'los carbohidratos', p: 'la proteína', g: 'la grasa', kcal: 'las calorías' };
  const findFood = id => S.myFoods.find(f => f.id === id) || FOODS.find(f => f.id === id) || null;
  const foodByName = n => FOODS.find(f => f.n === n) || S.myFoods.find(f => f.n === n) || null;
  function portion(food, grams) {
    const k = grams / 100;
    return { kcal: Math.round(food.kcal * k), p: r1(food.p * k), g: r1(food.g * k), c: r1(food.c * k) };
  }
  function matchKey(target, food) {
    const key = MATCH[target.cat] || 'kcal';
    return target[key] > 0 && food[key] >= 2 ? key : 'kcal';
  }
  // Gramos del alimento nuevo que igualan al original en su macro principal.
  function eqGrams(target, food) {
    if (!(target.kcal > 0) || !(food.kcal > 0)) return food.u ? food.u[1] : 100;
    const key = matchKey(target, food);
    const g = target[key] / food[key] * 100;
    const step = g < 30 ? 1 : 5;
    return Math.max(1, Math.round(g / step) * step);
  }

  function foodDay(date) {
    const d = S.food[date] = S.food[date] || { on: [], water: 0 };
    d.swaps = d.swaps || {};
    d.extra = d.extra || [];
    return d;
  }
  const mealsFor = (date, day) => CORE.mealsForDay(block(date).phase === 'cut', day);

  function viewNutricion(dateArg) {
    const date = dateArg || today();
    const tg = targets(date);
    const day = S.food[date] || { on: [], water: 0 };
    const meals = mealsFor(date, day);
    const eaten = f => f.extra || day.on.includes(f.id);
    let kcal = 0, prot = 0, fat = 0, carb = 0;
    meals.forEach(m => m.foods.forEach(f => { if (eaten(f)) { kcal += f.kcal; prot += f.p; fat += f.g || 0; carb += f.c || 0; } }));
    [prot, fat, carb] = [prot, fat, carb].map(Math.round);
    const bar = (label, v, goal) => `<div class="bar"><div class="top"><span>${label}</span><b>${v} / ${goal} g</b></div><div class="track"><span style="width:${Math.min(100, v / goal * 100)}%"></span></div></div>`;
    const planKcal = meals.reduce((a, m) => a + m.foods.filter(f => !f.extra).reduce((b, f) => b + f.kcal, 0), 0);
    const C = 2 * Math.PI * 48;
    const frac = Math.min(1, kcal / tg.kcal);
    const label = date === today() ? 'Hoy' : (date === addDays(today(), -1) ? 'Ayer' : fmtDay(date));
    const parts = [];
    parts.push(`<div class="daynav"><button data-a="nut-day" data-d="${addDays(date, -1)}" aria-label="Día anterior">‹</button><span class="dl">${esc(label.charAt(0).toUpperCase() + label.slice(1))}</span><button data-a="nut-day" data-d="${addDays(date, 1)}" aria-label="Día siguiente">›</button></div>`);
    parts.push(`<section class="card">
      <div class="kcal-row">
        <div class="ring"><svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="48" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="56" cy="56" r="48" fill="none" stroke="var(--lower)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
          <div class="c"><b>${nf(kcal, 0)}</b><span>de ${nf(tg.kcal, 0)} kcal</span></div></div>
        <div class="bars">
          ${bar('Proteína', prot, tg.p)}${bar('Grasa', fat, tg.g)}${bar('Carbos', carb, tg.c)}
        </div>
      </div>
      <p class="small muted">Plan del día: ≈${nf(planKcal, 0)} kcal. Marca cada alimento cuando lo comas. Toca su nombre para cambiarlo por otro.</p>
    </section>`);
    parts.push(`<section class="card"><div class="card-head"><h3>Agua</h3><span class="small muted">meta 2 L</span></div>
      <div class="water"><span class="wv">${nf(day.water / 1000, 2)} L</span>
      <button class="btn small ghost" data-a="water" data-v="-250" aria-label="Restar 250 ml">−</button>
      <button class="btn small ghost" data-a="water" data-v="250">+250 ml</button>
      <button class="btn small ghost" data-a="water" data-v="500">+500 ml</button></div></section>`);
    meals.forEach(m => {
      const mk = m.foods.reduce((a, f) => a + f.kcal, 0);
      const foods = m.foods.map(f => {
        const on = eaten(f);
        const tick = f.extra
          ? `<span class="tick on" aria-hidden="true">✓</span>`
          : `<button class="tick" data-a="food" data-id="${f.id}" aria-pressed="${on}" aria-label="Marcar ${esc(f.name)}">✓</button>`;
        const nameEl = f.free || f.extra
          ? `<div class="fname">${esc(f.name)}</div>`
          : `<button class="fname" data-a="swap-food" data-id="${f.id}">${esc(f.name)}</button>`;
        const notes = [
          f.cutPortion && !f.swappedFrom ? '<div class="cut-note">Porción de mini cut</div>' : '',
          f.fixed ? '<div class="fixed-note">Fijo</div>' : '',
          f.swappedFrom ? `<div class="swap-note">En vez de ${esc(f.swappedFrom)} · <button class="linkbtn small" data-a="unswap" data-id="${f.id}">volver al original</button></div>` : '',
          f.extra ? `<div class="swap-note">Agregado · <button class="linkbtn small" data-a="del-extra" data-id="${f.id}">quitar</button></div>` : ''
        ].join('');
        return `<div class="food ${on ? 'on' : ''}">${tick}
          <div style="min-width:0">${nameEl}<div class="fq">${esc(f.qty)}</div>${notes}</div>
          <div class="fk">${f.free ? '<b>libre</b>no se cuenta' : `<b>${f.estimate ? '≈' : ''}${f.kcal}</b>kcal${f.estimate ? '<br>por confirmar' : `<br>P ${fmtM(f.p)} · G ${fmtM(f.g)} · C ${fmtM(f.c)}`}`}</div></div>`;
      }).join('');
      parts.push(`<section class="card flush"><div class="meal-head"><h3>${esc(m.name)}</h3><span class="mk">${mk} kcal</span></div>${foods}
        <button class="addfood" data-a="add-food" data-meal="${m.id}">+ Agregar alimento</button></section>`);
    });
    parts.push(`<section class="card"><h3>Indicaciones</h3><ul class="tips">${NUTRITION_TIPS.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`);
    return { title: 'Nutrición', html: parts.join(''), pill: phasePill(date) };
  }

  // Selector de alimentos (hoja inferior): equivalentes, búsqueda, cantidad y alimentos propios.
  let picker = null;
  const nutDate = () => { const { name, arg } = current(); return (name === 'nutricion' && arg) || today(); };
  function searchFoods(q) {
    const qn = norm(q.trim());
    if (!qn) {
      const recent = S.recentFoods.map(findFood).filter(f => f && !S.myFoods.includes(f));
      return S.myFoods.slice().reverse().concat(recent).slice(0, 15);
    }
    const words = qn.split(/\s+/);
    return S.myFoods.concat(FOODS)
      .filter(f => { const n = norm(f.n); return words.every(w => n.includes(w)); })
      .sort((a, b) => (Number(norm(b.n).startsWith(qn)) - Number(norm(a.n).startsWith(qn))) || a.n.localeCompare(b.n, 'es'))
      .slice(0, 40);
  }
  function fpItem(f) {
    const t = picker.target;
    let right = `<b>${f.kcal}</b>kcal/100 g`;
    if (t) { const g = eqGrams(t, f); right = `<b>${fmtM(g)} g</b>${portion(f, g).kcal} kcal`; }
    const mine = S.myFoods.includes(f);
    return `<button class="fp-item" data-a="fp-pick" data-fid="${esc(f.id)}"><span class="grow"><span class="t">${esc(f.n)}</span>
      <span class="s">${mine ? 'Mi alimento · ' : ''}por 100 g: P ${fmtM(f.p)} · G ${fmtM(f.g)} · C ${fmtM(f.c)}${f.src && !mine ? ' · ' + esc(f.src) : ''}</span></span><span class="r">${right}</span></button>`;
  }
  function resultsHtml(q) {
    const list = searchFoods(q);
    if (!list.length) return q.trim() ? `<p class="muted small">No encontré «${esc(q)}». Créalo con la información de su etiqueta.</p>` : `<p class="muted small">Escribe para buscar entre ${FOODS.length} alimentos. Los que uses o crees aparecen aquí.</p>`;
    return (q.trim() ? '' : '<div class="eyebrow">Mis alimentos y recientes</div>') + list.map(fpItem).join('');
  }
  function renderPicker() {
    const p = picker;
    if (p.step === 'amount') return renderAmount();
    if (p.step === 'create') return renderCreate();
    const t = p.target;
    const meal = MEALS.find(m => m.id === p.meal);
    const head = t
      ? `<h2>Cambiar ${esc(t.name)}</h2><p class="muted small">En el plan: ${esc(t.qty)} · ${t.kcal} kcal. Las cantidades sugeridas igualan ${MATCH_LABEL[MATCH[t.cat] || 'kcal']}.</p>`
      : `<h2>Agregar a ${esc(meal ? meal.name.toLowerCase() : 'la comida')}</h2>`;
    const sugg = t ? (t.alts || []).map(foodByName).filter(Boolean) : [];
    openSheet(`${head}
      ${sugg.length ? `<div class="eyebrow">Equivalentes</div><div class="fp-list">${sugg.map(fpItem).join('')}</div>` : ''}
      <label class="eyebrow" for="fp-q">Buscar alimento</label>
      <input class="inp" id="fp-q" type="search" placeholder="Ej.: marraqueta, yogur, pollo" autocomplete="off" value="${esc(p.q || '')}">
      <div class="fp-list" id="fp-results">${resultsHtml(p.q || '')}</div>
      <button class="btn block ghost" data-a="fp-create">+ Crear alimento</button>
      <button class="btn block ghost" data-a="close">Cancelar</button>`);
  }
  function amountTotals() {
    const p = picker, f = p.sel, g = num(p.grams) || 0;
    const q = portion(f, g);
    let html = `<b>${q.kcal} kcal</b> · P ${fmtM(q.p)} g · G ${fmtM(q.g)} g · C ${fmtM(q.c)} g`;
    if (p.target && p.target.kcal > 0) {
      const d = q.kcal - p.target.kcal;
      html += `<br><span class="muted">Plan: ${p.target.kcal} kcal · P ${fmtM(p.target.p)} · G ${fmtM(p.target.g)} · C ${fmtM(p.target.c)} (${d >= 0 ? '+' : ''}${d} kcal)</span>`;
    }
    return html;
  }
  function renderAmount() {
    const p = picker, f = p.sel;
    const opts = [];
    if (p.target) opts.push(['Equivalente', eqGrams(p.target, f)]);
    if (f.u) {
      const unit = f.u[0].replace(/^1 /, '');
      opts.push([f.u[0], f.u[1]], ['½ ' + unit, r1(f.u[1] / 2)], ['2 × ' + unit, f.u[1] * 2]);
    }
    opts.push(['', 100]);
    openSheet(`<h2>${esc(f.n)}</h2>
      <p class="muted small">Por 100 g: ${f.kcal} kcal · P ${fmtM(f.p)} · G ${fmtM(f.g)} · C ${fmtM(f.c)}${f.src ? ' · ' + esc(f.src) : ''}</p>
      <div class="q"><label for="fp-g">¿Cuántos gramos comiste?</label><div class="inp-u"><input class="inp" id="fp-g" inputmode="decimal" autocomplete="off" value="${esc(String(p.grams).replace('.', ','))}"><span class="u">g</span></div></div>
      <div class="chipsel">${opts.map(([l, g]) => `<button type="button" data-a="fp-g" data-v="${g}">${l ? esc(l) + ' ' : ''}<span class="${l ? 'muted' : ''}">${fmtM(g)} g</span></button>`).join('')}</div>
      <p class="fp-tot" id="fp-tot">${amountTotals()}</p>
      <button class="btn block" data-a="fp-save">${p.target ? 'Guardar cambio' : 'Agregar'}</button>
      <button class="btn block ghost" data-a="fp-back">Volver</button>`);
  }
  function renderCreate() {
    const p = picker;
    const field = (id, label, unit, val) => `<div class="q"><label for="${id}">${label}</label><div class="inp-u"><input class="inp" id="${id}" inputmode="decimal" autocomplete="off" value="${esc(val || '')}"><span class="u">${unit}</span></div></div>`;
    openSheet(`<h2>Crear alimento</h2>
      <p class="muted small">Copia la información nutricional de la etiqueta, la columna de 100 g. Queda guardado para la próxima vez.</p>
      <div class="q"><label for="fc-n">Nombre</label><input class="inp" id="fc-n" autocomplete="off" value="${esc(p.q || '')}" placeholder="Ej.: Pan pita integral Ideal"></div>
      <div class="two">${field('fc-kcal', 'Energía', 'kcal')}${field('fc-p', 'Proteínas', 'g')}</div>
      <div class="two">${field('fc-g', 'Grasas totales', 'g')}${field('fc-c', 'H. de C. disponibles', 'g')}</div>
      <p class="small muted">Opcional: una porción para elegirla rápido.</p>
      <div class="two"><div class="q"><label for="fc-un">Porción</label><input class="inp" id="fc-un" autocomplete="off" placeholder="1 unidad"></div>${field('fc-ug', 'Gramos de la porción', 'g')}</div>
      <button class="btn block" data-a="fc-save">Guardar alimento</button>
      <button class="btn block ghost" data-a="fp-back">Volver</button>`);
  }

  function scaleButtons(field, from, to, value, date) {
    const btns = [];
    for (let i = from; i <= to; i++) btns.push(`<button type="button" class="${String(value) === String(i) ? 'on' : ''}" data-a="ci-set" data-k="${field}" data-v="${i}" data-d="${date}">${i}</button>`);
    return `<div class="scale">${btns.join('')}</div>`;
  }
  function segButtons(field, options, value, date) {
    return `<div class="seg">${Object.entries(options).map(([k, l]) => `<button type="button" class="${value === k ? 'on' : ''}" data-a="ci-set" data-k="${field}" data-v="${k}" data-d="${date}">${l}</button>`).join('')}</div>`;
  }

  function viewCheckinDay(date) {
    if (date > today()) return viewNotFound();
    const c = S.checkins[date] || {};
    const tg = targets(date);
    const html = `
      <div class="wk-head lower"><span class="eyebrow">Registro diario</span><span class="rname" style="font-size:1.8rem">${esc(fmtDay(date).charAt(0).toUpperCase() + fmtDay(date).slice(1))}</span>
      <p class="small muted">Se guarda solo mientras escribes.</p></div>
      <section class="card form">
        <div class="q"><label for="ci-pasos">Pasos <span class="key">CLAVE</span><span class="hint">meta ${nf(tg.steps, 0)}</span></label>
          <div class="inp-u"><input class="inp" id="ci-pasos" inputmode="numeric" pattern="[0-9]*" data-ci="pasos" data-d="${date}" value="${esc(c.pasos)}" placeholder="0"><span class="u">pasos</span></div></div>
        <div class="q"><span class="ql">Sueño de anoche <span class="key">CLAVE</span></span>
          <div class="two"><div class="inp-u"><input class="inp" id="ci-sh" inputmode="numeric" pattern="[0-9]*" data-ci="sleepH" data-d="${date}" value="${esc(c.sleepH)}" placeholder="7" aria-label="Horas de sueño"><span class="u">h</span></div>
          <div class="inp-u"><input class="inp" id="ci-sm" inputmode="numeric" pattern="[0-9]*" data-ci="sleepM" data-d="${date}" value="${esc(c.sleepM)}" placeholder="0" aria-label="Minutos de sueño"><span class="u">min</span></div></div></div>
        <div class="q"><span class="ql">Calidad del sueño</span>${scaleButtons('sleepQ', 1, 5, c.sleepQ, date)}<div class="scale-ends"><span>Muy mala</span><span>Excelente</span></div></div>
        <div class="q"><span class="ql">Cumplimiento de la dieta <span class="key">CLAVE</span><span class="hint">10 = todo pesado y según el plan</span></span>${scaleButtons('adh', 1, 10, c.adh, date)}</div>
        <div class="q"><label for="ci-peso">Peso en ayunas <span class="hint">después del baño</span></label>
          ${c.noPeso ? `<p class="muted">Hoy no te pesaste.</p>` : `<div class="inp-u"><input class="inp" id="ci-peso" inputmode="decimal" data-ci="peso" data-d="${date}" value="${esc(c.peso)}" placeholder="56,0"><span class="u">kg</span></div>`}
          <button type="button" class="linkbtn" data-a="ci-set" data-k="noPeso" data-v="${c.noPeso ? '' : '1'}" data-d="${date}">${c.noPeso ? 'Sí me pesé' : 'No me pesé hoy'}</button></div>
        ${PAIN ? `<div class="q"><span class="ql">Dolor de ${esc(PAIN.label)} <span class="hint">0 = nada, 10 = mucho</span></span>${scaleButtons('hombro', 0, 10, c.hombro, date)}</div>` : ''}
        <div class="q"><span class="ql">Energía</span>${segButtons('energy', ENERGY, c.energy, date)}</div>
        <div class="q"><label for="ci-nota">Nota del día</label><textarea id="ci-nota" data-ci="nota" data-d="${date}" placeholder="Algo fuera de lo común, cómo te sentiste…">${esc(c.nota)}</textarea></div>
      </section>
      <a class="btn block lower" href="#/checkin">${dayComplete(c) ? 'Listo' : 'Volver'}</a>`;
    return { title: 'Check-in', back: '#/checkin', html };
  }

  function viewCheckin(mondayArg) {
    const t = today();
    const monday = mondayArg || mondayOf(t);
    const st = weekStats(monday);
    const isCurrent = monday === mondayOf(t);
    const parts = [];
    const sent = S.sent[monday];
    parts.push(`<div class="daynav"><button data-a="ci-week" data-d="${addDays(monday, -7)}" aria-label="Semana anterior">‹</button><span class="dl">${isCurrent ? 'Esta semana' : 'Semana del ' + fmtShort(monday)}</span><button data-a="ci-week" data-d="${addDays(monday, 7)}" aria-label="Semana siguiente" ${isCurrent ? 'disabled style="opacity:.3"' : ''}>›</button></div>`);
    const strip = st.days.map((d, i) => {
      const c = S.checkins[d];
      const future = d > t;
      const cls = ['dc', dayComplete(c) ? 'done' : (future ? 'future' : 'pending'), d === t ? 'today' : ''].join(' ');
      return `<a class="${cls}" href="#/checkin/${d}"><span class="d">${DOW[i]}</span><span class="n">${parse(d).getDate()}</span><span class="m">${dayComplete(c) ? '✓' : (future ? '' : '•')}</span></a>`;
    }).join('');
    parts.push(`<section class="card"><div class="card-head"><h3>Registro diario</h3><span class="small muted num">${st.registered}/7 días</span></div><div class="daystrip">${strip}</div>
      ${isCurrent && !dayComplete(S.checkins[t]) ? `<a class="btn block lower" href="#/checkin/${t}">Registrar hoy</a>` : ''}</section>`);
    parts.push(`<section class="card"><h3>Tu semana en números</h3><div class="stats">
      <div class="stat"><span class="k">Peso promedio</span><span class="v">${st.peso !== null ? nf(st.peso, 1) + ' kg' : '—'}</span><span class="s">${st.pesoDelta !== null ? `${st.pesoDelta >= 0 ? '+' : ''}${nf(st.pesoDelta, 2)} kg vs anterior` : 'pésate 4 días o más'}</span></div>
      <div class="stat"><span class="k">Pasos</span><span class="v">${st.pasos !== null ? nf(st.pasos, 0) : '—'}</span><span class="s">promedio diario</span></div>
      <div class="stat"><span class="k">Sueño</span><span class="v">${st.sleep !== null ? fmtSleep(st.sleep).replace(' min', '') : '—'}</span><span class="s">${st.sleepQ !== null ? 'calidad ' + nf(st.sleepQ, 1) + '/5' : 'promedio'}</span></div>
      <div class="stat"><span class="k">Registros</span><span class="v">${st.registered}/7</span><span class="s">días completos</span></div>
      <div class="stat"><span class="k">Dieta</span><span class="v">${st.adh !== null ? nf(st.adh, 1) : '—'}</span><span class="s">cumplimiento /10</span></div>
      <div class="stat"><span class="k">Entrenos</span><span class="v">${st.sessions.length}</span><span class="s">${st.hombro !== null ? 'hombro ' + nf(st.hombro, 1) + '/10' : 'esta semana'}</span></div>
    </div></section>`);
    parts.push(`<section class="card"><h3>Enviar a ${esc(S.settings.coachName)}</h3>
      <p class="muted small">Manda el resumen el domingo en la noche o el lunes en la mañana. Se abre el menú de compartir: elige WhatsApp y el chat de ${esc(S.settings.coachName)}. Las fotos van aparte por WhatsApp cada 2 semanas.</p>
      ${sent ? `<p class="saved">Enviado el ${esc(fmtDay(ymd(new Date(sent))))}</p>` : ''}
      <button class="btn block upper" data-a="send-week" data-d="${monday}">Enviar resumen semanal</button></section>`);
    return { title: 'Check-in', html: parts.join(''), pill: phasePill(t) };
  }

  function viewMas() {
    const items = [
      ['#/plan', 'Plan y reglas', 'Fases, RIR, descansos y progresión'],
      ['#/medidas', 'Medidas', 'Cintura y cadera cada 2 semanas'],
      ['#/historial', 'Historial de entrenamientos', 'Todas las sesiones con sus series'],
      ['#/respaldo', 'Respaldo de datos', 'Guardar o recuperar todo lo registrado'],
      ['#/instalar', 'Instalar en el iPhone', 'Agregarla a la pantalla de inicio'],
      sb ? ['#/cuenta', 'Cuenta', 'Conexión con ' + S.settings.coachName] : ['#/coach', 'Modo coach', 'Solo para ' + S.settings.coachName]
    ];
    const html = `<section class="card flush"><div class="list">${items.map(([h, t, s]) => `<a class="li" href="${h}"><span class="grow"><span class="t">${esc(t)}</span><span class="s">${esc(s)}</span></span><span class="chev">›</span></a>`).join('')}</div></section>
      <p class="small muted">${sb ? `Todo lo que registras le llega a ${esc(S.settings.coachName)} cuando hay internet.` : 'Los datos se guardan solo en este teléfono. Haz un respaldo de vez en cuando.'}</p>`;
    return { title: 'Más', html, pill: phasePill() };
  }

  function viewPlan() {
    const html = window.DATA.guide(S.settings.kcal, esc(S.settings.coachName), nf);
    return { title: 'Plan y reglas', back: '#/mas', html };
  }

  function viewMedidas() {
    const list = S.measures.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const rows = list.map(m => `<tr><td>${esc(fmtShort(m.date))}</td><td>${m.cintura ? nf(m.cintura, 1) + ' cm' : '—'}</td><td>${m.cadera ? nf(m.cadera, 1) + ' cm' : '—'}</td><td><button class="linkbtn" style="color:var(--danger)" data-a="del-measure" data-id="${m.id}">Borrar</button></td></tr>`).join('');
    const html = `<section class="card form">
        <h3>Nueva medición</h3>
        <p class="small muted">Cinta métrica en ayunas. Cintura a la altura del ombligo, cadera en la parte más ancha.</p>
        <div class="q"><label for="m-date">Fecha</label><input class="inp" type="date" id="m-date" value="${today()}" max="${today()}"></div>
        <div class="two"><div class="q"><label for="m-cin">Cintura</label><div class="inp-u"><input class="inp" id="m-cin" inputmode="decimal" placeholder="0"><span class="u">cm</span></div></div>
        <div class="q"><label for="m-cad">Cadera</label><div class="inp-u"><input class="inp" id="m-cad" inputmode="decimal" placeholder="0"><span class="u">cm</span></div></div></div>
        <button class="btn block lower" data-a="add-measure">Guardar medición</button>
      </section>
      ${list.length ? `<section class="card flush"><div class="tbl"><table><thead><tr><th>Fecha</th><th>Cintura</th><th>Cadera</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>` : '<p class="muted small">Todavía no hay mediciones.</p>'}`;
    return { title: 'Medidas', back: '#/mas', html };
  }

  function viewRespaldo() {
    const html = `<section class="card"><h3>Guardar respaldo</h3>
        <p class="muted small">Crea un archivo con todo lo registrado: entrenamientos, check-ins, comidas y medidas. Mándalo a ${esc(S.settings.coachName)} por WhatsApp o guárdalo en Archivos.</p>
        <button class="btn block lower" data-a="export">Crear respaldo</button></section>
      <section class="card"><h3>Recuperar respaldo</h3>
        <p class="muted small">Reemplaza los datos de este teléfono por los de un archivo de respaldo. Sirve para pasar la app a otro teléfono o para que ${esc(S.settings.coachName)} vea los datos en el suyo.</p>
        <label class="btn block ghost" for="import-file">Elegir archivo</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden></section>`;
    return { title: 'Respaldo', back: '#/mas', html };
  }

  function viewInstalar() {
    const html = `<section class="card prose"><h2>Agregar a la pantalla de inicio</h2><ul>
        <li>Abre este enlace en <b>Safari</b> (no desde WhatsApp ni Instagram).</li>
        <li>Toca el botón <b>Compartir</b>: el cuadrado con la flecha hacia arriba.</li>
        <li>Baja y elige <b>Agregar a inicio</b>. Luego toca <b>Agregar</b>.</li>
        <li>Desde ahora ábrela siempre con el ícono de la pantalla de inicio. Funciona sin internet.</li></ul>
        <p class="muted small">Importante: lo que registres dentro de la app instalada queda guardado en la app, no en Safari.</p></section>`;
    return { title: 'Instalar', back: '#/mas', html };
  }

  function viewLogin() {
    const html = `<form class="card form" id="login-form" novalidate><h2>Entrar</h2>
        <p class="muted small">Con el correo y la contraseña que te dio ${esc(S.settings.coachName)}. Se hace una sola vez en este teléfono.</p>
        <div class="q"><label for="lg-email">Correo</label><input class="inp" id="lg-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off"></div>
        <div class="q"><label for="lg-pass">Contraseña</label><input class="inp" id="lg-pass" type="password" autocomplete="current-password"></div>
        <button class="btn block" type="submit" id="lg-btn">Entrar</button></form>`;
    return { title: `Plan ${PERSON}`, bare: true, html };
  }

  function viewNotLinked() {
    const html = `<section class="card"><h3>Esta cuenta no es de atleta</h3>
        <p class="muted">Entraste con ${esc(user && user.email)}, que no está conectada como atleta. Si eres ${esc(S.settings.coachName)}, usa la app de coach.</p>
        <button class="btn block ghost" data-a="logout">Cerrar sesión</button></section>`;
    return { title: `Plan ${PERSON}`, bare: true, html };
  }

  function viewCuenta() {
    const labels = { ok: 'Todo enviado', syncing: 'Sincronizando…', offline: 'Sin internet: se envía al volver la conexión', error: 'No se pudo sincronizar', idle: 'Pendiente' };
    const pend = pendingCount();
    const html = `<section class="card"><h3>Conexión con ${esc(S.settings.coachName)}</h3>
        <p class="muted small">Entraste como ${esc(user && user.email)}.</p>
        <div class="stats">
          <div class="stat"><span class="k">Estado</span><span class="v" style="font-size:1.1rem">${labels[syncInfo.state] || ''}</span></div>
          <div class="stat"><span class="k">Última vez</span><span class="v" style="font-size:1.1rem">${syncInfo.at ? new Date(syncInfo.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'}</span><span class="s">${pend ? pend + ' pendientes' : 'nada pendiente'}</span></div>
        </div>
        ${syncInfo.state === 'error' ? `<p class="small" style="color:var(--danger)">${esc(syncInfo.error)}</p>` : ''}
        <button class="btn block" data-a="sync-now">Sincronizar ahora</button></section>
      <section class="card"><h3>Ajustes del plan</h3><p class="muted small">La fecha de inicio, las calorías, las cargas, el RIR y las variantes del hombro los maneja ${esc(S.settings.coachName)} desde su app.</p></section>
      <button class="btn block danger" data-a="logout">Cerrar sesión</button>`;
    return { title: 'Cuenta', back: '#/mas', html };
  }

  function viewCoach() {
    if (sb) return viewCuenta();
    const pinSet = !!S.settings.coachPin;
    if (!coachUnlocked) {
      const html = `<section class="card form"><h3>${pinSet ? 'Ingresa el PIN de coach' : 'Crea el PIN de coach'}</h3>
        <p class="muted small">${pinSet ? 'Esta sección cambia la rutina y las metas.' : 'Elige 4 números. Solo los sabe ' + esc(S.settings.coachName) + '.'}</p>
        <input class="inp" id="coach-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="PIN">
        <button class="btn block upper" data-a="${pinSet ? 'coach-enter' : 'coach-create'}">${pinSet ? 'Entrar' : 'Crear PIN'}</button></section>`;
      return { title: 'Modo coach', back: '#/mas', html };
    }
    const k = S.settings.kcal;
    const swapRows = ROUTINE_ORDER.map(rid => {
      const r = ROUTINES[rid];
      return r.exercises.filter(ex => ex.shoulder).map(ex => {
        const on = !!S.swaps[ex.id];
        return `<div class="li"><span class="tag ${r.kind}">${r.name}</span><span class="grow"><span class="t">${esc(on ? ex.shoulder.name : ex.name)}</span><span class="s">${on ? 'En vez de: ' + esc(ex.name) : 'Variante: ' + esc(ex.shoulder.name)}</span></span>
          <button class="btn small ${on ? 'upper' : 'ghost'}" data-a="swap" data-id="${ex.id}" aria-pressed="${on}">${on ? 'Variante' : 'Original'}</button></div>`;
      }).join('');
    }).join('');
    const html = `<section class="card form"><h3>Bloque</h3>
        <div class="q"><label for="c-start">Fecha de inicio (lunes de la semana 1)</label><input class="inp" type="date" id="c-start" value="${S.settings.startDate}"></div>
        ${CORE.flexDayHtml(S.settings.upperDay)}
        ${CORE.kcalFieldsHtml(k)}
        <p class="small muted">Proteína y grasa quedan fijas por fase; los carbohidratos se recalculan solos.</p>
        <div class="q"><label for="c-name">Nombre del coach</label><input class="inp" id="c-name" value="${esc(S.settings.coachName)}" data-coachname="1"></div>
      </section>
      ${CORE.hasVariants() ? `<section class="card flush"><div style="padding:14px 16px 4px" class="stack"><h3>${esc(PAIN ? PAIN.variantsTitle : 'Variantes de ejercicios')}</h3><p class="small muted">Activa la variante según lo que diga la kinesióloga. Aplica desde el próximo entrenamiento.</p></div><div class="list">${swapRows}</div></section>` : ''}
      <button class="btn block ghost" data-a="coach-exit">Salir del modo coach</button>`;
    return { title: 'Modo coach', back: '#/mas', html };
  }

  function viewNotFound() {
    return { title: 'No encontrado', back: '#/entrenar', html: `<section class="card"><p>Esta pantalla no existe.</p><a class="btn block" href="#/entrenar">Volver al inicio</a></section>` };
  }

  // ---------- Render ----------
  const TABS = [['entrenar', 'Entrenar'], ['nutricion', 'Nutrición'], ['checkin', 'Check-in'], ['mas', 'Más']];
  const TAB_OF = { entrenar: 'entrenar', workout: 'entrenar', session: 'entrenar', historial: 'entrenar', nutricion: 'nutricion', checkin: 'checkin', mas: 'mas', plan: 'mas', medidas: 'mas', respaldo: 'mas', instalar: 'mas', coach: 'mas', cuenta: 'mas' };
  let lastRoute = null;

  function current() {
    const h = location.hash.replace(/^#\/?/, '') || 'entrenar';
    const [name, arg] = h.split('/');
    return { name, arg, key: h };
  }

  function render() {
    const { name, arg, key } = current();
    let v;
    if (!authReady) v = { title: `Plan ${PERSON}`, bare: true, html: '<p class="muted">Cargando…</p>' };
    else if (sb && !user) v = viewLogin();
    else if (sb && notLinked) v = viewNotLinked();
    else switch (name) {
      case 'entrenar': v = viewEntrenar(); break;
      case 'workout': v = viewWorkout(arg); break;
      case 'session': v = viewSession(arg); break;
      case 'historial': v = viewHistorial(); break;
      case 'nutricion': v = viewNutricion(arg); break;
      case 'checkin': v = arg && arg.length === 10 && !arg.startsWith('w') ? viewCheckinDay(arg) : viewCheckin(arg && arg.startsWith('w') ? arg.slice(1) : null); break;
      case 'mas': v = viewMas(); break;
      case 'plan': v = viewPlan(); break;
      case 'medidas': v = viewMedidas(); break;
      case 'respaldo': v = viewRespaldo(); break;
      case 'instalar': v = viewInstalar(); break;
      case 'coach': v = viewCoach(); break;
      case 'cuenta': v = sb ? viewCuenta() : viewCoach(); break;
      default: v = viewNotFound();
    }
    document.getElementById('hdr').innerHTML = `${v.back ? `<a class="back" href="${v.back}">‹ Volver</a>` : ''}<span class="title">${esc(v.title)}</span>${v.pill || ''}`;
    document.getElementById('view').innerHTML = v.html;
    const tab = TAB_OF[name] || 'entrenar';
    const pending = !dayComplete(S.checkins[today()]);
    document.getElementById('tabs').hidden = !!v.bare;
    document.getElementById('tabs').innerHTML = v.bare ? '' : TABS.map(([id, label]) => `<a href="#/${id}" class="${tab === id ? 'on' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span>${id === 'checkin' && pending ? '<span class="dot" aria-label="pendiente"></span>' : ''}</a>`).join('');
    document.title = `${v.title} · Plan ${PERSON}`;
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
    renderTimer();
  }

  // ---------- Timer de descanso (cuenta hacia arriba y marca el rango de descanso) ----------
  let beeped = false;
  function startTimer(rest, name) {
    if (!S.active) return;
    S.active.timer = { start: Date.now(), min: rest[0], max: rest[1], name };
    beeped = false;
    save(); renderTimer();
  }
  function renderTimer() {
    const el = document.getElementById('timer');
    const a = S.active;
    const onWorkout = a && current().name === 'workout' && current().arg === a.routine;
    if (!a || (!a.timer && !onWorkout)) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    if (!a.timer) {
      el.innerHTML = `<button class="timer-start" data-a="timer-start">⏱ Iniciar timer</button>`;
      return;
    }
    const t = a.timer;
    const sec = Math.max(0, Math.floor((Date.now() - t.start) / 1000));
    const state = sec >= t.max ? 'over' : (sec >= t.min ? 'ready' : '');
    if (state && !beeped) { beeped = true; beep(); }
    el.innerHTML = `<div class="in ${state}">
      <button class="tbtn stop" data-a="timer-stop">Detener</button>
      <div class="tmid"><span class="tval">${fmtClock(sec)}</span><span class="trange">(${Math.round(t.min / 60)}–${Math.round(t.max / 60)} min)</span><span class="tname">${state === 'ready' ? 'A la siguiente serie' : (state === 'over' ? 'Descanso máximo' : esc(t.name || ''))}</span></div>
      <button class="tbtn" data-a="timer-restart">Reiniciar</button></div>`;
  }
  setInterval(() => { if (S.active && S.active.timer) renderTimer(); }, 1000);

  // ---------- Acciones ----------
  const actions = {
    close: () => closeSheet(),
    'hide-install': () => { S.settings.hideInstall = true; save(); render(); },
    start: el => {
      unlockAudio();
      const rid = el.dataset.r;
      const r = ROUTINES[rid];
      const b = block();
      S.active = { routine: rid, date: today(), startedAt: Date.now(), week: Math.max(1, b.week), ex: {}, timer: null };
      r.exercises.forEach(ex => {
        const rx = resolveEx(ex, !!S.swaps[ex.id]);
        S.active.ex[ex.id] = { alt: rx.alt, histKey: rx.histKey, name: rx.name, sets: [], warm: [], draft: {}, note: '' };
      });
      save(); render();
      toast('Entrenamiento iniciado');
    },
    'reg-set': el => {
      unlockAudio();
      const a = S.active; if (!a) return;
      const exId = el.dataset.ex;
      const e = normEntry(a.ex[exId]);
      const ex = ROUTINES[a.routine].exercises.find(x => x.id === exId);
      const rx = resolveEx(ex, e.alt);
      const val = id => { const i = document.getElementById(id); return i ? i.value.trim().replace(',', '.') : ''; };
      const kg = val('dkg-' + exId), reps = val('dreps-' + exId), rir = val('drir-' + exId);
      if (!reps || !(num(reps) > 0)) { toast(rx.type === 'time' ? 'Anota los segundos' : 'Anota las repeticiones'); const i = document.getElementById('dreps-' + exId); if (i) i.focus(); return; }
      if (rir && !(num(rir) >= 0 && num(rir) <= 5)) { toast('El RIR va de 0 a 5'); return; }
      const set = { kg, reps, rir };
      if (el.dataset.kind === 'warm') {
        e.warm.push({ kg, reps });
      } else {
        e.sets.push(set);
        e.more = false;
        if (!ex.superset) startTimer(rx.rest, rx.name);
      }
      e.draft = {};
      save(); render();
      if (el.dataset.kind !== 'warm' && ex.superset) {
        const partner = document.getElementById('card-' + ex.superset);
        if (partner) partner.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    'more-set': el => { const e = S.active && S.active.ex[el.dataset.ex]; if (!e) return; e.more = true; save(); render(); },
    'edit-set': el => {
      const e = S.active && S.active.ex[el.dataset.ex]; if (!e) return;
      const list = el.dataset.kind === 'warm' ? e.warm : e.sets;
      const x = list[Number(el.dataset.i)]; if (!x) return;
      const lbl = (el.dataset.kind === 'warm' ? 'Aproximación ' : 'Serie ') + (Number(el.dataset.i) + 1);
      openSheet(`<h2>${lbl} · ${esc(e.name)}</h2>
        <div class="two"><div class="q"><label for="es-kg">Kilos</label><div class="inp-u"><input class="inp" id="es-kg" inputmode="decimal" value="${esc(String(x.kg || '').replace('.', ','))}"><span class="u">kg</span></div></div>
        <div class="q"><label for="es-reps">Reps o segundos</label><input class="inp" id="es-reps" inputmode="numeric" value="${esc(x.reps)}"></div></div>
        ${el.dataset.kind === 'warm' ? '' : `<div class="q"><label for="es-rir">RIR real</label><input class="inp" id="es-rir" inputmode="numeric" value="${esc(x.rir || '')}"></div>`}
        <button class="btn block" data-a="save-set" data-ex="${el.dataset.ex}" data-kind="${el.dataset.kind}" data-i="${el.dataset.i}">Guardar</button>
        <button class="btn block danger" data-a="del-set" data-ex="${el.dataset.ex}" data-kind="${el.dataset.kind}" data-i="${el.dataset.i}">Eliminar</button>
        <button class="btn block ghost" data-a="close">Cancelar</button>`);
    },
    'save-set': el => {
      const e = S.active.ex[el.dataset.ex];
      const list = el.dataset.kind === 'warm' ? e.warm : e.sets;
      const x = list[Number(el.dataset.i)];
      const v = id => { const i = document.getElementById(id); return i ? i.value.trim().replace(',', '.') : undefined; };
      const reps = v('es-reps');
      if (!reps || !(num(reps) > 0)) { toast('Las repeticiones no pueden quedar vacías'); return; }
      x.kg = v('es-kg'); x.reps = reps;
      if (el.dataset.kind !== 'warm') x.rir = v('es-rir') || '';
      save(); closeSheet(); render();
    },
    'del-set': el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez para eliminar'; return; }
      const e = S.active.ex[el.dataset.ex];
      const list = el.dataset.kind === 'warm' ? e.warm : e.sets;
      list.splice(Number(el.dataset.i), 1);
      save(); closeSheet(); render();
    },
    info: el => {
      const [t, body] = INFO[el.dataset.k] || [];
      if (t) openSheet(`<h2>${esc(t)}</h2><p>${esc(body)}</p><button class="btn block ghost" data-a="close">Entendido</button>`);
    },
    history: el => {
      const key = el.dataset.k;
      const rows = sortedSessions().filter(x => Object.values(x.ex).some(e => e.histKey === key && e.sets.length)).reverse().slice(0, 12).map(x => {
        const e = Object.values(x.ex).find(y => y.histKey === key);
        const ex = CORE.findExercise(Object.keys(x.ex).find(id => x.ex[id] === e));
        const rx = ex ? resolveEx(ex.ex, e.alt) : { type: 'reps' };
        return `<div class="li" style="padding:10px 0"><span class="grow"><span class="t">Semana ${x.week || '—'} · ${esc(fmtShort(x.date))}</span><span class="s">${e.sets.map((y, i) => `S${i + 1} ${esc(setText(rx, y))}${esc(rirTxt(y.rir))}`).join(' · ')}</span></span></div>`;
      }).join('');
      openSheet(`<h2>${esc(el.dataset.n)}</h2><p class="muted small">Semanas anteriores</p><div class="list">${rows || '<p class="muted">Sin registros.</p>'}</div><button class="btn block ghost" data-a="close">Cerrar</button>`);
    },
    'share-ex': el => {
      const a = S.active; const e = a && a.ex[el.dataset.ex]; if (!e) return;
      const ex = ROUTINES[a.routine].exercises.find(x => x.id === el.dataset.ex);
      const rx = resolveEx(ex, e.alt);
      const lines = [`${e.name} · ${fmtDay(a.date)}`].concat(e.sets.map((x, i) => `Serie ${i + 1}: ${setText(rx, x)}${rirTxt(x.rir)}`));
      if (e.note) lines.push('Nota: ' + e.note);
      shareText(lines.join('\n'), e.name);
    },
    'timer-start': () => {
      const a = S.active; if (!a) return;
      unlockAudio();
      const r = ROUTINES[a.routine];
      const ex = r.exercises.find(x => normEntry(a.ex[x.id]).sets.length < CORE.presSets(presFor(a.week, x.id), resolveEx(x, a.ex[x.id].alt))) || r.exercises[0];
      const rx = resolveEx(ex, a.ex[ex.id].alt);
      startTimer(rx.rest, rx.name);
    },
    'timer-stop': () => { if (S.active) { S.active.timer = null; save(); renderTimer(); } },
    'timer-restart': () => { if (S.active && S.active.timer) { S.active.timer.start = Date.now(); beeped = false; save(); renderTimer(); } },
    finish: () => {
      const a = S.active; if (!a) return;
      const anyDone = Object.values(a.ex).some(e => normEntry(e).sets.length);
      if (!anyDone) { toast('Todavía no hay series registradas'); return; }
      a.post = a.post || {};
      openFinishSheet();
    },
    'post-set': el => {
      S.active.post[el.dataset.k] = Number(el.dataset.v); save(); openFinishSheet();
    },
    'post-save': () => {
      const a = S.active; if (!a) return;
      const ex = {};
      Object.entries(a.ex).forEach(([id, e]) => {
        normEntry(e);
        const sets = e.sets.map(x => ({ kg: x.kg, reps: x.reps, rir: x.rir || '' }));
        const warm = e.warm.map(x => ({ kg: x.kg, reps: x.reps }));
        ex[id] = { alt: e.alt, histKey: e.histKey, name: e.name, sets, warm, note: e.note.trim(), setup: getSetup(e.histKey) };
      });
      const finishedAt = Date.now();
      const s = {
        id: 's' + finishedAt, routine: a.routine, date: a.date, week: a.week, startedAt: a.startedAt, finishedAt,
        minutes: Math.max(1, Math.round((finishedAt - a.startedAt) / 60000)), ex,
        difficulty: a.post.difficulty || null, shoulder: a.post.shoulder != null ? a.post.shoulder : null
      };
      S.sessions.push(s);
      S.active = null;
      save(); closeSheet();
      markDirty('session', s.id);
      location.hash = '#/session/' + s.id;
      toast('Entrenamiento guardado');
    },
    discard: el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez para descartar'; return; }
      S.active = null; save(); location.hash = '#/entrenar'; toast('Entrenamiento descartado');
    },
    'delete-session': el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez para eliminar'; return; }
      S.sessions = S.sessions.filter(s => s.id !== el.dataset.id); save(); markDeleted('session', el.dataset.id); location.hash = '#/historial'; toast('Entrenamiento eliminado');
    },
    'share-session': el => { const s = S.sessions.find(x => x.id === el.dataset.id); if (s) shareText(sessionText(s), `Entrenamiento de ${PERSON}`); },
    'nut-day': el => { const d = el.dataset.d; location.hash = '#/nutricion' + (d === today() ? '' : '/' + d); },
    food: el => {
      const { name, arg } = current();
      const date = (name === 'nutricion' && arg) || today();
      const day = S.food[date] = S.food[date] || { on: [], water: 0 };
      const id = el.dataset.id;
      day.on = day.on.includes(id) ? day.on.filter(x => x !== id) : day.on.concat(id);
      save(); markDirty('food', date); render();
    },
    water: el => {
      const { name, arg } = current();
      const date = (name === 'nutricion' && arg) || today();
      const day = S.food[date] = S.food[date] || { on: [], water: 0 };
      day.water = Math.max(0, (day.water || 0) + Number(el.dataset.v));
      save(); markDirty('food', date); render();
    },
    'swap-food': el => {
      const date = nutDate();
      const day = S.food[date] || { on: [], water: 0 };
      const f = mealsFor(date, day).flatMap(m => m.foods).find(x => x.id === el.dataset.id);
      if (!f) return;
      picker = { step: 'list', date, foodId: f.id, target: f.plan || f, q: '' };
      renderPicker();
    },
    'add-food': el => { picker = { step: 'list', date: nutDate(), meal: el.dataset.meal, target: null, q: '' }; renderPicker(); },
    'fp-pick': el => {
      const f = findFood(el.dataset.fid); if (!f || !picker) return;
      picker.sel = f;
      picker.grams = picker.target ? eqGrams(picker.target, f) : (f.u ? f.u[1] : 100);
      picker.step = 'amount';
      renderPicker();
    },
    'fp-g': el => {
      picker.grams = Number(el.dataset.v);
      const inp = document.getElementById('fp-g'); if (inp) inp.value = String(picker.grams).replace('.', ',');
      document.getElementById('fp-tot').innerHTML = amountTotals();
    },
    'fp-back': () => { picker.step = 'list'; renderPicker(); },
    'fp-create': () => { picker.step = 'create'; renderPicker(); },
    'fc-save': () => {
      const v = id => document.getElementById(id).value.trim();
      const n = v('fc-n');
      const kcal = num(v('fc-kcal'));
      if (!n) { toast('Escribe el nombre del alimento'); return; }
      if (kcal === null || kcal < 0 || kcal > 950) { toast('Revisa las calorías por 100 g'); return; }
      const macro = id => { const x = num(v(id)); return x === null ? 0 : Math.max(0, x); };
      const f = { id: 'my' + Date.now(), n, cat: 'otros', kcal: Math.round(kcal), p: r1(macro('fc-p')), g: r1(macro('fc-g')), c: r1(macro('fc-c')), src: 'propio' };
      const ug = num(v('fc-ug'));
      if (ug && ug > 0) f.u = [v('fc-un') || '1 porción', r1(ug)];
      S.myFoods.push(f);
      save(); markDirty('customfood', f.id);
      picker.sel = f;
      picker.grams = picker.target ? eqGrams(picker.target, f) : (f.u ? f.u[1] : 100);
      picker.step = 'amount';
      renderPicker();
      toast('Alimento guardado');
    },
    'fp-save': () => {
      const p = picker; if (!p || !p.sel) return;
      const g = num(p.grams);
      if (!g || g <= 0 || g > 3000) { toast('Escribe cuántos gramos comiste'); return; }
      const entry = Object.assign({ fid: p.sel.id, n: p.sel.n, grams: r1(g) }, portion(p.sel, g));
      const day = foodDay(p.date);
      if (p.target) {
        day.swaps[p.foodId] = entry;
        if (!day.on.includes(p.foodId)) day.on.push(p.foodId);
      } else {
        day.extra.push(Object.assign({ id: 'x' + Date.now(), meal: p.meal }, entry));
      }
      S.recentFoods = [p.sel.id].concat(S.recentFoods.filter(id => id !== p.sel.id)).slice(0, 12);
      save(); markDirty('food', p.date);
      closeSheet(); picker = null; render();
      toast(p.target ? 'Cambio guardado' : 'Alimento agregado');
    },
    unswap: el => {
      const date = nutDate(); const day = foodDay(date);
      delete day.swaps[el.dataset.id];
      save(); markDirty('food', date); render();
    },
    'del-extra': el => {
      const date = nutDate(); const day = foodDay(date);
      day.extra = day.extra.filter(x => x.id !== el.dataset.id);
      save(); markDirty('food', date); render();
    },
    'ci-set': el => {
      const date = el.dataset.d, k = el.dataset.k, v = el.dataset.v;
      const c = S.checkins[date] = S.checkins[date] || {};
      if (k === 'noPeso') { c.noPeso = v === '1'; if (c.noPeso) c.peso = ''; }
      else c[k] = String(c[k]) === v ? '' : v;
      save(); markDirty('checkin', date); render();
    },
    'ci-week': el => { const d = el.dataset.d; location.hash = d === mondayOf(today()) ? '#/checkin' : '#/checkin/w' + d; },
    'send-week': el => {
      const m = el.dataset.d;
      shareText(weekSummaryText(m), `Resumen semanal de ${PERSON}`).then(() => { S.sent[m] = Date.now(); save(); render(); });
    },
    'add-measure': () => {
      const date = document.getElementById('m-date').value || today();
      const cintura = num(document.getElementById('m-cin').value), cadera = num(document.getElementById('m-cad').value);
      if (!cintura && !cadera) { toast('Anota al menos una medida'); return; }
      const m = { id: 'm' + Date.now(), date, cintura, cadera };
      S.measures.push(m);
      save(); markDirty('measure', m.id); render(); toast('Medición guardada');
    },
    'del-measure': el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = '¿Seguro?'; return; }
      S.measures = S.measures.filter(m => m.id !== el.dataset.id); save(); markDeleted('measure', el.dataset.id); render();
    },
    export: async () => {
      const json = JSON.stringify(Object.assign({}, S, { exportedAt: new Date().toISOString() }));
      const name = `plan-paola-respaldo-${today()}.json`;
      try {
        const file = new File([json], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: `Respaldo Plan ${PERSON}` }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      shareText(json, `Respaldo Plan ${PERSON}`);
    },
    'coach-create': () => {
      const v = document.getElementById('coach-pin').value.trim();
      if (!/^\d{4,6}$/.test(v)) { toast('El PIN debe tener 4 a 6 números'); return; }
      S.settings.coachPin = v; coachUnlocked = true; save(); render(); toast('PIN creado');
    },
    'coach-enter': () => {
      const v = document.getElementById('coach-pin').value.trim();
      if (v !== S.settings.coachPin) { toast('PIN incorrecto'); return; }
      coachUnlocked = true; render();
    },
    'coach-exit': () => { coachUnlocked = false; location.hash = '#/mas'; },
    'upper-day': el => { S.settings.upperDay = el.dataset.v; save(); render(); },
    swap: el => { const id = el.dataset.id; if (S.swaps[id]) delete S.swaps[id]; else S.swaps[id] = true; save(); render(); },
    'import-confirm': () => {
      if (!pendingImport) return;
      S = hydrate(pendingImport); pendingImport = null; S.deletes = []; markAllDirty(); schedulePush();
      closeSheet(); location.hash = '#/entrenar'; render(); toast('Respaldo recuperado');
    },
    'sync-now': () => { sync(); toast('Sincronizando…'); },
    logout: async el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez para cerrar sesión'; return; }
      try { await sb.auth.signOut(); } catch (e) { /* se cierra igual en este teléfono */ }
      user = null; notLinked = false; location.hash = '#/entrenar'; render();
    }
  };

  async function login() {
    const email = document.getElementById('lg-email').value.trim();
    const password = document.getElementById('lg-pass').value;
    if (!email || !password) { toast('Escribe tu correo y tu contraseña'); return; }
    const btn = document.getElementById('lg-btn');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      btn.disabled = false; btn.textContent = 'Entrar';
      toast(navigator.onLine ? 'Correo o contraseña incorrectos' : 'Necesitas internet para entrar');
      return;
    }
    user = data.user;
    if (S.syncedUser !== user.id) { S.syncedUser = user.id; markAllDirty(); }
    await sync();
    location.hash = '#/entrenar';
    render();
  }
  document.addEventListener('submit', e => {
    if (e.target.id === 'login-form') { e.preventDefault(); login(); }
  });

  function openFinishSheet() {
    const p = S.active.post || {};
    const scale = (k, from, to) => {
      const b = [];
      for (let i = from; i <= to; i++) b.push(`<button type="button" class="${p[k] === i ? 'on' : ''}" data-a="post-set" data-k="${k}" data-v="${i}">${i}</button>`);
      return `<div class="scale">${b.join('')}</div>`;
    };
    openSheet(`<h2>Terminar entrenamiento</h2>
      <div class="q"><span class="ql">¿Qué tan difícil fue?</span>${scale('difficulty', 1, 5)}<div class="scale-ends"><span>Fácil</span><span>Durísimo</span></div></div>
      ${PAIN ? `<div class="q"><span class="ql">Molestia en ${esc(PAIN.label === 'hombro' ? 'el hombro' : PAIN.label)}</span>${scale('shoulder', 0, 10)}<div class="scale-ends"><span>Nada</span><span>Mucha</span></div></div>` : ''}
      <button class="btn block lower" data-a="post-save">Guardar entrenamiento</button>
      <button class="btn block ghost" data-a="close">Seguir entrenando</button>`);
  }

  let pendingImport = null;

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (!el) return;
    const fn = actions[el.dataset.a];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'fp-q' && picker) {
      picker.q = t.value;
      document.getElementById('fp-results').innerHTML = resultsHtml(t.value);
      return;
    }
    if (t.id === 'fp-g' && picker) {
      picker.grams = t.value;
      document.getElementById('fp-tot').innerHTML = amountTotals();
      return;
    }
    if (t.dataset.draft && S.active) {
      const [exId, field] = t.dataset.draft.split(':');
      const e = normEntry(S.active.ex[exId]);
      e.draft[field] = t.value.trim();
      save();
    } else if (t.dataset.setup) {
      S.setups = S.setups || {};
      S.setups[t.dataset.setup] = t.value;
      save();
    } else if (t.dataset.note && S.active) {
      S.active.ex[t.dataset.note].note = t.value; save();
    } else if (t.dataset.ci) {
      const c = S.checkins[t.dataset.d] = S.checkins[t.dataset.d] || {};
      c[t.dataset.ci] = t.value.trim ? (t.dataset.ci === 'nota' ? t.value : t.value.trim()) : t.value;
      save(); markDirty('checkin', t.dataset.d);
    } else if (t.dataset.kcal) {
      const v = num(t.value); if (v && v >= 1000 && v <= 3000) { S.settings.kcal[t.dataset.kcal] = Math.round(v); save(); }
    } else if (t.dataset.coachname) {
      S.settings.coachName = t.value.trim() || 'Franco'; save();
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'c-start' && t.value) {
      S.settings.startDate = mondayOf(t.value); save(); render(); toast('Inicio: ' + fmtDay(S.settings.startDate));
    } else if (t.dataset.ci) {
      // Al salir del campo se refresca para actualizar marcas de completado.
      const { name } = current(); if (name === 'checkin') render();
    } else if (t.dataset.kcal) {
      render();
    } else if (t.id === 'import-file' && t.files && t.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.sessions) || typeof data.checkins !== 'object') throw new Error('formato');
          pendingImport = data;
          openSheet(`<h2>¿Reemplazar los datos?</h2><p>El respaldo${data.exportedAt ? ' del ' + esc(fmtDay(ymd(new Date(data.exportedAt)))) : ''} tiene ${data.sessions.length} entrenamientos y ${Object.keys(data.checkins).length} días de check-in. Lo que hay ahora en este teléfono se pierde.</p>
            <button class="btn block lower" data-a="import-confirm">Reemplazar</button><button class="btn block ghost" data-a="close">Cancelar</button>`);
        } catch (err) { toast('Ese archivo no es un respaldo de esta app'); }
        t.value = '';
      };
      reader.readAsText(t.files[0]);
    }
  });

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render();
    if (!syncInfo.at || Date.now() - syncInfo.at > 60000) sync();
  });
  window.addEventListener('online', () => sync());
  render();
  initAuth();
  CORE.pullToRefresh(async () => {
    if (sb && user) await sync();
    location.reload();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin modo offline */ });
  }
})();
