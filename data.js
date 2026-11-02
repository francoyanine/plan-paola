'use strict';

// Elige el plan de la persona. Cada plan vive en plans/<id>.js y se registra en window.PLANS.
// Para agregar a alguien: copiar plans/paola.js a plans/<id>.js, cambiar id y person, editar rutinas y comidas,
// sumar el <script> en index.html, coach/index.html y sw.js, y poner "plan": "<id>" en su ficha (ver supabase/link-athlete.sql).
//
// Orden de prioridad: ?plan=<id> en la dirección (se recuerda en el teléfono) > lo recordado > paola.
// La app de cada persona confirma el plan con su ficha de Supabase y recarga si no coincide;
// la app de coach lo cambia según la persona elegida. Cada app recuerda el suyo por separado.
(function () {
  const KEY = window.PLAN_ID_KEY || 'plan-id';
  const store = {
    get: () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set: v => { try { localStorage.setItem(KEY, v); } catch (e) { /* sin almacenamiento: queda el plan por defecto */ } }
  };
  const plans = window.PLANS || {};
  const asked = (new URLSearchParams(location.search).get('plan') || '').toLowerCase();
  if (plans[asked]) store.set(asked);
  const saved = store.get();
  const id = plans[asked] ? asked : (plans[saved] ? saved : 'paola');

  window.DATA = Object.assign({ planId: id }, plans[id]);
  // Cambia de plan y recarga (los módulos leen window.DATA al cargarse). Devuelve true si recargó.
  window.DATA.switchPlan = function (next) {
    const target = plans[next] ? next : 'paola';
    if (target === id) return false;
    store.set(target);
    location.reload();
    return true;
  };
})();
