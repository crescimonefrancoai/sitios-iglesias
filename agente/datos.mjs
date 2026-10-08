/* Reglas de los datos de una iglesia: qué puede tocar el agente y qué forma
   tiene que tener cada cosa. Sin dependencias, para poder usarlo en cualquier lado. */

/* Textos sueltos que el agente puede cambiar */
export const CAMPOS_TEXTO = [
  "titulo", "bajada", "vision", "quienes", "pasoTexto",
  "pastores.nombres", "pastores.iniciales", "pastores.texto",
];
export const CAMPOS_URL = ["urlVivo", "urlEnsenanzas"];

/* Listas que el agente puede cambiar, con los campos de cada elemento */
export const LISTAS = {
  horarios: ["dia", "hora", "detalle"],
  ensenanzas: ["titulo", "pastor", "fecha", "resumen", "url"],
  eventos: ["titulo", "fecha", "hora", "lugar"],
  ministerios: ["nombre", "edad", "texto"],
  sedes: ["nombre", "direccion", "horarios"],
  redes: ["nombre", "url"],
};

/* Lo que el agente NO puede tocar: nombre, whatsapp, email y todo "ofrendas"
   (adonde va el dinero). Eso se cambia a mano en el archivo del cliente. */

const MAX_TEXTO = 600;
const MAX_ELEMENTOS = 50;

export const esSlug = (s) => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);

export const esFecha = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
};

export const esUrl = (s) => {
  if (typeof s !== "string" || s.length > MAX_TEXTO) return false;
  try { return new URL(s).protocol === "https:"; } catch { return false; }
};

const esTexto = (v) => typeof v === "string" && v.trim() !== "" && v.length <= MAX_TEXTO;
const leer = (obj, ruta) => ruta.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

export const hoyISO = (zona = "America/Argentina/Buenos_Aires") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function erroresDeLista(lista, elementos) {
  const campos = LISTAS[lista];
  if (!campos) return [`"${lista}" no es una lista que se pueda cambiar.`];
  if (!Array.isArray(elementos)) return [`${lista}: tiene que ser una lista.`];
  if (elementos.length > MAX_ELEMENTOS) return [`${lista}: admite hasta ${MAX_ELEMENTOS} elementos.`];
  const errores = [];
  elementos.forEach((e, i) => {
    const donde = `${lista}[${i}]`;
    if (e === null || typeof e !== "object" || Array.isArray(e)) { errores.push(`${donde}: tiene que ser un objeto.`); return; }
    for (const k of Object.keys(e)) if (!campos.includes(k)) errores.push(`${donde}: el campo "${k}" no existe. Campos válidos: ${campos.join(", ")}.`);
    for (const k of campos) {
      if (k === "fecha") { if (!esFecha(e[k])) errores.push(`${donde}.fecha: tiene que ser una fecha real con formato AAAA-MM-DD.`); }
      else if (k === "url") { if (!esUrl(e[k])) errores.push(`${donde}.url: tiene que ser una dirección completa que empiece con https://`); }
      else if (!esTexto(e[k])) errores.push(`${donde}.${k}: falta o es demasiado largo (máximo ${MAX_TEXTO} caracteres).`);
    }
  });
  return errores;
}

/* Revisa el archivo completo de un cliente. Devuelve una lista de errores (vacía si está bien). */
export function erroresDeDatos(datos) {
  if (datos === null || typeof datos !== "object" || Array.isArray(datos)) return ["El archivo no contiene un objeto."];
  const errores = [];
  if (!esTexto(datos.nombre)) errores.push("nombre: falta.");
  if (!/^\d{8,15}$/.test(datos.whatsapp ?? "")) errores.push("whatsapp: solo dígitos, con código de país (ej. 5491122334455).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email ?? "")) errores.push("email: no parece un correo.");
  /* churchId es opcional: conecta el sitio con la base de datos (id de la iglesia en la tabla churches) */
  if (datos.churchId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(datos.churchId)) errores.push("churchId: tiene que ser el id (UUID) de la iglesia en la base de datos.");
  for (const c of CAMPOS_TEXTO) if (!esTexto(leer(datos, c))) errores.push(`${c}: falta o es demasiado largo.`);
  for (const c of CAMPOS_URL) if (!esUrl(leer(datos, c))) errores.push(`${c}: tiene que empezar con https://`);
  for (const c of ["texto", "alias", "titular", "banco"]) if (!esTexto(leer(datos, `ofrendas.${c}`))) errores.push(`ofrendas.${c}: falta.`);
  if (!esUrl(leer(datos, "ofrendas.mercadopago"))) errores.push("ofrendas.mercadopago: tiene que empezar con https://");
  for (const lista of Object.keys(LISTAS)) errores.push(...erroresDeLista(lista, datos[lista]));
  return errores;
}

/* Las dos operaciones del agente. Modifican "datos" y devuelven null,
   o devuelven el error (sin modificar nada). */
export function cambiarTexto(datos, campo, valor) {
  const esCampoUrl = CAMPOS_URL.includes(campo);
  if (!esCampoUrl && !CAMPOS_TEXTO.includes(campo)) return `"${campo}" no se puede cambiar. Campos válidos: ${[...CAMPOS_TEXTO, ...CAMPOS_URL].join(", ")}.`;
  if (esCampoUrl ? !esUrl(valor) : !esTexto(valor)) return esCampoUrl ? "Tiene que ser una dirección completa que empiece con https://" : `El texto no puede estar vacío ni pasar de ${MAX_TEXTO} caracteres.`;
  const partes = campo.split(".");
  const ultimo = partes.pop();
  const destino = partes.reduce((o, k) => o[k], datos);
  destino[ultimo] = esCampoUrl ? valor : valor.trim();
  return null;
}

export function reemplazarLista(datos, lista, elementos) {
  const errores = erroresDeLista(lista, elementos);
  if (errores.length) return errores.join("\n");
  const campos = LISTAS[lista];
  datos[lista] = elementos.map((e) => Object.fromEntries(campos.map((k) => [k, k === "fecha" || k === "url" ? e[k] : e[k].trim()])));
  return null;
}
