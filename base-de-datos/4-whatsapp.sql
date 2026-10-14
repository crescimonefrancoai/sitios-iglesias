-- Agente por WhatsApp: quién puede pedir cambios y registro de los mensajes.
-- Se puede correr más de una vez sin problemas.

-- 1. Números habilitados para pedir cambios (uno o más por iglesia)
create table if not exists whatsapp_autorizados (
  telefono   text primary key check (telefono ~ '^[0-9]{8,15}$'),  -- como lo manda WhatsApp: código de país, sin + ni espacios
  church_id  uuid not null references churches(id) on delete cascade,
  nombre     text,
  activo     boolean not null default true,
  created_at timestamptz default now()
);

-- 2. Cada mensaje recibido y qué pasó con él (también evita procesar dos veces el mismo)
create table if not exists whatsapp_mensajes (
  id         uuid primary key default gen_random_uuid(),
  wamid      text not null unique,                 -- id del mensaje en WhatsApp
  telefono   text not null,
  church_id  uuid references churches(id) on delete set null,
  tipo       text,
  texto      text,
  estado     text not null default 'recibido'
             check (estado in ('recibido','no_autorizado','no_soportado','enviado_al_agente','respondido','error')),
  respuesta  text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists whatsapp_mensajes_church on whatsapp_mensajes (church_id, created_at desc);

-- 3. Seguridad: el público no ve nada. La función de WhatsApp usa la clave de servicio,
--    y el equipo de cada iglesia puede leer solo sus propios mensajes desde el panel.
alter table whatsapp_autorizados enable row level security;
alter table whatsapp_mensajes enable row level security;

drop policy if exists whatsapp_autorizados_tenant on whatsapp_autorizados;
create policy whatsapp_autorizados_tenant on whatsapp_autorizados for select
  using (church_id = public.my_church_id());

drop policy if exists whatsapp_mensajes_tenant on whatsapp_mensajes;
create policy whatsapp_mensajes_tenant on whatsapp_mensajes for select
  using (church_id = public.my_church_id());

-- 4. Habilitar un número. Cambiá TU_NUMERO por el número tal como lo usa WhatsApp:
--    código de país + número, solo dígitos. Argentina: 549 + característica + número (ej. 5491123456789).
--    México: 521 + 10 dígitos. Brasil: 55 + DDD + número. Guatemala: 502 + 8 dígitos.
insert into whatsapp_autorizados (telefono, church_id, nombre)
values ('TU_NUMERO', '0aa69392-5f53-4a43-9c20-2c1a246500c9', 'Prueba')
on conflict (telefono) do update set church_id = excluded.church_id, activo = true;
