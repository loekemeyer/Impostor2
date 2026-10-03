/* ===================================================================
   PÁDEL — Contador por cancha, con tablero táctil y celulares que marcan
   -------------------------------------------------------------------
   Pensado para un predio de 4 canchas. Cada partido es "Cancha N · HH:MM"
   del día: no hay códigos.

   Tablero (celu o tablet de la cancha): elige cancha y hora y abre el
   partido. Tocar la mitad de un equipo = punto para ese equipo. ↺ deshace.
   Celular que marca: 🎾 Pádel → "Marcar desde mi celular" → toca su
   partido en la lista de hoy → elige marcar sólo su equipo (un botón
   gigante) o los dos (un botón gigante por equipo).

   Datos: Supabase "loekemeyer's web", esquema "paddle" (ver
   supabase/paddle.sql). El partido vive en la base, así que cualquier
   celular marca aunque el tablero esté apagado o en otra app; el tablero
   y los demás se enteran al instante por Realtime (y cada 10 s por las
   dudas). Se escribe sólo con las funciones public.paddle_*; cada pedido
   lleva un id para que nunca se aplique dos veces.

   Usa de script.js: pantallas, mostrarPantalla, sonar, mostrarToast,
   copiaFallback. Usa de padel-reglas.js: calcularPadel, textoSet.
   =================================================================== */

