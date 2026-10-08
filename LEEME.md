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

## Qué puede y qué no puede tocar el agente

Puede cambiar: título, bajada, visión, quiénes somos, pastores, texto de siguiente paso, enlaces de transmisión y enseñanzas, horarios, enseñanzas, eventos, ministerios, sedes y redes.

No puede cambiar: nombre de la iglesia, WhatsApp, correo y **datos de ofrendas** (alias, banco, enlace de pago). Eso se edita a mano en `clientes/<cliente>.json`, para que nadie pueda desviar ofrendas con un pedido.

Si un cambio deja los datos con errores (una fecha que no existe, un enlace sin https), no se guarda ni se publica.

## Revisión semanal

Corre sola los lunes a las 9:00 (hora de Argentina). Quita los eventos que ya pasaron y, si encuentra algo para revisar (sin próximos eventos, más de 21 días sin enseñanza nueva, enlaces caídos, datos de ejemplo), abre un aviso en la pestaña **Issues** del repositorio. No usa la API de Claude, así que no tiene costo.

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
