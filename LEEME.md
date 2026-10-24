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

También acepta el enlace completo del canal o su id (`UC…`).

Por defecto entran prédicas, cultos y estudios, y quedan afuera anuncios y clips. Cada iglesia puede cambiar ese criterio en palabras comunes con otra línea:

```json
"youtubeCriterio": "Incluir las prédicas y el podcast «Café con el pastor». No incluir los videos de alabanza.",
```

Para probarlo sin esperar: **Actions → Enseñanzas desde YouTube → Run workflow**.

## Eventos con inscripción

Un evento del archivo del cliente puede llevar inscripción. Lo crea el pastor por WhatsApp ("Agregá el retiro el 7 de noviembre en Quinta Los Sauces, con inscripción, cupo 40"); si no dice cómo quiere enterarse de las inscripciones, el agente le pregunta antes de crearlo.

```json
{ "titulo": "Retiro de matrimonios", "fecha": "2026-11-07", "hora": "Todo el día", "lugar": "Quinta Los Sauces",
  "inscripcion": true, "cupo": 40, "avisos": "resumen_diario", "id": "k3x9a2pq" }
```

- `cupo` es opcional (sin cupo, no hay límite). Cada inscripción ocupa 1 lugar más sus acompañantes.
- `avisos`: `cada_inscripcion` (un WhatsApp al equipo por cada persona) o `resumen_diario` (un resumen entre las 19 y las 20 de la iglesia).
- `id` lo crea el sistema y une el evento con sus inscripciones: no se cambia.
- En la página: botón **Quiero inscribirme**, "Quedan N lugares" e "Inscripciones cerradas" cuando se llena. El formulario pide nombre, teléfono o correo, acompañantes y aceptación de datos.
- Mensajes: confirmación al inscrito, aviso o resumen al equipo, y recordatorio al inscrito el día anterior (entre las 9 y las 20).
- En el panel: pestaña **Inscripciones**, con la lista por evento y la descarga en planilla.
- La inscripción pasa por la función `whatsapp` (`/inscribir`), que revisa que el evento exista, no haya pasado y tenga lugar. Una misma persona (teléfono o correo) no se inscribe dos veces al mismo evento. Límite: 200 inscripciones por hora desde una misma conexión (alto a propósito, por el WiFi del templo).

```
base-de-datos/8-inscripciones.sql   Tabla de inscripciones y control del cupo
```

**Memoria corta del agente de WhatsApp**: el agente ve los mensajes de los últimos 30 minutos con la misma persona, así entiende respuestas a sus preguntas ("resumen por día").

## Eventos pagos (Mercado Pago)

Un evento con inscripción puede tener `precio` (por persona). Al inscribirse, la persona paga con Mercado Pago y la inscripción se confirma sola cuando el pago se acredita. **El dinero va directo a la cuenta de Mercado Pago de la iglesia**, nunca pasa por Eklesic.

```json
{ "titulo": "Retiro de mujeres", "fecha": "2026-11-20", "hora": "18:00", "lugar": "Longchamps",
  "inscripcion": true, "cupo": 30, "avisos": "cada_inscripcion", "precio": 25000, "id": "tp4j812e" }
```

El archivo de la iglesia necesita además `"moneda": "ARS"` (o `MXN`, `BRL`…), que se carga a mano: el agente no puede cambiarla. El pastor crea el evento pago por WhatsApp igual que los demás ("…con inscripción, cupo 30 y un costo de 25000").

Cómo funciona:

1. La persona completa el formulario y toca **Continuar al pago**. Se cobra por persona (ella más sus acompañantes).
2. Su lugar queda reservado **30 minutos** y la página la lleva a Mercado Pago. Solo se aceptan medios inmediatos (tarjeta, dinero en cuenta, PIX): los pagos en efectivo (OXXO, boleto, Rapipago) se excluyen porque se acreditan días después.
3. Mercado Pago avisa del pago a `/whatsapp/mp/notificacion`. El bot **no confía en el aviso**: consulta el pago a Mercado Pago, revisa que el monto y la moneda coincidan, y recién ahí marca la inscripción como pagada y manda la confirmación por WhatsApp y el aviso al equipo.
4. **Respaldo**: si un aviso se pierde, la tarea de cada hora busca en Mercado Pago los pagos de las reservas de las últimas 48 h. Las reservas sin pagar vencen solas y liberan el lugar.
5. En el panel, la pestaña Inscripciones muestra el estado de cada pago (pagado, pendiente, reserva vencida, reembolsado) y el total cobrado por evento. Las devoluciones las hace la iglesia desde su cuenta de Mercado Pago; al reembolsar, la inscripción pasa a "reembolsado".

```
base-de-datos/9-pagos.sql   Cuentas de Mercado Pago de las iglesias y estado de pago de las inscripciones
```

### Configuración (una sola vez, en Eklesic)

