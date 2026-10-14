/* Agente por WhatsApp (Supabase Edge Function "whatsapp").

   GET  /whatsapp         Meta verifica el webhook al configurarlo.
   POST /whatsapp         Meta avisa de mensajes nuevos: si el número está habilitado, el pedido va al agente de GitHub.
   POST /whatsapp/aviso   El agente de GitHub devuelve el resultado y se lo contamos a quien hizo el pedido.

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

async function enviarWhatsApp(telefono: string, texto: string) {
  const r = await fetch(`${GRAPH}/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: telefono, type: "text", text: { body: texto.slice(0, 4000) } }),
  });
  if (!r.ok) console.error("WhatsApp no aceptó el mensaje:", r.status, await r.text());
  return r.ok;
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

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const p = url.searchParams;
    const ok = p.get("hub.mode") === "subscribe" && iguales(p.get("hub.verify_token") ?? "", env("WHATSAPP_VERIFY_TOKEN"));
    return ok ? responder(200, p.get("hub.challenge") ?? "") : responder(403, "token incorrecto");
  }
  if (req.method !== "POST") return responder(405, "método no permitido");

  if (url.pathname.endsWith("/aviso")) return devolverResultado(req);

  const cuerpo = await req.text();
  if (!(await firmaValida(cuerpo, req.headers.get("x-hub-signature-256")))) return responder(401, "firma inválida");
  let aviso;
  try { aviso = JSON.parse(cuerpo); } catch { return responder(400, "json inválido"); }

  // Contestamos a Meta enseguida y procesamos después, para que no reintente por demora
  EdgeRuntime.waitUntil(procesarAviso(aviso));
  return responder(200);
});
