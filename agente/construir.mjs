/* Arma los sitios: diseño + funciones + clientes/<cliente>.json -> dist/<cliente>/index.html
   y el panel de administración -> dist/panel/index.html
   - Diseño: plantilla/iglesia.html (el base), o plantilla/disenos/<nombre>.html si el cliente tiene "diseno": "<nombre>".
   - Funciones: plantilla/funciones.js, compartidas por todos los diseños; se insertan en cada página.
   Si los datos de algún cliente están mal, o falta su diseño, corta sin publicar nada.
   Si a un diseño le falta algún elemento que ese cliente usa, avisa (esa parte no se vería) pero publica. */
import fs from "node:fs";
import path from "node:path";
import { erroresDeDatos } from "./datos.mjs";
import { RAIZ, listarClientes, leerCliente } from "./archivos.mjs";

const funciones = fs.readFileSync(path.join(RAIZ, "plantilla", "funciones.js"), "utf8");
if (/<\/script/i.test(funciones)) { console.error("✗ plantilla/funciones.js no puede contener «</script»."); process.exit(1); }

/* Diseño de cada cliente (se lee una vez por diseño) */
const disenos = new Map();
function leerDiseno(nombre) {
  const archivo = nombre ? path.join(RAIZ, "plantilla", "disenos", `${nombre}.html`) : path.join(RAIZ, "plantilla", "iglesia.html");
  if (!disenos.has(archivo)) disenos.set(archivo, fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf8") : null);
  return disenos.get(archivo);
}

/* Elementos (por id) que necesita cada parte de las funciones. Un diseño a medida puede no tener alguna parte
   (por ejemplo, sin ministerios): solo se avisa si ese cliente la usa. */
const PARTES = [
  ["encabezado", () => true, ["h-titulo", "h-bajada"]],
  ["horarios", (d) => d.horarios.length, ["horarios"]],
  ["visión y quiénes somos", () => true, ["vision", "quienes-texto"]],
  ["pastores", () => true, ["p-nombres", "p-texto"]],
  ["siguiente paso", () => true, ["paso-texto", "paso-boton"]],
  ["formulario de siguiente paso", (d, db) => db, ["paso-form", "pf-nombre", "pf-telefono", "pf-email", "pf-consent", "pf-enviar", "pf-aviso"]],
  ["pedidos de oración", () => true, ["or-form", "or-nombre", "or-texto", "or-enviar"]],
  ["enseñanzas", (d) => d.ensenanzas.length, ["ens-lista"]],
  ["eventos", () => true, ["ev-lista"]],
  ["inscripción a eventos", (d, db) => db && d.eventos.some((e) => e.inscripcion),
    ["dlg-insc", "insc-form", "insc-titulo", "insc-nombre", "insc-telefono", "insc-email", "insc-acomp", "insc-consent", "insc-enviar", "insc-cerrar", "insc-aviso"]],
  ["eventos pagos", (d, db) => db && d.eventos.some((e) => e.precio), ["insc-total", "ev-pago"]],
  ["ministerios", (d) => d.ministerios.length, ["min-lista"]],
  ["ofrendas", () => true, ["of-texto", "of-formas"]],
  ["sedes", (d) => d.sedes.length, ["sedes-lista"]],
  ["contacto", () => true, ["c-whatsapp", "c-email"]],
  ["asistente", (d, db) => db && d.asistente !== false, ["asis-boton", "asis-panel", "asis-mensajes", "asis-form", "asis-texto", "asis-enviar", "asis-cerrar"]],
];
function faltantes(html, datos, conBase) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  return PARTES.filter(([, usa]) => usa(datos, conBase))
    .map(([parte, , necesarios]) => [parte, necesarios.filter((id) => !ids.has(id))])
    .filter(([, faltan]) => faltan.length);
}
const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* "<" escapado para que ningún texto pueda cerrar la etiqueta <script> */
const comoJson = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const dist = path.join(RAIZ, "dist");

/* Conexión con la base de datos (Supabase). La clave "anon" es pública por diseño:
   la protección está en las reglas de la base (RLS). Nunca poner acá la clave "service_role". */