1. En Mercado Pago Developers, con la cuenta de Mercado Pago de Eklesic, **crear una aplicación** para pagos online con Checkout Pro.
2. En la aplicación, cargar como **URL de redireccionamiento**: `https://lzoidiktxmbswfgjoacf.supabase.co/functions/v1/whatsapp/mp/oauth`. Si la aplicación pide permisos, incluir `offline_access` (para que el acceso a la cuenta de cada iglesia se renueve solo).
3. Copiar el **Client ID** y el **Client Secret** de la aplicación y guardarlos en Supabase → Edge Functions → Secrets como `MP_CLIENT_ID` y `MP_CLIENT_SECRET`.
4. Opcional: `MP_COMISION` con un porcentaje (por ejemplo `3`) para que Eklesic cobre una comisión por inscripción. Consultar con un contador antes.
5. **No usar** `MP_PRUEBA` (pide credenciales del modo de prueba viejo de Mercado Pago y el pago falla con "Oh, no, algo anduvo mal"). `MP_SIN_VENCIMIENTO` = `si` existe solo para diagnosticar: quita el vencimiento de 30 minutos del cobro.

### Cómo probar sin dinero real (probado el 23/10/2026)

Una aplicación real no puede mover pagos entre cuentas de prueba cuando cobra a nombre de otro vendedor. Para probar:

1. En Mercado Pago Developers (cuenta real) → Cuentas de prueba, crear tres cuentas del mismo país: **Marketplace** (hace de Eklesic), **Vendedor** (hace de iglesia) y **Comprador**.
2. Iniciar sesión en Developers con la cuenta **Marketplace de prueba** y crear ahí una aplicación de prueba, con la misma URL de redireccionamiento.
3. Poner temporalmente en Supabase el `MP_CLIENT_ID` y el `MP_CLIENT_SECRET` de esa aplicación de prueba (guardar los reales aparte).
4. Conectar la iglesia desde el panel en una ventana de incógnito, iniciando sesión con la cuenta **Vendedor** de prueba.
5. Inscribirse en otra ventana de incógnito y pagar con la cuenta **Comprador** de prueba: tarjeta de prueba Mastercard terminada en 0604, código 123. Si Chrome bloquea las cookies de terceros (ojo tachado en la barra), permitirlas.
6. Al terminar, volver a poner las credenciales de la aplicación real.

Para iniciar sesión con una cuenta de prueba, el código de verificación es el de 6 dígitos que aparece en los datos de esa cuenta.

### Conectar una iglesia

1. Agregar `"moneda": "ARS"` (o la de su país) en `clientes/<cliente>.json`.
2. Quien administra la iglesia entra al panel → **Inscripciones** → **Conectar Mercado Pago**, ingresa con la cuenta de Mercado Pago de la iglesia y autoriza. El acceso dura 180 días y se renueva solo.

## Asistente de la página

Una burbuja "¿Tienes una pregunta?" abre un chat que responde a los visitantes con la información de su iglesia: horarios, sedes, ministerios, próximos eventos, enseñanzas y contacto. Aparece solo en los sitios conectados a la base de datos.

```
supabase/functions/asistente/index.ts  Función "asistente": arma la respuesta con Claude
base-de-datos/7-asistente.sql          Límites de uso
```

- Lee los datos de la iglesia del archivo del cliente en GitHub (cada 10 minutos como mucho), sin ids, claves ni datos bancarios.
- **No pide datos personales**: a quien quiere que lo contacten o pide oración lo lleva a los formularios de la página, que ya tienen el consentimiento y disparan los avisos.
- **No guarda las conversaciones.**
- Límites: 20 mensajes por hora por navegador (cada navegador guarda un código al azar, sin datos personales), 300 por hora por conexión (en el culto muchas personas comparten el WiFi del templo) y 1000 por día por iglesia (`settings.asistente_max_dia`). Para apagarlo en una iglesia: `settings.asistente = false` en la base, o `"asistente": false` en su archivo.
- Usa Claude Haiku 4.5 (el modelo económico de Claude, suficiente para estas preguntas): cada mensaje cuesta del orden de medio centavo de dólar.

Instalación: crear la función `asistente` en Supabase (Edge Functions → Deploy a new function → Via Editor) con el código de `index.ts`, **con la verificación de JWT apagada**, y agregar el secreto `ANTHROPIC_API_KEY`. Ejecutar `7-asistente.sql`.

## Escala: iglesias grandes y varias iglesias a la vez

Preparado para iglesias de 2000 personas o más:

- **Panel**: trae personas e inscripciones por tandas de 1000 (Supabase entrega como máximo 1000 filas por consulta), así no falta nadie en la lista, los contadores ni la planilla.
- **Cupos**: se cuentan en la base (`ocupados_por_evento`, en `8-inscripciones.sql`), sin tope de filas.
- **Mensajes masivos** (confirmaciones y recordatorios de un evento grande): salen de a 10 en paralelo, hasta 500 por pasada; la tarea de cada hora sigue con lo que falte.
- **Pedidos simultáneos**: el agente, YouTube y la revisión semanal no hacen fila (GitHub cancelaría los pedidos en espera). Guardan con `agente/guardar.sh`: si otro proceso guardó al mismo tiempo, combina los cambios, revisa que los datos sigan válidos y reintenta. Si dos pedidos tocan los mismos datos, el agente repite el pedido una vez sobre los datos nuevos.

