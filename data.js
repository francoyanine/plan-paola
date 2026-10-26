'use strict';

// Plan de Paola: rutinas, nutrición y textos. Para cambiar la rutina se edita este archivo y se vuelve a publicar.
// rest: segundos de descanso [mín, máx]. inc: kg que se suben al progresar. type: 'reps' | 'time' (segundos).
// shoulder: alternativa que no carga el hombro; el coach la activa desde Más → Modo coach.

const REST_COMP = [180, 300];
const REST_ISO = [120, 180];

const ROUTINES = {
  LA: {
    id: 'LA', name: 'Lower A', kind: 'lower', day: 'Lunes', minutes: 65,
    exercises: [
      {
        id: 'la1', name: 'Elevaciones laterales con mancuernas, sentada', sets: 3, reps: [12, 15],
        rest: REST_ISO, inc: 1, incLabel: 'por mancuerna', group: 'Hombro',
        note: 'Codos apenas flectados, subir hasta la altura del hombro, bajar en 2–3 s.',
        shoulder: {
          name: 'Abducción de cadera en polea baja, de pie', inc: 2.5, perSide: true, group: 'Glúteo medio',
          note: 'Tobillera en la polea baja, pierna del lado contrario a la polea. Llevar la pierna hacia afuera sin inclinar el tronco.'
        }
      },
      {
        id: 'la2', name: 'Curl femoral en máquina', sets: 2, reps: [10, 12], rest: REST_ISO, inc: 2.5,
        group: 'Isquiotibiales', note: 'Pausa de 1 s con la rodilla flectada al máximo. Calienta la rodilla para la sentadilla.'
      },
      {
        id: 'la3', name: 'Sentadilla en Smith', sets: 2, reps: [8, 10], rest: REST_COMP, inc: 2.5, approach: 2,
        group: 'Cuádriceps y glúteo',
        note: 'Pies un poco adelante de la barra, a lo ancho de caderas. Bajar todo lo que permita con la espalda neutra.'
      },
      {
        id: 'la4', name: 'Extensión de cuádriceps', sets: 3, reps: [10, 12], rest: REST_ISO, inc: 2.5,
        group: 'Cuádriceps', note: '1 s arriba con la pierna estirada, bajar lento. Sin balanceo.'
      },
      {
        id: 'la5', name: 'Pantorrillas en prensa', sets: 3, reps: [12, 15], rest: REST_ISO, inc: 5,
        group: 'Pantorrilla', note: 'Pausa de 2 s abajo con el talón estirado. Recorrido completo, sin rebote.'
      }
    ]
  },
  UA: {
    id: 'UA', name: 'Upper A', kind: 'upper', day: 'Martes o miércoles', minutes: 70,
    exercises: [
      {
        id: 'ua1', name: 'Crunch en polea alta, arrodillada', sets: 2, reps: [12, 15], rest: [60, 90], inc: 2.5,
        superset: 'ua1b', group: 'Abdomen',
        note: 'Enrollar la columna llevando costillas a la pelvis; la cadera no se mueve. Sin descanso, pasar a la plancha.'
      },
      {
        id: 'ua1b', name: 'Plancha frontal', sets: 2, type: 'time', rest: REST_ISO, inc: 0, supersetOf: 'ua1',
        group: 'Abdomen', note: 'Glúteos apretados, cadera alineada. Se corta cuando la cadera cae.',
        shoulder: {
          name: 'Dead bug', type: 'reps', reps: [8, 10], perSide: true, inc: 0, group: 'Abdomen',
          note: 'Boca arriba, lumbar pegada al suelo. Estirar brazo y pierna contrarios lento, sin despegar la espalda.'
        }
      },
      {
        id: 'ua2', name: 'Jalón unilateral en polea alta', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 2.5,
        perSide: true, approach: 1, group: 'Espalda',
        note: 'Sentada o arrodillada. Llevar el codo hacia el bolsillo, estirar bien arriba.',
        shoulder: {
          name: 'Remo unilateral con mancuerna apoyada en banco', inc: 1, perSide: true, group: 'Espalda',
          note: 'Mano y rodilla en el banco, espalda plana. Llevar el codo hacia la cadera.'
        }
      },
      {
        id: 'ua3', name: 'Remo con mancuernas, pecho apoyado en banco inclinado', sets: 2, reps: [10, 12],
        rest: REST_COMP, inc: 1, incLabel: 'por mancuerna', group: 'Espalda',
        note: 'Banco a 30–45°. Tirar con los codos hacia atrás, sin despegar el pecho.'
      },
      {
        id: 'ua4', name: 'Press plano con mancuernas', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 1,
        incLabel: 'por mancuerna', approach: 1, group: 'Pecho',
        note: 'Escápulas juntas y apoyadas, bajar hasta sentir estiramiento en el pecho.',
        shoulder: {
          name: 'Floor press con mancuernas, agarre neutro', inc: 1, incLabel: 'por mancuerna', group: 'Pecho',
          note: 'Acostada en el suelo, palmas mirándose. El suelo corta el recorrido cuando los codos lo tocan.'
        }
      },
      {
        id: 'ua5', name: 'Curl de bíceps unilateral con mancuerna, sentada', sets: 3, reps: [10, 12], rest: REST_ISO, inc: 1,
        perSide: true, group: 'Bíceps', note: 'Un brazo a la vez. Codo quieto al costado, bajar completo.'
      },
      {
        id: 'ua6', name: 'Extensión de tríceps unilateral sobre la cabeza en polea, con cuff', sets: 3, reps: [10, 12],
        rest: REST_ISO, inc: 2.5, perSide: true, group: 'Tríceps',
        note: 'De espaldas a la polea, cuff en la muñeca. Codo apuntando adelante, estirar el tríceps abajo.',
        shoulder: {
          name: 'Extensión de tríceps unilateral en polea alta con cuff', inc: 2.5, perSide: true, group: 'Tríceps',
          note: 'Codo pegado al cuerpo, estirar el brazo completo. El brazo no sube sobre la cabeza.'
        }
      }
    ]
  },
  LB: {
    id: 'LB', name: 'Lower B', kind: 'lower', day: 'Jueves', minutes: 75,
    exercises: [
      {
        id: 'lb1', name: 'Face pull en polea alta con cuerda', sets: 3, reps: [12, 15], rest: REST_ISO, inc: 2.5,
        group: 'Hombro posterior', note: 'Polea a la altura de la cara. Tirar separando las manos hacia las orejas, codos altos.',
        shoulder: {
          name: 'Patada de glúteo en polea baja', inc: 2.5, perSide: true, group: 'Glúteo',
          note: 'Tobillera en la polea baja, manos apoyadas. Llevar la pierna atrás sin arquear la espalda.'
        }
      },
      {
        id: 'lb2', name: 'Elevación lateral unilateral en polea baja', sets: 2, reps: [12, 15], rest: REST_ISO,
        inc: 2.5, perSide: true, group: 'Hombro',
        note: 'El cable pasa por delante del cuerpo. Subir hasta el hombro, bajar lento.',
        shoulder: {
          name: 'Abducción de cadera en polea baja, de pie', inc: 2.5, perSide: true, group: 'Glúteo medio',
          note: 'Tobillera en la polea baja. Llevar la pierna hacia afuera sin inclinar el tronco.'
        }
      },
      {
        id: 'lb3', name: 'Curl femoral en máquina', sets: 2, reps: [10, 12], rest: REST_ISO, inc: 2.5,
        group: 'Isquiotibiales', note: 'Igual que el lunes; intentar 1 repetición o un poco más de peso.',
        history: 'la2'
      },
      {
        id: 'lb4', name: 'Peso muerto rumano con barra y straps', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 2.5,
        approach: 2, group: 'Isquiotibiales y glúteo',
        note: 'Straps para que el agarre no limite. Rodillas suaves, cadera hacia atrás, barra pegada a los muslos. Bajar hasta media canilla o hasta que la espalda deje de estar neutra.'
      },
      {
        id: 'lb5', name: 'Prensa de piernas', sets: 2, reps: [10, 12], rest: REST_COMP, inc: 5, approach: 1,
        group: 'Cuádriceps y glúteo',
        note: 'Pies al medio de la plataforma. Bajar hasta que la pelvis no se despegue del respaldo.'
      },
      {
        id: 'lb6', name: 'Pantorrillas en prensa', sets: 3, reps: [12, 15], rest: REST_ISO, inc: 5,
        group: 'Pantorrilla', note: 'Pausa de 2 s abajo.', history: 'la5'
      }
    ]
  },
  UB: {
    id: 'UB', name: 'Upper B', kind: 'upper', day: 'Viernes (optativo)', minutes: 65, optional: true,
    exercises: [
      {
        id: 'ub1', name: 'Crunch en polea alta, arrodillada', sets: 2, reps: [12, 15], rest: [60, 90], inc: 2.5,
        superset: 'ub1b', group: 'Abdomen', history: 'ua1',
        note: 'Igual que en Upper A. Enrollar la columna llevando costillas a la pelvis. Sin descanso, pasar a la plancha.'
      },
      {
        id: 'ub1b', name: 'Plancha frontal', sets: 2, type: 'time', rest: REST_ISO, inc: 0, supersetOf: 'ub1',
        group: 'Abdomen', history: 'ua1b', note: 'Glúteos apretados, cadera alineada. Se corta cuando la cadera cae.',
        shoulder: {
          name: 'Dead bug', type: 'reps', reps: [8, 10], perSide: true, inc: 0, group: 'Abdomen',
          note: 'Boca arriba, lumbar pegada al suelo. Estirar brazo y pierna contrarios lento, sin despegar la espalda.'
        }
      },
      {
        id: 'ub2', name: 'Jalón en polea alta, agarre neutro', sets: 2, reps: [10, 12],
        rest: REST_COMP, inc: 2.5, approach: 1, group: 'Espalda',
        note: 'Palmas mirándose. Estirar bien arriba y llevar los codos hacia las costillas.',
        shoulder: {
          name: 'Remo unilateral en polea baja', inc: 2.5, perSide: true, group: 'Espalda',
          note: 'Una manilla en la polea baja, torso quieto. Llevar el codo atrás pegado al cuerpo.'
        }
      },
      {
        id: 'ub3', name: 'Remo sentada en polea baja, agarre neutro', sets: 2, reps: [10, 12], rest: REST_COMP,
        inc: 2.5, group: 'Espalda', note: 'Pies apoyados, torso quieto. Estirar adelante sin redondear la espalda.'
      },
      {
        id: 'ub4', name: 'Press inclinado con mancuernas, banco a 30°', sets: 2, reps: [10, 12], rest: REST_COMP,
        inc: 1, incLabel: 'por mancuerna', approach: 1, group: 'Pecho', note: 'Mismo control que el press plano.',
        shoulder: {
          name: 'Floor press con mancuernas, agarre neutro', inc: 1, incLabel: 'por mancuerna', group: 'Pecho',
          note: 'Acostada en el suelo, palmas mirándose. El suelo corta el recorrido.', history: 'ua4'
        }
      },
      {
        id: 'ub5', name: 'Curl de bíceps unilateral en banco inclinado con polea baja', sets: 3, reps: [10, 12],
        rest: REST_ISO, inc: 2.5, perSide: true, group: 'Bíceps',
        note: 'Banco inclinado de espaldas a la polea baja, el brazo queda estirado detrás del cuerpo. Codo quieto, subir sin adelantarlo.'
      },
      {
        id: 'ub6', name: 'Extensión de tríceps unilateral en polea alta, con cuff', sets: 3, reps: [10, 12], rest: REST_ISO,
        inc: 2.5, perSide: true, group: 'Tríceps', note: 'Cuff en la muñeca, codo pegado al cuerpo. Estirar el brazo completo.'
      }
    ]
  }
};

