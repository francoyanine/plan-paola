'use strict';

// Lógica compartida entre la app de Paola y la app de coach: fechas, fases, RIR y progresión.
(function () {
  const { ROUTINES, PHASES } = window.DATA;
  const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const DOW_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  // Semana del plan a partir del lunes de inicio: 1–4 recomposición, 5–10 mini cut, después mantención.
  function blockFor(startDate, date) {
    const days = daysBetween(startDate, date);
    const week = Math.floor(days / 7) + 1;
    let phase = 'maint', weekIn = week - 10, weeksTotal = null;
    if (days < 0) { phase = 'pre'; weekIn = null; }
    else if (week <= 4) { phase = 'recomp'; weekIn = week; weeksTotal = 4; }
    else if (week <= 10) { phase = 'cut'; weekIn = week - 4; weeksTotal = 6; }
    return { week, phase, weekIn, weeksTotal, info: PHASES[phase] };
  }
  const weekStart = (startDate, week) => addDays(startDate, (week - 1) * 7);

  // RIR del coach: "2-1" = primera serie RIR 2 y el resto RIR 1; "1" o "0" = todas iguales.
  // Sin indicación: semanas 1–2 todo a RIR 2, después 2-1. Nunca se usa RIR 3.
  const RIR_SCHEMES = ['2-1', '2', '1-0', '1', '0'];
  function parseRir(scheme) {
    const parts = String(scheme || '').split('-').map(s => s.trim()).filter(Boolean).map(Number);
    return parts.length && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 5) ? parts : null;
  }
  const defaultScheme = week => (week <= 2 ? '2' : '2-1');
  function rirForSet(scheme, week, i) {
    const parts = parseRir(scheme) || parseRir(defaultScheme(week));
    return parts[Math.min(i, parts.length - 1)];
  }
  const rirList = (scheme, week, n) => Array.from({ length: n }, (_, i) => rirForSet(scheme, week, i));

  function resolveEx(ex, alt) {
    if (alt && ex.shoulder) {
      return Object.assign({}, ex, ex.shoulder, { id: ex.id, alt: true, histKey: (ex.shoulder.history || ex.history || ex.id) + ':alt' });
    }
    return Object.assign({}, ex, { alt: false, histKey: ex.history || ex.id });
  }
  const isBodyweight = rx => !rx.inc;
  const findExercise = id => {
    for (const r of Object.values(ROUTINES)) {
      const ex = r.exercises.find(e => e.id === id);
      if (ex) return { routine: r, ex };
    }
    return null;
  };

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

  // Última vez que se hizo ese ejercicio (o su variante), antes de un momento dado.
  function lastPerfIn(sessions, histKey, before) {
    const list = sessions.filter(s => before == null || s.finishedAt < before).sort((a, b) => a.finishedAt - b.finishedAt);
    for (let i = list.length - 1; i >= 0; i--) {
      for (const e of Object.values(list[i].ex)) {
        if (e.histKey === histKey && e.sets.length) return { date: list[i].date, week: list[i].week, sets: e.sets };
      }
    }
    return null;
  }

  // Doble progresión: si todas las series llegaron al tope del rango, se sube el mínimo.
  function autoSuggest(rx, last, rir) {
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
      return { kg: nk, up: true, text: `Hoy: subir a ${nf(nk, 2)} kg${rx.incLabel ? ' ' + rx.incLabel : ''} y volver a ${rx.reps[0]} reps.` };
    }
    return { kg, text: `Hoy: repetir ${nf(kg, 2)} kg e intentar sumar repeticiones.` };
  }

  function scheduleFor(upperDay) {
    const map = { 0: 'LA', 3: 'LB', 4: 'UB' };
    map[upperDay === 'mie' ? 2 : 1] = 'UA';
    return map;
  }

  window.CORE = {
    DOW, DOW_LONG, MONTHS, pad, ymd, parse, today, addDays, dowIdx, mondayOf, daysBetween, fmtDay, fmtShort, nf, num, esc, avg,
    blockFor, weekStart, RIR_SCHEMES, parseRir, defaultScheme, rirForSet, rirList,
    resolveEx, isBodyweight, findExercise, setText, setsText, lastPerfIn, autoSuggest, scheduleFor
  };
})();
