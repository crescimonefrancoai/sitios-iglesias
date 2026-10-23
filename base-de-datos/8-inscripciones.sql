-- Eventos con inscripción. Los eventos están en el archivo del cliente (GitHub); acá se guardan las inscripciones.
-- Se puede correr más de una vez sin problemas. Necesita 2-seguridad.sql y 7-asistente.sql.
-- ATENCIÓN: si ya corriste 9-pagos.sql, no vuelvas a correr este archivo (dejaría dos versiones de la función
-- "inscribir"). Si hace falta, corré después 9-pagos.sql de nuevo y queda bien.

create table if not exists inscripciones (
  id            uuid primary key default gen_random_uuid(),
  church_id     uuid not null references churches(id) on delete cascade,
  evento_id     text not null check (evento_id ~ '^[a-z0-9]{8}$'),  -- el "id" del evento en clientes/<cliente>.json
  evento_titulo text not null,                                       -- copia, por si el evento se borra del sitio
  evento_fecha  date not null,
  nombre        text not null,
  telefono      text,
  email         text,
  acompanantes  int not null default 0 check (acompanantes between 0 and 20),
  consent_at    timestamptz not null default now(),                 -- aceptó que la iglesia guarde sus datos
  created_at    timestamptz not null default now(),
  confirmacion_enviada_at timestamptz,  -- confirmación por WhatsApp a quien se inscribió
  aviso_enviado_at        timestamptz,  -- aviso al equipo (eventos con avisos "cada_inscripcion")
  resumen_enviado_at      timestamptz,  -- incluida en el resumen diario (eventos con avisos "resumen_diario")
  recordatorio_enviado_at timestamptz   -- recordatorio el día anterior al evento
);
create index if not exists inscripciones_evento on inscripciones (church_id, evento_id);
create index if not exists inscripciones_pendientes on inscripciones (created_at)
  where confirmacion_enviada_at is null or aviso_enviado_at is null or resumen_enviado_at is null or recordatorio_enviado_at is null;

-- El equipo de cada iglesia ve y puede borrar solo sus inscripciones. El público no accede directo:
-- se inscribe a través de la función de WhatsApp, que revisa el evento y el cupo.
alter table inscripciones enable row level security;
drop policy if exists inscripciones_tenant on inscripciones;
create policy inscripciones_tenant on inscripciones
  using (church_id = public.my_church_id()) with check (church_id = public.my_church_id());

-- Inscribe controlando el cupo (personas = 1 + acompañantes). Devuelve 'ok', 'sin_cupo' o 'repetido'.
create or replace function public.inscribir(
  p_church uuid, p_evento text, p_titulo text, p_fecha date, p_cupo int,
  p_nombre text, p_telefono text, p_email text, p_acompanantes int)
returns text language plpgsql security definer set search_path = public as $$
declare ocupados int;
begin
  -- Una inscripción por vez para cada evento: así dos personas no se quedan con el mismo último lugar
  perform pg_advisory_xact_lock(hashtext(p_church::text || ':' || p_evento));
  if exists (select 1 from inscripciones where church_id = p_church and evento_id = p_evento
             and ((p_telefono is not null and telefono = p_telefono) or (p_email is not null and lower(email) = lower(p_email)))) then
    return 'repetido';
  end if;
  if p_cupo is not null then
    select coalesce(sum(1 + acompanantes), 0) into ocupados from inscripciones where church_id = p_church and evento_id = p_evento;
    if ocupados + 1 + p_acompanantes > p_cupo then return 'sin_cupo'; end if;
  end if;
  insert into inscripciones (church_id, evento_id, evento_titulo, evento_fecha, nombre, telefono, email, acompanantes)
  values (p_church, p_evento, p_titulo, p_fecha, p_nombre, p_telefono, p_email, p_acompanantes);
  return 'ok';
end $$;
revoke execute on function public.inscribir(uuid, text, text, date, int, text, text, text, int) from public, anon, authenticated;

-- Personas inscritas por evento (1 + acompañantes), contadas en la base: sin el tope de 1000 filas por consulta
create or replace function public.ocupados_por_evento(p_church uuid, p_evento text default null)
returns table (evento_id text, ocupados bigint)
language sql stable security definer set search_path = public as $$
  select i.evento_id, sum(1 + i.acompanantes)::bigint
  from inscripciones i
  where i.church_id = p_church and (p_evento is null or i.evento_id = p_evento)
  group by i.evento_id
$$;
revoke execute on function public.ocupados_por_evento(uuid, text) from public, anon, authenticated;
