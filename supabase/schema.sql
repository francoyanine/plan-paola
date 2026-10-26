-- Plan Paola: tablas y permisos.
-- Pegar completo en Supabase → SQL Editor → New query → Run. Se puede correr una sola vez.

-- Atleta y su coach. settings: fecha de inicio, día del Upper A, calorías y variantes de hombro.
create table public.athletes (
  id uuid primary key references auth.users (id) on delete cascade,
  coach_id uuid not null references auth.users (id),
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Progresión semanal que arma el coach.
-- draft: lo que el coach está editando. published: lo que ve la atleta (se copia al tocar "Enviar").
-- Formato: { "note": "...", "exercises": { "la1": { "kg": 3, "rir": "2-1", "note": "" }, ... } }
create table public.plan_weeks (
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  week int not null,
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, week)
);

-- Todo lo que registra la atleta. kind: session | checkin | food | measure | customfood. key: id o fecha.
create table public.records (
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  kind text not null check (kind in ('session', 'checkin', 'food', 'measure', 'customfood')),
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, kind, key)
);

create or replace function public.is_coach_of(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.athletes where id = aid and coach_id = auth.uid());
$$;

alter table public.athletes enable row level security;
alter table public.plan_weeks enable row level security;
alter table public.records enable row level security;

create policy "atleta y coach leen la ficha" on public.athletes
  for select using (id = auth.uid() or coach_id = auth.uid());
create policy "coach edita la ficha" on public.athletes
  for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());

create policy "coach maneja la progresión" on public.plan_weeks
  for all using (public.is_coach_of(athlete_id)) with check (public.is_coach_of(athlete_id));
create policy "atleta lee semanas enviadas" on public.plan_weeks
  for select using (athlete_id = auth.uid() and published_at is not null);

create policy "atleta maneja sus registros" on public.records
  for all using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());
create policy "coach lee los registros" on public.records
  for select using (public.is_coach_of(athlete_id));

grant select, insert, update, delete on public.athletes, public.plan_weeks, public.records to authenticated;
revoke all on public.athletes, public.plan_weeks, public.records from anon;
