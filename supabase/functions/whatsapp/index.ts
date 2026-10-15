/* Agente por WhatsApp (Supabase Edge Function "whatsapp").

   GET  /whatsapp         Meta verifica el webhook al configurarlo.
   POST /whatsapp         Meta avisa de mensajes nuevos: si el número está habilitado, el pedido va al agente de GitHub.
   POST /whatsapp/aviso   El agente de GitHub devuelve el resultado y se lo contamos a quien hizo el pedido.
   POST /whatsapp/pendientes
                          Manda lo que esté pendiente: aviso al equipo de visitas nuevas y pedidos de oración,
                          bienvenida a la visita y recordatorios de seguimiento. No recibe datos y cada cosa se
                          manda una sola vez, así que lo puede llamar cualquiera: la página web después de cada
                          formulario y GitHub una vez por hora (avisos.yml), por si algo quedó sin mandar.
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
  noAutorizado: "Hola 👋 Este número todavía no está habilitado para hacer cambios en la página. Si eres parte de una iglesia que trabaja con Eklesic, pide que lo habiliten.",
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

async function pedirAlAgente(cliente: string, pedido: string, aviso: string) {
  const r = await fetch(`https://api.github.com/repos/${env("GITHUB_REPO")}/actions/workflows/agente.yml/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "eklesic-whatsapp",
    },
    body: JSON.stringify({ ref: "main", inputs: { cliente, pedido, aviso } }),
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
  if (await pedirAlAgente(slug, texto, fila.id)) {
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

type Iglesia = { nombre: string; pais: string | null; zona: string; idioma: string; diasSeguimiento: number; equipo: string[] };
const iglesias = new Map<string, Promise<Iglesia | null>>();

function datosIglesia(id: string) {
  if (!iglesias.has(id)) iglesias.set(id, (async () => {
    const { data: c } = await db.from("churches").select("name, country, timezone, settings").eq("id", id).maybeSingle();
    if (!c) return null;
    const { data: nums } = await db.from("whatsapp_autorizados").select("telefono")
      .eq("church_id", id).eq("activo", true).eq("recibe_avisos", true);
    const s = (c.settings ?? {}) as Record<string, unknown>;
    return {
      nombre: c.name,
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

async function procesarPendientes() {
  iglesias.clear();
  for (const tarea of [avisarVisitasNuevas, avisarPedidosDeOracion, recordarSeguimientos]) {
    try { await tarea(); } catch (e) { console.error(`Falló ${tarea.name}:`, e); }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const p = url.searchParams;
    const ok = p.get("hub.mode") === "subscribe" && iguales(p.get("hub.verify_token") ?? "", env("WHATSAPP_VERIFY_TOKEN"));
    return ok ? responder(200, p.get("hub.challenge") ?? "") : responder(403, "token incorrecto");
  }
  if (req.method !== "POST") return responder(405, "método no permitido");

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
