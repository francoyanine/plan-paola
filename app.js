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
      plan: {}, dirty: {}, deletes: [], syncedUser: null, myFoods: [], recentFoods: [], usual: {}
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
  S.usual = S.usual || {};

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
    const done = new Set(weekSessions(monday).map(s => s.routine).concat(Object.keys(weekSkips(monday))));
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
  const trainedOn = d => S.sessions.some(s => s.date === d);
  const missingOn = d => CORE.checkinMissing(S.checkins[d], d, trainedOn(d));
  const dayDone = d => !!S.checkins[d] && missingOn(d).length === 0;
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
      days, registered: days.filter(dayDone).length,
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
      if (c.estres) parts.push(`estrés ${CORE.ESTRES[c.estres].toLowerCase()}`);
      if (c.entreno) parts.push(c.entreno === 'descanso' ? 'descanso' : (c.entreno === 'otro' ? `entrenó: ${c.entrenoTxt || 'otro'}` : `entrenó ${ROUTINES[c.entreno] ? ROUTINES[c.entreno].name : c.entreno}`));
      if (c.cardio === 'si') parts.push(`cardio${c.cardioTxt ? ' (' + c.cardioTxt + ')' : ''}`);
      if (c.extraAct === 'si') parts.push(`actividad extra${c.extraActTxt ? ' (' + c.extraActTxt + ')' : ''}`);
      L.push(`${DOW[dowIdx(d)]} ${parse(d).getDate()}: ${parts.join(' · ')}`);
      if (c.fuera === 'si') L.push(`   Fuera de lo común: ${c.fueraTxt || 'sí'}`);
      (c.skips || []).forEach(x => L.push(`   Saltó ${ROUTINES[x.rid] ? ROUTINES[x.rid].name : x.rid}${x.reason ? ': ' + x.reason : ''}`));
      if (c.nota) L.push(`   Nota: ${c.nota}`);
      const fd = S.food[d];
      if (fd && fd.note) L.push(`   Nota de comidas: ${fd.note}`);
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

  // Día programado de cada rutina en la semana (0 = lunes) y entrenamientos saltados (se guardan en el check-in del día).
  function routineDays() {
    const out = {};
    Object.entries(schedule()).forEach(([i, r]) => { if (out[r] === undefined) out[r] = Number(i); });
    return out;
  }
  function weekSkips(monday) {
    const out = {};
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      ((S.checkins[d] && S.checkins[d].skips) || []).forEach(x => { out[x.rid] = Object.assign({ on: d }, x); });
    }
    return out;
  }
  // Estado de cada rutina en la semana: hecha, saltada, atrasada (ya pasó su día) o pendiente.
  function routineStatus(monday) {
    const t = today();
    const days = routineDays();
    const done = {};
    weekSessions(monday).forEach(s => { done[s.routine] = s; });
    const skips = weekSkips(monday);
    const st = {};
    ROUTINE_ORDER.forEach(rid => {
      const date = days[rid] === undefined ? null : addDays(monday, days[rid]);
      if (done[rid]) st[rid] = { state: 'done', s: done[rid], date };
      else if (skips[rid]) st[rid] = { state: 'skip', skip: skips[rid], date };
      else if (date && date < t && date >= S.settings.startDate && !ROUTINES[rid].optional) st[rid] = { state: 'late', late: daysBetween(date, t), date };
      else st[rid] = { state: 'pending', date };
    });
    return st;
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const fmtDur = min => (min >= 60 ? `${Math.floor(min / 60)} h ${pad(min % 60)} min` : `${min} min`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // Series hechas y series indicadas de una sesión terminada.
  function seriesCount(s) {
    const r = ROUTINES[s.routine];
    let total = 0, done = 0;
    r.exercises.forEach(ex => {
      const e = s.ex[ex.id];
      total += CORE.presSets(presFor(s.week, ex.id), resolveEx(ex, e && e.alt));
      done += e ? e.sets.length : 0;
    });
    return { done, total };
  }

  function viewEntrenar() {
    const t = today();
    const monday = mondayOf(t);
    const b = block(t);
    const map = schedule();
    const status = routineStatus(monday);
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
      const st = r && status[r];
      const cls = ['wd', rr ? rr.kind : '', rr && rr.optional ? 'opt' : '', date === t ? 'today' : '', st && st.state === 'done' ? 'done' : '', st && st.state === 'late' ? 'late' : ''].join(' ');
      const mark = st ? ({ done: '✓', late: '!', skip: '–' }[st.state] || '') : '';
      const inner = `<span class="d">${d}</span><span class="s">${rr ? rr.name.replace(' ', '<br>') : '·'}</span><span class="m">${mark}</span>`;
      return rr ? `<a class="${cls}" href="#/workout/${r}">${inner}</a>` : `<div class="${cls}">${inner}</div>`;
    }).join('');
    const required = ROUTINE_ORDER.filter(r => !ROUTINES[r].optional);
    const doneCount = required.filter(r => status[r].state === 'done').length;
    const weekLine = b.phase === 'pre'
      ? `Parte el ${fmtDay(S.settings.startDate)}`
      : `${b.weekIn ? `Semana ${b.weekIn}${b.weeksTotal ? ' de ' + b.weeksTotal : ''}` : ''} · semana ${b.week} del plan`;
    parts.push(`<section class="card block-card">
      <div class="card-head"><span class="eyebrow">Bloque activo</span><span class="small muted num">${esc(weekLine)}</span></div>
      <h2>${esc(b.info.name)}</h2>
      <div class="progress" aria-label="Avance del plan"><span style="width:${pct}%"></span></div>
      <div class="weekstrip">${strip}</div>
      ${b.phase === 'pre' ? '' : `<div class="card-head small"><span class="muted">Esta semana</span><b class="num">${doneCount} / ${required.length} entrenamientos</b></div>`}
    </section>`);

    const wkPlan = S.plan[b.week];
    if (wkPlan && wkPlan.note) parts.push(`<div class="notice ok"><div><b>${esc(S.settings.coachName)} · semana ${b.week}:</b> ${esc(wkPlan.note)}</div></div>`);

    // Registro diario: los 7 días de la semana y el acceso al primero que falta.
    const ciDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    const missing = ciDays.filter(d => d <= t && d >= S.settings.startDate && !dayDone(d));
    const dots = ciDays.map((d, i) => {
      const cls = dayDone(d) ? 'done' : (d > t || d < S.settings.startDate ? 'future' : 'pending');
      return `<span class="cidot ${cls} ${d === t ? 'today' : ''}"><i>${dayDone(d) ? '✓' : (cls === 'pending' ? '–' : '')}</i><span>${DOW[i].charAt(0)}</span></span>`;
    }).join('');
    parts.push(`<a class="card ci-card" href="#/checkin/${missing[0] || t}">
      <div class="card-head"><span class="eyebrow">Check-in</span><span class="chev" aria-hidden="true">›</span></div>
      <h3>Registro diario 📝</h3>
      <span class="small ${missing.length ? 'warn-t' : 'ok-t'}">${missing.length ? `${plural(missing.length, 'día', 'días')} sin completar ⚠️` : 'Todo al día ✓'}</span>
      <div class="ci-row"><div class="cidots">${dots}</div>${missing.length ? '<span class="btn small soft">Llenar →</span>' : ''}</div></a>`);

    if (S.active) {
      const r = ROUTINES[S.active.routine];
      parts.push(`<section class="card next ${r.kind}"><span class="eyebrow">En curso</span><span class="rname">${r.name}</span>
        <p class="muted small">Empezaste a las ${new Date(S.active.startedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}.</p>
        <a class="btn block ${r.kind}" href="#/workout/${r.id}">Continuar entrenamiento</a></section>`);
    } else {
      const nr = nextRoutine(monday);
      if (nr) {
        const r = ROUTINES[nr];
        const st = status[nr];
        const late = st.state === 'late';
        parts.push(`<section class="card next ${r.kind}"><div class="card-head"><span class="eyebrow ${late ? 'warn-t' : ''}">${late ? 'Atrasado' : 'Próximo'}${r.optional ? ' · optativo' : ''}</span>${st.date ? `<span class="small muted">${esc(cap(fmtDay(st.date)))}</span>` : ''}</div>
          <span class="rname">${r.name}</span>
          <p class="muted small">${late ? `Tocaba hace ${plural(st.late, 'día', 'días')}. Hazlo apenas puedas.` : esc(r.day)} · ≈${r.minutes} min · ${r.exercises.length} ejercicios</p>
          <a class="btn block ${r.kind}" href="#/workout/${r.id}">Comenzar entrenamiento →</a></section>`);
      } else {
        parts.push(`<div class="notice ok"><div><b>Semana completa.</b> Hiciste todas las sesiones. Descanso y a caminar.</div></div>`);
      }
    }

    const rows = ROUTINE_ORDER.map(rid => {
      const r = ROUTINES[rid];
      const st = status[rid];
      let sub, href = '#/workout/' + rid, lead = `<span class="daytag ${r.kind}">${st.date ? DOW[dowIdx(st.date)] : '—'}</span>`, cls = '';
      if (st.state === 'done') {
        const s = st.s, n = seriesCount(s);
        sub = `${DOW[dowIdx(s.date)]} ${fmtShort(s.date)} · ${fmtDur(s.minutes)} · ${n.done}/${n.total} series`;
        href = '#/session/' + s.id; cls = 'done'; lead = '<span class="daytag ok">✓</span>';
      } else if (st.state === 'skip') {
        sub = `Saltado${st.skip.reason ? ' · ' + esc(st.skip.reason) : ''}`; cls = 'skip'; lead = '<span class="daytag">–</span>';
      } else if (st.state === 'late') {
        sub = `<span class="warn-t">⚠️ Atrasado · ${plural(st.late, 'día', 'días')}</span>`;
      } else {
        sub = `<span class="up-t">${st.date ? DOW_LONG[dowIdx(st.date)] : esc(r.day)} · ${r.optional ? 'optativo' : 'pendiente'}</span>`;
      }
      return `<a class="li wk-row ${cls}" href="${href}">${lead}<span class="grow"><span class="t">${r.name}</span><span class="s">${sub}</span></span><span class="chev">›</span></a>`;
    }).join('');
    parts.push(`<section class="card flush"><div class="sec-h"><h3>Esta semana ⏳</h3></div><div class="list">${rows}</div></section>`);

    if (b.phase !== 'pre') {
      const weeks = [];
      for (let w = Math.max(1, b.week); w >= 1 && weeks.length < 4; w--) weeks.push(w);
      const weekRows = weeks.map(w => {
        const m = CORE.weekStart(S.settings.startDate, w);
        const n = new Set(weekSessions(m).filter(s => !ROUTINES[s.routine].optional).map(s => s.routine)).size;
        return `<a class="li" href="#/historial"><span class="daytag">S${w}</span><span class="grow"><span class="t">Semana ${w}</span><span class="s">${n}/${required.length} completados · ${fmtShort(m)}</span></span><span class="chev">›</span></a>`;
      }).join('');
      parts.push(`<section class="card flush"><div class="sec-h"><h3>Historial 📊</h3><a class="linkbtn" href="#/historial">Ver sesiones</a></div><div class="list">
        <a class="li" href="#/bloque"><span class="daytag">BLQ</span><span class="grow"><span class="t">Ver bloque completo</span><span class="s">Todas las semanas, ejercicio por ejercicio</span></span><span class="chev">›</span></a>${weekRows}</div></section>`);
    }
    return { title: 'Entrenamiento', html: parts.join(''), pill: phasePill(t) };
  }

  // Todo el bloque: lo que se hizo en cada semana del plan, ejercicio por ejercicio.
  function viewBloque() {
    const lastW = Math.max(1, block().week);
    const parts = [`<p class="small muted">Cada fila es una semana del plan, con los kilos y repeticiones de cada serie. Sirve para ver cómo vas progresando.</p>`];
    ROUTINE_ORDER.forEach(rid => {
      const r = ROUTINES[rid];
      const labels = exNumbering(r);
      const rows = r.exercises.map(ex => {
        const weeks = [];
        for (let w = 1; w <= lastW; w++) {
          const s = sortedSessions().filter(x => x.routine === rid && x.week === w).pop();
          const e = s && s.ex[ex.id];
          if (e && e.sets.length) weeks.push(`<tr><th>Sem ${w}</th><td>${esc(setsText(resolveEx(ex, e.alt), e.sets))}${e.alt ? ' <span class="tag warn">variante</span>' : ''}</td></tr>`);
        }
        return `<div class="blq-ex"><div class="blq-n"><span class="ex-n">${labels[ex.id]}</span><b>${esc(ex.name)}</b></div>
          ${weeks.length ? `<table class="blq-t"><tbody>${weeks.join('')}</tbody></table>` : '<p class="small muted">Sin registros todavía.</p>'}</div>`;
      }).join('');
      parts.push(`<section class="card"><div class="card-head"><span class="tag ${r.kind}">${r.name}</span><span class="small muted">${esc(r.day)}</span></div>${rows}</section>`);
    });
    return { title: 'Bloque completo', back: '#/entrenar', html: parts.join('') };
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
      const st = routineStatus(mondayOf(today()))[rid];
      if (st.state === 'skip') {
        parts.push(`<div class="notice"><div><b>Lo marcaste como saltado esta semana${st.skip.reason ? ': ' + esc(st.skip.reason) : ''}.</b> <button class="linkbtn" data-a="unskip" data-r="${rid}">Deshacer</button></div></div>`);
      }
      parts.push(`<button class="btn block ${r.kind}" data-a="start" data-r="${rid}">Comenzar entrenamiento</button>`);
      parts.push(`<a class="btn block ghost" href="#/bloque">Ver bloque completo →</a>`);
      if (st.state !== 'done' && st.state !== 'skip') parts.push(`<button class="linkbtn center" data-a="skip" data-r="${rid}">Saltar entrenamiento</button>`);
      parts.push(`<p class="small muted center">Solo lectura · Comienza el entrenamiento para registrar las series.</p>`);
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

  const waterGoal = () => Number(window.DATA.water) || 2000;
  const sumFoods = list => {
    const t = { kcal: 0, p: 0, g: 0, c: 0 };
    list.forEach(f => { t.kcal += f.kcal || 0; t.p += f.p || 0; t.g += f.g || 0; t.c += f.c || 0; });
    return t;
  };
  const dayHasCustom = day => !!day && (Object.keys(day.swaps || {}).length || (day.extra || []).length || Object.keys(day.qty || {}).length);

  function viewNutricion(dateArg) {
    const date = dateArg || today();
    const tg = targets(date);
    const day = S.food[date] || { on: [], water: 0 };
    const meals = mealsFor(date, day);
    const baseMeals = mealsFor(date, null);
    const eaten = f => f.extra || day.on.includes(f.id);
    const tot = sumFoods(meals.flatMap(m => m.foods).filter(eaten));
    const kcal = tot.kcal;
    const [prot, fat, carb] = [tot.p, tot.g, tot.c].map(Math.round);
    const bar = (label, v, goal) => `<div class="bar"><div class="top"><span>${label}</span><b>${v} / ${goal} g</b></div><div class="track"><span style="width:${Math.min(100, v / goal * 100)}%"></span></div></div>`;
    const C = 2 * Math.PI * 48;
    const frac = Math.min(1, kcal / tg.kcal);
    const left = tg.kcal - kcal;
    const label = date === today() ? 'Hoy' : (date === addDays(today(), -1) ? 'Ayer' : fmtDay(date));
    const parts = [];
    parts.push(`<div class="macrobar" id="macrobar" hidden><div class="mb-k"><span class="eyebrow">Día</span><span><b>${nf(kcal, 0)}</b> / ${nf(tg.kcal, 0)} kcal</span></div>
      <div class="mb-m"><span><i>P</i><b>${prot}</b>/${tg.p}</span><span><i>C</i><b>${carb}</b>/${tg.c}</span><span><i>G</i><b>${fat}</b>/${tg.g}</span></div></div>`);
    parts.push(`<div class="daynav"><button data-a="nut-day" data-d="${addDays(date, -1)}" aria-label="Día anterior">‹</button><span class="dl">${esc(cap(label))}</span><button data-a="nut-day" data-d="${addDays(date, 1)}" aria-label="Día siguiente">›</button></div>`);
    parts.push(`<details class="card tipsbox"><summary><span class="eyebrow">📋 Indicaciones del plan</span><span class="chev" aria-hidden="true">▾</span></summary><ul class="tips">${NUTRITION_TIPS.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`);
    parts.push(`<section class="card" id="nut-ring">
      <div class="kcal-row">
        <div class="ring"><svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="48" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="56" cy="56" r="48" fill="none" stroke="var(--lower)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
          <div class="c"><b>${nf(kcal, 0)}</b><span>de ${nf(tg.kcal, 0)} kcal</span><span class="${left >= 0 ? 'up-t' : 'warn-t'}">${left >= 0 ? nf(left, 0) + ' libres' : nf(-left, 0) + ' de más'}</span></div></div>
        <div class="bars">
          ${bar('Proteína', prot, tg.p)}${bar('Carbos', carb, tg.c)}${bar('Grasa', fat, tg.g)}
        </div>
      </div>
      <p class="small muted">Marca cada alimento cuando lo comas, o toda la comida con el cuadro de arriba. Toca un alimento para cambiar la cantidad o reemplazarlo.</p>
    </section>`);
    const water = day.water || 0;
    parts.push(`<section class="card"><div class="card-head"><span class="eyebrow">💧 Hidratación</span><span class="wv"><b>${nf(water / 1000, 2)}</b> / ${nf(waterGoal() / 1000, 1)} L</span></div>
      <div class="track wtrack"><span style="width:${Math.min(100, water / waterGoal() * 100)}%"></span></div>
      <div class="wbtns"><button data-a="water" data-v="250">+ Vaso 250</button><button data-a="water" data-v="500">+ Botella 500</button><button data-a="water" data-v="1000">+ 1 L</button>
        <button class="wide" data-a="water-other">+ Otro…</button><button data-a="water" data-v="-250" aria-label="Restar 250 ml">−</button></div></section>`);
    parts.push(`<button class="card toolbtn" data-a="copy-day">⧉ Copiar otro día completo acá</button>`);
    meals.forEach((m, mi) => {
      const planned = m.foods.filter(f => !f.extra && !f.free);
      const allOn = planned.length > 0 && planned.every(f => day.on.includes(f.id));
      const got = sumFoods(m.foods.filter(eaten));
      const base = sumFoods(baseMeals[mi].foods);
      const custom = m.foods.some(f => f.extra || f.swappedFrom || f.factor);
      const foods = m.foods.map(f => {
        const on = eaten(f);
        const tick = f.extra
          ? `<span class="tick on" aria-hidden="true">✓</span>`
          : `<button class="tick" data-a="food" data-id="${f.id}" aria-pressed="${on}" aria-label="Marcar ${esc(f.name)}">✓</button>`;
        const nameEl = f.free ? `<div class="fname">${esc(f.name)}</div>` : `<button class="fname" data-a="edit-food" data-id="${f.id}">${esc(f.name)}</button>`;
        const notes = [
          f.cutPortion && !f.swappedFrom ? '<div class="cut-note">Porción de mini cut</div>' : '',
          f.fixed && !f.factor ? '<div class="fixed-note">Fijo</div>' : '',
          f.swappedFrom ? `<div class="swap-note">En vez de ${esc(f.swappedFrom)} · <button class="linkbtn small" data-a="unswap" data-id="${f.id}">volver al original</button></div>` : '',
          f.factor ? `<div class="swap-note">Cantidad cambiada · <button class="linkbtn small" data-a="unqty" data-id="${f.id}">volver a lo del plan</button></div>` : '',
          f.extra ? `<div class="swap-note">Agregado · <button class="linkbtn small" data-a="del-extra" data-id="${f.id}">quitar</button></div>` : '',
          !f.free && !f.extra ? `<button class="eqb" data-a="swap-food" data-id="${f.id}">⇄ Equivalencias</button>` : ''
        ].join('');
        return `<div class="food ${on ? 'on' : ''}">${tick}
          <div style="min-width:0">${nameEl}<div class="fq">${esc(f.qty)}</div>${notes}</div>
          <div class="fk">${f.free ? '<b>libre</b>no se cuenta' : `<b>${f.estimate ? '≈' : ''}${f.kcal}</b>kcal${f.estimate ? '<br>por confirmar' : `<br>P ${fmtM(f.p)} · G ${fmtM(f.g)} · C ${fmtM(f.c)}`}`}</div></div>`;
      }).join('');
      parts.push(`<section class="card flush"><div class="meal-head">
          ${planned.length ? `<button class="mtick ${allOn ? 'on' : ''}" data-a="meal-all" data-meal="${m.id}" aria-pressed="${allOn}" aria-label="Marcar toda la comida">✓</button>` : ''}
          <div class="grow"><h3 class="${allOn ? 'up-t' : ''}">${esc(m.name)}</h3>${custom ? '<span class="eyebrow up-t">Personalizado</span>' : ''}</div>
          <span class="mk"><b>${nf(got.kcal, 0)}</b> / ${nf(base.kcal, 0)} kcal</span></div>
        <div class="meal-mac">P ${fmtM(got.p)}/${fmtM(base.p)} · C ${fmtM(got.c)}/${fmtM(base.c)} · G ${fmtM(got.g)}/${fmtM(base.g)}</div>
        ${foods}
        <button class="addfood" data-a="add-food" data-meal="${m.id}">+ Agregar alimento</button></section>`);
    });
    if (dayHasCustom(S.food[date])) parts.push(`<button class="card toolbtn" data-a="restore-day" data-d="${date}">↺ Restaurar dieta base del día</button>`);
    parts.push(`<section class="card form"><label class="eyebrow" for="nut-note">Nota del día</label>
      <textarea id="nut-note" data-nnote="${date}" placeholder="Ej.: comí fuera, antojos, digestión…">${esc(day.note || '')}</textarea>
      <span class="small muted">${esc(S.settings.coachName)} la ve junto a tus comidas.</span></section>`);
    return { title: 'Nutrición', html: parts.join(''), pill: phasePill(date) };
  }

  // Barra fija con calorías y macros del día, visible cuando el resumen de arriba sale de la pantalla.
  let mbObs = null;
  function setupMacrobar() {
    if (mbObs) { mbObs.disconnect(); mbObs = null; }
    const bar = document.getElementById('macrobar'), ring = document.getElementById('nut-ring');
    if (!bar || !ring || !('IntersectionObserver' in window)) return;
    const h = document.getElementById('hdr').offsetHeight;
    bar.style.top = h + 'px';
    mbObs = new IntersectionObserver(([e]) => { bar.hidden = e.isIntersecting || e.boundingClientRect.top > h; }, { rootMargin: `-${h}px 0px 0px 0px` });
    mbObs.observe(ring);
  }

  // Selector de alimentos (hoja inferior): equivalentes, categorías, búsqueda, cantidad, agregado rápido y alimentos propios.
  let picker = null;
  const nutDate = () => { const { name, arg } = current(); return (name === 'nutricion' && arg) || today(); };
  const CATS = [['', 'Recientes'], ['proteina', 'Proteína'], ['carbo', 'Carbo'], ['grasa', 'Grasa'], ['lacteo', 'Lácteo'], ['fruta', 'Fruta'], ['verdura', 'Vegetal'], ['otros', 'Otros']];
  function searchFoods(q, cat) {
    const qn = norm(q.trim());
    if (!qn && !cat) {
      const recent = S.recentFoods.map(findFood).filter(f => f && !S.myFoods.includes(f));
      return S.myFoods.slice().reverse().concat(recent).slice(0, 15);
    }
    const words = qn ? qn.split(/\s+/) : [];
    return S.myFoods.concat(FOODS)
      .filter(f => (!cat || f.cat === cat) && words.every(w => norm(f.n).includes(w)))
      .sort((a, b) => (Number(!!S.usual[b.id]) - Number(!!S.usual[a.id])) || (qn ? Number(norm(b.n).startsWith(qn)) - Number(norm(a.n).startsWith(qn)) : 0) || a.n.localeCompare(b.n, 'es'))
      .slice(0, 60);
  }
  function fpItem(f) {
    const t = picker.target;
    let right = `<b>${f.kcal}</b>kcal/100 g`;
    if (t) { const g = eqGrams(t, f); right = `<b>${fmtM(g)} g</b>${portion(f, g).kcal} kcal`; }
    const mine = S.myFoods.includes(f);
    const usual = S.usual[f.id];
    return `<button class="fp-item" data-a="fp-pick" data-fid="${esc(f.id)}"><span class="grow"><span class="t">${esc(f.n)}</span>
      <span class="s">${mine ? 'Mi alimento · ' : ''}por 100 g: P ${fmtM(f.p)} · G ${fmtM(f.g)} · C ${fmtM(f.c)}${f.src && !mine ? ' · ' + esc(f.src) : ''}</span>
      ${usual ? `<span class="s">Sueles usar <b class="up-t">${fmtM(usual)} g</b></span>` : ''}</span><span class="r">${right}</span></button>`;
  }
  function resultsHtml(q, cat) {
    const list = searchFoods(q, cat);
    if (!list.length) return q.trim() ? `<p class="muted small">No encontré «${esc(q)}». Créalo con la información de su etiqueta.</p>` : `<p class="muted small">Escribe para buscar entre ${FOODS.length} alimentos, o elige una categoría. Los que uses o crees aparecen aquí.</p>`;
    return (q.trim() || cat ? '' : '<div class="eyebrow">Mis alimentos y recientes</div>') + list.map(fpItem).join('');
  }
  function renderPicker() {
    const p = picker;
    if (p.step === 'amount') return renderAmount();
    if (p.step === 'create') return renderCreate();
    if (p.step === 'quick') return renderQuick();
    const t = p.target;
    const meal = MEALS.find(m => m.id === p.meal);
    const head = t
      ? `<div><span class="eyebrow">Reemplazar</span><h2>${esc(t.name)}</h2></div><p class="muted small">En el plan: ${esc(t.qty)} · ${t.kcal} kcal. Las cantidades sugeridas igualan ${MATCH_LABEL[MATCH[t.cat] || 'kcal']}.</p>`
      : `<div><span class="eyebrow">Agregar</span><h2>${esc(meal ? meal.name : 'Alimento')}</h2></div>`;
    const sugg = t ? (t.alts || []).map(foodByName).filter(Boolean) : [];
    openSheet(`${head}
      <input class="inp" id="fp-q" type="search" placeholder="Buscar alimento… ej.: marraqueta, yogur, pollo" autocomplete="off" value="${esc(p.q || '')}" aria-label="Buscar alimento">
      <div class="cattabs" role="tablist">${CATS.map(([id, l]) => `<button type="button" role="tab" class="${(p.cat || '') === id ? 'on' : ''}" aria-selected="${(p.cat || '') === id}" data-a="fp-cat" data-v="${id}">${l}</button>`).join('')}</div>
      <div class="two">${t ? '' : '<button class="btn soft" data-a="fp-quick">⚡ Agregado rápido</button>'}<button class="btn soft" data-a="fp-create">+ Crear alimento</button></div>
      ${sugg.length && !p.q && !p.cat ? `<div class="eyebrow">Equivalentes del plan</div><div class="fp-list">${sugg.map(fpItem).join('')}</div>` : ''}
      <div class="fp-list" id="fp-results">${resultsHtml(p.q || '', p.cat || '')}</div>
      <button class="btn block ghost" data-a="close">Cancelar</button>`);
  }
  const macroTiles = q => `<div class="mtiles"><div><b>${fmtM(q.p)}</b><span>Proteína</span></div><div><b>${fmtM(q.c)}</b><span>Carbos</span></div><div><b>${fmtM(q.g)}</b><span>Grasas</span></div><div><b>${nf(q.kcal, 0)}</b><span>Kcal</span></div></div>`;
  function amountTotals() {
    const p = picker, f = p.sel, g = num(p.grams) || 0;
    const q = portion(f, g);
    let html = macroTiles(q);
    if (p.target && p.target.kcal > 0) {
      const d = q.kcal - p.target.kcal;
      html += `<p class="small muted">En el plan: ${p.target.kcal} kcal · P ${fmtM(p.target.p)} · G ${fmtM(p.target.g)} · C ${fmtM(p.target.c)} (${d >= 0 ? '+' : ''}${d} kcal)</p>`;
    }
    return html;
  }
  function renderAmount() {
    const p = picker, f = p.sel;
    const opts = [];
    if (p.target) opts.push(['Equivalente', eqGrams(p.target, f)]);
    if (S.usual[f.id]) opts.push(['Lo de siempre', S.usual[f.id]]);
    if (f.u) {
      const unit = f.u[0].replace(/^1 /, '');
      opts.push([f.u[0], f.u[1]], ['½ ' + unit, r1(f.u[1] / 2)], ['2 × ' + unit, f.u[1] * 2]);
    }
    opts.push(['', 100]);
    openSheet(`<button class="linkbtn" data-a="fp-back">← Volver</button>
      <div><h2>${esc(f.n)}</h2><p class="muted small">Se mide en gramos · ${f.kcal} kcal/100 g${f.src ? ' · ' + esc(f.src) : ''}</p></div>
      <div class="q"><label for="fp-g" class="eyebrow">Cantidad (gramos)</label><div class="inp-u"><input class="inp" id="fp-g" inputmode="decimal" autocomplete="off" value="${esc(String(p.grams).replace('.', ','))}"><span class="u">g</span></div>
        ${!p.target && S.usual[f.id] && Number(p.grams) === S.usual[f.id] ? '<span class="small muted">Lo que sueles usar. Cámbialo si hoy es distinto.</span>' : ''}</div>
      <div class="chipsel">${opts.map(([l, g]) => `<button type="button" data-a="fp-g" data-v="${g}">${l ? esc(l) + ' ' : ''}<span class="${l ? 'muted' : ''}">${fmtM(g)} g</span></button>`).join('')}</div>
      <div id="fp-tot">${amountTotals()}</div>
      <button class="btn block" data-a="fp-save">${p.target ? 'Guardar cambio' : 'Agregar'}</button>`);
  }
  function renderQuick() {
    const field = (id, label, unit) => `<div class="q"><label for="${id}">${label}</label><div class="inp-u"><input class="inp" id="${id}" inputmode="decimal" autocomplete="off"><span class="u">${unit}</span></div></div>`;
    openSheet(`<button class="linkbtn" data-a="fp-back">← Volver</button>
      <div><span class="eyebrow">Agregado rápido</span><h2>Anotar calorías y macros</h2></div>
      <p class="muted small">Para cuando comes algo que no está en la lista y sabes (o calculas) sus calorías. Si solo pones los macros, las calorías se calculan solas.</p>
      <div class="q"><label for="qa-n">Qué fue <span class="hint">opcional</span></label><input class="inp" id="qa-n" autocomplete="off" placeholder="Ej.: empanada de queso"></div>
      ${field('qa-kcal', 'Calorías', 'kcal')}
      <div class="two">${field('qa-p', 'Proteína', 'g')}${field('qa-c', 'Carbos', 'g')}</div>
      ${field('qa-g', 'Grasas', 'g')}
      <button class="btn block" data-a="qa-save">Agregar</button>`);
  }

  // Editor de un alimento del día: cantidad (porciones del plan o gramos), reemplazo y quitar.
  let editor = null;
  function editorFood() {
    const day = S.food[editor.date] || { on: [] };
    return mealsFor(editor.date, day).flatMap(m => m.foods).find(x => x.id === editor.id) || null;
  }
  function editorCalc() {
    const f = editorFood(); if (!f) return null;
    const v = num(editor.val) || 0;
    if (editor.kind === 'plan') { const b = f.plan || f; return { kcal: Math.round(b.kcal * v), p: r1(b.p * v), g: r1((b.g || 0) * v), c: r1((b.c || 0) * v) }; }
    if (editor.food) return portion(editor.food, v);
    return { kcal: f.kcal, p: f.p, g: f.g, c: f.c };
  }
  function renderEditor() {
    const f = editorFood(); if (!f) { closeSheet(); return; }
    const k = editor.kind;
    let field = '';
    if (k === 'plan') {
      const b = f.plan || f;
      const opts = [[0.5, '½'], [0.75, '¾'], [1, '1'], [1.25, '1¼'], [1.5, '1½'], [2, '2']];
      field = `<div class="q"><label class="eyebrow" for="ed-v">Porciones del plan</label><p class="small muted">1 porción = ${esc(b.qty)}</p>
        <div class="inp-u"><input class="inp" id="ed-v" inputmode="decimal" autocomplete="off" value="${esc(String(editor.val).replace('.', ','))}"><span class="u">× porción</span></div></div>
        <div class="chipsel">${opts.map(([o, l]) => `<button type="button" data-a="ed-set" data-v="${o}">${l} ×</button>`).join('')}</div>`;
    } else if (editor.food) {
      field = `<div class="q"><label class="eyebrow" for="ed-v">Cantidad (gramos)</label><div class="inp-u"><input class="inp" id="ed-v" inputmode="decimal" autocomplete="off" value="${esc(String(editor.val).replace('.', ','))}"><span class="u">g</span></div></div>`;
    }
    const canSwap = k !== 'extra';
    openSheet(`<h2>${esc(f.name)}</h2>
      ${f.swappedFrom ? `<p class="small muted">En vez de ${esc(f.swappedFrom)}</p>` : ''}
      ${field}
      <div id="ed-tot">${macroTiles(editorCalc())}</div>
      ${canSwap ? `<button class="btn block soft" data-a="swap-food" data-id="${f.id}">⇄ Cambiar por otro alimento</button>` : ''}
      <div class="two">${k === 'extra' ? `<button class="btn danger" data-a="del-extra" data-id="${f.id}">Eliminar</button>` : (k === 'swap' ? `<button class="btn ghost" data-a="unswap" data-id="${f.id}">Volver al plan</button>` : `<button class="btn ghost" data-a="close">Cancelar</button>`)}
        ${field ? '<button class="btn" data-a="ed-save">Guardar</button>' : '<button class="btn ghost" data-a="close">Cerrar</button>'}</div>`);
  }
  function renderCreate() {
    const p = picker;
    const field = (id, label, unit, val) => `<div class="q"><label for="${id}">${label}</label><div class="inp-u"><input class="inp" id="${id}" inputmode="decimal" autocomplete="off" value="${esc(val || '')}"><span class="u">${unit}</span></div></div>`;
    openSheet(`<button class="linkbtn" data-a="fp-back">← Volver</button><h2>Crear alimento</h2>
      <p class="muted small">Copia la información nutricional de la etiqueta, la columna de 100 g. Queda guardado para la próxima vez.</p>
      <div class="q"><label for="fc-n">Nombre</label><input class="inp" id="fc-n" autocomplete="off" value="${esc(p.q || '')}" placeholder="Ej.: Pan pita integral Ideal"></div>
      <div class="two">${field('fc-kcal', 'Energía', 'kcal')}${field('fc-p', 'Proteínas', 'g')}</div>
      <div class="two">${field('fc-g', 'Grasas totales', 'g')}${field('fc-c', 'H. de C. disponibles', 'g')}</div>
      <p class="small muted">Opcional: una porción para elegirla rápido.</p>
      <div class="two"><div class="q"><label for="fc-un">Porción</label><input class="inp" id="fc-un" autocomplete="off" placeholder="1 unidad"></div>${field('fc-ug', 'Gramos de la porción', 'g')}</div>
      <button class="btn block" data-a="fc-save">Guardar alimento</button>`);
  }

  function scaleButtons(field, from, to, value, date) {
    const btns = [];
    for (let i = from; i <= to; i++) btns.push(`<button type="button" class="${String(value) === String(i) ? 'on' : ''}" data-a="ci-set" data-k="${field}" data-v="${i}" data-d="${date}">${i}</button>`);
    return `<div class="scale">${btns.join('')}</div>`;
  }
  function segButtons(field, options, value, date) {
    return `<div class="seg">${Object.entries(options).map(([k, l]) => `<button type="button" class="${value === k ? 'on' : ''}" data-a="ci-set" data-k="${field}" data-v="${k}" data-d="${date}">${l}</button>`).join('')}</div>`;
  }

  const ENERGY_L = { baja: '🪫 Baja', promedio: '😐 Promedio', alta: '⚡ Alta' };
  const ESTRES_L = { alto: '😰 Alto', promedio: '😐 Promedio', bajo: '😌 Bajo' };
  const YESNO = { no: 'No', si: 'Sí' };
  const hasVal = v => v !== undefined && v !== null && String(v).trim() !== '';
  // Tira de los 7 días de la semana de una fecha, con su estado (completo, pendiente o futuro).
  function ciStrip(monday, selected) {
    const t = today();
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      const future = d > t;
      const cls = ['dc', dayDone(d) ? 'done' : (future ? 'future' : 'pending'), d === t ? 'today' : '', d === selected ? 'sel' : ''].join(' ');
      return `<a class="${cls}" href="#/checkin/${d}"><span class="d">${DOW[i]}</span><span class="n">${parse(d).getDate()}</span><span class="m">${dayDone(d) ? '✓' : (future ? '' : '–')}</span></a>`;
    }).join('');
  }

  function viewCheckinDay(date) {
    if (date > today()) return viewNotFound();
    const c = S.checkins[date] || {};
    const tg = targets(date);
    const v2 = date >= CORE.CI_V2_FROM;
    const daySes = S.sessions.filter(s => s.date === date);
    const miss = missingOn(date);
    const dot = ok => `<span class="qdot ${ok ? 'on' : ''}" aria-hidden="true"></span>`;
    const q = (label, ok, body, opts = {}) => `<div class="q"><span class="ql">${label}${opts.key === false ? '' : ' <span class="clave">Clave</span>'}${dot(ok)}</span>${opts.hint ? `<span class="small muted">${opts.hint}</span>` : ''}${body}</div>`;
    const sec = (icon, title, qs) => { const list = qs.filter(Boolean); return `<section class="card form ci-sec"><div class="ci-sh"><span class="ci-ic" aria-hidden="true">${icon}</span><div><h3>${title}</h3><span class="eyebrow">${list.length} campos</span></div></div>${list.join('')}</section>`; };
    const txt = (k, ph) => `<textarea data-ci="${k}" data-d="${date}" placeholder="${esc(ph)}">${esc(c[k])}</textarea>`;

    const bio = [
      q('Peso corporal en ayunas', c.noPeso || hasVal(c.peso), `${c.noPeso ? `<p class="muted">Este día no te pesaste.</p>` : `<div class="inp-u"><input class="inp" id="ci-peso" inputmode="decimal" data-ci="peso" data-d="${date}" value="${esc(c.peso)}" placeholder="0,0"><span class="u">kg</span></div>`}
        <button type="button" class="btn ghost block small" data-a="ci-set" data-k="noPeso" data-v="${c.noPeso ? '' : '1'}" data-d="${date}">${c.noPeso ? 'Sí me pesé' : '⊘ No me pesé este día'}</button>`,
        { hint: 'Apenas despiertas, después de ir al baño y antes de tomar agua o comer.' }),
      v2 ? q('¿Algo fuera de lo común?', hasVal(c.fuera), segButtons('fuera', YESNO, c.fuera, date) + (c.fuera === 'si' ? txt('fueraTxt', '¿Qué pasó? Ej.: me enfermé, viaje, fiesta, comí fuera…') : ''), { hint: 'Cualquier cosa que pueda mover tu peso o tu energía.' }) : '',
      q('Niveles de energía', hasVal(c.energy), segButtons('energy', ENERGY_L, c.energy, date)),
      v2 ? q('Niveles de estrés', hasVal(c.estres), segButtons('estres', ESTRES_L, c.estres, date)) : '',
      PAIN ? q(`Dolor de ${esc(PAIN.label)}`, hasVal(c.hombro), scaleButtons('hombro', 0, 10, c.hombro, date) + '<div class="scale-ends"><span>Nada</span><span>Mucho</span></div>') : ''
    ];
    const sleep = [
      q('Horas de sueño', hasVal(c.sleepH), `<div class="two"><div class="inp-u"><input class="inp" id="ci-sh" inputmode="numeric" pattern="[0-9]*" data-ci="sleepH" data-d="${date}" value="${esc(c.sleepH)}" placeholder="7" aria-label="Horas de sueño"><span class="u">h</span></div>
        <div class="inp-u"><input class="inp" id="ci-sm" inputmode="numeric" pattern="[0-9]*" data-ci="sleepM" data-d="${date}" value="${esc(c.sleepM)}" placeholder="0" aria-label="Minutos de sueño"><span class="u">min</span></div></div>`, { hint: 'Lo que dormiste la noche anterior.' }),
      q('Calidad del sueño', hasVal(c.sleepQ), scaleButtons('sleepQ', 1, 5, c.sleepQ, date) + '<div class="scale-ends"><span>Muy mala</span><span>Excelente</span></div>')
    ];
    const entrenoOpts = [['', 'Elige…']].concat(ROUTINE_ORDER.map(r => [r, ROUTINES[r].name]), [['descanso', 'Descanso'], ['otro', 'Otro']]);
    const train = [
      v2 ? q('¿Qué entrenamiento?', daySes.length > 0 || hasVal(c.entreno), daySes.length
        ? `<p class="saved">Registrado en la app: ${daySes.map(s => esc(ROUTINES[s.routine].name)).join(', ')} ✓</p>`
        : `<select class="inp" data-ci="entreno" data-d="${date}" aria-label="Qué entrenamiento">${entrenoOpts.map(([v, l]) => `<option value="${v}" ${String(c.entreno || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${c.entreno === 'otro' ? `<input class="inp" data-ci="entrenoTxt" data-d="${date}" value="${esc(c.entrenoTxt)}" placeholder="¿Qué hiciste?">` : ''}`,
        { hint: daySes.length ? '' : 'Elige el entrenamiento que hiciste, o marca «Descanso» u «Otro».' }) : '',
      q('Sesión de cardio', hasVal(c.cardio), segButtons('cardio', YESNO, c.cardio, date) + (c.cardio === 'si' ? `<input class="inp" data-ci="cardioTxt" data-d="${date}" value="${esc(c.cardioTxt)}" placeholder="Ej.: 30 min de bici">` : ''), { key: false }),
      q('Pasos diarios', hasVal(c.pasos), `<div class="inp-u wide-u"><input class="inp" id="ci-pasos" inputmode="numeric" pattern="[0-9]*" data-ci="pasos" data-d="${date}" value="${esc(c.pasos)}" placeholder="0"><span class="u">/ ${nf(tg.steps, 0)} pasos</span></div>`, { hint: 'El número real de tu contador, sin redondear.' }),
      q('¿Actividad adicional?', hasVal(c.extraAct), segButtons('extraAct', YESNO, c.extraAct, date) + (c.extraAct === 'si' ? `<input class="inp" data-ci="extraActTxt" data-d="${date}" value="${esc(c.extraActTxt)}" placeholder="Ej.: caminata larga, baile, piscina">` : ''), { key: false })
    ];
    const nut = [
      q('Adherencia al plan (1–10)', hasVal(c.adh), `<details class="howto"><summary>¿Cómo se mide? ▾</summary><p class="small">10 = comiste todo lo del plan, pesado o medido. 8–9 = casi todo, con algún cambio pequeño. 6–7 = te saliste en una comida. 5 o menos = te saliste en varias comidas o comiste bastante fuera del plan. Responde con sinceridad: sirve para ajustar el plan, no para juzgar.</p></details>
        ${scaleButtons('adh', 1, 10, c.adh, date)}`),
      q('Nota del día', hasVal(c.nota), txt('nota', 'Cómo te sentiste, antojos, digestión, dudas…'), { key: false })
    ];
    const next = addDays(date, 1);
    const cta = next <= today()
      ? `<a class="btn block lower" href="#/checkin/${next}">Completar ${esc(cap(DOW_LONG[dowIdx(next)]))} ${parse(next).getDate()} →</a>`
      : `<a class="btn block lower" href="#/checkin">${miss.length ? 'Volver' : 'Listo ✓'}</a>`;
    const html = `
      <div class="daystrip">${ciStrip(mondayOf(date), date)}</div>
      <div class="wk-head lower"><span class="eyebrow">Registro diario</span><span class="rname" style="font-size:1.8rem">${esc(cap(fmtDay(date)))}</span></div>
      ${miss.length ? `<div class="notice"><div><b>Te ${miss.length === 1 ? 'falta 1 dato clave' : `faltan ${miss.length} datos clave`} para cerrar este día:</b> ${esc(miss.join(', '))}.</div></div>` : '<div class="notice ok"><div><b>Día completo.</b> Gracias.</div></div>'}
      ${sec('💪', 'Biofeedback', bio)}
      ${sec('😴', 'Sueño', sleep)}
      ${sec('🏋️', 'Entrenamiento', train)}
      ${sec('🥗', 'Nutrición', nut)}
      <p class="small muted">Se guarda solo mientras escribes.</p>
      <div class="sticky-cta">${cta}</div>`;
    return { title: 'Check-in', back: '#/checkin', html };
  }

  function viewCheckin(mondayArg) {
    const t = today();
    const monday = mondayArg || mondayOf(t);
    const st = weekStats(monday);
    const isCurrent = monday === mondayOf(t);
    const parts = [];
    const sent = S.sent[monday];
    const missing = st.days.filter(d => d <= t && d >= S.settings.startDate && !dayDone(d));
    parts.push(`<div class="daynav"><button data-a="ci-week" data-d="${addDays(monday, -7)}" aria-label="Semana anterior">‹</button><span class="dl">${isCurrent ? 'Esta semana' : 'Semana del ' + fmtShort(monday)}<br><span class="small muted">${st.registered}/${st.days.filter(d => d <= t).length || 7} días</span></span><button data-a="ci-week" data-d="${addDays(monday, 7)}" aria-label="Semana siguiente" ${isCurrent ? 'disabled style="opacity:.3"' : ''}>›</button></div>`);
    parts.push(`<div class="daystrip">${ciStrip(monday, null)}</div>`);
    if (missing.length) {
      parts.push(`<a class="btn block lower" href="#/checkin/${missing[0]}">Llenar registro diario del ${esc(fmtDay(missing[0]))} →</a>
        <p class="small warn-t" style="margin-top:-8px">Tienes ${plural(missing.length, 'día', 'días')} sin completar ⚠️</p>`);
    } else if (isCurrent) {
      parts.push(`<div class="notice ok"><div><b>Registro al día.</b> Mañana toca de nuevo.</div></div>`);
    }
    parts.push(`<section class="card"><h3>Tu semana en números</h3><p class="small muted">Promedio de los días que llevas cargados.</p><div class="stats">
      <div class="stat"><span class="k">Peso promedio</span><span class="v">${st.peso !== null ? nf(st.peso, 2) + ' kg' : '—'}</span><span class="s">${st.pesoDelta !== null ? `${st.pesoDelta >= 0 ? '+' : ''}${nf(st.pesoDelta, 2)} kg vs anterior` : 'pésate 4 días o más'}</span></div>
      <div class="stat"><span class="k">Pasos</span><span class="v">${st.pasos !== null ? nf(st.pasos, 0) : '—'}</span><span class="s">promedio diario</span></div>
      <div class="stat"><span class="k">Sueño</span><span class="v">${st.sleep !== null ? fmtSleep(st.sleep).replace(' min', '') : '—'}</span><span class="s">${st.sleepQ !== null ? 'calidad ' + nf(st.sleepQ, 1) + '/5' : 'promedio'}</span></div>
      <div class="stat"><span class="k">Adherencia</span><span class="v">${st.adh !== null ? nf(st.adh, 1) : '—'}</span><span class="s">dieta /10</span></div>
      <div class="stat"><span class="k">Registros</span><span class="v">${st.registered}/7</span><span class="s">días completos</span></div>
      <div class="stat"><span class="k">Entrenos</span><span class="v">${st.sessions.length}</span><span class="s">${st.hombro !== null ? 'hombro ' + nf(st.hombro, 1) + '/10' : 'esta semana'}</span></div>
    </div></section>`);
    parts.push(`<section class="card"><h3>Enviar a ${esc(S.settings.coachName)}</h3>
      <p class="muted small">Se abre el menú de compartir: elige WhatsApp y el chat de ${esc(S.settings.coachName)}.</p>
      ${sent ? `<p class="saved">Enviado el ${esc(fmtDay(ymd(new Date(sent))))}</p>` : ''}
      <button class="btn block upper" data-a="send-week" data-d="${monday}">Enviar resumen semanal</button></section>`);
    parts.push(`<section class="card prose"><h3>Cómo funciona tu check-in</h3>
      <div class="howbox"><span class="eyebrow up-t">Tu día de check-in</span><b class="big">Domingo en la noche o lunes en la mañana</b><span class="small muted">Para esa hora, todos los días de la semana tienen que estar completos y el resumen enviado.</span></div>
      <ul>
        <li><b>Todos los días:</b> el registro diario, entrenes o no. Los datos «Clave» son obligatorios para cerrar el día.</li>
        <li><b>Pésate</b> en ayunas apenas te levantas. Si un día no puedes, marca «No me pesé».</li>
        <li><b>Cada 2 semanas:</b> medidas (Más → Medidas) y fotos por WhatsApp.</li>
        <li>Si un día pasa algo fuera de lo común, cuéntalo: explica muchos cambios de peso.</li>
      </ul></section>`);
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
  const TAB_OF = { entrenar: 'entrenar', workout: 'entrenar', session: 'entrenar', historial: 'entrenar', bloque: 'entrenar', nutricion: 'nutricion', checkin: 'checkin', mas: 'mas', plan: 'mas', medidas: 'mas', respaldo: 'mas', instalar: 'mas', coach: 'mas', cuenta: 'mas' };
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
      case 'bloque': v = viewBloque(); break;
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
    const pending = !dayDone(today());
    document.getElementById('tabs').hidden = !!v.bare;
    document.getElementById('tabs').innerHTML = v.bare ? '' : TABS.map(([id, label]) => `<a href="#/${id}" class="${tab === id ? 'on' : ''}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span>${id === 'checkin' && pending ? '<span class="dot" aria-label="pendiente"></span>' : ''}</a>`).join('');
    document.title = `${v.title} · Plan ${PERSON}`;
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
    if (name === 'nutricion') setupMacrobar(); else if (mbObs) { mbObs.disconnect(); mbObs = null; }
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
      const set = { kg, reps, rir, at: Date.now() };
      if (el.dataset.kind === 'warm') {
        e.warm.push({ kg, reps, at: Date.now() });
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
      if (!a.post || !a.post.difficulty) { toast('Marca qué tan difícil fue'); return; }
      if (PAIN && (a.post.shoulder === undefined || a.post.shoulder === null)) { toast(`Marca la molestia en ${PAIN.label === 'hombro' ? 'el hombro' : PAIN.label} (0 si no hubo)`); return; }
      const ex = {};
      Object.entries(a.ex).forEach(([id, e]) => {
        normEntry(e);
        const sets = e.sets.map(x => ({ kg: x.kg, reps: x.reps, rir: x.rir || '' }));
        const warm = e.warm.map(x => ({ kg: x.kg, reps: x.reps }));
        ex[id] = { alt: e.alt, histKey: e.histKey, name: e.name, sets, warm, note: e.note.trim(), setup: getSetup(e.histKey) };
      });
      const finishedAt = Date.now();
      // Si quedó abierto después de la última serie, la duración se corta 5 minutos después de esa serie.
      const lastAt = Math.max(0, ...Object.values(a.ex).flatMap(e => e.sets.concat(e.warm).map(x => x.at || 0)));
      const endAt = lastAt ? Math.min(finishedAt, lastAt + 5 * 60000) : finishedAt;
      const s = {
        id: 's' + finishedAt, routine: a.routine, date: a.date, week: a.week, startedAt: a.startedAt, finishedAt,
        minutes: Math.max(1, Math.round((endAt - a.startedAt) / 60000)), ex,
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
      picker.grams = picker.target ? eqGrams(picker.target, f) : (S.usual[f.id] || (f.u ? f.u[1] : 100));
      picker.step = 'amount';
      renderPicker();
    },
    'fp-g': el => {
      picker.grams = Number(el.dataset.v);
      const inp = document.getElementById('fp-g'); if (inp) inp.value = String(picker.grams).replace('.', ',');
      document.getElementById('fp-tot').innerHTML = amountTotals();
    },
    'fp-back': () => { picker.step = 'list'; renderPicker(); },
    'fp-cat': el => { picker.cat = el.dataset.v; renderPicker(); },
    'fp-quick': () => { picker.step = 'quick'; renderPicker(); },
    'qa-save': () => {
      const v = id => num(document.getElementById(id).value);
      const p = Math.max(0, v('qa-p') || 0), c = Math.max(0, v('qa-c') || 0), g = Math.max(0, v('qa-g') || 0);
      let kcal = v('qa-kcal');
      if (kcal === null) kcal = Math.round(p * 4 + c * 4 + g * 9);
      if (!(kcal > 0) || kcal > 5000) { toast('Anota las calorías o los macros'); return; }
      const n = document.getElementById('qa-n').value.trim() || 'Agregado rápido';
      const day = foodDay(picker.date);
      day.extra.push({ id: 'x' + Date.now(), meal: picker.meal, n, grams: null, kcal: Math.round(kcal), p: r1(p), g: r1(g), c: r1(c) });
      save(); markDirty('food', picker.date);
      closeSheet(); picker = null; render(); toast('Agregado');
    },
    'edit-food': el => {
      const date = nutDate();
      const day = S.food[date] || { on: [] };
      const f = mealsFor(date, day).flatMap(m => m.foods).find(x => x.id === el.dataset.id);
      if (!f) return;
      if (f.extra) {
        const x = (day.extra || []).find(y => y.id === f.id);
        const food = x && x.fid ? findFood(x.fid) : null;
        editor = { date, id: f.id, kind: 'extra', food, val: x && x.grams ? x.grams : '' };
      } else if (f.swappedFrom) {
        const sw = day.swaps[f.id];
        editor = { date, id: f.id, kind: 'swap', food: findFood(sw.fid), val: sw.grams };
      } else {
        editor = { date, id: f.id, kind: 'plan', food: null, val: (day.qty && day.qty[f.id]) || 1 };
      }
      renderEditor();
    },
    'ed-set': el => {
      editor.val = Number(el.dataset.v);
      const inp = document.getElementById('ed-v'); if (inp) inp.value = String(editor.val).replace('.', ',');
      document.getElementById('ed-tot').innerHTML = macroTiles(editorCalc());
    },
    'ed-save': () => {
      const e = editor; if (!e) return;
      const v = num(e.val);
      const day = foodDay(e.date);
      if (e.kind === 'plan') {
        if (!(v > 0) || v > 10) { toast('Escribe cuántas porciones (ej.: 1,5)'); return; }
        day.qty = day.qty || {};
        if (v === 1) delete day.qty[e.id]; else day.qty[e.id] = r1(v * 100) / 100;
        if (!day.on.includes(e.id)) day.on.push(e.id);
      } else {
        if (!(v > 0) || v > 3000) { toast('Escribe los gramos'); return; }
        const entry = Object.assign({ fid: e.food.id, n: e.food.n, grams: r1(v) }, portion(e.food, v));
        if (e.kind === 'swap') day.swaps[e.id] = entry;
        else { const i = day.extra.findIndex(x => x.id === e.id); if (i >= 0) day.extra[i] = Object.assign({}, day.extra[i], entry); }
        S.usual[e.food.id] = r1(v);
      }
      save(); markDirty('food', e.date);
      closeSheet(); editor = null; render(); toast('Guardado');
    },
    unqty: el => {
      const date = nutDate(); const day = foodDay(date);
      if (day.qty) delete day.qty[el.dataset.id];
      save(); markDirty('food', date); render();
    },
    'meal-all': el => {
      const date = nutDate(); const day = foodDay(date);
      const m = mealsFor(date, day).find(x => x.id === el.dataset.meal); if (!m) return;
      const ids = m.foods.filter(f => !f.extra && !f.free).map(f => f.id);
      const all = ids.every(id => day.on.includes(id));
      day.on = all ? day.on.filter(id => !ids.includes(id)) : day.on.concat(ids.filter(id => !day.on.includes(id)));
      save(); markDirty('food', date); render();
    },
    'water-other': () => {
      openSheet(`<h2>Agregar agua</h2><div class="q"><label for="w-ml">¿Cuánto tomaste?</label><div class="inp-u"><input class="inp" id="w-ml" inputmode="numeric" autocomplete="off" placeholder="350"><span class="u">ml</span></div></div>
        <button class="btn block" data-a="water-save">Agregar</button><button class="btn block ghost" data-a="close">Cancelar</button>`);
      const i = document.getElementById('w-ml'); if (i) i.focus();
    },
    'water-save': () => {
      const ml = num(document.getElementById('w-ml').value);
      if (!(ml > 0) || ml > 5000) { toast('Escribe los ml (ej.: 350)'); return; }
      const date = nutDate(); const day = foodDay(date);
      day.water = Math.max(0, (day.water || 0) + Math.round(ml));
      save(); markDirty('food', date); closeSheet(); render();
    },
    'copy-day': () => {
      const date = nutDate();
      const days = Array.from({ length: 21 }, (_, i) => addDays(date, -(i + 1))).filter(d => { const x = S.food[d]; return x && ((x.on || []).length || (x.extra || []).length); });
      const rows = days.map(d => {
        const t = CORE.dayIntake(block(d).phase === 'cut', S.food[d]);
        return `<button class="fp-item" data-a="copy-day-do" data-d="${d}"><span class="grow"><span class="t">${esc(cap(fmtDay(d)))}</span><span class="s">P ${t.p} · C ${t.c} · G ${t.g}${dayHasCustom(S.food[d]) ? ' · con cambios' : ''}</span></span><span class="r"><b>${nf(t.kcal, 0)}</b>kcal</span></button>`;
      }).join('');
      openSheet(`<h2>Copiar un día completo</h2><p class="muted small">Copia lo que marcaste, los cambios y los agregados de otro día a ${esc(date === today() ? 'hoy' : fmtDay(date))}. Reemplaza lo que haya marcado; el agua y la nota se mantienen.</p>
        <div class="fp-list">${rows || '<p class="muted small">No hay días anteriores con comidas registradas.</p>'}</div>
        <button class="btn block ghost" data-a="close">Cancelar</button>`);
    },
    'copy-day-do': el => {
      const date = nutDate(); const src = S.food[el.dataset.d]; if (!src) return;
      const day = foodDay(date);
      const copy = JSON.parse(JSON.stringify(src));
      day.on = copy.on || [];
      day.swaps = copy.swaps || {};
      day.qty = copy.qty || {};
      day.extra = (copy.extra || []).map((x, i) => Object.assign({}, x, { id: 'x' + Date.now() + i }));
      save(); markDirty('food', date); closeSheet(); render(); toast('Día copiado');
    },
    'restore-day': el => {
      if (el.dataset.confirm !== '1') { el.dataset.confirm = '1'; el.textContent = 'Toca otra vez: se borran cambios y agregados'; return; }
      const date = el.dataset.d; const day = foodDay(date);
      day.swaps = {}; day.extra = []; day.qty = {};
      save(); markDirty('food', date); render(); toast('Dieta base restaurada');
    },
    skip: el => {
      const r = ROUTINES[el.dataset.r];
      openSheet(`<h2>Saltar ${esc(r.name)}</h2><p class="muted small">Queda marcado como saltado esta semana y ${esc(S.settings.coachName)} lo ve en tu check-in. Si después lo haces, igual puedes registrarlo.</p>
        <div class="q"><label for="skip-why">¿Por qué? <span class="hint">opcional</span></label><textarea id="skip-why" placeholder="Ej.: viaje, enfermedad, mucho cansancio…"></textarea></div>
        <button class="btn block danger" data-a="skip-save" data-r="${r.id}">Saltar entrenamiento</button><button class="btn block ghost" data-a="close">Cancelar</button>`);
    },
    'skip-save': el => {
      const t = today();
      const c = S.checkins[t] = S.checkins[t] || {};
      c.skips = (c.skips || []).filter(x => x.rid !== el.dataset.r).concat({ rid: el.dataset.r, reason: document.getElementById('skip-why').value.trim(), at: Date.now() });
      save(); markDirty('checkin', t); closeSheet(); location.hash = '#/entrenar'; toast('Entrenamiento saltado');
    },
    unskip: el => {
      const monday = mondayOf(today());
      for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i); const c = S.checkins[d];
        if (c && c.skips && c.skips.some(x => x.rid === el.dataset.r)) { c.skips = c.skips.filter(x => x.rid !== el.dataset.r); save(); markDirty('checkin', d); }
      }
      render(); toast('Listo, ya no está saltado');
    },
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
      S.usual[p.sel.id] = r1(g);
      save(); markDirty('food', p.date);
      closeSheet(); picker = null; render();
      toast(p.target ? 'Cambio guardado' : 'Alimento agregado');
    },
    unswap: el => {
      const date = nutDate(); const day = foodDay(date);
      delete day.swaps[el.dataset.id];
      save(); markDirty('food', date); closeSheet(); render();
    },
    'del-extra': el => {
      const date = nutDate(); const day = foodDay(date);
      day.extra = day.extra.filter(x => x.id !== el.dataset.id);
      save(); markDirty('food', date); closeSheet(); render();
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
      document.getElementById('fp-results').innerHTML = resultsHtml(t.value, picker.cat || '');
      return;
    }
    if (t.id === 'fp-g' && picker) {
      picker.grams = t.value;
      document.getElementById('fp-tot').innerHTML = amountTotals();
      return;
    }
    if (t.id === 'ed-v' && editor) {
      editor.val = t.value;
      document.getElementById('ed-tot').innerHTML = macroTiles(editorCalc());
      return;
    }
    if (t.dataset.nnote) {
      foodDay(t.dataset.nnote).note = t.value;
      save(); markDirty('food', t.dataset.nnote);
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
