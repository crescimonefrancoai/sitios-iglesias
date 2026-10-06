/* Arma el sitio de cada cliente: plantilla + clientes/<cliente>.json -> dist/<cliente>/index.html
   Si los datos de algún cliente están mal, corta sin publicar nada. */
import fs from "node:fs";
import path from "node:path";
import { erroresDeDatos } from "./datos.mjs";
import { RAIZ, listarClientes, leerCliente } from "./archivos.mjs";

const plantilla = fs.readFileSync(path.join(RAIZ, "plantilla", "iglesia.html"), "utf8");
const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dist = path.join(RAIZ, "dist");

let fallas = 0;
fs.rmSync(dist, { recursive: true, force: true });

for (const cliente of listarClientes()) {
  const datos = leerCliente(cliente);
  const errores = erroresDeDatos(datos);
  if (errores.length) {
    fallas++;
    console.error(`✗ ${cliente}:\n  ${errores.join("\n  ")}`);
    continue;
  }
  /* "<" escapado para que ningún texto pueda cerrar la etiqueta <script> */
  const json = JSON.stringify(datos).replace(/</g, "\\u003c").replace(/ /g, "\\u2028").replace(/ /g, "\\u2029");
  const html = plantilla
    .replace("/*__DATOS__*/null", () => json)
    .replace("__NOMBRE__", () => escHtml(datos.nombre))
    .replace("__DESCRIPCION__", () => escHtml(`${datos.nombre}. Horarios de reunión, enseñanzas, eventos y cómo llegar.`));
  fs.mkdirSync(path.join(dist, cliente), { recursive: true });
  fs.writeFileSync(path.join(dist, cliente, "index.html"), html);
  console.log(`✓ ${cliente}`);
}

if (fallas) process.exit(1);
