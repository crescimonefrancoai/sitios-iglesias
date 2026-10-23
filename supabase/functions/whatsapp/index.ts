/* Agente por WhatsApp (Supabase Edge Function "whatsapp").

   GET  /whatsapp         Meta verifica el webhook al configurarlo.
   POST /whatsapp         Meta avisa de mensajes nuevos: si el número está habilitado, el pedido va al agente de GitHub.
   POST /whatsapp/aviso   El agente de GitHub devuelve el resultado y se lo contamos a quien hizo el pedido.
   POST /whatsapp/pendientes
                          Manda lo que esté pendiente: aviso al equipo de visitas nuevas y pedidos de oración,
                          bienvenida a la visita y recordatorios de seguimiento. No recibe datos y cada cosa se
                          manda una sola vez, así que lo puede llamar cualquiera: la página web después de cada
                          formulario y GitHub una vez por hora (avisos.yml), por si algo quedó sin mandar.
                          Entre el 1 y el 5 de cada mes manda también el reporte mensual al equipo.
                          También manda lo de los eventos con inscripción: confirmación al inscrito, aviso o
                          resumen diario al equipo y recordatorio el día anterior.
   POST /whatsapp/inscribir   La página inscribe a alguien en un evento (revisa el evento y el cupo).
   POST /whatsapp/cupos       La página consulta cuántos lugares están ocupados en cada evento.
   Eventos pagos (Mercado Pago, ver la sección más abajo):
   POST /whatsapp/mp/notificacion   Mercado Pago avisa de un pago (se consulta a Mercado Pago antes de confirmar).
   POST /whatsapp/mp/estado         El panel pregunta si la iglesia tiene Mercado Pago conectado.
   POST /whatsapp/mp/enlace         El panel pide la dirección para conectar la cuenta de la iglesia.
   GET  /whatsapp/mp/oauth          Mercado Pago vuelve acá después de que la iglesia autoriza.
                          Usa plantillas de WhatsApp aprobadas en Meta (ver LEEME.md).

   Secretos (Supabase -> Edge Functions -> Secrets):
     WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET,
     GITHUB_TOKEN, GITHUB_REPO (usuario/repositorio), AVISO_SECRET
   SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
   La verificación de JWT de la función tiene que estar APAGADA: Meta no manda JWT. */
import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promesa: Promise<unknown>): void };

const env = (clave: string) => Deno.env.get(clave) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const GRAPH = "https://graph.facebook.com/v23.0";
const MAX_PEDIDO = 2000;

const TEXTOS = {
  recibido: "Recibido 🙌 Estoy haciendo el cambio y te aviso cuando esté listo.",
  noAutorizado: "Hola 👋 Este número envía avisos automáticos y no puede responder mensajes. Para hablar con tu iglesia, escríbele a su WhatsApp: lo encuentras en su página web. Si eres parte del equipo de una iglesia que trabaja con Eklesic, pide que habiliten tu número.",
  soloTexto: "Por ahora solo entiendo mensajes de texto. Escríbeme el cambio que necesitas 🙂",
  muyLargo: `El mensaje es muy largo. Escríbeme el cambio en menos de ${MAX_PEDIDO} caracteres, por favor.`,
  falla: "No pude tomar tu pedido en este momento. Vuelve a intentarlo en unos minutos, por favor.",
};

const responder = (estado: number, cuerpo = "ok") => new Response(cuerpo, { status: estado });

/* Compara sin filtrar por tiempo cuántos caracteres coinciden */
function iguales(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

/* Meta firma cada aviso con el secreto de la app: así sabemos que no es un tercero haciéndose pasar por Meta */
async function firmaValida(cuerpo: string, firma: string | null) {
  if (!firma?.startsWith("sha256=") || !env("WHATSAPP_APP_SECRET")) return false;
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("WHATSAPP_APP_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(cuerpo)));
  const esperada = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return iguales(firma.slice(7), esperada);
}

/* WhatsApp informa los celulares de Argentina con un 9 (549…) y los de México con un 1 (521…),
   pero con el número de prueba de Meta a veces solo acepta responderles en el formato viejo:
   sin el 9 / sin el 1, o en Argentina con el 15 después de la característica (de 2, 3 o 4 dígitos).
   Si rechaza el número por no estar en la lista permitida (131030), se prueban esas formas.
   Con un número real de WhatsApp Business no hay lista permitida y sirve la primera. */
function formasDelNumero(t: string) {
  const formas = [t];
  if (/^521\d{10}$/.test(t)) formas.push("52" + t.slice(3));
  if (/^549\d{10}$/.test(t)) {
    const resto = t.slice(3);
    formas.push("54" + resto);
    for (const largo of [2, 3, 4]) formas.push("54" + resto.slice(0, largo) + "15" + resto.slice(largo));
  }
  return formas;
}

async function enviarAMeta(telefono: string, mensaje: Record<string, unknown>) {
  for (const destino of formasDelNumero(telefono)) {
    const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: destino, ...mensaje }),
    });
    if (r.ok) return true;
    const detalle = await r.text();
    console.error(`WhatsApp no aceptó el mensaje (forma ${destino.slice(0, 6)}…, ${destino.length} dígitos):`, r.status, detalle);
    if (!detalle.includes("131030")) break;
  }
  return false;
}

const enviarWhatsApp = (telefono: string, texto: string) =>
  enviarAMeta(telefono, { type: "text", text: { body: texto.slice(0, 4000) } });

/* Mensajes que inicia la iglesia (fuera de las 24 h desde que la persona escribió): WhatsApp solo los acepta
   como plantillas aprobadas. Los valores no pueden tener saltos de línea ni quedar vacíos. */
const valorPlantilla = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "-";
const enviarPlantilla = (telefono: string, nombre: string, idioma: string, valores: unknown[]) =>
  enviarAMeta(telefono, {
    type: "template",
    template: {
      name: nombre,
      language: { code: idioma },
      components: [{ type: "body", parameters: valores.map((v) => ({ type: "text", text: valorPlantilla(v) })) }],
    },
  });

