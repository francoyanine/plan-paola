-- Une la cuenta de una persona con la de Franco. Correr después de crear los dos usuarios
-- en Authentication → Users. Reemplazar los tres valores antes de correrlo.
--   CORREO_DE_LA_PERSONA: correo con el que ella entra a su app
--   CORREO_DE_FRANCO:     tu correo de coach
--   plan: 'paola' o 'anita' (el id del archivo en plans/). Define qué rutina y comidas ve.
-- Se corre una vez por persona. Cada una queda con sus propios datos; tú las ves todas en la app de coach.
insert into public.athletes (id, coach_id, name, settings)
select a.id, c.id, 'NOMBRE', jsonb_build_object('plan', 'ID_DEL_PLAN')
from auth.users a, auth.users c
where a.email = 'CORREO_DE_LA_PERSONA' and c.email = 'CORREO_DE_FRANCO';

-- Para cambiar el plan de alguien que ya está conectada:
-- update public.athletes set settings = settings || '{"plan":"anita"}'::jsonb where id = (select id from auth.users where email = 'CORREO_DE_LA_PERSONA');

-- Debe mostrar una fila por persona, con los dos correos y el plan.
select a.name, a.settings->>'plan' as plan, ua.email as atleta, uc.email as coach
from public.athletes a
join auth.users ua on ua.id = a.id
join auth.users uc on uc.id = a.coach_id;
