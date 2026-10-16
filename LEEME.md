# Sitios de iglesias con mantenimiento automático

Una plantilla, un archivo de datos por iglesia y un agente que actualiza esos datos.
Todo corre en GitHub: no hace falta instalar nada en la PC.

```
plantilla/iglesia.html      El diseño (igual para todos los clientes)
clientes/<cliente>.json     Los datos de cada iglesia
agente/agente.mjs           Agente: recibe un pedido y cambia los datos (usa la API de Claude)
agente/revision.mjs         Revisión semanal: eventos vencidos, enlaces caídos, contenido faltante
agente/construir.mjs        Une plantilla + datos y arma cada sitio
.github/workflows/          Las tres automatizaciones de GitHub
```

Cada sitio queda en `https://<usuario>.github.io/<repositorio>/<cliente>/`.

## Puesta en marcha (una sola vez)

1. Crear una cuenta en github.com y un repositorio nuevo **público** (GitHub Pages gratis solo funciona en repositorios públicos).
2. Subir todo el contenido de esta carpeta al repositorio, incluida la carpeta `.github`.
3. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
4. Crear una clave en console.anthropic.com y guardarla en **Settings → Secrets and variables → Actions → New repository secret** con el nombre `ANTHROPIC_API_KEY`.
5. En **Actions → Publicar sitios → Run workflow** para la primera publicación.

## Pedir un cambio

**Actions → Agente - pedir un cambio → Run workflow**, elegir el cliente y escribir el pedido:

- "Agregá un bautismo el 12 de diciembre a las 11 en la sede central"
- "El culto del domingo a la noche pasa a las 19:30"
- "Nueva enseñanza: «Volver a empezar», Pastor Daniel, 4 de octubre, https://youtu.be/..., trata sobre las segundas oportunidades"

El agente cambia los datos, los valida, guarda el cambio y publica. Al terminar, la misma pantalla muestra un resumen de lo que hizo (o por qué no hizo nada).

### Por API

El mismo pedido se puede mandar desde otro sistema (un formulario, un bot de WhatsApp):

```bash
curl -X POST https://api.github.com/repos/USUARIO/REPOSITORIO/actions/workflows/agente.yml/dispatches \
  -H "Authorization: Bearer TOKEN_DE_GITHUB" \
  -H "Accept: application/vnd.github+json" \
  -d '{"ref":"main","inputs":{"cliente":"puerto-seguro","pedido":"Agregá un bautismo el 12 de diciembre a las 11 en la sede central"}}'
```

El token se crea en GitHub (Settings → Developer settings → Fine-grained tokens) con permiso **Actions: Read and write** sobre este repositorio.

### Por WhatsApp

Los pastores le escriben al número de WhatsApp de Eklesic y el pedido llega al mismo agente. Solo responden los números habilitados; cada uno corresponde a una iglesia.

```
supabase/functions/whatsapp/index.ts   Recibe los mensajes (webhook de Meta) y le pasa el pedido al agente
base-de-datos/4-whatsapp.sql           Números habilitados y registro de mensajes
```

1. Quien escribe recibe "Recibido". La función dispara **Agente - pedir un cambio** con el cliente, el pedido y un id interno (`aviso`). El teléfono nunca viaja a GitHub.
2. Al terminar, el workflow le devuelve el resultado a la función (`/whatsapp/aviso`) y la función se lo manda por WhatsApp.

Secretos de la función (Supabase → Edge Functions → Secrets): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `GITHUB_TOKEN` (fine-grained, **Actions: Read and write** sobre este repositorio), `GITHUB_REPO` (`usuario/repositorio`) y `AVISO_SECRET`. La función va con **verificación de JWT apagada**, porque Meta no la manda; en su lugar se comprueba la firma de Meta y el `AVISO_SECRET`.

Secretos del repositorio (GitHub → Settings → Secrets → Actions): `WHATSAPP_AVISO_URL` (`https://<proyecto>.supabase.co/functions/v1/whatsapp/aviso`) y `WHATSAPP_AVISO_SECRET` (el mismo valor que `AVISO_SECRET`).