/* El formulario de la página acepta el teléfono como lo escriba la persona. Lo pasamos al formato de WhatsApp
   (código de país + número) usando el país de la iglesia. Si no se puede saber con seguridad, devuelve null
   y no se manda la bienvenida (el equipo igual recibe el contacto tal como lo escribió). */
function telefonoWhatsApp(escrito: string | null, pais: string | null) {
  if (!escrito) return null;
  const internacional = /^\s*(\+|00)/.test(escrito);
  const d = escrito.replace(/\D/g, "").replace(/^00/, "");
  const local = d.replace(/^0+/, "");
  const p = (pais ?? "").toUpperCase();
  // Ya trae el código de país. Celulares como los informa WhatsApp: Argentina 549…, México 521…
  if (/^549?\d{10}$/.test(d) && (internacional || p === "AR")) return "549" + d.slice(-10);
  if (/^521?\d{10}$/.test(d) && (internacional || p === "MX")) return "521" + d.slice(-10);
  if (/^55\d{10,11}$/.test(d) && (internacional || p === "BR")) return d;
  if (/^502\d{8}$/.test(d) && (internacional || p === "GT")) return d;
  if (internacional) return d.length >= 8 && d.length <= 15 ? d : null;
  // Número local, sin código de país
  if (p === "AR" && local.length === 10) return "549" + local;
  if (p === "MX" && local.length === 10) return "521" + local;
  if (p === "BR" && (local.length === 10 || local.length === 11)) return "55" + local;
  if (p === "GT" && local.length === 8) return "502" + local;
  return null;
}

/* Los mensajes de los últimos 30 minutos con esa persona, para que el agente entienda respuestas a sus preguntas */
async function conversacionReciente(telefono: string, idActual: string) {
  const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await db.from("whatsapp_mensajes").select("id, texto, respuesta")
    .eq("telefono", telefono).gte("created_at", desde).neq("id", idActual)
    .order("created_at", { ascending: false }).limit(5);
  return (data ?? []).reverse()
    .filter((m) => m.texto)
    .map((m) => `Pastor: ${m.texto}` + (m.respuesta ? `\nEklesic: ${m.respuesta}` : ""))
    .join("\n\n");
}

