-- Alta de la iglesia "Puerto Seguro" y de su usuario del panel.
-- El id tiene que ser el mismo que "churchId" en clientes/puerto-seguro.json.

insert into churches (id, name, slug, country, timezone, contact_email, contact_phone)
values ('0aa69392-5f53-4a43-9c20-2c1a246500c9', 'Iglesia Cristiana Puerto Seguro', 'puerto-seguro',
        'AR', 'America/Argentina/Buenos_Aires', 'contacto@ejemplo.org', '5491100000000')
on conflict (id) do nothing;

-- PASO MANUAL ANTES: en Supabase -> Authentication -> Users -> Add user -> Create new user
-- (correo + contraseña, con "Auto Confirm User" marcado). Después cambiá TU_CORREO por ese correo:

insert into staff_users (church_id, auth_id, email, full_name, role)
select '0aa69392-5f53-4a43-9c20-2c1a246500c9', id, email, 'Administrador', 'owner'
from auth.users
where email = 'TU_CORREO'
on conflict do nothing;