Para habilitar un número nuevo, agregarlo en la tabla `whatsapp_autorizados` (ver el final de `4-whatsapp.sql`). Por ahora entiende solo mensajes de texto.

## Qué puede y qué no puede tocar el agente

Puede cambiar: título, bajada, visión, quiénes somos, pastores, texto de siguiente paso, enlaces de transmisión y enseñanzas, horarios, enseñanzas, eventos, ministerios, sedes y redes.

No puede cambiar: nombre de la iglesia, WhatsApp, correo y **datos de ofrendas** (alias, banco, enlace de pago). Eso se edita a mano en `clientes/<cliente>.json`, para que nadie pueda desviar ofrendas con un pedido.

Si un cambio deja los datos con errores (una fecha que no existe, un enlace sin https), no se guarda ni se publica.

## Revisión semanal

Corre sola los lunes a las 9:00 (hora de Argentina). Quita los eventos que ya pasaron y, si encuentra algo para revisar (sin próximos eventos, más de 21 días sin enseñanza nueva, enlaces caídos, datos de ejemplo), abre un aviso en la pestaña **Issues** del repositorio. No usa la API de Claude, así que no tiene costo.

## Enseñanzas desde YouTube

Cada 6 horas, **Enseñanzas desde YouTube** (`.github/workflows/youtube.yml` → `agente/youtube.mjs`) revisa el canal de cada iglesia que tenga configurado:

1. Lee la lista pública de videos del canal (la que YouTube publica para cualquiera: no usa cuenta, contraseña ni permiso del canal).
2. Descarta los shorts, las transmisiones programadas que todavía no empezaron (0 vistas), los videos de más de 21 días y los que ya están en el sitio.
3. Si queda algún video nuevo, Claude decide si es una enseñanza (prédica, culto, estudio) o no (anuncio, clip), limpia el título, identifica al pastor y escribe un resumen de una oración. Claude solo se usa cuando hay videos nuevos.
4. Agrega las enseñanzas, deja las 12 más recientes y publica el sitio.

Para activarlo en una iglesia, agregar en `clientes/<cliente>.json` la línea:

```json
"youtube": "@usuario-del-canal",
```

También acepta el enlace completo del canal o su id (`UC…`). Para probarlo sin esperar: **Actions → Enseñanzas desde YouTube → Run workflow**.

## Agregar una iglesia

Copiar `clientes/puerto-seguro.json` con otro nombre (minúsculas y guiones, por ejemplo `luz-del-valle.json`), cargar sus datos y subirlo. El sitio aparece en `/<ese-nombre>/`.

Para que sus formularios guarden en la base de datos (ver más abajo), también hay que darla de alta en la base y poner su `churchId` en el archivo.

## Base de datos y panel (Supabase)

Una sola base de datos para todas las iglesias. Los formularios del sitio guardan ahí a quien se anota, y el panel muestra los datos.

```
base-de-datos/1-tablas.sql             Crea las tablas (una sola vez)
base-de-datos/2-seguridad.sql          Reglas: cada iglesia ve solo lo suyo; el público solo puede anotarse
base-de-datos/3-alta-puerto-seguro.sql Da de alta una iglesia y su usuario del panel
plantilla/conexion.json                Dirección de la base y clave PÚBLICA (anon). Nunca la service_role
plantilla/panel.html                   Panel de administración (se publica en /panel/)
```

- En el sitio, "¿Eres nuevo en la fe?" guarda en la tabla `people` (estado `prospect`) y "¿Necesitas oración?" en `prayer_requests`. Si `churchId` o `conexion.json` faltan, el sitio sigue funcionando por WhatsApp como antes.
- El panel está en `https://<usuario>.github.io/<repositorio>/panel/`. Cada persona del equipo entra con su correo y contraseña de Supabase y ve solo los datos de su iglesia.
- Los **eventos y enseñanzas** siguen saliendo del archivo JSON (los actualiza el agente). La base guarda a las personas.
- Para dar de alta una iglesia nueva: generar un UUID, ejecutar un `alta-<cliente>.sql` equivalente al de Puerto Seguro, y poner el mismo UUID como `churchId` en `clientes/<cliente>.json`.
- Que alguien asista a una iglesia es información sensible: el formulario exige aceptar el tratamiento de datos y la base guarda la fecha de aceptación (`consent_at`). Revisar la normativa de cada país donde se venda.

