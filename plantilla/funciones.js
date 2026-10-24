/* ==========================================================
   FUNCIONES DE LOS SITIOS (compartidas por todos los diseños)
   ==========================================================
   agente/construir.mjs inserta este archivo en cada página, donde el diseño tiene el marcador
   del bloque de funciones, después de "const IGLESIA = …" (los datos de la iglesia).

   Cada diseño (plantilla/iglesia.html o plantilla/disenos/<nombre>.html) solo define estructura y estilos.
   Estas funciones completan los elementos por su id (ver la lista en LEEME.md, "Diseños a medida").
   Si un diseño no tiene algún elemento, esa parte simplemente no se muestra: la página no se rompe. */

/* Elemento "fantasma": lo que devuelve $() cuando el diseño no tiene ese id. Acepta todo y no hace nada. */
const FANTASMA = {
  textContent: "", innerHTML: "", href: "", value: "", hidden: true, disabled: false, checked: false, open: false,
  className: "", dataset: {}, style: {}, options: [],
  classList: { add() {}, remove() {}, replace() {}, toggle() { return false; }, contains() { return false; } },
  addEventListener() {}, setAttribute() {}, showModal() {}, close() {}, reset() {}, focus() {}, append() {}, remove() {},
  requestSubmit() {}, querySelector() { return null; }, closest() { return null; },
};
const $ = (id) => document.getElementById(id) ?? FANTASMA;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const wa = (texto) => `https://wa.me/${IGLESIA.whatsapp}?text=${encodeURIComponent(texto)}`;
const aFecha = (iso) => { const [a, m, d] = iso.split("-").map(Number); return new Date(a, m - 1, d); };

document.title = IGLESIA.nombre;
$("marca-nombre").textContent = IGLESIA.nombre;
$("h-titulo").textContent = IGLESIA.titulo;
$("h-bajada").textContent = IGLESIA.bajada;
$("btn-vivo").href = IGLESIA.urlVivo;

$("horarios").innerHTML = IGLESIA.horarios.map((h) =>
  `<div class="horario"><dt>${esc(h.dia)}</dt><dd><strong>${esc(h.hora)}</strong><span>${esc(h.detalle)}</span></dd></div>`
).join("");

$("vision").textContent = IGLESIA.vision;
$("quienes-texto").textContent = IGLESIA.quienes;
$("p-iniciales").textContent = IGLESIA.pastores.iniciales;
$("p-nombres").textContent = IGLESIA.pastores.nombres;
$("p-texto").textContent = IGLESIA.pastores.texto;

/* Siguiente paso y oración.
   Con la base de datos conectada (IGLESIA.supabase) los formularios guardan los datos;
   sin conexión, todo sigue funcionando por WhatsApp. */
