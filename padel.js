/* ===================================================================
   PÁDEL — Contador con tablero táctil y control desde otros celulares
   -------------------------------------------------------------------
   Tablero (este celu): tocar la mitad de un equipo = punto para ese
   equipo. ↺ deshace. 🔗 muestra un link (y un QR) por equipo.
   Control (el celu que abre el link): un botón grande que suma punto
   para SU equipo y "deshacer mi último punto".

   Sincronización: Supabase Realtime (broadcast + presence) en el canal
   "padel-<id>". No se guarda nada en la base de datos: el tablero es el
   dueño del partido (lo guarda en localStorage) y después de cada cambio
   manda el estado completo a los controles.
     control → tablero:   "punto" {equipo, eid} · "deshacer" {equipo, eid} · "pedir"
     tablero → controles: "estado" {nombres, puntos, ack}
   "eid" identifica cada pedido: el tablero no lo aplica dos veces y lo
   devuelve en "ack" para que el control sepa que llegó.

   Usa de script.js: pantallas, mostrarPantalla, sonar, mostrarToast,
   copiaFallback. Usa de padel-reglas.js: calcularPadel, textoSet.
   =================================================================== */

(function () {
  "use strict";

  /* Supabase "loekemeyer's web": clave publishable (pública por diseño;
     no da acceso a datos, sólo a los canales de broadcast). */
  const SUPA_URL = "https://kwkclwhmoygunqmlegrg.supabase.co";
  const SUPA_KEY = "sb_publishable_mVX5MnjwM770cNjgiL6yLw_LDNl9pML";
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
  const CLAVE_PARTIDO = "padel-partido";   // localStorage: partido en curso (tablero)
  const CLAVE_PREFS   = "padel-config";    // localStorage: últimos nombres y reglas
  const ESPERA_MS     = 4000;              // sin "ack" en este tiempo, el punto no llegó

  pantallas.padelConfig = document.getElementById("screen-padel-config");
  pantallas.padel       = document.getElementById("screen-padel");
  pantallas.padelLinks  = document.getElementById("screen-padel-links");
  pantallas.padelRemote = document.getElementById("screen-padel-remote");

  const el = (id) => document.getElementById(id);
  const EQUIPOS = ["a", "b"];

  /* ---------- Estado ---------- */
  const P = {
    rol: null,              // "tablero" | "control" | null (fuera del pádel)
    id: null,               // id de la sala (va en los links)
    equipo: null,           // (control) "a" | "b"
    nombres: { a: "", b: "" },
    puntos: "",             // "abba…f" — fuente única del marcador (ver padel-reglas.js)
    setDescartado: 0,       // (tablero) sets ya cerrados en los que tocaron "Seguir jugando"
    procesados: [],         // (tablero) eids ya aplicados
    recibido: false,        // (control) ya llegó al menos un estado del tablero
    // conexión
    client: null,
    canal: null,
    conexion: "off",        // "off" | "conectando" | "ok" | "error"
    tableroOnline: false,
    controles: { a: 0, b: 0 },
    pendiente: null,        // (control) { eid, tipo } esperando ack
    pendienteTimer: null,
    wakeLock: null,
    ocultoDesde: 0
  };

  const nombre = (e) => P.nombres[e] || (e === "a" ? "Equipo A" : "Equipo B");
  const base = () => location.href.split(/[?#]/)[0];
  const linkControl = (e) => `${base()}?padel=${P.id}&equipo=${e}`;

  /* ===================================================================
     Utilidades
     =================================================================== */
  function leerLS(clave) {
    try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
  }
  function guardarLS(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  /** Id corto y difícil de adivinar (sin 0/o/1/l para dictarlo sin errores). */
  function nuevoId() {
    const abc = "abcdefghijkmnpqrstuvwxyz23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => abc[n % abc.length]).join("");
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
     Conexión (Supabase Realtime)
     =================================================================== */
  async function conectarSala() {
    desconectarSala();
    P.conexion = "conectando";
    actualizarConexion();

    let lib;
    try {
      lib = await cargarLib("supabase");
    } catch (e) {
      P.conexion = "error";
      actualizarConexion();
      return;
    }
    if (!P.rol) return;   // salió mientras cargaba

    if (!P.client) {
      P.client = lib.createClient(SUPA_URL, SUPA_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }

    const canal = P.client.channel(`padel-${P.id}`, {
      config: { broadcast: { self: false }, presence: { key: `${P.rol}-${nuevoId()}` } }
    });
    canal
      .on("broadcast", { event: "punto" },    (m) => alRecibir("punto", m.payload || {}))
      .on("broadcast", { event: "deshacer" }, (m) => alRecibir("deshacer", m.payload || {}))
      .on("broadcast", { event: "pedir" },    (m) => alRecibir("pedir", m.payload || {}))
      .on("broadcast", { event: "estado" },   (m) => alRecibir("estado", m.payload || {}))
      .on("presence",  { event: "sync" },     () => alPresencia(canal.presenceState()));

    P.canal = canal;
    canal.subscribe(async (status) => {
      if (P.canal !== canal) return;   // canal viejo (hubo reconexión)
      if (status === "SUBSCRIBED") {
        P.conexion = "ok";
        try { await canal.track({ rol: P.rol, equipo: P.equipo }); } catch (e) { /* reintenta solo */ }
        if (P.rol === "tablero") difundir();
        else enviar("pedir", {});
      } else {
        P.conexion = status === "CLOSED" ? "conectando" : "error";
      }
      actualizarConexion();
    });
  }

  function desconectarSala() {
    if (P.canal && P.client) P.client.removeChannel(P.canal);
    P.canal = null;
    P.conexion = "off";
    P.tableroOnline = false;
    P.controles = { a: 0, b: 0 };
  }

  function enviar(evento, payload) {
    if (!P.canal || P.conexion !== "ok") return false;
    P.canal.send({ type: "broadcast", event: evento, payload });
    return true;
  }

  /** (tablero) Manda el partido completo a todos los controles. */
  function difundir(ack) {
    enviar("estado", { nombres: P.nombres, puntos: P.puntos, ack: ack || null });
  }

  function alPresencia(estadoPresencia) {
    const metas = Object.values(estadoPresencia).flat();
    P.tableroOnline = metas.some((m) => m.rol === "tablero");
    P.controles = {
      a: metas.filter((m) => m.rol === "control" && m.equipo === "a").length,
      b: metas.filter((m) => m.rol === "control" && m.equipo === "b").length
    };
    actualizarConexion();
  }

  function alRecibir(evento, datos) {
    if (P.rol === "tablero") {
      if (evento === "pedir") return difundir();
      if (evento !== "punto" && evento !== "deshacer") return;
      if (!EQUIPOS.includes(datos.equipo) || typeof datos.eid !== "string") return;
      if (P.procesados.includes(datos.eid)) return difundir(datos.eid);   // repetido
      P.procesados = P.procesados.concat(datos.eid).slice(-40);
      if (evento === "punto") sumarPunto(datos.equipo, datos.eid);
      else deshacer(datos.equipo, datos.eid);
      return;
    }
    if (P.rol === "control" && evento === "estado") {
      if (datos.nombres) P.nombres = datos.nombres;
      P.puntos = typeof datos.puntos === "string" ? datos.puntos : "";
      P.recibido = true;
      if (P.pendiente && datos.ack === P.pendiente.eid) confirmarPendiente();
      renderControl();
    }
  }

  /** Muestra el estado de la conexión en la pantalla que esté activa. */
  function actualizarConexion() {
    if (P.rol === "tablero") {
      // "📡 ● ●": un punto por equipo, con su color si su control está conectado
      const c = el("padel-conexion");
      const hayControles = P.conexion === "ok" && (P.controles.a + P.controles.b) > 0;
      c.textContent = "📡 ";
      if (P.conexion === "error") c.append("sin conexión");
      else if (P.conexion !== "ok") c.append("conectando…");
      else if (!hayControles) c.append("sin controles");
      else EQUIPOS.forEach((e) => {
        const punto = document.createElement("i");
        punto.className = `padel-dot team-${e}` + (P.controles[e] ? " is-on" : "");
        punto.title = `${nombre(e)}: ${P.controles[e] ? "conectado" : "sin control"}`;
        c.appendChild(punto);
      });
      el("padel-links-aviso").textContent = P.conexion === "ok"
        ? ""
        : "El tablero no está conectado: los links van a andar cuando se conecte.";
    } else if (P.rol === "control") {
      renderControl();
    }
  }

  /* ===================================================================
     Configuración del partido
     =================================================================== */
  function abrirConfig() {
    const prefs = leerLS(CLAVE_PREFS);
    if (prefs && prefs.nombres) P.nombres = prefs.nombres;
    el("padel-nombre-a").value = P.nombres.a || "";
    el("padel-nombre-b").value = P.nombres.b || "";
    renderConfig();
    mostrarPantalla("padelConfig");
  }

  function renderConfig() {
    // si quedó un partido sin terminar, se ofrece seguirlo
    const g = leerLS(CLAVE_PARTIDO);
    const btn = el("btn-padel-continuar");
    const r = g && typeof g.puntos === "string" && g.puntos ? calcularPadel(g.puntos) : null;
    btn.hidden = !r || r.terminado;
    if (r && !r.terminado) {
      const marcador = r.sets.map(textoSet).concat(`${r.games.a}-${r.games.b}`).join(" · ");
      btn.textContent = `Continuar partido (${marcador})`;
    }
  }

  function leerNombres() {
    P.nombres = {
      a: el("padel-nombre-a").value.trim().slice(0, 18),
      b: el("padel-nombre-b").value.trim().slice(0, 18)
    };
  }

  function empezarPartido() {
    leerNombres();
    guardarLS(CLAVE_PREFS, { nombres: P.nombres });
    P.id = nuevoId();
    P.puntos = "";
    P.procesados = [];
    P.setDescartado = 0;
    guardarPartido();
    iniciarTablero();
  }

  function continuarPartido() {
    const g = leerLS(CLAVE_PARTIDO);
    if (!g) return;
    cargarPartido(g);
    iniciarTablero();
  }

  function cargarPartido(g) {
    P.id = g.id;
    P.nombres = g.nombres || { a: "", b: "" };
    P.puntos = g.puntos || "";
    P.procesados = g.procesados || [];
    P.setDescartado = g.setDescartado || 0;
  }

  function guardarPartido() {
    guardarLS(CLAVE_PARTIDO, {
      id: P.id, nombres: P.nombres, puntos: P.puntos, procesados: P.procesados, setDescartado: P.setDescartado
    });
  }

  /* ===================================================================
     Tablero
     =================================================================== */
  function iniciarTablero(directo) {
    P.rol = "tablero";
    cambiarUrl(`?tablero=${P.id}`);
    renderTablero();
    if (directo) mostrarDirecto("padel");
    else mostrarPantalla("padel");
    pedirWakeLock();
    conectarSala();
  }

  function sumarPunto(e, eid) {
    if (calcularPadel(P.puntos).terminado) return difundir(eid);
    P.puntos += e;
    guardarPartido();
    renderTablero();
    flash(el(`padel-half-${e}`));
    sonar("normal");
    difundir(eid);
  }

  /** Saca el último punto. Si viene de un control, sólo si ese punto era de su equipo. */
  function deshacer(soloEquipo, eid) {
    if (!P.puntos || (soloEquipo && P.puntos.slice(-1) !== soloEquipo)) return difundir(eid);
    P.puntos = P.puntos.slice(0, -1);
    guardarPartido();
    renderTablero();
    sonar("click");
    difundir(eid);
  }

  /** Fin de set: siguen jugando (sólo cierra el cartel; el próximo punto arranca el set). */
  function seguirJugando() {
    P.setDescartado = calcularPadel(P.puntos).sets.length;
    guardarPartido();
    renderTablero();
    sonar("click");
  }

  /** Fin de set: termina el partido ("f" en la lista; se puede deshacer). */
  function terminarPartido() {
    P.puntos += "f";
    guardarPartido();
    renderTablero();
    sonar("normal");
    difundir();
  }

  function nuevoPartido() {
    P.puntos = "";
    P.procesados = [];
    P.setDescartado = 0;
    guardarPartido();
    renderTablero();
    sonar("click");
    difundir();
  }

  function salirTablero() {
    desconectarSala();
    soltarWakeLock();
    P.rol = null;
    cambiarUrl("");
    renderConfig();
    mostrarPantalla("padelConfig");
    sonar("click");
  }

  function renderTablero() {
    const r = calcularPadel(P.puntos);
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
    el("padel-deshacer").disabled = !P.puntos;

    // cartel: al cerrar un set (¿seguir o terminar?) y al terminar el partido
    const pausa = r.finDeSet && P.setDescartado !== r.sets.length;
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

  /* ---------- Links + QR ---------- */
  async function abrirLinks() {
    EQUIPOS.forEach((e) => { el(`padel-qr-name-${e}`).textContent = nombre(e); });
    actualizarConexion();
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
        await navigator.share({ title: "Pádel", text: `Marcá los puntos de ${nombre(e)}:`, url });
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
     Control (celular que abrió el link de un equipo)
     =================================================================== */
  function iniciarControl(id, equipo) {
    P.rol = "control";
    P.id = id;
    P.equipo = equipo;
    P.puntos = "";
    P.recibido = false;
    renderControl();
    mostrarDirecto("padelRemote");
    conectarSala();
  }

  function controlEnviar(tipo) {
    if (P.pendiente) return;
    if (P.conexion !== "ok" || !P.tableroOnline) {
      mostrarToast("El tablero no está conectado");
      return;
    }
    const eid = nuevoId();
    if (!enviar(tipo, { equipo: P.equipo, eid })) return;
    P.pendiente = { eid, tipo };
    if (navigator.vibrate) navigator.vibrate(30);
    sonar("click");
    P.pendienteTimer = setTimeout(() => {
      P.pendiente = null;
      renderControl();
      mostrarToast("No llegó al tablero. Probá de nuevo.");
    }, ESPERA_MS);
    renderControl();
  }

  function confirmarPendiente() {
    clearTimeout(P.pendienteTimer);
    const tipo = P.pendiente.tipo;
    P.pendiente = null;
    if (tipo === "punto") {
      flash(el("padel-remote-punto"));
      sonar("normal");
    } else {
      mostrarToast("Punto deshecho");
    }
  }

  function salirControl() {
    clearTimeout(P.pendienteTimer);
    P.pendiente = null;
    desconectarSala();
    P.rol = null;
    cambiarUrl("");
    mostrarPantalla("config");
    sonar("click");
  }

  function renderControl() {
    const r = calcularPadel(P.puntos);
    const listo = P.conexion === "ok" && P.tableroOnline && P.recibido;

    EQUIPOS.forEach((e) => {
      el(`padel-mini-${e}`).classList.toggle("is-mine", e === P.equipo);
      el(`padel-mini-name-${e}`).textContent = nombre(e);
      el(`padel-mini-sets-${e}`).textContent = r.sets.map((s) => s[e]).join(" ");
      el(`padel-mini-games-${e}`).textContent = r.terminado ? "" : r.games[e];
      el(`padel-mini-pts-${e}`).textContent = r.terminado ? (r.ganador === e ? "🏆" : "") : r.display[e];
    });
    el("padel-remote-etiqueta").textContent = etiqueta(r);

    const estadoEl = el("padel-remote-estado");
    let txt = "Conectando…";
    if (P.conexion === "error") txt = "○ Sin conexión a internet";
    else if (P.conexion === "ok" && !P.tableroOnline) txt = "○ El tablero no está abierto";
    else if (listo) txt = "● Conectado al tablero";
    estadoEl.textContent = txt;
    estadoEl.classList.toggle("is-ok", listo);
    estadoEl.classList.toggle("is-bad", P.conexion === "error" || (P.conexion === "ok" && !P.tableroOnline));

    const boton = el("padel-remote-punto");
    boton.classList.toggle("team-b", P.equipo === "b");
    boton.classList.toggle("is-sending", !!P.pendiente);
    boton.disabled = !listo || r.terminado;
    el("padel-remote-equipo").textContent = nombre(P.equipo);
    boton.querySelector(".padel-boton-mas").textContent = P.pendiente && P.pendiente.tipo === "punto" ? "…" : "+1";

    el("padel-remote-deshacer").disabled = !listo || !!P.pendiente || r.ultimo !== P.equipo;
  }

  /* ===================================================================
     Eventos
     =================================================================== */
  el("btn-open-padel").addEventListener("click", () => { abrirConfig(); sonar("click"); });

  el("btn-padel-empezar").addEventListener("click", empezarPartido);
  el("btn-padel-continuar").addEventListener("click", continuarPartido);
  el("btn-padel-volver").addEventListener("click", () => { mostrarPantalla("config"); sonar("click"); });

  EQUIPOS.forEach((e) => el(`padel-half-${e}`).addEventListener("click", () => sumarPunto(e)));
  el("padel-deshacer").addEventListener("click", () => deshacer());
  el("btn-padel-fin-deshacer").addEventListener("click", () => deshacer());
  el("btn-padel-nuevo").addEventListener("click", nuevoPartido);
  el("btn-padel-seguir").addEventListener("click", seguirJugando);
  el("btn-padel-terminar").addEventListener("click", terminarPartido);
  el("padel-salir").addEventListener("click", salirTablero);
  el("padel-links").addEventListener("click", abrirLinks);
  el("btn-padel-links-volver").addEventListener("click", () => { mostrarPantalla("padel"); sonar("click"); });
  document.querySelectorAll(".padel-share").forEach((b) =>
    b.addEventListener("click", () => enviarLink(b.dataset.equipo)));

  el("padel-remote-punto").addEventListener("click", () => controlEnviar("punto"));
  el("padel-remote-deshacer").addEventListener("click", () => controlEnviar("deshacer"));
  el("padel-remote-salir").addEventListener("click", salirControl);

  /* Al volver de la pantalla bloqueada / otra app: el socket pudo haber
     muerto sin avisar, así que se reconecta de cero y se pide el estado. */
  document.addEventListener("visibilitychange", () => {
    if (!P.rol) return;
    if (document.hidden) {
      P.ocultoDesde = Date.now();
      return;
    }
    if (P.rol === "tablero") pedirWakeLock();
    if (Date.now() - P.ocultoDesde > 3000 || P.conexion !== "ok") conectarSala();
    else if (P.rol === "tablero") difundir();
    else enviar("pedir", {});
  });

  /* ---------- Arranque: ¿se abrió desde un link? ---------- */
  const params = new URLSearchParams(location.search);
  const sala = params.get("padel");
  const equipo = params.get("equipo");
  const tablero = params.get("tablero");

  if (sala && /^[a-z0-9]{4,16}$/.test(sala) && EQUIPOS.includes(equipo)) {
    iniciarControl(sala, equipo);
  } else if (tablero) {
    // recarga del tablero: si el partido guardado es ese, se sigue
    const g = leerLS(CLAVE_PARTIDO);
    if (g && g.id === tablero) {
      cargarPartido(g);
      iniciarTablero(true);
    } else {
      cambiarUrl("");
    }
  }
})();