const archivoConexion = path.join(RAIZ, "plantilla", "conexion.json");
let conexion = null;
if (fs.existsSync(archivoConexion)) {
  conexion = JSON.parse(fs.readFileSync(archivoConexion, "utf8"));
  const urlOk = typeof conexion.url === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(conexion.url);
  const claveOk = typeof conexion.anonKey === "string" && conexion.anonKey.length > 20;
  let rol = null;
  try { rol = JSON.parse(Buffer.from(conexion.anonKey.split(".")[1], "base64url").toString("utf8")).role; } catch { /* clave nueva (no JWT) */ }
  if (!urlOk || !claveOk || rol === "service_role" || conexion.anonKey.startsWith("sb_secret_")) {
    console.error("✗ plantilla/conexion.json: la url tiene que ser https://<proyecto>.supabase.co y la clave tiene que ser la pública (anon). Nunca la service_role.");
    process.exit(1);
  }
}

let fallas = 0;
fs.rmSync(dist, { recursive: true, force: true });

for (const cliente of listarClientes()) {
  if (cliente === "panel" || cliente === "privacidad") {
    fallas++;
    console.error(`✗ "${cliente}" no puede ser el nombre de un cliente (esa dirección está reservada).`);
    continue;
  }
  const datos = leerCliente(cliente);
  const errores = erroresDeDatos(datos);
  if (errores.length) {
    fallas++;
    console.error(`✗ ${cliente}:\n  ${errores.join("\n  ")}`);
    continue;
  }
  const plantilla = leerDiseno(datos.diseno);
  if (!plantilla) {
    fallas++;
    console.error(`✗ ${cliente}: no existe el diseño plantilla/disenos/${datos.diseno}.html`);
    continue;
  }
  if (!plantilla.includes("/*__DATOS__*/null") || !plantilla.includes("/*__FUNCIONES__*/")) {
    fallas++;
    console.error(`✗ ${cliente}: el diseño «${datos.diseno ?? "base"}» no tiene los marcadores de datos y de funciones (ver LEEME.md).`);
    continue;
  }
  /* Si hay conexión y el cliente tiene churchId, sus formularios guardan en la base */
  const { churchId, ...visibles } = datos;
  if (conexion && churchId) visibles.supabase = { url: conexion.url, anonKey: conexion.anonKey, churchId };
  for (const [parte, faltan] of faltantes(plantilla, datos, Boolean(conexion && churchId))) {
    console.warn(`⚠ ${cliente}: al diseño «${datos.diseno ?? "base"}» le falta lo necesario para «${parte}» (${faltan.map((id) => "#" + id).join(", ")}): esa parte no se va a ver.`);
  }
  const html = plantilla
    .replace("/*__DATOS__*/null", () => comoJson(visibles))
    .replace("/*__FUNCIONES__*/", () => funciones)
    .replace("__NOMBRE__", () => escHtml(datos.nombre))
    .replace("__DESCRIPCION__", () => escHtml(`${datos.nombre}. Horarios de reunión, enseñanzas, eventos y cómo llegar.`))
    /* "prueba": true -> iglesia para probar: los buscadores no la indexan */
    .replace('<meta name="description"', () => (datos.prueba === true ? '<meta name="robots" content="noindex, nofollow">\n<meta name="description"' : '<meta name="description"'));
  fs.mkdirSync(path.join(dist, cliente), { recursive: true });
  fs.writeFileSync(path.join(dist, cliente, "index.html"), html);
  console.log(`✓ ${cliente}${datos.diseno ? ` (diseño «${datos.diseno}»)` : ""}${conexion && churchId ? " (conectado a la base de datos)" : ""}`);
}

/* Panel de administración: uno solo para todas las iglesias; cada usuario ve solo la suya */
if (conexion) {
  const panel = fs.readFileSync(path.join(RAIZ, "plantilla", "panel.html"), "utf8")
    .replace("/*__SUPABASE__*/null", () => comoJson({ url: conexion.url, anonKey: conexion.anonKey }));
  fs.mkdirSync(path.join(dist, "panel"), { recursive: true });
  fs.writeFileSync(path.join(dist, "panel", "index.html"), panel);
  console.log("✓ panel");
}

/* Política de privacidad de Eklesic (la pide Meta para el agente de WhatsApp) */
fs.mkdirSync(path.join(dist, "privacidad"), { recursive: true });
fs.copyFileSync(path.join(RAIZ, "plantilla", "privacidad.html"), path.join(dist, "privacidad", "index.html"));
console.log("✓ privacidad");

if (fallas) process.exit(1);
