-- Seguridad (RLS): cada iglesia ve solo sus datos y el público solo puede anotarse.
-- Se puede correr más de una vez sin problemas.

-- 1. Función que dice a qué iglesia pertenece el usuario que inició sesión
create or replace function public.my_church_id()
returns uuid language sql stable security definer
set search_path = public as $$
  select church_id from staff_users where auth_id = auth.uid() limit 1
$$;

-- 2. Regla anterior de people (versión inicial del esquema)
drop policy if exists people_tenant on people;

-- 3. El equipo de cada iglesia accede solo a SUS datos
do $$
declare t text;
begin
  foreach t in array array['people','staff_users','households','gatherings','attendance',
    'events','event_registrations','ministries','follow_ups','prayer_requests']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_tenant', t);
    execute format('create policy %I on %I using (church_id = public.my_church_id()) with check (church_id = public.my_church_id())', t||'_tenant', t);
  end loop;
end $$;

alter table ministry_members enable row level security;
drop policy if exists ministry_members_tenant on ministry_members;
create policy ministry_members_tenant on ministry_members
  using (exists (select 1 from ministries m where m.id = ministry_id and m.church_id = public.my_church_id()));

alter table churches enable row level security;
drop policy if exists churches_public_read on churches;
create policy churches_public_read on churches for select using (true);

-- 4. Lo que puede hacer el público desde la página web (solo agregar, nunca leer)
drop policy if exists people_public_insert on people;
create policy people_public_insert on people for insert to anon
  with check (consent_data = true and status = 'prospect' and source = 'web_form');

drop policy if exists registrations_public_insert on event_registrations;
create policy registrations_public_insert on event_registrations for insert to anon with check (true);

drop policy if exists prayer_public_insert on prayer_requests;
create policy prayer_public_insert on prayer_requests for insert to anon with check (true);

drop policy if exists events_public_read on events;
create policy events_public_read on events for select to anon using (published = true);
