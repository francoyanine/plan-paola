-- Une la cuenta de Paola con la de Franco. Correr después de crear los dos usuarios
-- en Authentication → Users. Reemplazar los dos correos antes de correrlo.
insert into public.athletes (id, coach_id, name)
select a.id, c.id, 'Paola'
from auth.users a, auth.users c
where a.email = 'CORREO_DE_PAOLA' and c.email = 'CORREO_DE_FRANCO';

-- Debe mostrar una fila con los dos correos.
select a.name, ua.email as atleta, uc.email as coach
from public.athletes a
join auth.users ua on ua.id = a.id
join auth.users uc on uc.id = a.coach_id;