async function pedirAlAgente(cliente: string, pedido: string, aviso: string, contexto = "") {
  const r = await fetch(`https://api.github.com/repos/${env("GITHUB_REPO")}/actions/workflows/agente.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "eklesic-whatsapp",
    },
    body: JSON.stringify({ ref: "main", inputs: { cliente, pedido, aviso, contexto: contexto.slice(0, 6000) } }),
  });
  if (!r.ok) console.error("GitHub no aceptó el pedido:", r.status, await r.text());
  return r.ok;
}

const marcar = (id: string, cambios: Record<string, unknown>) =>
  db.from("whatsapp_mensajes").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", id);

// deno-lint-ignore no-explicit-any
async function procesarMensaje(msg: any) {
  const telefono = String(msg.from ?? "");
  const texto = msg.type === "text" ? String(msg.text?.body ?? "").trim() : "";

  // Meta puede mandar el mismo aviso más de una vez: el wamid único hace que se procese una sola
  const { data: fila, error } = await db.from("whatsapp_mensajes")
    .upsert({ wamid: msg.id, telefono, tipo: msg.type, texto }, { onConflict: "wamid", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) return console.error("No se pudo registrar el mensaje:", error.message);
  if (!fila) return; // repetido

  const { data: autorizado } = await db.from("whatsapp_autorizados")
    .select("church_id, churches(slug)").eq("telefono", telefono).eq("activo", true).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const slug = (autorizado?.churches as any)?.slug as string | undefined;

  if (!autorizado || !slug) {
    await marcar(fila.id, { estado: "no_autorizado" });
    return enviarWhatsApp(telefono, TEXTOS.noAutorizado);
  }
  await marcar(fila.id, { church_id: autorizado.church_id });

  if (!texto) {
    await marcar(fila.id, { estado: "no_soportado" });
    return enviarWhatsApp(telefono, TEXTOS.soloTexto);
  }
  if (texto.length > MAX_PEDIDO) {
    await marcar(fila.id, { estado: "no_soportado" });
    return enviarWhatsApp(telefono, TEXTOS.muyLargo);
  }

  // Al agente solo le pasamos el id del mensaje (no el teléfono): las ejecuciones de GitHub pueden ser públicas
  if (await pedirAlAgente(slug, texto, fila.id, await conversacionReciente(telefono, fila.id))) {
    await marcar(fila.id, { estado: "enviado_al_agente" });
    await enviarWhatsApp(telefono, TEXTOS.recibido);
  } else {
    await marcar(fila.id, { estado: "error" });
    await enviarWhatsApp(telefono, TEXTOS.falla);
  }
}

// deno-lint-ignore no-explicit-any
async function procesarAviso(aviso: any) {
  const mensajes = (aviso?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.messages ?? []));
  if (mensajes.length) console.log(`Llegaron ${mensajes.length} mensaje(s) de WhatsApp`);
  for (const msg of mensajes) {
    try { await procesarMensaje(msg); } catch (e) { console.error("Falló un mensaje:", e); }
  }
}

async function devolverResultado(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env("AVISO_SECRET") || !iguales(auth, `Bearer ${env("AVISO_SECRET")}`)) return responder(401, "no autorizado");
  const { id, texto } = await req.json().catch(() => ({}));
  if (typeof id !== "string" || typeof texto !== "string" || !texto.trim()) return responder(400, "faltan datos");

  const { data: fila } = await db.from("whatsapp_mensajes").select("telefono").eq("id", id).maybeSingle();
  if (!fila) return responder(404, "mensaje desconocido");
  const ok = await enviarWhatsApp(fila.telefono, texto.trim());
  await marcar(id, { estado: ok ? "respondido" : "error", respuesta: texto.trim() });
  return ok ? responder(200) : responder(502, "WhatsApp no aceptó el mensaje");
}

/* ---------- Avisos automáticos ---------- */

type Iglesia = { nombre: string; slug: string; pais: string | null; zona: string; idioma: string; diasSeguimiento: number; equipo: string[] };
const iglesias = new Map<string, Promise<Iglesia | null>>();

function datosIglesia(id: string) {
  if (!iglesias.has(id)) iglesias.set(id, (async () => {
    const { data: c } = await db.from("churches").select("name, slug, country, timezone, settings").eq("id", id).maybeSingle();
    if (!c) return null;
    const { data: nums } = await db.from("whatsapp_autorizados").select("telefono")
      .eq("church_id", id).eq("activo", true).eq("recibe_avisos", true);
    const s = (c.settings ?? {}) as Record<string, unknown>;
    return {
      nombre: c.name,
      slug: c.slug,
      pais: c.country,
      zona: c.timezone || "UTC",
      idioma: typeof s.idioma === "string" ? s.idioma : "es",
      diasSeguimiento: Number(s.dias_seguimiento) > 0 ? Number(s.dias_seguimiento) : 2,
      equipo: (nums ?? []).map((n) => n.telefono),
    };
  })());
  return iglesias.get(id)!;
}

/* Marca la fila antes de mandar: si dos llamadas llegan juntas, solo una la "gana" y no se manda dos veces */
async function tomar(tabla: string, columna: string, id: string) {
  const { data } = await db.from(tabla).update({ [columna]: new Date().toISOString() })
    .eq("id", id).is(columna, null).select("id").maybeSingle();
  return Boolean(data);
}

const avisarEquipo = async (ig: Iglesia, plantilla: string, valores: unknown[]) => {
  for (const tel of ig.equipo) await enviarPlantilla(tel, plantilla, ig.idioma, valores);
};

const nombreDe = (p: { first_name: string; last_name: string | null }) => [p.first_name, p.last_name].filter(Boolean).join(" ");
const horaLocal = (zona: string) => Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: zona }).format(new Date()));

async function avisarVisitasNuevas() {
  const { data } = await db.from("people").select("id, church_id, first_name, last_name, phone, email")
    .eq("source", "web_form").is("aviso_enviado_at", null).order("created_at").limit(50);
  for (const p of data ?? []) {
    if (!(await tomar("people", "aviso_enviado_at", p.id))) continue;
    const ig = await datosIglesia(p.church_id);
    if (!ig) continue;
    await avisarEquipo(ig, "aviso_registro_web", [nombreDe(p), [p.phone, p.email].filter(Boolean).join(" / ")]);
    const tel = telefonoWhatsApp(p.phone, ig.pais);
    if (tel && await enviarPlantilla(tel, "confirmacion_registro", ig.idioma, [p.first_name, ig.nombre])) {
      await db.from("people").update({ bienvenida_enviada_at: new Date().toISOString() }).eq("id", p.id);
    }
  }
}

async function avisarPedidosDeOracion() {
  const { data } = await db.from("prayer_requests").select("id, church_id, name")
    .is("aviso_enviado_at", null).order("created_at").limit(50);
  for (const o of data ?? []) {
    if (!(await tomar("prayer_requests", "aviso_enviado_at", o.id))) continue;
    const ig = await datosIglesia(o.church_id);
    // El texto del pedido no viaja por WhatsApp: se lee en el panel, que tiene usuario y contraseña
    if (ig) await avisarEquipo(ig, "aviso_oracion_recibida", [o.name || "una persona que no dejó su nombre"]);
  }
}

async function recordarSeguimientos() {
  const desde = new Date(Date.now() - 86400000).toISOString(); // nadie se recuerda antes de 1 día
  const { data } = await db.from("people").select("id, church_id, first_name, last_name, phone, email, created_at")
    .eq("source", "web_form").eq("status", "prospect").is("contactado_at", null).is("recordatorio_enviado_at", null)
    .lt("created_at", desde).order("created_at").limit(100);
  for (const p of data ?? []) {
    const ig = await datosIglesia(p.church_id);
    if (!ig) continue;
    const dias = Math.floor((Date.now() - Date.parse(p.created_at)) / 86400000);
    const hora = horaLocal(ig.zona);
    if (dias < ig.diasSeguimiento || hora < 9 || hora >= 20) continue; // solo en horario razonable de la iglesia
    if (!(await tomar("people", "recordatorio_enviado_at", p.id))) continue;
    await avisarEquipo(ig, "seguimiento_pendiente", [nombreDe(p), dias, [p.phone, p.email].filter(Boolean).join(" / ")]);
  }
}

/* ---------- Reporte mensual ---------- */

/* Fecha y hora "de pared" en la zona de la iglesia */
function partesLocales(t: number, zona: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return { anio: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute, segundo: p.second };
}
/* Instante en que empieza el día 1 de ese mes en la zona de la iglesia */
function inicioDeMes(anio: number, mes: number, zona: string) {
  const aprox = Date.UTC(anio, mes - 1, 1);
  const l = partesLocales(aprox, zona);
  const desfase = Date.UTC(l.anio, l.mes - 1, l.dia, l.hora, l.minuto, l.segundo) - aprox;
  return new Date(aprox - desfase);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const urlPanel = () => {
  if (env("PANEL_URL")) return env("PANEL_URL");
  const [dueno, repo] = env("GITHUB_REPO").split("/");
  return `https://${dueno.toLowerCase()}.github.io/${repo}/panel/`;
};

/* Las enseñanzas y los eventos están en el archivo del cliente en GitHub, no en la base.
   Se guarda unos minutos para no pedirlo en cada inscripción. */
// deno-lint-ignore no-explicit-any
const archivos = new Map<string, { hasta: number; datos: Promise<any> }>();
function archivoCliente(slug: string) {
  const guardado = archivos.get(slug);
  if (guardado && guardado.hasta > Date.now()) return guardado.datos;
  const datos = fetch(`https://raw.githubusercontent.com/${env("GITHUB_REPO")}/main/clientes/${slug}.json`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  archivos.set(slug, { hasta: Date.now() + 3 * 60 * 1000, datos });
  return datos;
}

async function ensenanzasDelMes(slug: string, prefijo: string) {
  const datos = await archivoCliente(slug);
  if (!datos) return "sin datos";
  return (datos.ensenanzas ?? []).filter((e: { fecha?: string }) => e.fecha?.startsWith(prefijo)).length;
}

async function enviarReportesMensuales() {
  const { data: lista } = await db.from("churches").select("id");
  for (const { id } of lista ?? []) {
    const ig = await datosIglesia(id);
    if (!ig || !ig.equipo.length) continue;
    const ahora = partesLocales(Date.now(), ig.zona);
    // Del 1 al 5, en horario de la iglesia. Para probarlo otro día: secreto REPORTE_CUALQUIER_DIA = si (y borrarlo después)
    if ((ahora.dia > 5 && env("REPORTE_CUALQUIER_DIA") !== "si") || ahora.hora < 9 || ahora.hora >= 20) continue;

    const anio = ahora.mes === 1 ? ahora.anio - 1 : ahora.anio;
    const mes = ahora.mes === 1 ? 12 : ahora.mes - 1;
    const prefijo = `${anio}-${String(mes).padStart(2, "0")}`;
    const desde = inicioDeMes(anio, mes, ig.zona).toISOString();
    const hasta = inicioDeMes(ahora.anio, ahora.mes, ig.zona).toISOString();

    // Se registra antes de mandar: si dos llamadas llegan juntas, solo una manda el reporte
    const { data: nuevo } = await db.from("reportes_mensuales")
      .upsert({ church_id: id, mes: `${prefijo}-01` }, { onConflict: "church_id,mes", ignoreDuplicates: true })
      .select("church_id").maybeSingle();
    if (!nuevo) continue;

    const deLaWeb = () => db.from("people").select("id", { count: "exact", head: true })
      .eq("church_id", id).eq("source", "web_form").gte("created_at", desde).lt("created_at", hasta);
    const [{ count: registradas }, { count: pendientes }, { count: oraciones }, ensenanzas] = await Promise.all([
      deLaWeb(),
      deLaWeb().eq("status", "prospect").is("contactado_at", null),
      db.from("prayer_requests").select("id", { count: "exact", head: true }).eq("church_id", id).gte("created_at", desde).lt("created_at", hasta),
      ensenanzasDelMes(ig.slug, prefijo),
    ]);
    const total = registradas ?? 0, sinContactar = pendientes ?? 0;
    await avisarEquipo(ig, "reporte_mensual", [
      `${MESES[mes - 1]} ${anio}`, total, total - sinContactar, sinContactar, oraciones ?? 0, ensenanzas, urlPanel(),
    ]);
  }
}

/* ---------- Eventos con inscripción ---------- */

type Evento = { id: string; titulo: string; fecha: string; hora: string; lugar: string; inscripcion?: boolean; cupo?: number; avisos?: string; precio?: number };

// "authorization": el panel manda la sesión del usuario para conectar Mercado Pago
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type, authorization" };
const responderJson = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const hoyEn = (zona: string, masDias = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date(Date.now() + masDias * 86400000));
const fechaLarga = (iso: string) => new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
  .format(new Date(`${iso}T12:00:00Z`));
const primerNombre = (nombre: string) => nombre.trim().split(/\s+/)[0];
/* "a las 10:00" si es una hora; si no, el texto tal cual en minúscula ("todo el día") */
const horaTexto = (hora?: string) => !hora ? "en horario a confirmar" : /^\d{1,2}([:.]\d{2})?\s*(h|hs)?$/i.test(hora.trim()) ? `a las ${hora.trim()}` : hora.trim().toLowerCase();
const cuandoTexto = (fecha: string, hora?: string) => `${fechaLarga(fecha)}, ${horaTexto(hora)}`;
const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function eventosConInscripcion(slug: string): Promise<Evento[]> {
  const datos = await archivoCliente(slug);
  return (datos?.eventos ?? []).filter((e: Evento) => e.inscripcion && e.id);
}

/* Personas inscritas por evento (cada inscripción cuenta 1 + sus acompañantes) */
async function ocupadosPorEvento(churchId: string, eventoId?: string) {
  // Se cuenta en la base (8-inscripciones.sql): una consulta común trae como máximo 1000 filas
  const { data, error } = await db.rpc("ocupados_por_evento", { p_church: churchId, p_evento: eventoId ?? null });
  if (error) console.error("No se pudieron contar las inscripciones:", error.message);
  const ocupados: Record<string, number> = {};
  for (const fila of (data ?? []) as { evento_id: string; ocupados: number }[]) ocupados[fila.evento_id] = Number(fila.ocupados);
  return ocupados;
}
const inscritosTexto = (total: number, cupo?: number) => (cupo ? `${total} de ${cupo}` : String(total));

async function cifrar(texto: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto + env("SUPABASE_URL"))));
  return Array.from(bytes.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function leerJson(req: Request): Promise<any> {
  try { return JSON.parse(await req.text()); } catch { return null; }
}

/* POST /whatsapp/cupos { churchId } -> lugares ocupados de cada evento con inscripción */
async function cupos(req: Request) {
  const c = await leerJson(req);
  if (!esUuid(c?.churchId)) return responderJson(400, { error: "faltan datos" });
  return responderJson(200, { ocupados: await ocupadosPorEvento(c.churchId) });
}

/* POST /whatsapp/inscribir { churchId, eventoId, nombre, telefono, email, acompanantes, acepto, web } */
async function inscribir(req: Request) {
  const c = await leerJson(req);
  if (!c) return responderJson(400, { error: "No pudimos leer los datos." });
  if (c.web) return responderJson(200, { ok: true, mensaje: "¡Listo!" }); // campo trampa: solo lo completan los robots
  const ig = esUuid(c.churchId) ? await datosIglesia(c.churchId) : null;
  if (!ig) return responderJson(404, { error: "No encontramos la iglesia." });
  const evento = (await eventosConInscripcion(ig.slug)).find((e) => e.id === c.eventoId);
  if (!evento) return responderJson(404, { error: "Este evento ya no tiene la inscripción abierta." });
  if (evento.fecha < hoyEn(ig.zona)) return responderJson(409, { error: "Este evento ya pasó." });

  const nombre = String(c.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const telefono = String(c.telefono ?? "").trim().slice(0, 40) || null;
  const email = String(c.email ?? "").trim().slice(0, 160) || null;
  const acompanantes = Number.isInteger(c.acompanantes) && c.acompanantes >= 0 && c.acompanantes <= 20 ? c.acompanantes : 0;
  if (!nombre) return responderJson(400, { error: "Escribe tu nombre." });
  if (!telefono && !email) return responderJson(400, { error: "Déjanos un teléfono o un correo para confirmarte." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return responderJson(400, { error: "Revisa tu correo: no parece completo." });
  if (c.acepto !== true) return responderJson(400, { error: "Para inscribirte, marca que aceptas que guardemos tus datos." });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-ip";
  // Alto a propósito: en el culto cientos de personas comparten el WiFi de la iglesia (una sola IP).
  // Las inscripciones repetidas ya las frena la base (mismo teléfono o correo en el mismo evento).
  const { data: permitido } = await db.rpc("asistente_permitido", { p_clave: `insc:${await cifrar(ip)}`, p_maximo: 200, p_ventana: "1 hour" });
  if (permitido !== true) return responderJson(429, { error: "Recibimos muchas inscripciones seguidas desde tu conexión. Intenta en un rato." });

  // Evento pago: hace falta la moneda de la iglesia y su cuenta de Mercado Pago conectada
  const conPago = typeof evento.precio === "number" && evento.precio > 0;
  let tokenCobro: string | null = null, moneda: string | null = null;
  if (conPago) {
    moneda = (await archivoCliente(ig.slug))?.moneda ?? null;
    tokenCobro = await tokenMP(c.churchId);
    if (!moneda || !tokenCobro) return responderJson(409, { error: "La inscripción con pago todavía no está habilitada. Escríbenos por WhatsApp y te anotamos." });
  }

  const { data: resultado, error } = await db.rpc("inscribir", {
    p_church: c.churchId, p_evento: evento.id, p_titulo: evento.titulo, p_fecha: evento.fecha, p_cupo: evento.cupo ?? null,
    p_nombre: nombre, p_telefono: telefono, p_email: email, p_acompanantes: acompanantes,
    p_monto: conPago ? evento.precio : null, p_moneda: moneda, p_minutos: MINUTOS_RESERVA,
  });
  if (error) { console.error("No se pudo inscribir:", error.message); return responderJson(500, { error: "No pudimos guardar tu inscripción. Intenta de nuevo en unos minutos." }); }
  if (resultado === "sin_cupo") return responderJson(409, { error: "No quedan lugares suficientes para este evento." });
  if (resultado === "repetido") return responderJson(200, { ok: true, mensaje: "Ya estabas inscrito en este evento. ¡Te esperamos!" });

  if (conPago) {
    // 'ok:<id>' (inscripción nueva) o 'pendiente:<id>' (ya tenía un lugar reservado sin pagar): en los dos casos, a pagar
    const insId = String(resultado).split(":")[1];
    const volver = typeof c.volver === "string" && /^https:\/\/\S{1,300}$/.test(c.volver) ? c.volver : urlSitio(ig.slug);
    try {
      const pagar = await crearCobroMP(tokenCobro!, { id: insId, acompanantes }, evento, moneda!, c.churchId, volver);
      return responderJson(200, { ok: true, pagar, mensaje: "Te llevamos a Mercado Pago para completar el pago…" });
    } catch (e) {
      console.error("No se pudo crear el cobro:", e);
      await db.from("inscripciones").update({ pago_estado: "vencido" }).eq("id", insId).eq("pago_estado", "pendiente"); // libera el lugar
      return responderJson(502, { error: "No pudimos iniciar el pago. Intenta de nuevo en unos minutos." });
    }
  }

  EdgeRuntime.waitUntil(procesarPendientes()); // confirmación y aviso al equipo, ya mismo
  return responderJson(200, { ok: true, mensaje: `¡Listo, ${primerNombre(nombre)}! Ya estás inscrito. Te esperamos el ${cuandoTexto(evento.fecha, evento.hora)}.` });
}

/* Marca todas las inscripciones pendientes de un evento (por filtro: una lista de ids en la consulta
   no entra cuando son cientos). Devuelve las que marcó esta llamada. */
const marcarDelEvento = (churchId: string, eventoId: string, columna: string) =>
  db.from("inscripciones").update({ [columna]: new Date().toISOString() })
    .eq("church_id", churchId).eq("evento_id", eventoId).is(columna, null).in("pago_estado", ["no_requiere", "pagado"]).select("id");

async function eventoDe(ig: Iglesia, eventoId: string) {
  return (await eventosConInscripcion(ig.slug)).find((e) => e.id === eventoId);
}

/* Hace las tareas de a varias a la vez: WhatsApp acepta muchos mensajes por segundo, y así un evento
   grande no se pasa del tiempo máximo de la función. Cada tarea que falla no frena a las demás. */
async function enLotes<T>(items: T[], tamano: number, tarea: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += tamano) {
    await Promise.all(items.slice(i, i + tamano).map((x) => tarea(x).catch((e) => console.error("Falló un envío:", e))));
  }
}

/* Confirmación a quien se inscribió y, en los eventos "cada_inscripcion", aviso al equipo */
async function avisarInscripciones() {
  const { data: confirmar } = await db.from("inscripciones").select("*").is("confirmacion_enviada_at", null).in("pago_estado", ["no_requiere", "pagado"]).order("created_at").limit(200);
  await enLotes(confirmar ?? [], 10, async (r) => {
    if (!(await tomar("inscripciones", "confirmacion_enviada_at", r.id))) return;
    const ig = await datosIglesia(r.church_id);
    const tel = ig && telefonoWhatsApp(r.telefono, ig.pais);
    if (!ig || !tel) return;
    const ev = await eventoDe(ig, r.evento_id);
    await enviarPlantilla(tel, "confirmacion_inscripcion", ig.idioma, [
      primerNombre(r.nombre), ev?.titulo ?? r.evento_titulo, cuandoTexto(ev?.fecha ?? r.evento_fecha, ev?.hora), ev?.lugar ?? "el lugar que confirmaremos",
    ]);
  });

  const { data: avisar } = await db.from("inscripciones").select("*").is("aviso_enviado_at", null).in("pago_estado", ["no_requiere", "pagado"]).order("created_at").limit(50);
  for (const r of avisar ?? []) {
    if (!(await tomar("inscripciones", "aviso_enviado_at", r.id))) continue;
    const ig = await datosIglesia(r.church_id);
    if (!ig) continue;
    const ev = await eventoDe(ig, r.evento_id);
    if (ev?.avisos === "resumen_diario") continue; // esos van en el resumen del día
    const total = (await ocupadosPorEvento(r.church_id, r.evento_id))[r.evento_id] ?? 0;
    await avisarEquipo(ig, "aviso_inscripcion", [ev?.titulo ?? r.evento_titulo, r.nombre, r.acompanantes, inscritosTexto(total, ev?.cupo)]);
  }
}

/* Resumen del día al equipo (eventos con avisos "resumen_diario"), entre las 19 y las 20 de la iglesia */
async function resumirInscripciones() {
  // Solo hace falta saber qué eventos tienen inscripciones sin resumir; el conteo sale al marcarlas
  const { data } = await db.from("inscripciones").select("church_id, evento_id, evento_titulo").is("resumen_enviado_at", null).in("pago_estado", ["no_requiere", "pagado"]).limit(1000);
  const eventos = new Map<string, { church_id: string; evento_id: string; evento_titulo: string }>();
  for (const r of data ?? []) eventos.set(`${r.church_id}|${r.evento_id}`, r);
  for (const { church_id, evento_id, evento_titulo } of eventos.values()) {
    const ig = await datosIglesia(church_id);
    const ev = ig && await eventoDe(ig, evento_id);
    if (!ig || ev?.avisos !== "resumen_diario") { await marcarDelEvento(church_id, evento_id, "resumen_enviado_at"); continue; } // no corresponde resumen
    if (horaLocal(ig.zona) !== 19) continue;
    const { data: tomadas } = await marcarDelEvento(church_id, evento_id, "resumen_enviado_at");
    if (!tomadas?.length) continue;
    const total = (await ocupadosPorEvento(church_id, evento_id))[evento_id] ?? 0;
    await avisarEquipo(ig, "resumen_inscripciones", [ev.titulo ?? evento_titulo, tomadas.length, inscritosTexto(total, ev.cupo)]);
  }
}

/* Recordatorio a cada inscrito el día anterior al evento, entre las 9 y las 20 de la iglesia */
async function recordarEventos() {
  const { data } = await db.from("inscripciones").select("*").is("recordatorio_enviado_at", null).in("pago_estado", ["no_requiere", "pagado"])
    .lte("evento_fecha", hoyEn("UTC", 2)).order("evento_fecha").limit(500);
  await enLotes(data ?? [], 10, async (r) => {
    const ig = await datosIglesia(r.church_id);
    if (!ig) return;
    const manana = hoyEn(ig.zona, 1);
    if (r.evento_fecha < manana) { await tomar("inscripciones", "recordatorio_enviado_at", r.id); return; } // ya es hoy o pasó: no corresponde
    const hora = horaLocal(ig.zona);
    if (r.evento_fecha !== manana || hora < 9 || hora >= 20) return;
    if (!(await tomar("inscripciones", "recordatorio_enviado_at", r.id))) return;
    const tel = telefonoWhatsApp(r.telefono, ig.pais);
    if (!tel) return;
    const ev = await eventoDe(ig, r.evento_id);
    await enviarPlantilla(tel, "recordatorio_evento", ig.idioma, [primerNombre(r.nombre), ev?.titulo ?? r.evento_titulo, horaTexto(ev?.hora), ev?.lugar ?? "el lugar que confirmaremos"]);
  });
}

/* ---------- Mercado Pago (eventos pagos) ----------
   Secretos: MP_CLIENT_ID y MP_CLIENT_SECRET (la aplicación de Eklesic en Mercado Pago Developers).
   Opcionales: MP_PRUEBA = si (usar cuentas de prueba) y MP_COMISION (porcentaje para Eklesic; por defecto, nada).
   En la aplicación de Mercado Pago, la URL de redireccionamiento es <SUPABASE_URL>/functions/v1/whatsapp/mp/oauth
   El dinero va directo a la cuenta de cada iglesia, que se conecta desde el panel (Inscripciones → Conectar Mercado Pago). */
const MP_API = "https://api.mercadopago.com";
const MINUTOS_RESERVA = 30; // lugar guardado mientras la persona paga
const mpPrueba = () => env("MP_PRUEBA") === "si";
const urlRetornoOAuth = () => `${env("SUPABASE_URL")}/functions/v1/whatsapp/mp/oauth`;
const urlSitio = (slug: string) => {
  const [dueno, repo] = env("GITHUB_REPO").split("/");
  return `https://${dueno.toLowerCase()}.github.io/${repo}/${slug}/`;
};

async function firmar(texto: string) {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("AVISO_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(texto)));
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function pedirTokenMP(cuerpo: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), ...cuerpo }),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.access_token) throw new Error(`Mercado Pago no entregó el acceso (${r.status}): ${JSON.stringify(datos).slice(0, 300)}`);
  return datos;
}
// El acceso dura 180 días según Mercado Pago
const venceDe = (t: { expires_in?: number }) => new Date(Date.now() + (Number(t.expires_in) > 0 ? Number(t.expires_in) * 1000 : 180 * 86400000)).toISOString();

/* Acceso a la cuenta de Mercado Pago de una iglesia; se renueva solo cuando faltan menos de 7 días */
async function tokenMP(churchId: string): Promise<string | null> {
  const { data: c } = await db.from("mp_cuentas").select("access_token, refresh_token, vence_at").eq("church_id", churchId).maybeSingle();
  if (!c) return null;
  if (!c.refresh_token || Date.parse(c.vence_at) - Date.now() > 7 * 86400000) return c.access_token;
  try {
    const t = await pedirTokenMP({ grant_type: "refresh_token", refresh_token: c.refresh_token });
    await db.from("mp_cuentas").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? c.refresh_token, vence_at: venceDe(t), actualizada_at: new Date().toISOString() }).eq("church_id", churchId);
    return t.access_token;
  } catch (e) {
    console.error("No se pudo renovar el acceso a Mercado Pago:", e);
    return c.access_token;
  }
}

