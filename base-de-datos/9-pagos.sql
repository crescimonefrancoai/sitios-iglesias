-- Eventos pagos con Mercado Pago. Se puede correr más de una vez sin problemas. Necesita 8-inscripciones.sql.

-- 1. Cuenta de Mercado Pago de cada iglesia (la conecta la iglesia desde el panel; el dinero va directo a ella).
--    Solo la usa la función whatsapp con la clave de servicio: ni el público ni el panel la pueden leer.
create table if not exists mp_cuentas (
  church_id      uuid primary key references churches(id) on delete cascade,
  mp_user_id     text not null,
  access_token   text not null,
  refresh_token  text,
  live_mode      boolean,
  vence_at       timestamptz not null,           -- el acceso dura 180 días; la función lo renueva sola antes
  conectada_at   timestamptz not null default now(),
  actualizada_at timestamptz not null default now()
);
alter table mp_cuentas enable row level security;
revoke all on mp_cuentas from anon, authenticated;

-- 2. Estado del pago de cada inscripción
alter table inscripciones add column if not exists pago_estado text not null default 'no_requiere';
alter table inscripciones drop constraint if exists inscripciones_pago_estado_check;
alter table inscripciones add constraint inscripciones_pago_estado_check
  check (pago_estado in ('no_requiere', 'pendiente', 'pagado', 'vencido', 'reembolsado'));
alter table inscripciones add column if not exists monto numeric(12, 2);     -- total a pagar (precio x personas)
alter table inscripciones add column if not exists moneda text;
alter table inscripciones add column if not exists pago_vence_at timestamptz; -- hasta cuándo se le guarda el lugar sin pagar
alter table inscripciones add column if not exists mp_pago_id text;
alter table inscripciones add column if not exists pagado_at timestamptz;
create index if not exists inscripciones_pago_pendiente on inscripciones (created_at) where pago_estado = 'pendiente';

-- 3. Una inscripción ocupa lugar si no requiere pago, si está pagada, o si está pendiente y su reserva no venció
create or replace function public.inscripcion_ocupa(i inscripciones)
returns boolean language sql stable as $$
  select i.pago_estado in ('no_requiere', 'pagado') or (i.pago_estado = 'pendiente' and i.pago_vence_at > now())
$$;

-- 4. Inscribir (reemplaza la versión de 8-inscripciones.sql). Con p_monto, la inscripción queda pendiente de pago
--    y el lugar se reserva p_minutos. Devuelve 'ok:<id>', 'pendiente:<id>' (ya tenía una reserva sin pagar),
--    'sin_cupo' o 'repetido'.
drop function if exists public.inscribir(uuid, text, text, date, int, text, text, text, int);
create or replace function public.inscribir(
  p_church uuid, p_evento text, p_titulo text, p_fecha date, p_cupo int,
  p_nombre text, p_telefono text, p_email text, p_acompanantes int,
  p_monto numeric default null, p_moneda text default null, p_minutos int default 30)
returns text language plpgsql security definer set search_path = public as $$
declare
  ocupados int;
  previa inscripciones;
  nueva uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_church::text || ':' || p_evento));
  select * into previa from inscripciones i
   where i.church_id = p_church and i.evento_id = p_evento and public.inscripcion_ocupa(i)
     and ((p_telefono is not null and i.telefono = p_telefono) or (p_email is not null and lower(i.email) = lower(p_email)))
   limit 1;
  if found then
    if previa.pago_estado = 'pendiente' then
      update inscripciones set pago_vence_at = now() + make_interval(mins => p_minutos) where id = previa.id;
      return 'pendiente:' || previa.id;
    end if;
    return 'repetido';
  end if;
  if p_cupo is not null then
    select coalesce(sum(1 + i.acompanantes), 0) into ocupados
      from inscripciones i where i.church_id = p_church and i.evento_id = p_evento and public.inscripcion_ocupa(i);
    if ocupados + 1 + p_acompanantes > p_cupo then return 'sin_cupo'; end if;
  end if;
  insert into inscripciones (church_id, evento_id, evento_titulo, evento_fecha, nombre, telefono, email, acompanantes,
                             pago_estado, monto, moneda, pago_vence_at)
  values (p_church, p_evento, p_titulo, p_fecha, p_nombre, p_telefono, p_email, p_acompanantes,
          case when p_monto is null then 'no_requiere' else 'pendiente' end,
          case when p_monto is null then null else p_monto * (1 + p_acompanantes) end,
          p_moneda,
          case when p_monto is null then null else now() + make_interval(mins => p_minutos) end)
  returning id into nueva;
  return 'ok:' || nueva;
end $$;
revoke execute on function public.inscribir(uuid, text, text, date, int, text, text, text, int, numeric, text, int) from public, anon, authenticated;

-- 5. Lugares ocupados por evento: ahora sin contar las reservas vencidas sin pagar
create or replace function public.ocupados_por_evento(p_church uuid, p_evento text default null)
returns table (evento_id text, ocupados bigint)
language sql stable security definer set search_path = public as $$
  select i.evento_id, sum(1 + i.acompanantes)::bigint
  from inscripciones i
  where i.church_id = p_church and (p_evento is null or i.evento_id = p_evento) and public.inscripcion_ocupa(i)
  group by i.evento_id
$$;
revoke execute on function public.ocupados_por_evento(uuid, text) from public, anon, authenticated;