const ROUTINE_ORDER = ['LA', 'UA', 'LB', 'UB'];

// Macros por fase. Si el coach cambia las calorías, los carbohidratos se recalculan.
// La grasa es más alta que un plan estándar porque el desayuno trae huevos, queso, kéfir entero y chía.
const PHASES = {
  pre: { name: 'Antes de empezar', short: 'Pre', macros: { p: 120, g: 60 }, kcalKey: 'recomp' },
  recomp: { name: 'Recomposición', short: 'Recomp', weeks: 4, macros: { p: 120, g: 60 }, kcalKey: 'recomp', steps: 10000 },
  cut: { name: 'Mini cut', short: 'Mini cut', weeks: 6, macros: { p: 115, g: 55 }, kcalKey: 'cut', steps: 10000 },
  maint: { name: 'Mantención', short: 'Mantención', macros: { p: 120, g: 60 }, kcalKey: 'recomp', steps: 10000 }
};

// Día tipo. Valores por porción: kcal, p (proteína), g (grasa), c (carbohidratos disponibles).
// fixed = no se toca en ninguna fase. cut: null = se saca en el mini cut; objeto = cambia la porción.
// estimate = calorías estimadas, falta medir. free = no se cuenta.
// cat = grupo para calcular equivalencias (carbo y fruta por carbohidratos, proteína y lácteo por proteína,
// grasa por grasa, otros por calorías). alts = reemplazos sugeridos, por nombre en foods.js.
const PAN_ALTS = ['Marraqueta', 'Hallulla', 'Pan amasado', 'Pan de molde integral', 'Pan pita', 'Tortilla de harina (wrap)'];
const TORTILLA = { name: 'Tortilla siria multigrano Assanabel', qty: '1 unidad (65 g)', kcal: 178, p: 7, g: 2, c: 33, fixed: true, cat: 'carbo', alts: PAN_ALTS };