const DB = IGLESIA.supabase || null;
async function guardar(tabla, fila) {
  const r = await fetch(`${DB.url}/rest/v1/${tabla}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: DB.anonKey, Authorization: `Bearer ${DB.anonKey}`, Prefer: "return=minimal" },
    body: JSON.stringify(fila),
  });
  if (!r.ok) throw new Error(`Error ${r.status}`);
}
/* Despierta los avisos por WhatsApp al equipo. No manda datos: la función los lee de la base.
   Si falla no pasa nada: GitHub revisa lo pendiente cada hora. */
const despertarAvisos = () =>
  fetch(`${DB.url}/functions/v1/whatsapp/pendientes`, { method: "POST", mode: "no-cors", keepalive: true }).catch(() => {});
const aviso = (id, texto, error) => { const el = $(id); el.textContent = texto; el.className = "aviso" + (error ? " aviso--error" : ""); };

$("paso-texto").textContent = IGLESIA.pasoTexto;
$("paso-boton").href = wa("Hola, quiero dar mi siguiente paso en la fe.");
const armarOracion = () => {
  const nombre = $("or-nombre").value.trim();
  const texto = $("or-texto").value.trim();
  const mensaje = "Hola, quisiera enviar una petición de oración." +
    (nombre ? `\nMi nombre: ${nombre}` : "") +
    (texto ? `\nPetición: ${texto}` : "");
  $("or-enviar").href = wa(mensaje);
};
$("or-nombre").addEventListener("input", armarOracion);
$("or-texto").addEventListener("input", armarOracion);
armarOracion();

if (DB) {
  /* Formulario "siguiente paso" -> tabla people (estado: prospect) */
  $("paso-boton").hidden = true;
  $("paso-form").hidden = false;
  $("paso-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if ($("pf-web").value) return; /* campo trampa: solo lo completan los robots */
    const nombre = $("pf-nombre").value.trim().replace(/\s+/g, " ");
    const telefono = $("pf-telefono").value.trim();
    const email = $("pf-email").value.trim();
    if (!nombre) return aviso("pf-aviso", "Escribe tu nombre.", true);
    if (!telefono && !email) return aviso("pf-aviso", "Déjanos un teléfono o un correo para poder escribirte.", true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return aviso("pf-aviso", "Revisa tu correo: no parece completo.", true);
    if (!$("pf-consent").checked) return aviso("pf-aviso", "Para continuar, marca que aceptas que guardemos tus datos.", true);
    const boton = $("pf-enviar");
    boton.disabled = true;
    aviso("pf-aviso", "Enviando…");
    try {
      const [nombrePila, ...resto] = nombre.split(" ");
      await guardar("people", {
        church_id: DB.churchId,
        first_name: nombrePila,
        last_name: resto.join(" ") || null,
        phone: telefono || null,
        email: email || null,
        status: "prospect",
        source: "web_form",
        consent_data: true,
        consent_at: new Date().toISOString(),
      });
      despertarAvisos();
      $("paso-form").reset();
      aviso("pf-aviso", "¡Gracias! Recibimos tus datos y pronto alguien de la iglesia te escribirá.");
    } catch (e) {
      aviso("pf-aviso", "No pudimos guardar tus datos. Escríbenos por WhatsApp y te acompañamos.", true);
      $("paso-boton").hidden = false;
    } finally {
      boton.disabled = false;
    }
  });

  /* Formulario de oración -> tabla prayer_requests (WhatsApp queda como segunda opción) */
  $("or-guardar").hidden = false;
  $("or-nota").hidden = false;
  $("or-enviar").classList.replace("boton--marea", "boton--linea");
  $("or-enviar").textContent = "O enviar por WhatsApp";
  $("or-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if ($("or-web").value) return;
    const texto = $("or-texto").value.trim();
    if (!texto) return aviso("or-aviso", "Escribe tu petición.", true);
    const boton = $("or-guardar");
    boton.disabled = true;
    aviso("or-aviso", "Enviando…");
    try {
      await guardar("prayer_requests", {
        church_id: DB.churchId,
        name: $("or-nombre").value.trim() || null,
        request: texto,
        is_private: true,
      });
      despertarAvisos();
      $("or-texto").value = "";
      armarOracion();
      aviso("or-aviso", "Recibimos tu petición. Estamos orando por ti.");
    } catch (e) {
      aviso("or-aviso", "No pudimos enviar tu petición. Puedes mandarla por WhatsApp.", true);
    } finally {
      boton.disabled = false;
    }
  });
}

/* Enseñanzas */
$("ens-todas").href = IGLESIA.urlEnsenanzas;
const fmtLargo = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" });
$("ens-lista").innerHTML = IGLESIA.ensenanzas.map((e) =>
  `<li><a href="${esc(e.url)}" target="_blank" rel="noopener">
     <time datetime="${esc(e.fecha)}">${fmtLargo.format(aFecha(e.fecha))}</time>
     <div><h3>${esc(e.titulo)}</h3><p>${esc(e.resumen)}</p><p class="quien">${esc(e.pastor)}</p></div>
     <span class="ver">Ver mensaje</span>
   </a></li>`
).join("");

/* Eventos: solo se muestran los que todavía no pasaron */
const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
const proximos = IGLESIA.eventos.filter((e) => aFecha(e.fecha) >= hoy).sort((a, b) => aFecha(a.fecha) - aFecha(b.fecha));
const fmtMes = new Intl.DateTimeFormat("es", { month: "long" });
const fmtDiaSemana = new Intl.DateTimeFormat("es", { weekday: "long" });
/* Precio en la moneda de la iglesia ("moneda" del archivo, por ejemplo ARS, MXN o BRL) */
const precioTexto = (n) => {
  const regiones = { ARS: "es-AR", MXN: "es-MX", BRL: "pt-BR", GTQ: "es-GT", CLP: "es-CL", COP: "es-CO", UYU: "es-UY", PEN: "es-PE" };
  try { return new Intl.NumberFormat(regiones[IGLESIA.moneda] || "es", { style: "currency", currency: IGLESIA.moneda, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch (e) { return String(n); }
};
$("ev-lista").innerHTML = proximos.length
  ? proximos.map((e) => {
      const f = aFecha(e.fecha);
      return `<article class="evento">
        <div class="dia">${f.getDate()}</div>
        <div class="mes">${fmtMes.format(f)}</div>
        <h3>${esc(e.titulo)}</h3>
        <p>${fmtDiaSemana.format(f)}, ${esc(e.hora)}. ${esc(e.lugar)}</p>
        ${e.precio ? `<p class="precio">${esc(precioTexto(e.precio))} por persona</p>` : ""}
        ${DB && e.inscripcion && e.id ? `<p class="lugares" data-lugares="${esc(e.id)}"></p>
        <button class="boton boton--marea" type="button" data-evento="${esc(e.id)}">Quiero inscribirme</button>` : ""}
      </article>`;
    }).join("")
  : `<p class="vacio">Pronto publicaremos las próximas fechas.</p>`;

/* Inscripción a eventos: la función "whatsapp" de Supabase revisa el evento y el cupo, y manda la confirmación */
const conInscripcion = DB ? proximos.filter((e) => e.inscripcion && e.id) : [];
if (conInscripcion.length) {
  /* Sin encabezados propios: así el navegador no necesita pedir permiso previo (CORS) */
  const llamar = (ruta, datos) =>
    fetch(`${DB.url}/functions/v1/whatsapp/${ruta}`, { method: "POST", body: JSON.stringify(datos) }).then((r) => r.json());
  const mostrarLugares = (ocupados) => conInscripcion.forEach((e) => {
    const lugares = document.querySelector(`[data-lugares="${e.id}"]`);
    const boton = document.querySelector(`[data-evento="${e.id}"]`);
    if (!e.cupo || !lugares || !boton) return;
    const quedan = Math.max(0, e.cupo - (ocupados[e.id] ?? 0));
    lugares.textContent = quedan ? `Quedan ${quedan} ${quedan === 1 ? "lugar" : "lugares"}` : "Inscripciones cerradas: ya no quedan lugares.";
    boton.hidden = !quedan;
  });
  const actualizarLugares = () => llamar("cupos", { churchId: DB.churchId }).then((r) => mostrarLugares(r.ocupados ?? {})).catch(() => {});
  actualizarLugares();

  let eventoAbierto = null;
  /* En los eventos pagos se cobra por persona: quien se inscribe más sus acompañantes */
  const mostrarTotal = () => {
    const personas = 1 + Number($("insc-acomp").value || 0);
    $("insc-total").textContent = eventoAbierto?.precio
      ? `Total a pagar: ${precioTexto(eventoAbierto.precio * personas)} (${personas} ${personas === 1 ? "persona" : "personas"}). Se paga con Mercado Pago y tu lugar queda reservado 30 minutos.`
      : "";
  };
  $("insc-acomp").addEventListener("change", mostrarTotal);
  $("insc-acomp").innerHTML = Array.from({ length: 11 }, (_, n) => `<option value="${n}">${n === 0 ? "Vengo solo/a" : n}</option>`).join("");
  $("ev-lista").addEventListener("click", (ev) => {
    const boton = ev.target.closest("[data-evento]");
    if (!boton) return;
    eventoAbierto = conInscripcion.find((e) => e.id === boton.dataset.evento);
    const f = aFecha(eventoAbierto.fecha);
    $("insc-titulo").textContent = eventoAbierto.titulo;
    $("insc-sub").textContent = `${fmtDiaSemana.format(f)} ${f.getDate()} de ${fmtMes.format(f)}, ${eventoAbierto.hora}. ${eventoAbierto.lugar}`;
    $("insc-enviar").hidden = false;
    $("insc-enviar").textContent = eventoAbierto.precio ? "Continuar al pago" : "Inscribirme";
    mostrarTotal();
    aviso("insc-aviso", "");
    $("dlg-insc").showModal();
  });
  $("insc-cerrar").addEventListener("click", () => $("dlg-insc").close());

  $("insc-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const nombre = $("insc-nombre").value.trim().replace(/\s+/g, " ");
    const telefono = $("insc-telefono").value.trim();
    const email = $("insc-email").value.trim();
    if (!nombre) return aviso("insc-aviso", "Escribe tu nombre.", true);
    if (!telefono && !email) return aviso("insc-aviso", "Déjanos un teléfono o un correo para confirmarte.", true);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return aviso("insc-aviso", "Revisa tu correo: no parece completo.", true);
    if (!$("insc-consent").checked) return aviso("insc-aviso", "Para inscribirte, marca que aceptas que guardemos tus datos.", true);
    const boton = $("insc-enviar");
    boton.disabled = true;
    aviso("insc-aviso", "Enviando…");
    try {
      const r = await llamar("inscribir", {
        churchId: DB.churchId, eventoId: eventoAbierto.id, nombre, telefono, email,
        acompanantes: Number($("insc-acomp").value), acepto: true, web: $("insc-web").value,
        volver: location.origin + location.pathname,
      });
      if (r.ok && r.pagar) {
        aviso("insc-aviso", r.mensaje);
        location.href = r.pagar; /* pantalla de pago de Mercado Pago */
        return;
      }
      if (r.ok) {
        aviso("insc-aviso", r.mensaje);
        $("insc-form").reset();
        boton.hidden = true;
        actualizarLugares();
      } else {
        aviso("insc-aviso", r.error || "No pudimos guardar tu inscripción.", true);
      }
    } catch (e) {
      aviso("insc-aviso", "No pudimos guardar tu inscripción. Escríbenos por WhatsApp y te anotamos.", true);
    } finally {
      boton.disabled = false;
    }
  });
}

/* Al volver de Mercado Pago: la página recibe ?pago=listo|pendiente|error */
const estadoPago = new URLSearchParams(location.search).get("pago");
const MENSAJES_PAGO = {
  listo: "¡Gracias! Recibimos tu pago. En unos minutos te llega la confirmación por WhatsApp.",
  pendiente: "Tu pago está en proceso. Cuando se acredite, te llega la confirmación por WhatsApp.",
  error: "El pago no se completó. Puedes intentarlo de nuevo: tu lugar queda reservado 30 minutos.",
};
if (MENSAJES_PAGO[estadoPago]) {
  $("ev-pago").textContent = MENSAJES_PAGO[estadoPago];
  history.replaceState(null, "", location.pathname + location.hash); /* que al recargar no se repita el mensaje */
}

/* Ministerios */
$("min-lista").innerHTML = IGLESIA.ministerios.map((m) =>
  `<article class="ministerio"><h3>${esc(m.nombre)}</h3><p class="edad">${esc(m.edad)}</p><p>${esc(m.texto)}</p></article>`
).join("");

/* Ofrendas */
const of = IGLESIA.ofrendas;
$("of-texto").textContent = of.texto;
$("of-formas").innerHTML = `
  <div class="forma">
    <h3>Online</h3>
    <p class="suave">Con tarjeta o dinero en cuenta, de forma segura.</p>
    <div class="datos"><a class="boton boton--marea" href="${esc(of.mercadopago)}" target="_blank" rel="noopener">Ofrendar online</a></div>
  </div>
  <div class="forma">
    <h3>Transferencia bancaria</h3>
    <p class="suave">${esc(of.titular)}. ${esc(of.banco)}.</p>
    <div class="datos"><code id="alias">${esc(of.alias)}</code><button class="copiar" id="copiar" type="button">Copiar alias</button></div>
  </div>
  <div class="forma">
    <h3>En persona</h3>
    <p class="suave">Durante los servicios, en el momento de las ofrendas.</p>
  </div>`;
$("copiar").addEventListener("click", () => {
  const boton = $("copiar");
  const listo = () => { boton.textContent = "Copiado"; setTimeout(() => (boton.textContent = "Copiar alias"), 2000); };
  const respaldo = () => {
    try {
      const rango = document.createRange(); rango.selectNodeContents($("alias"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rango);
      document.execCommand("copy"); listo();
    } catch (e) { /* si falla, queda seleccionado para copiar a mano */ }
  };
  try { navigator.clipboard.writeText(of.alias).then(listo, respaldo); } catch (e) { respaldo(); }
});

/* Sedes */
$("sedes-lista").innerHTML = IGLESIA.sedes.map((s) =>
  `<article class="sede">
     <h3>${esc(s.nombre)}</h3>
     <p>${esc(s.direccion)}</p>
     <p class="horas">${esc(s.horarios)}</p>
     <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.direccion)}" target="_blank" rel="noopener">Ver en el mapa</a>
   </article>`
).join("");

/* Contacto y pie */
$("c-whatsapp").href = wa("Hola, quisiera más información.");
$("c-email").href = `mailto:${IGLESIA.email}`;
$("c-email").textContent = IGLESIA.email;
$("pie-copy").textContent = `© ${new Date().getFullYear()} ${IGLESIA.nombre}`;
$("pie-redes").innerHTML = IGLESIA.redes.map((r) =>
  `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.nombre)}</a></li>`
).join("");

/* Asistente: chat que responde con la información de la iglesia (función "asistente" de Supabase).
   La conversación vive solo en esta página: no se guarda. */
if (DB && IGLESIA.asistente !== false) {
  const historial = [];
  /* Código al azar de este navegador (sin datos personales): da a cada persona su propio límite de mensajes,
     aunque muchas compartan el WiFi del templo. Si el navegador no deja guardarlo, vale por esta visita. */
  const visitante = (() => {
    const nuevo = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
    try {
      let v = localStorage.getItem("asistente-visitante");
      if (!/^[a-z0-9]{16,40}$/.test(v || "")) { v = nuevo(); localStorage.setItem("asistente-visitante", v); }
      return v;
    } catch (e) { return nuevo(); }
  })();
  const caja = $("asis-mensajes");
  const agregar = (rol, texto, extra = "") => {
    const p = document.createElement("p");
    p.className = `asis-msj asis-msj--${rol} ${extra}`.trim();
    p.textContent = texto;
    caja.append(p);
    caja.scrollTop = caja.scrollHeight;
    return p;
  };
  const abrir = (si) => {
    $("asis-panel").hidden = !si;
    $("asis-boton").setAttribute("aria-expanded", String(si));
    if (!si) return;
    if (!caja.childElementCount) agregar("asistente", `¡Hola! Soy el asistente de ${IGLESIA.nombre}. Pregúntame por horarios, actividades, cómo llegar o lo que quieras saber de la iglesia.`);
    $("asis-texto").focus();
  };
  const cerrar = () => { abrir(false); $("asis-boton").focus(); };

  $("asis-boton").hidden = false;
  $("asis-boton").addEventListener("click", () => abrir($("asis-panel").hidden));
  $("asis-cerrar").addEventListener("click", cerrar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("asis-panel").hidden) cerrar(); });

  $("asis-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const texto = $("asis-texto").value.trim();
    if (!texto || $("asis-enviar").disabled) return;
    $("asis-texto").value = "";
    agregar("usuario", texto);
    historial.push({ rol: "usuario", texto });
    const pensando = agregar("asistente", "Escribiendo…", "asis-msj--pensando");
    $("asis-enviar").disabled = true;
    let respuesta = "";
    try {
      /* Sin encabezados propios: así el navegador no necesita pedir permiso previo (CORS) */
      const r = await fetch(`${DB.url}/functions/v1/asistente`, { method: "POST", body: JSON.stringify({ churchId: DB.churchId, visitante, mensajes: historial }) });
      respuesta = (await r.json()).respuesta || "";
    } catch (e) { /* sin conexión: se usa el mensaje de abajo */ }
    respuesta ||= "No pude responder en este momento. Puedes escribirle a la iglesia por WhatsApp.";
    pensando.remove();
    agregar("asistente", respuesta);
    historial.push({ rol: "asistente", texto: respuesta });
    $("asis-enviar").disabled = false;
    $("asis-texto").focus();
  });
}

/* Menú en celulares */
const botonMenu = $("menu-boton"), menu = $("menu");
botonMenu.addEventListener("click", () => {
  const abierto = menu.classList.toggle("abierto");
  botonMenu.setAttribute("aria-expanded", String(abierto));
});
menu.addEventListener("click", (e) => {
  if (e.target.closest("a")) { menu.classList.remove("abierto"); botonMenu.setAttribute("aria-expanded", "false"); }
});
