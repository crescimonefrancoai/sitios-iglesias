/* Arma los sitios: plantilla + clientes/<cliente>.json -> dist/<cliente>/index.html
   y el panel de administración -> dist/panel/index.html
   Si los datos de algún cliente están mal, corta sin publicar nada. */
import fs from "node:fs";
import path from "node:path";
import { erroresDeDatos } from "./datos.mjs";
import { RAIZ, listarClientes, leerCliente } from "./archivos.mjs";

const plantilla = fs.readFileSync(path.join(RAIZ, "plantilla", "iglesia.html"), "utf8");
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
  if (cliente === "panel") {
    fallas++;
    console.error('✗ "panel" no puede ser el nombre de un cliente (esa dirección es del panel de administración).');
    continue;
  }
  const datos = leerCliente(cliente);
  const errores = erroresDeDatos(datos);
  if (errores.length) {
    fallas++;
    console.error(`✗ ${cliente}:\n  ${errores.join("\n  ")}`);
    continue;
  }
  /* Si hay conexión y el cliente tiene churchId, sus formularios guardan en la base */
  const { churchId, ...visibles } = datos;
  if (conexion && churchId) visibles.supabase = { url: conexion.url, anonKey: conexion.anonKey, churchId };
  const html = plantilla
    .replace("/*__DATOS__*/null", () => comoJson(visibles))
    .replace("__NOMBRE__", () => escHtml(datos.nombre))
    .replace("__DESCRIPCION__", () => escHtml(`${datos.nombre}. Horarios de reunión, enseñanzas, eventos y cómo llegar.`));
  fs.mkdirSync(path.join(dist, cliente), { recursive: true });
  fs.writeFileSync(path.join(dist, cliente, "index.html"), html);
  console.log(`✓ ${cliente}${conexion && churchId ? " (conectado a la base de datos)" : ""}`);
}

/* Panel de administración: uno solo para todas las iglesias; cada usuario ve solo la suya */
if (conexion) {
  const panel = fs.readFileSync(path.join(RAIZ, "plantilla", "panel.html"), "utf8")
    .replace("/*__SUPABASE__*/null", () => comoJson({ url: conexion.url, anonKey: conexion.anonKey }));
  fs.mkdirSync(path.join(dist, "panel"), { recursive: true });
  fs.writeFileSync(path.join(dist, "panel", "index.html"), panel);
  console.log("✓ panel");
}

if (fallas) process.exit(1);
