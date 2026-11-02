'use strict';

// Plan de Anita: rutina de 4 días (de su planilla), minuta con lo que ella come (1.800 kcal en recomposición, 1.600 en definición)
// y fases de 4 semanas de recomposición + 5 de definición, para llegar al verano en la semana 10.
// Para cambiar el plan se edita este archivo y se vuelve a publicar.
// Cada persona tiene su archivo en plans/ y se activa con plan = '<id>' en su ficha (ver data.js).
// rest: segundos de descanso [mín, máx]. inc: kg que se suben al progresar. type: 'reps' | 'time' (segundos).

(function () {
  const REST_COMP = [180, 300];
  const REST_ISO = [120, 180];

  const ROUTINES = {
    UA: {
      id: 'UA', name: 'Upper A', kind: 'upper', day: 'Lunes', minutes: 65,
      exercises: [
        { id: 'ua1', name: 'Dominadas BE', sets: 3, reps: [6, 8], rest: REST_COMP, group: 'Espalda' },
        { id: 'ua2', name: 'Remo en polea', sets: 2, reps: [12, 14], rest: REST_COMP, inc: 2.5, group: 'Espalda' },
        { id: 'ua3', name: 'Press banca', sets: 3, reps: [8, 10], rest: REST_COMP, inc: 2.5, approach: 2, group: 'Pecho' },
        { id: 'ua4', name: 'Pájaros', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 1, incLabel: 'por mancuerna', group: 'Hombro posterior' },
        { id: 'ua5', name: 'Bíceps en banco sentado unilateral', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 1, incLabel: 'por mancuerna', perSide: true, group: 'Bíceps' }
      ]
    },
    LA: {
      id: 'LA', name: 'Lower A', kind: 'lower', day: 'Martes', minutes: 65,
      exercises: [
        { id: 'la1', name: 'Patada', sets: 2, reps: [12, 14], rest: REST_ISO, inc: 2.5, perSide: true, group: 'Glúteo' },
        { id: 'la2', name: 'Hip thrust', sets: 3, reps: [10, 12], rest: REST_COMP, inc: 5, approach: 1, group: 'Glúteo' },
        { id: 'la3', name: 'Zancadas en Smith', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 2.5, group: 'Cuádriceps y glúteo' },
        { id: 'la4', name: 'Abductores', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 2.5, group: 'Glúteo medio' },
        { id: 'la5', name: 'Gemelo en prensa', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 5, group: 'Pantorrilla' }
      ]
    },
    UB: {
      id: 'UB', name: 'Upper B', kind: 'upper', day: 'Jueves', minutes: 65,
      exercises: [
        { id: 'ub1', name: 'Jalón agarre neutro', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 2.5, group: 'Espalda' },
        { id: 'ub2', name: 'Remo con mancuernas en banco inclinado', sets: 2, reps: [12, 14], rest: REST_COMP, inc: 1, incLabel: 'por mancuerna', group: 'Espalda' },
        { id: 'ub3', name: 'Press militar', sets: 3, reps: [10, 12], rest: REST_COMP, inc: 2.5, group: 'Hombro' },
        { id: 'ub4', name: 'Elevaciones laterales', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 1, incLabel: 'por mancuerna', group: 'Hombro' },
        { id: 'ub5', name: 'Extensión de tríceps unilateral en diagonal', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 2.5, perSide: true, group: 'Tríceps' }
      ]
    },
    LB: {
      id: 'LB', name: 'Lower B', kind: 'lower', day: 'Viernes', minutes: 65,
      exercises: [
        { id: 'lb1', name: 'Patada', sets: 2, reps: [12, 14], rest: REST_ISO, inc: 2.5, perSide: true, group: 'Glúteo' },
        { id: 'lb2', name: 'Sentadilla', sets: 3, reps: [8, 10], rest: REST_COMP, inc: 2.5, approach: 2, group: 'Cuádriceps y glúteo' },
        { id: 'lb3', name: 'Extensión de cuádriceps', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 2.5, group: 'Cuádriceps' },
        { id: 'lb4', name: 'Aductores', sets: 2, reps: [12, 14], rest: REST_ISO, inc: 2.5, group: 'Aductores' },
        { id: 'lb5', name: 'Abductores', sets: 3, reps: [12, 14], rest: REST_ISO, inc: 2.5, group: 'Glúteo medio' }
      ]
    }
  };

  const ROUTINE_ORDER = ['UA', 'LA', 'UB', 'LB'];

  // Macros por fase. Si el coach cambia las calorías, los carbohidratos se recalculan.
  // Semanas 1–4 recomposición, 5–9 definición, 10 en adelante mantención (vacaciones de verano).
  const PHASES = {
    pre: { name: 'Antes de empezar', short: 'Pre', macros: { p: 120, g: 52 }, kcalKey: 'recomp' },
    recomp: { name: 'Recomposición', short: 'Recomp', weeks: 4, macros: { p: 120, g: 52 }, kcalKey: 'recomp', steps: 8000 },
    cut: { name: 'Definición', short: 'Definición', weeks: 5, macros: { p: 120, g: 48 }, kcalKey: 'cut', steps: 9000 },
    maint: { name: 'Mantención', short: 'Mantención', macros: { p: 115, g: 55 }, kcalKey: 'recomp', steps: 8000 }
  };

  // Día tipo. Valores por porción: kcal, p (proteína), g (grasa), c (carbohidratos disponibles).
  // fixed = no se toca en ninguna fase. cut: null = se saca en la definición; objeto = cambia la porción.
  // estimate = calorías estimadas, falta medir. free = no se cuenta.
  // cat = grupo para calcular equivalencias (carbo y fruta por carbohidratos, proteína y lácteo por proteína,
  // grasa por grasa, otros por calorías). alts = reemplazos sugeridos, por nombre en foods.js.
  // Anita no pesa la comida: cada porción dice entre paréntesis cómo se ve a simple vista (mano, puño, palma).
  // No come jamón de pavo ni aceite de oliva. Los fideos solo van en el almuerzo.
  // Las colaciones son las que lleva al trabajo y va rotando (etiquetas en foods.js, src: etiqueta).
  const PAN_ALTS = ['Hallulla', 'Pan amasado', 'Pan de molde integral', 'Pan pita', 'Tortilla siria multigrano Assanabel', 'Tortilla de harina (wrap)', 'Galletas de arroz'];
  const COLACION_LACTEO = ['Yogur Protein+ (Soprole)', 'Leche Protein+ cacao (Soprole)', 'Leche Protein+ sabor (Soprole)', 'Yogur griego natural descremado', 'Queso cottage', 'Quesillo'];
  const PROTEINA_NOCHE = ['Huevo duro', 'Clara de huevo', 'Jamón de cerdo', 'Carne molida 5 % grasa, cruda', 'Pechuga de pollo, cruda', 'Atún en agua, drenado',
    'Pescado blanco (merluza, reineta), crudo', 'Posta negra o rosada, cruda', 'Lomo de cerdo, crudo', 'Hamburguesa vegetal (Impossible)', 'Quesillo', 'Queso cottage'];

  const MEALS = [
    {
      id: 'm1', name: 'Desayuno', foods: [
        { id: 'd1', name: 'Pan (marraqueta)', qty: '1 marraqueta chica, 90 g (del largo de tu mano)', kcal: 240, p: 8, g: 1, c: 50, fixed: true, cat: 'carbo', alts: PAN_ALTS },
        { id: 'd2', name: 'Jamón de cerdo', qty: '2 láminas finas, 40 g (como lo que cubre tu palma, apiladas dos veces)', kcal: 66, p: 7, g: 4, c: 1, fixed: true, cat: 'proteina',
          alts: ['Huevo duro', 'Quesillo', 'Queso cottage'] },
        { id: 'd3', name: 'Queso gauda o mantecoso', qty: '2 láminas, 40 g (del tamaño de la palma, finas como un dedo meñique)', kcal: 142, p: 10, g: 11, c: 1, fixed: true, cat: 'lacteo',
          alts: ['Queso chanco', 'Queso Hulgo', 'Queso mozzarella light', 'Quesillo'] },
        { id: 'd4', name: 'Té sin azúcar', qty: 'a gusto', kcal: 0, p: 0, g: 0, c: 0, free: true }
      ]
    },
    {
      id: 'm5', name: 'Colación de la mañana', foods: [
        { id: 'k1', name: 'Yogur Protein+ (Soprole)', qty: '1 pote (155 g)', kcal: 105, p: 10, g: 3, c: 10, fixed: true, cat: 'lacteo',
          alts: COLACION_LACTEO.filter(n => n !== 'Yogur Protein+ (Soprole)') },
        { id: 'k2', name: 'Golden Crunchy (Wild Foods)', qty: '1/3 taza, 37 g (un puñado pequeño, lo que cabe en la palma ahuecada)', kcal: 128, p: 11, g: 4, c: 13, fixed: true, cat: 'carbo',
          alts: ['Avena', 'Granola', 'Cereal corn flakes', 'Galletas de arroz', 'Plátano', 'Manzana'] }
      ]
    },
    {
      id: 'm2', name: 'Almuerzo', foods: [
        { id: 'a1', name: 'Pechuga de pollo cocida', qty: '110 g (1 palma de la mano, del grosor de la palma)', kcal: 182, p: 34, g: 4, c: 0, cat: 'proteina',
          alts: ['Atún en agua, drenado', 'Pescado blanco (merluza, reineta), cocido', 'Salmón, cocido', 'Carne molida 5 % grasa, cruda', 'Filete de vacuno, crudo', 'Huevo entero', 'Hamburguesa vegetal (Impossible)'] },
        { id: 'a2', name: 'Arroz (peso crudo)', qty: '55 g crudo (≈1 puño lleno de arroz ya cocido, 1 taza escasa)', kcal: 201, p: 4, g: 0, c: 43, cat: 'carbo',
          cut: { qty: '40 g crudo (≈¾ de puño de arroz ya cocido)', kcal: 146, p: 3, c: 31 },
          alts: ['Fideos, cocidos', 'Papa, cocida', 'Arroz blanco, cocido', 'Quínoa, cruda', 'Lentejas, crudas', 'Garbanzos, cocidos', 'Puré de papas', 'Arroz integral, crudo', 'Fideos, crudos', 'Papa, cruda'] },
        { id: 'a3', name: 'Verduras en ensalada', qty: 'a gusto (la mitad del plato)', kcal: 0, p: 0, g: 0, c: 0, free: true },
        { id: 'a5', name: 'Manzana mediana', qty: '1 unidad, 150 g (del tamaño de tu puño)', kcal: 78, p: 1, g: 0, c: 17, cat: 'fruta',
          alts: ['Naranja', 'Mandarina', 'Pera', 'Kiwi', 'Frutillas', 'Uvas', 'Puré de fruta Vivo (manzana-frambuesa)'] }
      ]
    },
    {
      id: 'm4', name: 'Colación de la tarde', foods: [
        { id: 'c1', name: 'Leche Protein+ cacao (Soprole)', qty: '1 caja (200 ml)', kcal: 126, p: 12, g: 4, c: 16, fixed: true, cat: 'lacteo',
          alts: ['Leche Protein+ sabor (Soprole)', 'Yogur Protein+ (Soprole)', 'Barra proteica chocolate-maní (Wild Foods)', 'Leche descremada', 'Yogur griego natural descremado'] },
        { id: 'c2', name: 'Plátano', qty: '1 chico, 100 g pelado (del largo de tu mano)', kcal: 89, p: 1, g: 0, c: 20, cut: null, cat: 'fruta',
          alts: ['Puré de fruta Vivo (manzana-frambuesa)', 'Manzana', 'Golden Crunchy (Wild Foods)', 'Galletas de arroz', 'Mandarina', 'Uvas', 'Pera', 'Kiwi'] }
      ]
    },
    {
      id: 'm3', name: 'Once / cena', foods: [
        { id: 'o1', name: 'Marraqueta', qty: '½ marraqueta, 60 g (del largo de tu palma)', kcal: 160, p: 5, g: 1, c: 33, cat: 'carbo',
          cut: { qty: '40 g (un tercio de marraqueta)', kcal: 107, p: 3, g: 0, c: 22 },
          alts: PAN_ALTS },
        { id: 'o2', name: 'Huevos enteros', qty: '3 unidades, 150 g (revueltos se ven como 1 puño y medio)', kcal: 215, p: 19, g: 14, c: 1, fixed: true, cat: 'proteina',
          alts: PROTEINA_NOCHE },
        { id: 'o3', name: 'Palta', qty: '40 g (¼ de palta mediana)', kcal: 64, p: 1, g: 6, c: 1, fixed: true, cat: 'grasa',
          alts: ['Aceitunas', 'Almendras', 'Nueces'] },
        { id: 'o4', name: 'Verduras en ensalada', qty: 'a gusto (un cuarto del plato)', kcal: 0, p: 0, g: 0, c: 0, free: true }
      ]
    }
  ];

  const NUTRITION_TIPS = [
    'No necesitas pesar. Usa tu mano: la palma (sin dedos) es una porción de carne, pollo o pescado; el puño cerrado es una porción de arroz, fideos o papa ya cocidos; el pulgar es una porción de grasa (¼ de palta).',
    'Las cantidades entre paréntesis son para verlas a simple vista. Si quieres cambiar un alimento, toca su nombre y la app te da los gramos equivalentes.',
    'Para la noche, en lugar de 3 huevos (≈19 g de proteína): 150 g de huevo duro (3 unidades), 114 g de jamón (≈6 láminas), 88 g de carne molida magra cruda (una hamburguesa chica), 84 g de pechuga de pollo cruda, 74 g de atún en agua (½ lata), 106 g de pescado blanco crudo, 145 g de quesillo, o 1 hamburguesa vegetal Impossible (113 g).',
    'Para el almuerzo, en lugar de 55 g de arroz crudo (1 puño de arroz cocido): 150 g de fideos cocidos (1 puño y medio), 240 g de papa cocida (2 papas medianas), 220 g de garbanzos cocidos (1 taza), 80 g de lentejas crudas o 75 g de quínoa cruda.',
    'Para el pan de la noche, en lugar de ½ marraqueta (60 g): 1 hallulla chica (60 g), 1 pan pita (60 g), 1 tortilla siria (65 g), 3 rebanadas de pan de molde integral (90 g) o 4 galletas de arroz (45 g).',
    'Colaciones: yogur Protein+ con Golden Crunchy, o leche Protein+ con una fruta, o la barra Wild Foods sola (179 kcal, 15 g de proteína) en lugar de leche y fruta. Que lleven proteína y un carbohidrato, y varía entre ellas.',
    'Verduras, ensaladas y té: libres. Néctar Livean y bebidas light: libres, son para la sed, no cuentan como colación. Una copa de vino de 150 ml son ≈125 kcal y se registra.'
  ];

    // Página «Plan y reglas» (Más → Plan y reglas). k = calorías por fase, coach = nombre del coach.
    const guide = (k, coach, nf) => `<section class="card prose"><h2>Las fases</h2><ul>
          <li><b>Semanas 1–4, recomposición:</b> ${nf(k.recomp, 0)} kcal, cerca de tu mantención. Las semanas 1–2 son de adaptación, con todas las series a RIR 2.</li>
          <li><b>Semanas 5–9, definición:</b> ${nf(k.cut, 0)} kcal y más pasos. El objetivo es bajar 0,2–0,4 kg por semana sin perder fuerza.</li>
          <li><b>Semana 10, vacaciones:</b> vuelves a mantención para llegar bien al verano.</li></ul></section>
        <section class="card prose"><h2>Cómo se entrena</h2><ul>
          <li><b>RIR</b> son las repeticiones que quedan en reserva. RIR 1 = podrías hacer una más con buena técnica, pero no dos.</li>
          <li><b>Desde la semana 3:</b> la primera serie a RIR 2 y las demás a RIR 1, salvo que ${coach} indique otra cosa en el ejercicio.</li>
          <li><b>Descansos:</b> 3–5 min en sentadilla, hip thrust, press, remo, jalón y dominadas. 2–3 min en el resto.</li>
          <li><b>Progresión:</b> cuando todas las series llegan al tope del rango, se sube el peso lo mínimo y se vuelve al número bajo. La app te lo sugiere en cada ejercicio.</li>
          <li><b>Calentamiento:</b> 5 min suaves y series de aproximación en el primer ejercicio de cada grupo.</li>
          <li><b>Técnica:</b> bajar en 2–3 s, recorrido completo, sin rebotes. Una repetición con mala técnica no cuenta.</li></ul></section>
        <section class="card prose"><h2>Cómo se ajusta</h2><ul>
          <li><b>Pesarse:</b> en ayunas, y se mira el promedio de la semana, no un día suelto.</li>
          <li><b>Recomposición:</b> si después de 2 semanas el promedio no ha bajado nada, −100 kcal o +2.000 pasos. Si baja más de 0,4 kg por semana, +100 kcal.</li>
          <li><b>Definición:</b> si baja menos de 0,2 kg por semana durante 2 semanas, −100 kcal o +2.000 pasos. Si baja más de 0,5 kg o las cargas caen, +100 kcal.</li></ul></section>`;

    // ---------- Configuración del plan ----------
    // Calendario: fixed = día de la semana (0 = lunes) → rutina. flex = una rutina que la persona mueve entre días;
    // el valor elegido se guarda en settings.upperDay (nombre histórico) y options dice a qué día corresponde. Anita no usa día movible.
    // Las fases con "weeks" se recorren en orden desde la fecha de inicio; después viene la mantención.
    // La fase que se llame "cut" es la que usa las porciones "cut" de las comidas.
    // pain: etiqueta de la molestia que se registra en el check-in y al terminar un entrenamiento (null = no se pregunta).
    window.PLANS = window.PLANS || {};
    window.PLANS.anita = {
      id: 'anita', person: 'Anita',
      ROUTINES, ROUTINE_ORDER, PHASES, MEALS, NUTRITION_TIPS,
      schedule: {
        fixed: { 0: 'UA', 1: 'LA', 3: 'UB', 4: 'LB' }
      },
      kcal: { defaults: { recomp: 1800, cut: 1600 }, fields: [{ key: 'recomp', label: 'Recomposición' }, { key: 'cut', label: 'Definición' }] },
      pain: null,
      guide
    };

})();
