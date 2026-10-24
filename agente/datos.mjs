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

/* Campos opcionales de algunas listas: nombre -> cómo se valida.
   Los eventos con inscripción llevan un id fijo, que une las inscripciones de la base con el evento. */
export const AVISOS_INSCRIPCION = ["cada_inscripcion", "resumen_diario"];
export const OPCIONALES = {
  eventos: {
    id: (v) => typeof v === "string" && /^[a-z0-9]{8}$/.test(v),
    inscripcion: (v) => typeof v === "boolean",
    cupo: (v) => Number.isInteger(v) && v >= 1 && v <= 10000,
    avisos: (v) => AVISOS_INSCRIPCION.includes(v),
    /* precio por persona, en la moneda de la iglesia ("moneda" del archivo); se cobra con Mercado Pago */
    precio: (v) => typeof v === "number" && v > 0 && v <= 10000000 && Math.round(v * 100) === v * 100,
  },
};
const nuevoId = () => Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

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
  const opcionales = OPCIONALES[lista] ?? {};
  const validos = [...campos, ...Object.keys(opcionales)];
  const errores = [];
  const ids = new Set();
  elementos.forEach((e, i) => {
    const donde = `${lista}[${i}]`;
    if (e === null || typeof e !== "object" || Array.isArray(e)) { errores.push(`${donde}: tiene que ser un objeto.`); return; }
    for (const k of Object.keys(e)) if (!validos.includes(k)) errores.push(`${donde}: el campo "${k}" no existe. Campos válidos: ${validos.join(", ")}.`);
    for (const k of campos) {
      if (k === "fecha") { if (!esFecha(e[k])) errores.push(`${donde}.fecha: tiene que ser una fecha real con formato AAAA-MM-DD.`); }
      else if (k === "url") { if (!esUrl(e[k])) errores.push(`${donde}.url: tiene que ser una dirección completa que empiece con https://`); }
      else if (!esTexto(e[k])) errores.push(`${donde}.${k}: falta o es demasiado largo (máximo ${MAX_TEXTO} caracteres).`);
    }
    for (const [k, valido] of Object.entries(opcionales)) {
      if (e[k] !== undefined && !valido(e[k])) errores.push(`${donde}.${k}: valor inválido.` +
        (k === "cupo" ? " Tiene que ser un número entero de personas, de 1 a 10000." : k === "avisos" ? ` Opciones: ${AVISOS_INSCRIPCION.join(", ")}.` : ""));
    }
    if (e.id !== undefined) { if (ids.has(e.id)) errores.push(`${donde}.id: está repetido.`); ids.add(e.id); }
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
  /* moneda es opcional (código de 3 letras: ARS, MXN, BRL…), pero obligatoria si algún evento tiene precio.
     Se carga a mano: el agente no la puede cambiar. */
  /* diseno: opcional, nombre del archivo plantilla/disenos/<diseno>.html (diseño a medida). Se carga a mano. */
  if (datos.diseno !== undefined && !/^[a-z0-9-]{1,40}$/.test(datos.diseno)) errores.push("diseno: tiene que ser un nombre en minúsculas, números y guiones (el de plantilla/disenos/<diseno>.html).");
  if (datos.moneda !== undefined && !/^[A-Z]{3}$/.test(datos.moneda)) errores.push("moneda: tiene que ser un código de 3 letras, como ARS, MXN o BRL.");
  (Array.isArray(datos.eventos) ? datos.eventos : []).forEach((e, i) => {
    if (e?.inscripcion && !e.id) errores.push(`eventos[${i}]: tiene inscripción pero le falta el id.`);
    if (e?.precio !== undefined && !e.inscripcion) errores.push(`eventos[${i}]: tiene precio pero no tiene inscripción.`);
    if (e?.precio !== undefined && !datos.moneda) errores.push(`eventos[${i}]: tiene precio, pero falta "moneda" en el archivo de la iglesia.`);
  });
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
  const opcionales = Object.keys(OPCIONALES[lista] ?? {});
  const anteriores = Array.isArray(datos[lista]) ? datos[lista] : [];
  const usados = new Set(elementos.map((e) => e.id).filter(Boolean));
  datos[lista] = elementos.map((e) => {
    const nuevo = Object.fromEntries(campos.map((k) => [k, k === "fecha" || k === "url" ? e[k] : e[k].trim()]));
    for (const k of opcionales) if (e[k] !== undefined) nuevo[k] = e[k];
    /* Un evento con inscripción conserva su id (si el agente no lo mandó, se busca el mismo evento de antes) */
    if (lista === "eventos" && nuevo.inscripcion && !nuevo.id) {
      const previo = anteriores.find((a) => a.id && !usados.has(a.id) && a.titulo === nuevo.titulo && a.fecha === nuevo.fecha);
      nuevo.id = previo?.id ?? nuevoId();
      usados.add(nuevo.id);
    }
    return nuevo;
  });
  return null;
}
