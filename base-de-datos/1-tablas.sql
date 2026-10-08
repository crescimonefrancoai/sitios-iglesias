-- MVP: sistema de presencia digital para iglesias (multi-tenant, PostgreSQL / Supabase)
-- Una sola base de datos para todas las iglesias clientes. Cada tabla lleva church_id.

create extension if not exists "pgcrypto";

-- 1. IGLESIAS (cada cliente) -------------------------------------------------
create table churches (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,          -- subdominio / URL del sitio
  country       text,
  timezone      text default 'UTC',
  currency      text default 'USD',
  contact_email text,
  contact_phone text,
  address       text,
  settings      jsonb default '{}',            -- colores, logo, textos del sitio
  plan          text default 'basic',          -- basic / pro (mantenimiento mensual)
  created_at    timestamptz default now()
);

-- 2. USUARIOS DEL SISTEMA (pastores, secretarios, vos como admin) -------------
create table staff_users (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references churches(id) on delete cascade,
  auth_id    uuid unique,                      -- id de Supabase Auth
  email      text not null,
  full_name  text,
  role       text not null default 'editor'
             check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz default now(),
  unique (church_id, email)
);

-- 3. FAMILIAS / HOGARES -------------------------------------------------------
create table households (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references churches(id) on delete cascade,
  name       text not null,                    -- "Familia Pérez"
  address    text,
  created_at timestamptz default now()
);

-- 4. PERSONAS (miembros, visitantes, futuros asistentes) ---------------------
-- Una sola tabla: la persona "avanza" cambiando de status.
create table people (
  id             uuid primary key default gen_random_uuid(),
  church_id      uuid not null references churches(id) on delete cascade,
  household_id   uuid references households(id) on delete set null,
  first_name     text not null,
  last_name      text,
  email          text,
  phone          text,
  birth_date     date,
  gender         text,
  address        text,
  status         text not null default 'visitor'
                 check (status in ('prospect','visitor','regular','member','inactive')),
  -- prospect = se anotó en la web pero aún no vino
  -- visitor  = vino al menos una vez
  -- regular  = viene seguido, aún no es miembro
  -- member   = miembro formal
  source         text,                         -- 'web_form','evento','invitado_por','presencial'
  invited_by     uuid references people(id) on delete set null,
  first_visit_at date,
  member_since   date,
  baptized       boolean,
  baptism_date   date,
  notes          text,
  consent_data   boolean not null default false,   -- aceptó tratamiento de datos
  consent_at     timestamptz,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index on people (church_id, status);
create index on people (church_id, last_name);

-- 5. SERVICIOS / REUNIONES Y ASISTENCIA ---------------------------------------
create table gatherings (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references churches(id) on delete cascade,
  title      text not null,                    -- "Culto domingo", "Célula Norte"
  kind       text default 'service',           -- service / small_group / youth / other
  starts_at  timestamptz not null,
  created_at timestamptz default now()
);

create table attendance (
  gathering_id uuid not null references gatherings(id) on delete cascade,
  person_id    uuid not null references people(id) on delete cascade,
  church_id    uuid not null references churches(id) on delete cascade,
  checked_in_at timestamptz default now(),
  primary key (gathering_id, person_id)
);

-- 6. EVENTOS PÚBLICOS E INSCRIPCIONES (lo que se muestra en la web) -----------
create table events (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references churches(id) on delete cascade,
  title       text not null,
  description text,
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  image_url   text,
  capacity    int,
  published   boolean default true,
  created_at  timestamptz default now()
);

create table event_registrations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  church_id  uuid not null references churches(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  guests     int default 0,
  created_at timestamptz default now(),
  unique (event_id, person_id)
);

-- 7. MINISTERIOS / GRUPOS -----------------------------------------------------
create table ministries (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references churches(id) on delete cascade,
  name        text not null,                   -- Alabanza, Jóvenes, Niños...
  description text,
  leader_id   uuid references people(id) on delete set null
);

create table ministry_members (
  ministry_id uuid not null references ministries(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  role        text default 'member',
  primary key (ministry_id, person_id)
);

-- 8. SEGUIMIENTO DE VISITAS (clave para que nadie se pierda) -----------------
create table follow_ups (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references churches(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  assigned_to uuid references staff_users(id) on delete set null,
  type        text default 'call',             -- call / visit / message
  status      text default 'pending' check (status in ('pending','done','cancelled')),
  due_date    date,
  note        text,
  created_at  timestamptz default now()
);

-- 9. PEDIDOS DE ORACIÓN (formulario público de la web) ------------------------
create table prayer_requests (
  id         uuid primary key default gen_random_uuid(),
  church_id  uuid not null references churches(id) on delete cascade,
  person_id  uuid references people(id) on delete set null,
  name       text,
  request    text not null,
  is_private boolean default true,
  created_at timestamptz default now()
);

-- 10. SEGURIDAD: aislar los datos de cada iglesia (Row Level Security) --------
-- Activar RLS en todas las tablas con church_id y crear una política por tabla.
-- Ejemplo para people (repetir el patrón en el resto):
alter table people enable row level security;
create policy people_tenant on people
  using (church_id = (select church_id from staff_users where auth_id = auth.uid()));