const conEstadoDePago = (volver: string, estado: string) => {
  const u = new URL(volver);
  u.searchParams.set("pago", estado);
  u.hash = "eventos";
  return u.toString();
};

/* Crea el cobro en la cuenta de la iglesia y devuelve la dirección de la pantalla de pago */
async function crearCobroMP(token: string, ins: { id: string; acompanantes: number }, evento: Evento, moneda: string, churchId: string, volver: string) {
  const personas = 1 + ins.acompanantes;
  const ahora = Date.now();
  const iso = (t: number) => new Date(t).toISOString().replace("Z", "+00:00");
  const comision = Number(env("MP_COMISION")) > 0 ? Math.round(evento.precio! * personas * Number(env("MP_COMISION"))) / 100 : 0;
  const preferencia: Record<string, unknown> = {
    items: [{ id: evento.id, title: `Inscripción: ${evento.titulo}`.slice(0, 250), quantity: personas, unit_price: evento.precio, currency_id: moneda }],
    external_reference: ins.id,
    notification_url: `${env("SUPABASE_URL")}/functions/v1/whatsapp/mp/notificacion?iglesia=${churchId}`,
    back_urls: { success: conEstadoDePago(volver, "listo"), pending: conEstadoDePago(volver, "pendiente"), failure: conEstadoDePago(volver, "error") },
    auto_return: "approved",
    // Solo medios inmediatos: los pagos en efectivo (OXXO, boleto, Rapipago) se acreditan días después de vencida la reserva
    payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
  };
  // El lugar se guarda MINUTOS_RESERVA: después, el cobro vence y no se puede pagar. Sin fecha de inicio
  // (con zona horaria mal interpretada puede quedar "todavía no vigente"). MP_SIN_VENCIMIENTO = si lo apaga:
  // si alguien paga tarde, el pago igual se acredita y la inscripción se confirma.
  if (env("MP_SIN_VENCIMIENTO") !== "si") {
    preferencia.expires = true;
    preferencia.expiration_date_to = iso(ahora + MINUTOS_RESERVA * 60000);
  }
  if (comision > 0) preferencia.marketplace_fee = comision;
  const r = await fetch(`${MP_API}/checkout/preferences`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(preferencia),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok || !datos.init_point) throw new Error(`Mercado Pago no creó el cobro (${r.status}): ${JSON.stringify(datos).slice(0, 300)}`);
  return (mpPrueba() && datos.sandbox_init_point) || datos.init_point;
}

