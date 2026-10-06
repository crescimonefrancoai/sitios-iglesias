/* Revisión periódica de todos los clientes: quita eventos vencidos, revisa enlaces
   y avisa si falta contenido. No usa la API de Claude (son controles fijos, sin costo).
   Uso: node agente/revision.mjs */
import fs from "node:fs";
import { erroresDeDatos, hoyISO } from "./datos.mjs";
import { listarClientes, leerCliente, guardarCliente, resumenActions, salidaActions, archivoTemporal } from "./archivos.mjs";

const hoy = hoyISO(process.env.ZONA);
const DIAS_SIN_ENSENANZA = 21;
const diasEntre = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000);

async function enlaceRoto(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 (revision-sitios)" } });
    /* 401/403/429 suelen ser sitios que bloquean robots (Instagram, Facebook), no enlaces rotos */
    return r.status === 404 || r.status === 410 || r.status >= 500 ? `responde ${r.status}` : null;
  } catch (e) {
    return "no responde";
  }
}

async function revisar(cliente) {
  const datos = leerCliente(cliente);
  const hechos = [], avisos = [];

  const errores = erroresDeDatos(datos);
  if (errores.length) return { nombre: cliente, hechos, avisos: errores.map((e) => `Dato inválido (el sitio no se va a publicar hasta corregirlo): ${e}`) };

  const vencidos = datos.eventos.filter((e) => e.fecha < hoy);
  if (vencidos.length) {
    datos.eventos = datos.eventos.filter((e) => e.fecha >= hoy);
    guardarCliente(cliente, datos);
    hechos.push(`Se quitaron ${vencidos.length} evento(s) vencido(s): ${vencidos.map((e) => `${e.titulo} (${e.fecha})`).join(", ")}.`);
  }
  if (!datos.eventos.length) avisos.push("No hay próximos eventos: la sección muestra «Pronto publicaremos las próximas fechas».");

  const ultima = datos.ensenanzas.map((e) => e.fecha).sort().pop();
  if (!ultima) avisos.push("No hay enseñanzas cargadas.");
  else if (diasEntre(ultima, hoy) > DIAS_SIN_ENSENANZA) avisos.push(`La última enseñanza es del ${ultima} (hace ${diasEntre(ultima, hoy)} días).`);

  /* Datos de ejemplo que quedaron de la plantilla */
  if (datos.whatsapp === "5491100000000") avisos.push("El WhatsApp es el número de ejemplo.");
  if (/ejemplo/i.test(datos.email)) avisos.push("El correo es el de ejemplo.");
  if (/ejemplo/i.test(datos.ofrendas.banco)) avisos.push("El banco de las ofrendas es el de ejemplo.");
  for (const s of datos.sedes) if (/ejemplo|muestra/i.test(s.direccion)) avisos.push(`La dirección de «${s.nombre}» parece de ejemplo.`);

  const enlaces = new Map([
    ["Transmisión en vivo", datos.urlVivo],
    ["Todas las enseñanzas", datos.urlEnsenanzas],
    ["Ofrenda online", datos.ofrendas.mercadopago],
    ...datos.ensenanzas.map((e) => [`Enseñanza «${e.titulo}»`, e.url]),
    ...datos.redes.map((r) => [r.nombre, r.url]),
  ]);
  const genericos = [...enlaces].filter(([, url]) => new URL(url).pathname === "/").map(([que]) => que);
  if (genericos.length) avisos.push(`Estos enlaces van a la portada del servicio y no a la cuenta de la iglesia: ${genericos.join(", ")}.`);

  const estados = new Map(await Promise.all([...new Set(enlaces.values())].map(async (url) => [url, await enlaceRoto(url)])));
  for (const [que, url] of enlaces) if (estados.get(url)) avisos.push(`Enlace caído, ${que}: ${url} (${estados.get(url)}).`);

  return { nombre: datos.nombre, hechos, avisos };
}

const resultados = [];
for (const cliente of listarClientes()) resultados.push({ cliente, ...(await revisar(cliente)) });

const informe = [`# Revisión de sitios, ${hoy}`, ""];
for (const r of resultados) {
  informe.push(`## ${r.nombre} (${r.cliente})`);
  if (!r.hechos.length && !r.avisos.length) informe.push("Todo en orden.");
  for (const h of r.hechos) informe.push(`- Hecho: ${h}`);
  for (const a of r.avisos) informe.push(`- Para revisar: ${a}`);
  informe.push("");
}
const texto = informe.join("\n");

fs.writeFileSync(archivoTemporal("informe.md"), texto);
salidaActions("avisos", resultados.some((r) => r.avisos.length) ? "si" : "no");
salidaActions("fecha", hoy);
resumenActions(texto);
console.log(texto);