(function () {
  "use strict";

  /* Supabase "loekemeyer's web": clave publishable (pública por diseño;
     la tabla sólo se puede leer, y escribir únicamente con las funciones). */
  const SUPA_URL = "https://kwkclwhmoygunqmlegrg.supabase.co";
  const SUPA_KEY = "sb_publishable_mVX5MnjwM770cNjgiL6yLw_LDNl9pML";
  /* Librerías del CDN (versión fija + SRI), cargadas sólo al usar el pádel.
     La clave es el nombre global que deja cada una. */
  const LIBS = {
    supabase: {
      src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
      sri: "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok"
    },
    qrcode: {
      src: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",
      sri: "sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k"
    }
  };
  const CANCHAS       = 4;
  const CLAVE_PARTIDO = "padel-tablero";   // localStorage: último partido abierto como tablero
  const CLAVE_PREFS   = "padel-config";    // localStorage: última cancha y nombres
  const ESPERA_MS     = 8000;              // sin respuesta de la base en este tiempo: avisa
  const REFRESCO_MS   = 10000;             // relectura del partido por si se perdió un aviso

  pantallas.padelConfig = document.getElementById("screen-padel-config");
  pantallas.padel       = document.getElementById("screen-padel");
  pantallas.padelLinks  = document.getElementById("screen-padel-links");
  pantallas.padelRemote = document.getElementById("screen-padel-remote");
  pantallas.padelJoin   = document.getElementById("screen-padel-join");

  const el = (id) => document.getElementById(id);
  const EQUIPOS = ["a", "b"];
  const OPCIONES = ["a", "b", "ambos"];   // qué marca un celular

  /* ---------- Estado ---------- */
  const P = {
    rol: null,              // "tablero" | "control" | null (fuera del pádel)
    partido: null,          // fila de paddle.partidos (id, cancha, hora, nombres, puntos, version…)
    equipo: null,           // (control) "a" | "b" | "ambos"
    cancha: 1,              // (config) cancha elegida
    hora: "17:00",          // (config) hora elegida
    elegido: null,          // (unirme) partido tocado en la lista, antes de elegir equipo
    lista: [],              // (unirme) partidos abiertos hoy
    client: null,
    canal: null,
    enVivo: false,          // Realtime suscripto
    controles: { a: 0, b: 0 },
    enviando: null,         // (control) { tipo, equipo } mientras espera la base
    refresco: null,
    wakeLock: null
  };

  const nombre = (e) => {
    const n = P.partido && (e === "a" ? P.partido.nombre_a : P.partido.nombre_b);
    return n || (e === "a" ? "Equipo A" : "Equipo B");
  };
  const titulo = (p) => `Cancha ${p.cancha} · ${p.hora}`;
  const base = () => location.href.split(/[?#]/)[0];
  const linkControl = (e) => `${base()}?partido=${P.partido.id}&equipo=${e}`;
  const dos = (n) => String(n).padStart(2, "0");

  /* ===================================================================
     Utilidades
     =================================================================== */
  function leerLS(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
  }
  function guardarLS(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  /** Id corto para cada pedido (la base no aplica dos veces el mismo). */
  function nuevoId() {
    const abc = "abcdefghijkmnpqrstuvwxyz23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => abc[n % abc.length]).join("");
  }

  /** Fecha de hoy en este celular ("2026-10-03"). */
  function hoy() {
    const d = new Date();
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  }
  /** Hora actual redondeada para abajo a la media hora ("17:30"). */
  function horaActual() {
    const d = new Date();
    return `${dos(d.getHours())}:${d.getMinutes() < 30 ? "00" : "30"}`;
  }
  function moverHora(hora, pasos) {
    const [h, m] = hora.split(":").map(Number);
    const total = Math.min(23 * 60 + 30, Math.max(0, h * 60 + m + pasos * 30));
    return `${dos(Math.floor(total / 60))}:${dos(total % 60)}`;
  }

  function cambiarUrl(query) {
    try { history.replaceState(null, "", base() + query); } catch (e) { /* file:// */ }
  }

  /** Carga una librería del CDN una sola vez (con SRI) y devuelve su global. */
  const cargas = {};
  function cargarLib(nombreGlobal) {
    if (window[nombreGlobal]) return Promise.resolve(window[nombreGlobal]);
    if (!cargas[nombreGlobal]) {
      cargas[nombreGlobal] = new Promise((ok, mal) => {
        const s = document.createElement("script");
        s.src = LIBS[nombreGlobal].src;
        s.integrity = LIBS[nombreGlobal].sri;
        s.crossOrigin = "anonymous";
        s.onload = () => (window[nombreGlobal] ? ok(window[nombreGlobal]) : mal(new Error(nombreGlobal)));
        s.onerror = () => { delete cargas[nombreGlobal]; s.remove(); mal(new Error(nombreGlobal)); };
        document.head.appendChild(s);
      });
    }
    return cargas[nombreGlobal];
  }

  /** Muestra una pantalla sin animación (al abrir la app desde un link). */
  function mostrarDirecto(nombrePantalla) {
    document.querySelectorAll(".screen.is-active").forEach((s) => s.classList.remove("is-active"));
    pantallas[nombrePantalla].classList.add("is-active");
  }

  /** Reinicia una animación CSS de "flash" sobre un elemento. */
  function flash(elemento) {
    elemento.classList.remove("is-flash");
    void elemento.offsetWidth;
    elemento.classList.add("is-flash");
  }

  /** Etiqueta del momento: fin del partido, fin de set, tie-break, iguales, ventaja. */
  function etiqueta(r) {
    if (r.terminado) return r.ganador === "empate" ? "Empate" : `¡Ganó ${nombre(r.ganador)}!`;
    if (r.finDeSet) return `Set para ${nombre(r.sets[r.sets.length - 1].g)}`;
    if (r.tb) return "Tie-break";
    if (r.iguales) return "Iguales";
    if (r.ventaja) return `Ventaja ${nombre(r.ventaja)}`;
    return "";
  }

  /* Wake lock: que la pantalla del tablero no se apague durante el partido */
  async function pedirWakeLock() {
    try {
      if ("wakeLock" in navigator && !document.hidden) P.wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) { /* no soportado o sin permiso */ }
  }
  function soltarWakeLock() {
    try { if (P.wakeLock) P.wakeLock.release(); } catch (e) { /* ya liberado */ }
    P.wakeLock = null;
  }

  /* ===================================================================
     Base de datos (Supabase)
     =================================================================== */
  async function cliente() {
    if (!P.client) {
      const lib = await cargarLib("supabase");
      P.client = lib.createClient(SUPA_URL, SUPA_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }
    return P.client;
  }

  /** Llama a una función public.paddle_* con tiempo límite. Lanza error si falla. */
  async function rpc(funcion, args) {
    const c = await cliente();
    const corte = new AbortController();
    const timer = setTimeout(() => corte.abort(), ESPERA_MS);
    try {
      const { data, error } = await c.rpc(funcion, args).abortSignal(corte.signal);
      if (error) throw new Error(error.message);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Toma la versión más nueva del partido y redibuja. */
  function aplicar(fila) {
    if (!fila || !fila.id) return;
    if (P.partido && P.partido.id === fila.id && fila.version < P.partido.version) return;   // aviso viejo
    P.partido = fila;
    if (P.rol === "tablero") renderTablero();
    if (P.rol === "control") renderControl();
  }

  async function refrescar() {
    if (!P.partido) return;
    try {
      aplicar(await rpc("paddle_estado", { p_id: P.partido.id }));
    } catch (e) { /* sin red: lo intenta el próximo refresco */ }
  }

  /** Avisos en vivo del partido (cambios de la base) + quién está marcando (presence). */
  async function suscribir() {
    desuscribir();
    const id = P.partido.id;
    let c;
    try { c = await cliente(); } catch (e) { actualizarConexion(); return; }
    if (!P.partido || P.partido.id !== id) return;

    const canal = c.channel(`paddle-${id}`, { config: { presence: { key: `${P.rol}-${nuevoId()}` } } });
    canal
      .on("postgres_changes", { event: "UPDATE", schema: "paddle", table: "partidos", filter: `id=eq.${id}` },
        (m) => aplicar(m.new))
      .on("presence", { event: "sync" }, () => contarControles(canal.presenceState()))
      .on("system", {}, (m) => {
        // los avisos de la base arrancan recién acá: se relee por si algo cambió en el medio
        if (m && m.extension === "postgres_changes" && m.status === "ok") refrescar();
      });
    P.canal = canal;
    canal.subscribe(async (status) => {
      if (P.canal !== canal) return;
      P.enVivo = status === "SUBSCRIBED";
      if (P.enVivo) {
        try { await canal.track({ rol: P.rol, equipo: P.equipo }); } catch (e) { /* reintenta solo */ }
        refrescar();
      }
      actualizarConexion();
    });

    clearInterval(P.refresco);
    P.refresco = setInterval(() => { if (!document.hidden) refrescar(); }, REFRESCO_MS);
  }

  function desuscribir() {
    clearInterval(P.refresco);
    if (P.canal && P.client) P.client.removeChannel(P.canal);
    P.canal = null;
    P.enVivo = false;
    P.controles = { a: 0, b: 0 };
  }

  function contarControles(estadoPresencia) {
    const metas = Object.values(estadoPresencia).flat().filter((m) => m.rol === "control");
    P.controles = {
      a: metas.filter((m) => m.equipo === "a" || m.equipo === "ambos").length,
      b: metas.filter((m) => m.equipo === "b" || m.equipo === "ambos").length
    };
    actualizarConexion();
  }

  /** Muestra el estado de la conexión en la pantalla que esté activa. */
  function actualizarConexion() {
    if (P.rol === "tablero") {
      // "Cancha 1 · 17:00 ● ●": un punto por equipo, con su color si hay un celular marcando
      const c = el("padel-conexion");
      c.textContent = P.enVivo ? titulo(P.partido) + " " : "📡 reconectando… ";
      if (P.enVivo && (P.controles.a + P.controles.b) > 0) {
        EQUIPOS.forEach((e) => {
          const punto = document.createElement("i");
          punto.className = `padel-dot team-${e}` + (P.controles[e] ? " is-on" : "");
          punto.title = `${nombre(e)}: ${P.controles[e] ? "marcando desde un celular" : "sin celular"}`;
          c.appendChild(punto);
        });
      }
      c.classList.toggle("is-ok", P.enVivo);
    } else if (P.rol === "control") {
      renderControl();
    }
  }

  /* ===================================================================
     Configuración del tablero: cancha + hora + equipos
     =================================================================== */
  function abrirConfig() {
    const prefs = leerLS(CLAVE_PREFS) || {};
    P.cancha = prefs.cancha >= 1 && prefs.cancha <= CANCHAS ? prefs.cancha : 1;
    P.hora = horaActual();
    el("padel-nombre-a").value = "";
    el("padel-nombre-b").value = "";
    el("padel-config-aviso").textContent = "";
    renderConfig();
    mostrarPantalla("padelConfig");
  }

  function renderConfig() {
    document.querySelectorAll("[data-cancha]").forEach((b) =>
      b.classList.toggle("is-selected", Number(b.dataset.cancha) === P.cancha));
    el("padel-hora").value = P.hora;

    // el último partido abierto hoy en este celular se ofrece para seguirlo
    const g = leerLS(CLAVE_PARTIDO);
    const btn = el("btn-padel-continuar");
    btn.hidden = !(g && g.id && g.fecha === hoy());
    if (!btn.hidden) btn.textContent = `Continuar ${titulo(g)}`;
  }

  async function abrirTablero() {
    const btn = el("btn-padel-empezar");
    btn.disabled = true;
    el("padel-config-aviso").textContent = "";
    try {
      const fila = await rpc("paddle_abrir", {
        p_fecha: hoy(),
        p_cancha: P.cancha,
        p_hora: P.hora,
        p_nombre_a: el("padel-nombre-a").value.trim().slice(0, 18),
        p_nombre_b: el("padel-nombre-b").value.trim().slice(0, 18)
      });
      guardarLS(CLAVE_PREFS, { cancha: P.cancha });
      iniciarTablero(fila);
    } catch (e) {
      el("padel-config-aviso").textContent = "No se pudo abrir el partido: revisá la conexión a internet.";
    } finally {
      btn.disabled = false;
    }
  }

  async function continuarTablero() {
    const g = leerLS(CLAVE_PARTIDO);
    if (!g) return;
    try {
      const fila = await rpc("paddle_estado", { p_id: g.id });
      if (fila && fila.id) iniciarTablero(fila);
    } catch (e) {
      el("padel-config-aviso").textContent = "No se pudo abrir el partido: revisá la conexión a internet.";
    }
  }

  /* ===================================================================
     Tablero
     =================================================================== */
  function iniciarTablero(fila, directo) {
    P.rol = "tablero";
    P.equipo = null;
    P.partido = fila;
    guardarLS(CLAVE_PARTIDO, { id: fila.id, fecha: fila.fecha, cancha: fila.cancha, hora: fila.hora });
    cambiarUrl(`?tablero=${fila.id}`);
    renderTablero();
    if (directo) mostrarDirecto("padel");
    else mostrarPantalla("padel");
    pedirWakeLock();
    suscribir();
  }

  /** Cambio desde el tablero: llama a la base y muestra el resultado (o avisa si no hay red). */
  async function cambio(funcion, args, sonido) {
    try {
      aplicar(await rpc(funcion, { p_id: P.partido.id, ...args }));
      if (sonido) sonar(sonido);
    } catch (e) {
      mostrarToast("Sin conexión: no se guardó");
      refrescar();
    }
  }

  function sumarPunto(e) {
    if (calcularPadel(P.partido.puntos).terminado) return;
    flash(el(`padel-half-${e}`));
    cambio("paddle_punto", { p_equipo: e, p_eid: nuevoId() }, "normal");
  }
  const deshacer = () => cambio("paddle_deshacer", { p_permitidos: "abf", p_eid: nuevoId() }, "click");
  const seguirJugando = () => cambio("paddle_seguir", { p_sets: calcularPadel(P.partido.puntos).sets.length }, "click");
  const terminarPartido = () => cambio("paddle_terminar", {}, "normal");
  const nuevoPartido = () => cambio("paddle_reiniciar", {}, "click");

  function salirTablero() {
    desuscribir();
    soltarWakeLock();
    P.rol = null;
    cambiarUrl("");
    renderConfig();
    mostrarPantalla("padelConfig");
    sonar("click");
  }

  function renderTablero() {
    const p = P.partido;
    const r = calcularPadel(p.puntos);
    EQUIPOS.forEach((e) => {
      el(`padel-name-${e}`).textContent = nombre(e);
      el(`padel-pts-${e}`).textContent = r.terminado ? (r.ganador === e ? "🏆" : "") : r.display[e];
      el(`padel-games-${e}`).textContent = r.games[e];
      el(`padel-sets-${e}`).textContent = r.setsGanados[e];
    });

    // historial: sets terminados + el set en curso resaltado
    const hist = el("padel-historial");
    hist.textContent = "";
    r.sets.forEach((s) => {
      const span = document.createElement("span");
      span.textContent = textoSet(s);
      hist.appendChild(span);
    });
    if (!r.terminado && !r.finDeSet) {
      const actual = document.createElement("b");
      actual.textContent = `${r.games.a}-${r.games.b}`;
      hist.appendChild(actual);
    }

    el("padel-etiqueta").textContent = etiqueta(r);
    el("padel-deshacer").disabled = !p.puntos;

    // cartel: al cerrar un set (¿seguir o terminar?) y al terminar el partido
    const pausa = r.finDeSet && p.set_descartado !== r.sets.length;
    el("padel-fin").hidden = !(pausa || r.terminado);
    if (pausa || r.terminado) {
      el("padel-fin-emoji").textContent = !r.terminado ? "🎾" : r.ganador === "empate" ? "🤝" : "🏆";
      el("padel-fin-titulo").textContent = etiqueta(r);
      el("padel-fin-sets").textContent = r.sets.map(textoSet).join("  ·  ");
      el("padel-fin-total").textContent = r.sets.length
        ? `Sets: ${nombre("a")} ${r.setsGanados.a} – ${r.setsGanados.b} ${nombre("b")}`
        : "";
      el("btn-padel-seguir").hidden = r.terminado;
      el("btn-padel-terminar").hidden = r.terminado;
      el("btn-padel-nuevo").hidden = !r.terminado;
    }
    actualizarConexion();
  }

  /* ---------- Conectar celulares: cancha + hora y QR por equipo ---------- */
  async function abrirLinks() {
    el("padel-codigo").textContent = titulo(P.partido);
    EQUIPOS.forEach((e) => { el(`padel-qr-name-${e}`).textContent = nombre(e); });
    el("padel-links-aviso").textContent = "";
    mostrarPantalla("padelLinks");
    sonar("click");

    try {
      const qrcode = await cargarLib("qrcode");
      EQUIPOS.forEach((e) => {
        const qr = qrcode(0, "M");
        qr.addData(linkControl(e));
        qr.make();
        el(`padel-qr-${e}`).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
      });
    } catch (err) {
      EQUIPOS.forEach((e) => { el(`padel-qr-${e}`).textContent = "Sin QR (sin internet). Usá «Enviar link»."; });
    }
  }

  async function enviarLink(e) {
    const url = linkControl(e);
    if (navigator.share) {
      try {
        await navigator.share({ title: "Pádel", text: `${titulo(P.partido)} · marcá los puntos de ${nombre(e)}:`, url });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;   // cerró el menú de compartir
      }
    }
    const ok = () => mostrarToast(`Link de ${nombre(e)} copiado`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(() => copiaFallback(url, ok));
    } else {
      copiaFallback(url, ok);
    }
  }

  /* ===================================================================
     Marcar desde mi celular: elegir partido de hoy y qué equipo marcar
     =================================================================== */
  function abrirUnirme() {
    salirDeControl();
    P.elegido = null;
    P.lista = [];
    renderUnirme("Buscando los partidos de hoy…");
    mostrarPantalla("padelJoin");
    sonar("click");
    cargarLista();
  }

  async function cargarLista() {
    try {
      const filas = await rpc("paddle_partidos", { p_fecha: hoy() });
      P.lista = (filas || []).filter((f) => !calcularPadel(f.puntos).terminado);
      renderUnirme(P.lista.length ? "" : "Todavía no hay partidos abiertos hoy. Abrí el tablero en la cancha y tocá Actualizar.");
    } catch (e) {
      renderUnirme("Sin conexión a internet. Tocá Actualizar para reintentar.", true);
    }
  }

  function renderUnirme(mensaje, error) {
    const lista = el("padel-lista");
    lista.textContent = "";
    if (!P.elegido) {
      P.lista.forEach((f) => {
        const r = calcularPadel(f.puntos);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "padel-partido-btn";
        const t = document.createElement("b");
        t.textContent = titulo(f);
        const d = document.createElement("span");
        const marcador = r.sets.map(textoSet).concat(`${r.games.a}-${r.games.b}`).join(" · ");
        d.textContent = `${f.nombre_a || "Equipo A"} vs ${f.nombre_b || "Equipo B"} · ${marcador}`;
        b.append(t, d);
        b.addEventListener("click", () => elegirPartido(f));
        lista.appendChild(b);
      });
    }
    const estado = el("padel-join-estado");
    estado.textContent = P.elegido ? "" : (mensaje || "");
    estado.className = "padel-join-estado" + (error ? " is-bad" : "");

    el("padel-join-equipos").hidden = !P.elegido;
    el("padel-join-sub").textContent = P.elegido ? "¿Qué vas a marcar?" : "Elegí tu partido";
    el("btn-padel-actualizar").hidden = !!P.elegido;
    if (P.elegido) {
      el("padel-elegido").textContent = titulo(P.elegido);
      el("padel-unir-a").textContent = `Sólo ${P.elegido.nombre_a || "Equipo A"}`;
      el("padel-unir-b").textContent = `Sólo ${P.elegido.nombre_b || "Equipo B"}`;
    }
  }

  function elegirPartido(fila) {
    P.elegido = fila;
    renderUnirme();
    sonar("click");
  }

  function volverDeUnirme() {
    if (P.elegido) {
      // del paso 2 vuelve a la lista
      P.elegido = null;
      renderUnirme();
      cargarLista();
    } else {
      salirDeControl();   // si venía de "Cambiar", deja de marcar ese partido
      mostrarPantalla("padelConfig");
    }
    sonar("click");
  }

  /** Elegido qué marca ("a", "b" o "ambos"), pasa a la pantalla de marcar (queda en la URL por si recarga). */
  function elegirEquipo(e) {
    iniciarControl(P.elegido, e);
    mostrarPantalla("padelRemote");
    sonar("click");
  }

  /* ===================================================================
     Control (celular que marca)
     =================================================================== */
  function iniciarControl(fila, equipo) {
    const mismo = P.rol === "control" && P.partido && P.partido.id === fila.id && P.canal;
    P.rol = "control";
    P.partido = fila;
    P.equipo = equipo;
    P.enviando = null;
    cambiarUrl(`?partido=${fila.id}&equipo=${equipo}`);
    renderControl();
    if (mismo) {
      // sólo cambió qué marca: se avisa sin reconectar
      P.canal.track({ rol: "control", equipo }).catch(() => {});
    } else {
      suscribir();
    }
  }

  /** "Cambiar": vuelve a elegir qué marca en el mismo partido, sin desconectarse. */
  function cambiarEquipo() {
    P.elegido = P.partido;
    renderUnirme();
    mostrarPantalla("padelJoin");
    sonar("click");
  }

  async function controlEnviar(tipo, equipo) {
    if (P.enviando || !P.partido) return;
    P.enviando = { tipo, equipo };
    if (navigator.vibrate) navigator.vibrate(30);
    sonar("click");
    renderControl();
    const args = tipo === "punto"
      ? { p_equipo: equipo, p_eid: nuevoId() }
      : { p_permitidos: P.equipo === "ambos" ? "ab" : P.equipo, p_eid: nuevoId() };
    try {
      const fila = await rpc(tipo === "punto" ? "paddle_punto" : "paddle_deshacer", { p_id: P.partido.id, ...args });
      P.enviando = null;
      aplicar(fila);
      if (tipo === "punto") {
        flash(el(`padel-remote-punto-${equipo}`));
        sonar("normal");
      } else {
        mostrarToast("Punto deshecho");
      }
    } catch (e) {
      P.enviando = null;
      mostrarToast("Sin conexión: no se marcó. Probá de nuevo.");
      refrescar();
    }
    renderControl();
  }

  /** Corta la conexión de un control (sin cambiar de pantalla). */
  function salirDeControl() {
    if (P.rol !== "control") return;
    desuscribir();
    P.rol = null;
    P.equipo = null;
    P.enviando = null;
    cambiarUrl("");
  }

  function salirControl() {
    salirDeControl();
    mostrarPantalla("config");
    sonar("click");
  }

  function renderControl() {
    if (!P.partido) return;
    const r = calcularPadel(P.partido.puntos);

    EQUIPOS.forEach((e) => {
      el(`padel-mini-${e}`).classList.toggle("is-mine", e === P.equipo);
      el(`padel-mini-name-${e}`).textContent = nombre(e);
      el(`padel-mini-sets-${e}`).textContent = r.sets.map((s) => s[e]).join(" ");
      el(`padel-mini-games-${e}`).textContent = r.terminado ? "" : r.games[e];
      el(`padel-mini-pts-${e}`).textContent = r.terminado ? (r.ganador === e ? "🏆" : "") : r.display[e];
    });
    el("padel-remote-etiqueta").textContent = etiqueta(r);

    const estadoEl = el("padel-remote-estado");
    estadoEl.textContent = (P.enVivo ? "● " : "○ ") + titulo(P.partido);
    estadoEl.classList.toggle("is-ok", P.enVivo);
    estadoEl.title = P.enVivo ? "Conectado" : "Reconectando…";

    // un botón gigante por equipo que este celular marca
    const ambos = P.equipo === "ambos";
    EQUIPOS.forEach((e) => {
      const boton = el(`padel-remote-punto-${e}`);
      const enviando = !!P.enviando && P.enviando.tipo === "punto" && P.enviando.equipo === e;
      boton.hidden = !ambos && P.equipo !== e;
      boton.disabled = r.terminado;
      boton.classList.toggle("is-sending", enviando);
      boton.querySelector(".padel-boton-txt").textContent = enviando ? "Marcando…" : "Punto para";
      el(`padel-remote-equipo-${e}`).textContent = nombre(e);
    });

    const puedeDeshacer = ambos ? EQUIPOS.includes(r.ultimo) : r.ultimo === P.equipo;
    const btnDeshacer = el("padel-remote-deshacer");
    btnDeshacer.textContent = ambos ? "↺ Deshacer último punto" : "↺ Deshacer mi punto";
    btnDeshacer.disabled = !!P.enviando || !puedeDeshacer;
  }

  /* ===================================================================
     Eventos
     =================================================================== */
  el("btn-open-padel").addEventListener("click", () => { abrirConfig(); sonar("click"); });

  document.querySelectorAll("[data-cancha]").forEach((b) => b.addEventListener("click", () => {
    P.cancha = Number(b.dataset.cancha);
    renderConfig();
    sonar("click");
  }));
  el("padel-hora-menos").addEventListener("click", () => { P.hora = moverHora(P.hora, -1); renderConfig(); sonar("click"); });
  el("padel-hora-mas").addEventListener("click", () => { P.hora = moverHora(P.hora, 1); renderConfig(); sonar("click"); });
  el("btn-padel-empezar").addEventListener("click", abrirTablero);
  el("btn-padel-continuar").addEventListener("click", continuarTablero);
  el("btn-padel-volver").addEventListener("click", () => { mostrarPantalla("config"); sonar("click"); });
  el("btn-padel-unirme").addEventListener("click", abrirUnirme);

  el("btn-padel-actualizar").addEventListener("click", () => { renderUnirme("Buscando…"); cargarLista(); sonar("click"); });
  OPCIONES.forEach((e) => el(`padel-unir-${e}`).addEventListener("click", () => elegirEquipo(e)));
  el("btn-padel-join-volver").addEventListener("click", volverDeUnirme);

  EQUIPOS.forEach((e) => el(`padel-half-${e}`).addEventListener("click", () => sumarPunto(e)));
  el("padel-deshacer").addEventListener("click", deshacer);
  el("btn-padel-fin-deshacer").addEventListener("click", deshacer);
  el("btn-padel-nuevo").addEventListener("click", nuevoPartido);
  el("btn-padel-seguir").addEventListener("click", seguirJugando);
  el("btn-padel-terminar").addEventListener("click", terminarPartido);
  el("padel-salir").addEventListener("click", salirTablero);
  el("padel-links").addEventListener("click", abrirLinks);
  el("btn-padel-links-volver").addEventListener("click", () => { mostrarPantalla("padel"); sonar("click"); });
  document.querySelectorAll(".padel-share").forEach((b) =>
    b.addEventListener("click", () => enviarLink(b.dataset.equipo)));

  EQUIPOS.forEach((e) => el(`padel-remote-punto-${e}`).addEventListener("click", () => controlEnviar("punto", e)));
  el("padel-remote-deshacer").addEventListener("click", () => controlEnviar("deshacer"));
  el("padel-remote-cambiar").addEventListener("click", cambiarEquipo);
  el("padel-remote-salir").addEventListener("click", salirControl);

  /* Al volver de la pantalla bloqueada / otra app: se relee el partido y,
     si el aviso en vivo se cortó, se vuelve a suscribir. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !P.rol || !P.partido) return;
    if (P.rol === "tablero") pedirWakeLock();
    if (!P.enVivo) suscribir();
    else refrescar();
  });

  /* ---------- Arranque: ¿se abrió desde un link o se recargó el tablero? ---------- */
  const params = new URLSearchParams(location.search);
  const uuid = /^[0-9a-f-]{36}$/i;
  const idPartido = params.get("partido");
  const equipo = params.get("equipo");
  const idTablero = params.get("tablero");

  async function arrancarDesdeLink(id, alAbrir) {
    try {
      const fila = await rpc("paddle_estado", { p_id: id });
      if (fila && fila.id) return alAbrir(fila);
    } catch (e) { /* sin red */ }
    cambiarUrl("");
    mostrarToast("No se encontró el partido");
  }

  if (idPartido && uuid.test(idPartido) && OPCIONES.includes(equipo)) {
    arrancarDesdeLink(idPartido, (fila) => { iniciarControl(fila, equipo); mostrarDirecto("padelRemote"); });
  } else if (idTablero && uuid.test(idTablero)) {
    arrancarDesdeLink(idTablero, (fila) => iniciarTablero(fila, true));
  } else if (params.has("padel") || params.has("tablero")) {
    cambiarUrl("");   // links viejos (con código)
  }
})();