const MEALS = [
  {
    id: 'm1', name: 'Desayuno', foods: [
      Object.assign({ id: 'd2' }, TORTILLA),
      { id: 'd1', name: 'Huevos enteros', qty: '3 unidades', kcal: 220, p: 19, g: 15, c: 1, fixed: true, cat: 'proteina',
        alts: ['Huevo duro', 'Clara de huevo', 'Jamón de pavo', 'Quesillo'] },
      { id: 'd3', name: 'Queso Hulgo', qty: '1 lámina (20 g)', kcal: 71, p: 5, g: 6, c: 0, fixed: true, cat: 'lacteo',
        alts: ['Queso gauda o mantecoso', 'Queso chanco', 'Queso mozzarella light', 'Quesillo', 'Jamón de pavo'] },
      { id: 'd5', name: 'Kéfir casero de leche entera', qty: '100 ml', kcal: 61, p: 3, g: 3, c: 5, cat: 'lacteo',
        alts: ['Leche entera', 'Leche descremada', 'Yogur natural entero', 'Yogur griego natural descremado'] },
      { id: 'd6', name: 'Chía', qty: '1 cucharada (12 g)', kcal: 58, p: 2, g: 4, c: 1, cat: 'grasa',
        alts: ['Linaza', 'Almendras', 'Nueces'] }
    ]
  },
  {
    id: 'm2', name: 'Almuerzo', foods: [
      { id: 'a1', name: 'Pechuga de pollo cocida', qty: '120 g', kcal: 198, p: 37, g: 4, c: 0, cat: 'proteina',
        alts: ['Atún en agua, drenado', 'Pescado blanco (merluza, reineta), cocido', 'Salmón, cocido', 'Trutro de pollo sin piel, cocido', 'Pechuga de pavo, cruda', 'Carne molida 5 % grasa, cruda'] },
      { id: 'a2', name: 'Arroz (peso crudo)', qty: '40 g (≈120 g cocido)', kcal: 144, p: 3, g: 0, c: 31, cat: 'carbo',
        cut: { qty: '20 g (≈60 g cocido)', kcal: 72, p: 1, c: 16 },
        alts: ['Papa, cruda', 'Fideos, crudos', 'Quínoa, cruda', 'Camote, crudo', 'Arroz integral, crudo', 'Lentejas, crudas', 'Arroz blanco, cocido'] },
      { id: 'a3', name: 'Lechuga', qty: 'a gusto', kcal: 0, p: 0, g: 0, c: 0, free: true },
      { id: 'a4', name: 'Naranja mediana, en la ensalada', qty: '1 unidad', kcal: 70, p: 1, g: 0, c: 15, cat: 'fruta',
        alts: ['Manzana', 'Mandarina', 'Frutillas', 'Kiwi', 'Pera'] },
      { id: 'a5', name: 'Aceite de oliva, medido', qty: '5 ml (1 cucharadita)', kcal: 40, p: 0, g: 5, c: 0, cat: 'grasa',
        alts: ['Palta', 'Aceitunas', 'Almendras'] },
      { id: 'a6', name: 'Barrita proteica casera', qty: '1 unidad', kcal: 200, p: 0, g: 0, c: 0, estimate: true, cut: null, cat: 'otros',
        alts: ['Yogur proteico', 'Yogur griego natural descremado'] }
    ]
  },
  {
    id: 'm4', name: 'Colación de la tarde', foods: [
      { id: 'c1', name: 'Yogur proteico', qty: '1 unidad', kcal: 110, p: 15, g: 1, c: 10, cat: 'lacteo',
        alts: ['Yogur griego natural descremado', 'Quesillo', 'Queso cottage', 'Leche descremada'] },
      { id: 'c2', name: 'Jalea sin calorías', qty: 'a gusto', kcal: 0, p: 0, g: 0, c: 0, free: true },
      { id: 'c3', name: 'Plátano', qty: '50 g (≈½ plátano chico)', kcal: 45, p: 0, g: 0, c: 11, cut: null, cat: 'fruta',
        alts: ['Manzana', 'Frutillas', 'Arándanos', 'Kiwi'] }
    ]
  },
  {
    id: 'm3', name: 'Once / cena', foods: [
      Object.assign({ id: 'o1' }, TORTILLA),
      { id: 'o2', name: 'Posta paleta, 3–4 % de grasa (peso crudo)', qty: '150 g', kcal: 180, p: 32, g: 6, c: 0, fixed: true, cat: 'proteina',
        alts: ['Posta negra o rosada, cruda', 'Pechuga de pollo, cruda', 'Filete de vacuno, crudo', 'Lomo de cerdo, crudo', 'Pescado blanco (merluza, reineta), crudo', 'Salmón, crudo'] },
      { id: 'o3', name: 'Palta', qty: '50 g', kcal: 80, p: 1, g: 7, c: 1, fixed: true, cat: 'grasa',
        alts: ['Aceitunas', 'Aceite de oliva', 'Almendras'] }
    ]
  }
];

const NUTRITION_TIPS = [
  'Todo se pesa en crudo, salvo lo que diga "cocido". El arroz se pesa antes de cocerlo.',
  'Lechuga, hojas verdes y verduras: libres, no se cuentan. Lo que suma son los aliños.',
  'Aceite de oliva: 1 cucharadita medida (5 ml). 20 ml a ojo son ≈160 kcal.',
  'La palta de la once se pesa siempre: 50 g.',
  'Barrita casera: pesar cada ingrediente de la receta y dividir por las barritas que salen. Mientras tanto se cuenta como ≈200 kcal.',
  'Bebidas y jugos light: libres. Una copa de vino de 150 ml son ≈125 kcal y se registra.'
];

window.DATA = { ROUTINES, ROUTINE_ORDER, PHASES, MEALS, NUTRITION_TIPS };
