-- Asistente de la página: límites de uso (las conversaciones no se guardan).
-- Se puede correr más de una vez sin problemas.

-- Contadores por visitante (su IP, cifrada) y por iglesia, que se reinician solos al vencer
create table if not exists asistente_uso (
  clave    text primary key,          -- "ip:<hash>" o "iglesia:<id>"
  cantidad int not null default 0,
  vence    timestamptz not null
);
alter table asistente_uso enable row level security;   -- sin reglas: solo la función (clave de servicio) la usa

-- Suma un mensaje a la clave y dice si todavía está dentro del máximo de la ventana
create or replace function public.asistente_permitido(p_clave text, p_maximo int, p_ventana interval)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into asistente_uso (clave, cantidad, vence) values (p_clave, 1, now() + p_ventana)
  on conflict (clave) do update set
    cantidad = case when asistente_uso.vence < now() then 1 else asistente_uso.cantidad + 1 end,
    vence    = case when asistente_uso.vence < now() then now() + p_ventana else asistente_uso.vence end
  returning cantidad into n;
  return n <= p_maximo;
end $$;

revoke execute on function public.asistente_permitido(text, int, interval) from public, anon, authenticated;

-- Opcional: cambiar el máximo diario de una iglesia (por defecto 300 mensajes por día)
-- update churches set settings = settings || '{"asistente_max_dia": 500}' where slug = 'puerto-seguro';
-- Opcional: apagar el asistente de una iglesia
-- update churches set settings = settings || '{"asistente": false}' where slug = 'puerto-seguro';
