-- Avisos automáticos: visitas nuevas, pedidos de oración y recordatorios de seguimiento.
-- Se puede correr más de una vez sin problemas.

-- 1. Qué ya se avisó y quién ya fue contactado
alter table people add column if not exists contactado_at timestamptz;            -- lo marca el equipo desde el panel
alter table people add column if not exists aviso_enviado_at timestamptz;         -- se avisó al equipo que se anotó
alter table people add column if not exists bienvenida_enviada_at timestamptz;    -- se le mandó la bienvenida a la persona
alter table people add column if not exists recordatorio_enviado_at timestamptz;  -- se recordó al equipo que nadie la contactó
alter table prayer_requests add column if not exists aviso_enviado_at timestamptz;

-- 2. Qué números del equipo reciben los avisos (por defecto, todos los habilitados para el agente)
alter table whatsapp_autorizados add column if not exists recibe_avisos boolean not null default true;

-- 3. Lo que ya estaba cargado antes de activar los avisos no se avisa (si no, llegaría todo junto)
update people
   set aviso_enviado_at = coalesce(aviso_enviado_at, now()),
       recordatorio_enviado_at = coalesce(recordatorio_enviado_at, now())
 where created_at < now() - interval '1 hour';
update prayer_requests
   set aviso_enviado_at = now()
 where aviso_enviado_at is null and created_at < now() - interval '1 hour';

-- 4. Para encontrar rápido lo pendiente
create index if not exists people_aviso_pendiente on people (created_at) where aviso_enviado_at is null;
create index if not exists people_sin_contactar on people (created_at)
  where status = 'prospect' and contactado_at is null and recordatorio_enviado_at is null;
create index if not exists prayer_aviso_pendiente on prayer_requests (created_at) where aviso_enviado_at is null;

-- 5. Opcional: días que se espera antes del recordatorio (si no se configura, son 2).
-- update churches set settings = settings || '{"dias_seguimiento": 3}' where slug = 'puerto-seguro';