/* Aplica a la inscripción lo que dice Mercado Pago de un pago (siempre consultado a Mercado Pago, nunca creído de un aviso) */
// deno-lint-ignore no-explicit-any
async function aplicarPagoMP(churchId: string, pago: any) {
  const insId = String(pago?.external_reference ?? "");
  if (!esUuid(insId)) return;
  const { data: ins } = await db.from("inscripciones").select("id, monto, moneda, pago_estado").eq("id", insId).eq("church_id", churchId).maybeSingle();
  if (!ins) return;
  if (pago.status === "approved") {
    if (ins.pago_estado === "pagado") return;
    const alcanza = Number(pago.transaction_amount) + 0.01 >= Number(ins.monto ?? 0) && (!ins.moneda || pago.currency_id === ins.moneda);
    if (!alcanza) return console.error(`El pago ${pago.id} (${pago.transaction_amount} ${pago.currency_id}) no coincide con la inscripción ${insId}`);
    // Si la reserva ya había vencido igual se confirma: la persona pagó
    await db.from("inscripciones").update({ pago_estado: "pagado", mp_pago_id: String(pago.id), pagado_at: pago.date_approved ?? new Date().toISOString() })
      .eq("id", insId).neq("pago_estado", "pagado");
  } else if (["refunded", "charged_back"].includes(pago.status) && ins.pago_estado === "pagado") {
    await db.from("inscripciones").update({ pago_estado: "reembolsado" }).eq("id", insId);
  }
}