## Avisos de visitas y pedidos de oración

Para que nadie que se anota en la página se pierda:

| Cuándo | Qué pasa |
|---|---|
| Alguien completa "¿Eres nuevo en la fe?" | El equipo recibe un WhatsApp con su nombre y contacto. Si dejó un celular, la persona recibe una bienvenida. |
| Alguien deja un pedido de oración | El equipo recibe un WhatsApp avisando quién lo dejó. El texto del pedido **no** viaja por WhatsApp: se lee en el panel. |
| Pasan 2 días y nadie lo marcó como contactado | El equipo recibe un recordatorio (solo entre las 9 y las 20 de la iglesia, una sola vez). |

En el panel, la tarjeta **Sin contactar** muestra a quien falta llamar, y el botón **Ya lo contactamos** frena el recordatorio.

```
base-de-datos/5-avisos.sql            Columnas para saber qué ya se avisó y quién fue contactado
supabase/functions/whatsapp/index.ts  POST /whatsapp/pendientes: manda todo lo pendiente, cada cosa una sola vez
.github/workflows/avisos.yml          Llama a /pendientes una vez por hora (respaldo y recordatorios)
```

- Reciben los avisos los números de `whatsapp_autorizados` de esa iglesia con `recibe_avisos = true` (por defecto, todos).
- Días hasta el recordatorio: `settings.dias_seguimiento` de la iglesia (por defecto 2). Idioma de las plantillas: `settings.idioma` (por defecto `es`).
- El teléfono de la bienvenida se pasa al formato de WhatsApp según `churches.country` (`AR`, `MX`, `BR`, `GT`). Si no se puede interpretar, no se manda la bienvenida; el equipo igual recibe el contacto.

### Plantillas de WhatsApp

WhatsApp no deja que un negocio escriba primero con texto libre: hacen falta **plantillas aprobadas por Meta**. Se crean en WhatsApp Manager → **Plantillas de mensajes → Crear plantilla**, categoría **Utilidad**, idioma **Español**, con el nombre y el texto exactos de abajo. Meta pide un ejemplo para cada `{{n}}`. Si cambia un nombre, el código no la encuentra.

Meta clasifica sola cada plantilla. Para que quede en **Utilidad** (más barata y sin límites de entrega de Marketing), el texto tiene que empezar por el hecho concreto, sin saludos ni frases promocionales; la calidez va al cierre. Las primeras versiones (`aviso_nueva_visita`, `aviso_pedido_oracion`, `recordatorio_seguimiento`, `bienvenida_visita`) quedaron como Marketing y ya no se usan.

**`aviso_registro_web`**
> Nuevo registro en la página: {{1}} completó el formulario de siguiente paso. Contacto: {{2}}. Cuando le escribas, márcalo como contactado en el panel. Dios te bendiga.

Ejemplos: `Ana López` · `11 2345 6789`

**`aviso_oracion_recibida`**
> Se recibió un nuevo pedido de oración en la página, de parte de {{1}}. Puedes leerlo en el panel de la iglesia. Dios te bendiga.

Ejemplo: `Ana`

**`seguimiento_pendiente`**
> Seguimiento pendiente: {{1}} se registró en la página hace {{2}} días y todavía no figura como contactado. Contacto: {{3}}. Cuando le escribas, márcalo en el panel.

Ejemplos: `Ana López` · `3` · `11 2345 6789`

**`confirmacion_registro`**
> Hola {{1}}, recibimos tus datos en la página de {{2}}. En los próximos días alguien de nuestro equipo te escribirá para acompañarte. Dios te bendiga.

Ejemplos: `Ana` · `Iglesia Puerto Seguro`

Cada mensaje de plantilla tiene un costo por mensaje que cobra Meta, según el país. Con el número de prueba de Meta solo llegan a los números cargados en su lista de destinatarios.
