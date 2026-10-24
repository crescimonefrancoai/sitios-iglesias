-- Alta de la "Iglesia de Prueba": para probar cambios, formularios, inscripciones y pagos sin tocar la demo
-- (Puerto Seguro) ni los sitios de los clientes. Su sitio es clientes/prueba.json y queda en /prueba/.
-- Se puede correr más de una vez sin problemas.

insert into churches (id, name, slug, country, timezone, currency, settings)
values ('c1028489-083c-4268-b0ee-5186a3c347c0', 'Iglesia de Prueba', 'prueba', 'AR',
        'America/Argentina/Buenos_Aires', 'ARS', '{"asistente_max_dia": 100}')
on conflict (id) do nothing;

-- Usuario del panel. Cada usuario pertenece a UNA sola iglesia, así que para entrar al panel de la iglesia de prueba
-- hace falta un usuario aparte. PASO MANUAL ANTES: Supabase -> Authentication -> Users -> Add user -> Create new user,
-- con "Auto Confirm User" marcado. Truco: con Gmail, tucorreo+prueba@gmail.com llega a la misma casilla que tucorreo@gmail.com.
-- Después cambiá TU_CORREO_DE_PRUEBA por ese correo y ejecutá:
insert into staff_users (church_id, auth_id, email, full_name, role)
select 'c1028489-083c-4268-b0ee-5186a3c347c0', id, email, 'Pruebas', 'owner'
from auth.users
where email = 'TU_CORREO_DE_PRUEBA'
on conflict do nothing;

-- A propósito, la iglesia de prueba NO tiene números en whatsapp_autorizados: las pruebas no le mandan avisos a nadie.
-- Para probar un aviso por WhatsApp, se puede pasar un número a esta iglesia por un rato:
--   update whatsapp_autorizados set church_id = 'c1028489-083c-4268-b0ee-5186a3c347c0' where telefono = 'TU_NUMERO';
-- y devolverlo después a Puerto Seguro:
--   update whatsapp_autorizados set church_id = '0aa69392-5f53-4a43-9c20-2c1a246500c9' where telefono = 'TU_NUMERO';