Límites de los servicios que conviene revisar antes de vender:

| Servicio | Límite que importa | Qué hacer |
|---|---|---|
| WhatsApp (Meta) | El número de prueba solo llega a 5 números. Con número real, Meta limita a cuántas personas distintas se les puede escribir primero por día, para todo el portafolio Eklesic junto; empieza bajo y sube con la verificación del negocio y la calidad de los mensajes. | Número real y verificación del negocio antes del primer cliente. |
| Supabase (plan gratis) | Sin copias de seguridad automáticas, el proyecto se pausa si queda inactivo y tiene topes de base de datos, transferencia y llamadas a funciones. | Plan Pro cuando haya clientes: copias diarias y sin pausas. |
| API de Claude | Límite de pedidos por minuto según el nivel de la cuenta; sube con el uso y el crédito cargado. | Revisar Settings → Limits en console.anthropic.com. |
| GitHub Pages | Pensado para sitios institucionales, no para alojar comercialmente sitios de clientes; tope de transferencia mensual y de publicaciones por hora, compartido por todos los sitios del repositorio. | Para clientes que pagan, evaluar Cloudflare Pages o Netlify con dominio propio. |

## Iglesia de prueba

`clientes/prueba.json` es una iglesia inventada para probar cambios, formularios, inscripciones y pagos sin tocar la demo (Puerto Seguro) ni a los clientes. Su sitio está en `/prueba/`.

- `"prueba": true` hace que los buscadores no la indexen y que la revisión semanal no abra avisos por sus datos de ejemplo.
- En la base es la iglesia `c1028489-083c-4268-b0ee-5186a3c347c0` (`base-de-datos/10-alta-prueba.sql`). Tiene su propio usuario del panel, porque cada usuario pertenece a una sola iglesia.
- No tiene números de WhatsApp habilitados, así que las pruebas no le mandan avisos a nadie. Para probar un aviso, el SQL explica cómo pasarle un número por un rato.
- Tiene un evento gratis y uno pago con inscripción. Para el pago, se conecta desde su panel la cuenta vendedor de prueba de Mercado Pago.
- Los cambios por WhatsApp no le llegan (no tiene números), pero se le pueden pedir desde GitHub: Actions → **Agente - pedir un cambio** → Run workflow, con cliente `prueba`.

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

**Reporte mensual**: entre el 1 y el 5 de cada mes, en horario de la iglesia, el equipo recibe un resumen del mes anterior (personas registradas, contactadas y pendientes, pedidos de oración y enseñanzas publicadas, con el enlace al panel). Llega una sola vez por mes: `base-de-datos/6-reporte-mensual.sql` registra qué mes ya se mandó. Las enseñanzas se cuentan desde el archivo del cliente en GitHub. El enlace al panel sale de `GITHUB_REPO`, o del secreto `PANEL_URL` si la iglesia tiene dominio propio.

Para probarlo un día que no sea del 1 al 5: agregar en Supabase el secreto `REPORTE_CUALQUIER_DIA` = `si`, correr **Avisos y recordatorios** en Actions y después **borrar el secreto**. Para repetir la prueba, borrar la fila de ese mes en la tabla `reportes_mensuales`.

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

**`reporte_mensual`**
> Este es el resumen de {{1}} de la página web de la iglesia:
> • Personas nuevas registradas: {{2}}
> • Personas ya contactadas: {{3}}
> • Personas pendientes de contactar: {{4}}
> • Pedidos de oración recibidos: {{5}}
> • Enseñanzas publicadas: {{6}}
> Puedes ver el detalle de cada persona en el panel: {{7}} . Dios te bendiga.

Ejemplos: `octubre 2026` · `5` · `3` · `2` · `4` · `2` · `https://crescimonefrancoai.github.io/sitios-iglesias/panel/`

**`confirmacion_inscripcion`**
> Hola {{1}}, tu inscripción a {{2}} quedó confirmada. Te esperamos el {{3}}, en {{4}}. Dios te bendiga.

Ejemplos: `Ana` · `Retiro de matrimonios` · `sábado, 7 de noviembre, a las 10:00` · `Sede central`

**`recordatorio_evento`**
> Hola {{1}}, te recordamos que mañana es {{2}}, {{3}}, en {{4}}. Dios te bendiga.

Ejemplos: `Ana` · `Retiro de matrimonios` · `a las 10:00` · `Quinta Los Sauces`

**`aviso_inscripcion`**
> Nueva inscripción a {{1}}: {{2}} se anotó con {{3}} acompañantes. Ya hay {{4}} personas inscritas. Puedes ver la lista en el panel.

Ejemplos: `Retiro de matrimonios` · `Ana López` · `1` · `12 de 40`

**`resumen_inscripciones`**
> Tu evento {{1}} recibió {{2}} inscripciones nuevas hoy. Ya hay {{3}} personas inscritas. Puedes ver la lista completa en el panel.

Ejemplos: `Retiro de matrimonios` · `3` · `12 de 40`

Cada mensaje de plantilla tiene un costo por mensaje que cobra Meta, según el país. Con el número de prueba de Meta solo llegan a los números cargados en su lista de destinatarios.
