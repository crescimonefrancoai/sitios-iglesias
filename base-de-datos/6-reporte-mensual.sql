-- Reporte mensual por WhatsApp al equipo de cada iglesia.
-- Se puede correr más de una vez sin problemas.

-- Qué mes ya se reportó a cada iglesia (así el reporte llega una sola vez)
create table if not exists reportes_mensuales (
  church_id  uuid not null references churches(id) on delete cascade,
  mes        date not null,                 -- primer día del mes reportado
  enviado_at timestamptz not null default now(),
  primary key (church_id, mes)
);

-- Solo la función de WhatsApp (con la clave de servicio) la usa: el público y el panel no la ven
alter table reportes_mensuales enable row level security;