/* POST /whatsapp/mp/notificacion?iglesia=<id>: Mercado Pago avisa que cambió un pago */
async function notificacionMP(req: Request, url: URL) {
  const churchId = url.searchParams.get("iglesia");
  const cuerpo = (await leerJson(req)) ?? {};
  const tipo = cuerpo.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const pagoId = String(cuerpo.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (tipo === "payment" && /^\d+$/.test(pagoId) && esUuid(churchId)) {
    try {
      const token = await tokenMP(churchId);
      const r = token ? await fetch(`${MP_API}/v1/payments/${pagoId}`, { headers: { Authorization: `Bearer ${token}` } }) : null;
      if (r?.ok) await aplicarPagoMP(churchId, await r.json());
      else if (r) console.error(`Mercado Pago no devolvió el pago ${pagoId}:`, r.status);
    } catch (e) {
      console.error("Falló la revisión de un pago:", e);
    }
    EdgeRuntime.waitUntil(procesarPendientes()); // confirmación al inscrito y aviso al equipo
  }
  return responder(200); // Mercado Pago reintenta si no recibe 200
}

/* Respaldo de los avisos: busca en Mercado Pago los pagos de las reservas de las últimas 48 h, y marca como
   vencidas las reservas sin pagar (así dejan de ocupar lugar y se ven así en el panel) */
async function conciliarPagosMP() {
  const desde = new Date(Date.now() - 48 * 3600000).toISOString();
  const { data } = await db.from("inscripciones").select("id, church_id").in("pago_estado", ["pendiente", "vencido"])
    .gte("created_at", desde).order("created_at").limit(50);
  await enLotes(data ?? [], 5, async (i) => {
    const token = await tokenMP(i.church_id);
    if (!token) return;
    const r = await fetch(`${MP_API}/v1/payments/search?external_reference=${i.id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    // deno-lint-ignore no-explicit-any
    const aprobado = ((await r.json()).results ?? []).find((p: any) => p.status === "approved");
    if (aprobado) await aplicarPagoMP(i.church_id, aprobado);
  });
  await db.from("inscripciones").update({ pago_estado: "vencido" })
    .eq("pago_estado", "pendiente").lt("pago_vence_at", new Date(Date.now() - 10 * 60000).toISOString());
}

/* El panel manda la sesión del usuario: solo quien administra la iglesia puede conectar su cuenta */
async function usuarioDelPanel(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: staff } = await db.from("staff_users").select("church_id, role").eq("auth_id", data.user.id).maybeSingle();
  return staff as { church_id: string; role: string } | null;
}

/* POST /whatsapp/mp/estado (desde el panel): si la iglesia tiene Mercado Pago conectado */
async function estadoMP(req: Request) {
  const staff = await usuarioDelPanel(req);
  if (!staff) return responderJson(401, { error: "Vuelve a ingresar al panel." });
  const { data } = await db.from("mp_cuentas").select("live_mode, conectada_at").eq("church_id", staff.church_id).maybeSingle();
  return responderJson(200, {
    configurado: Boolean(env("MP_CLIENT_ID") && env("MP_CLIENT_SECRET")),
    conectada: Boolean(data), prueba: data ? data.live_mode === false : null, desde: data?.conectada_at ?? null,
    puedeConectar: ["owner", "admin"].includes(staff.role),
  });
}

/* POST /whatsapp/mp/enlace (desde el panel): dirección para que la iglesia autorice a Eklesic en Mercado Pago */
async function enlaceMP(req: Request) {
  const staff = await usuarioDelPanel(req);
  if (!staff) return responderJson(401, { error: "Vuelve a ingresar al panel." });
  if (!["owner", "admin"].includes(staff.role)) return responderJson(403, { error: "Solo quien administra la iglesia puede conectar Mercado Pago." });
  if (!env("MP_CLIENT_ID") || !env("MP_CLIENT_SECRET")) return responderJson(503, { error: "Los pagos todavía no están habilitados en Eklesic." });
  const vence = Date.now() + 30 * 60000;
  const estado = `${staff.church_id}.${vence}.${await firmar(`${staff.church_id}.${vence}`)}`;
  const u = new URL("https://auth.mercadopago.com/authorization");
  u.search = new URLSearchParams({ client_id: env("MP_CLIENT_ID"), response_type: "code", platform_id: "mp", state: estado, redirect_uri: urlRetornoOAuth() }).toString();
  return responderJson(200, { url: u.toString() });
}

/* GET /whatsapp/mp/oauth: Mercado Pago vuelve acá después de que la iglesia autoriza. Se guarda el acceso y
   se vuelve al panel (Supabase no deja mostrar páginas HTML desde sus funciones). */
async function volverDeMP(url: URL) {
  const alPanel = (resultado: string) => Response.redirect(`${urlPanel()}?mp=${resultado}`, 302);
  const [churchId, venceTxt, firma] = (url.searchParams.get("state") ?? "").split(".");
  const code = url.searchParams.get("code");
  if (!code) return alPanel("cancelado");
  if (!esUuid(churchId) || !firma || Number(venceTxt) < Date.now() || !iguales(firma, await firmar(`${churchId}.${venceTxt}`))) return alPanel("vencido");
  try {
    const t = await pedirTokenMP({ grant_type: "authorization_code", code, redirect_uri: urlRetornoOAuth(), test_token: mpPrueba() ? "true" : "false" });
    const { error } = await db.from("mp_cuentas").upsert({
      church_id: churchId, mp_user_id: String(t.user_id ?? ""), access_token: t.access_token, refresh_token: t.refresh_token ?? null,
      live_mode: t.live_mode ?? null, vence_at: venceDe(t), conectada_at: new Date().toISOString(), actualizada_at: new Date().toISOString(),
    }, { onConflict: "church_id" });
    if (error) throw new Error(error.message);
    return alPanel("conectado");
  } catch (e) {
    console.error("No se pudo conectar Mercado Pago:", e);
    return alPanel("error");
  }
}

async function procesarPendientes() {
  iglesias.clear();
  for (const tarea of [avisarVisitasNuevas, avisarPedidosDeOracion, recordarSeguimientos, enviarReportesMensuales,
    conciliarPagosMP, avisarInscripciones, resumirInscripciones, recordarEventos]) {
    try { await tarea(); } catch (e) { console.error(`Falló ${tarea.name}:`, e); }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname.endsWith("/mp/oauth")) return volverDeMP(url);
  if (req.method === "GET") {
    const p = url.searchParams;
    const ok = p.get("hub.mode") === "subscribe" && iguales(p.get("hub.verify_token") ?? "", env("WHATSAPP_VERIFY_TOKEN"));
    return ok ? responder(200, p.get("hub.challenge") ?? "") : responder(403, "token incorrecto");
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return responder(405, "método no permitido");

  // Las rutas de Mercado Pago van antes que "/aviso" (la del agente de GitHub)
  if (url.pathname.endsWith("/mp/notificacion")) return notificacionMP(req, url);
  if (url.pathname.endsWith("/mp/estado")) return estadoMP(req);
  if (url.pathname.endsWith("/mp/enlace")) return enlaceMP(req);
  if (url.pathname.endsWith("/inscribir")) return inscribir(req);
  if (url.pathname.endsWith("/cupos")) return cupos(req);
  if (url.pathname.endsWith("/aviso")) return devolverResultado(req);
  if (url.pathname.endsWith("/pendientes")) {
    EdgeRuntime.waitUntil(procesarPendientes());
    return responder(202);
  }

  const cuerpo = await req.text();
  if (!(await firmaValida(cuerpo, req.headers.get("x-hub-signature-256")))) return responder(401, "firma inválida");
  let aviso;
  try { aviso = JSON.parse(cuerpo); } catch { return responder(400, "json inválido"); }

  // Contestamos a Meta enseguida y procesamos después, para que no reintente por demora
  EdgeRuntime.waitUntil(procesarAviso(aviso));
  return responder(200);
});
