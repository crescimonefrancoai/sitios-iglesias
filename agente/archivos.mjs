/* Lectura y escritura de los archivos de clientes (clientes/<cliente>.json) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esSlug } from "./datos.mjs";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENTES = path.join(RAIZ, "clientes");

export const listarClientes = () =>
  fs.readdirSync(CLIENTES).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter(esSlug).sort();

const ruta = (cliente) => {
  if (!esSlug(cliente)) throw new Error(`"${cliente}" no es un nombre de cliente válido (minúsculas, números y guiones).`);
  return path.join(CLIENTES, `${cliente}.json`);
};

export function leerCliente(cliente) {
  const archivo = ruta(cliente);
  if (!fs.existsSync(archivo)) throw new Error(`No existe el cliente "${cliente}". Clientes: ${listarClientes().join(", ")}.`);
  return JSON.parse(fs.readFileSync(archivo, "utf8"));
}

export const guardarCliente = (cliente, datos) =>
  fs.writeFileSync(ruta(cliente), JSON.stringify(datos, null, 2) + "\n");

/* Para dejar mensajes en la pantalla de GitHub Actions (si no corre ahí, no hace nada) */
export const resumenActions = (texto) => {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, texto + "\n");
};
export const salidaActions = (clave, valor) => {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${clave}=${valor}\n`);
};
export const archivoTemporal = (nombre) => path.join(process.env.RUNNER_TEMP || RAIZ, nombre);
