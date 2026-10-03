/* ===================================================================
   PÁDEL — Contador con tablero táctil y control desde otros celulares
   -------------------------------------------------------------------
   Tablero (este celu): tocar la mitad de un equipo = punto para ese
   equipo. ↺ deshace. 🔗 muestra un link (y un QR) por equipo.
   Control (otro celu): elige marcar sólo su equipo (un botón gigante)
   o los dos equipos (un botón gigante por equipo), y puede deshacer.

   Conexión: el tablero inventa un código de 6 números al empezar. Los
   otros celulares entran con ese código (🎾 Pádel → Unirme con código)
   o con el link/QR de su equipo, que lleva el mismo código.
   Sincronización: PeerJS (WebRTC). El servidor público gratuito de
   PeerJS sólo presenta a los celulares por el código; después cada
   control habla directo con el tablero. No hay base de datos ni cuenta:
   el tablero es el dueño del partido (lo guarda en localStorage) y
   después de cada cambio manda el estado completo a los controles.
     control → tablero:   "hola" {equipo: "a"|"b"|"ambos"} · "punto" {equipo, eid}
                          · "deshacer" {eid} · "pedir"
     tablero → controles: "estado" {nombres, puntos, ack}
   El tablero respeta lo que eligió cada control al presentarse: uno de
   "a" sólo puede marcar y deshacer puntos de "a"; uno de "ambos", de los dos.
   "eid" identifica cada pedido: el tablero no lo aplica dos veces y lo
   devuelve en "ack" para que el control sepa que llegó.

   Usa de script.js: pantallas, mostrarPantalla, sonar, mostrarToast,
   copiaFallback. Usa de padel-reglas.js: calcularPadel, textoSet.
   =================================================================== */

(function () {
  "use strict";

  /* Librerías del CDN (versión fija + SRI), cargadas sólo al usar el pádel.
     La clave es el nombre global que deja cada una. */
  const LIBS = {
    Peer: {
      src: "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js",
      sri: "sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu"
    },
    qrcode: {
      src: "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",
      sri: "sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k"
    }
  };
  const CLAVE_PARTIDO = "padel-partido";   // localStorage: partido en curso (tablero)
  const CLAVE_PREFS   = "padel-config";    // localStorage: últimos nombres y reglas
  const ESPERA_MS     = 4000;              // sin "ack" en este tiempo, el punto no llegó
  const REINTENTO_MS  = 3000;              // reintento de conexión
  const PREFIJO       = "impostor2-padel-"; // id del tablero en PeerJS: prefijo + código

  pantallas.padelConfig = document.getElementById("screen-padel-config");
  pantallas.padel       = document.getElementById("screen-padel");
  pantallas.padelLinks  = document.getElementById("screen-padel-links");
  pantallas.padelRemote = document.getElementById("screen-padel-remote");
  pantallas.padelJoin   = document.getElementById("screen-padel-join");

  const el = (id) => document.getElementById(id);
  const EQUIPOS = ["a", "b"];
  const OPCIONES = ["a", "b", "ambos"];   // qué puede marcar un control

  /* ---------- Estado ---------- */
  const P = {
    rol: null,              // "tablero" | "control" | null (fuera del pádel)
    id: null,               // código de la sala: 6 números (va en los links)
    equipo: null,           // (control) "a" | "b" | "ambos" | null mientras elige
    nombres: { a: "", b: "" },
    puntos: "",             // "abba…f" — fuente única del marcador (ver padel-reglas.js)
    setDescartado: 0,       // (tablero) sets ya cerrados en los que tocaron "Seguir jugando"
    procesados: [],         // (tablero) eids ya aplicados
    recibido: false,        // (control) ya llegó al menos un estado del tablero
    // conexión
    peer: null,             // PeerJS de este celular
    conn: null,             // (control) conexión directa con el tablero
    conns: new Map(),       // (tablero) conexión de cada control → "a" | "b" | "ambos"
    token: null,            // (tablero) secreto para recuperar el mismo código al recargar
    reintento: null,
    conexion: "off",        // servidor de PeerJS: "off" | "conectando" | "ok" | "error"
    tableroOnline: false,   // (control) conectado directo con el tablero
    sinTablero: false,      // (control) el servidor dijo que no hay tablero con ese código
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

  /** Código de sala: 6 números al azar ("048213"). */
  function nuevoCodigo() {
    return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  }
  const codigoLindo = (c) => `${c.slice(0, 3)} ${c.slice(3)}`;

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
     Conexión (PeerJS)
     =================================================================== */
  async function conectarSala() {
    desconectarSala();
    P.conexion = "conectando";
    actualizarConexion();

    let Peer;
    try {
      Peer = await cargarLib("Peer");
    } catch (e) {
      P.conexion = "error";
      actualizarConexion();
      programarReintento();
      return;
    }
    if (!P.rol) return;   // salió mientras cargaba

    const esTablero = P.rol === "tablero";
    // el tablero ocupa el id del código; cada control, uno propio al azar
    const id = esTablero ? PREFIJO + P.id : `${PREFIJO}${P.id}-${nuevoId()}`;
    const peer = new Peer(id, esTablero ? { debug: 0, token: P.token } : { debug: 0 });
    P.peer = peer;

    peer.on("open", () => {
      if (P.peer !== peer) return;
      P.conexion = "ok";
      if (!esTablero) conectarAlTablero();
      actualizarConexion();
    });
    peer.on("connection", (conn) => {
      if (P.peer !== peer || P.rol !== "tablero") return conn.close();
      recibirControl(conn);
    });
    peer.on("disconnected", () => {
      // se cortó el servidor: las conexiones directas siguen andando
      if (P.peer !== peer || peer.destroyed) return;
      P.conexion = "conectando";
      actualizarConexion();
      programarReintento();
    });
    peer.on("error", (err) => {
      if (P.peer !== peer) return;
      const tipo = err && err.type;
      if (tipo === "peer-unavailable") {
        // (control) no hay ningún tablero abierto con ese código
        P.tableroOnline = false;
        P.sinTablero = true;
        actualizarConexion();
        programarReintento();
        return;
      }
      if (tipo === "unavailable-id" && esTablero && !P.puntos) {
        // otro partido ya usa ese código y nadie lo conoce todavía: se elige otro
        P.id = nuevoCodigo();
        P.token = nuevoId() + nuevoId();
        guardarPartido();
        cambiarUrl(`?tablero=${P.id}`);
        conectarSala();
        return;
      }
      // red, servidor caído, o el código todavía figura de la sesión anterior
      P.conexion = "error";
      actualizarConexion();
      programarReintento();
    });
  }

  /** Reintenta lo que falte: el servidor, o (control) la conexión con el tablero. */
  function programarReintento() {
    clearTimeout(P.reintento);
    P.reintento = setTimeout(() => {
      if (!P.rol) return;
      const peer = P.peer;
      if (!peer || peer.destroyed || (P.conexion === "error" && !peer.open)) return conectarSala();
      if (peer.disconnected) {
        try { peer.reconnect(); } catch (e) { return conectarSala(); }
      }
      if (P.rol === "control" && !P.tableroOnline) conectarAlTablero();
    }, REINTENTO_MS);
  }

  function desconectarSala() {
    clearTimeout(P.reintento);
    if (P.peer) {
      try { P.peer.destroy(); } catch (e) { /* ya cerrado */ }
    }
    P.peer = null;
    P.conn = null;
    P.conns = new Map();
    P.conexion = "off";
    P.tableroOnline = false;
    P.sinTablero = false;
    P.controles = { a: 0, b: 0 };
  }

  /* ---------- (control) conexión directa con el tablero ---------- */
  function conectarAlTablero() {
    if (!P.peer || !P.peer.open) return;
    const vieja = P.conn;
    P.conn = null;   // primero se suelta, así su "close" no dispara otro reintento
    if (vieja) {
      try { vieja.close(); } catch (e) { /* ya cerrada */ }
    }
    const conn = P.peer.connect(PREFIJO + P.id, { reliable: true });
    P.conn = conn;
    conn.on("open", () => {
      if (P.conn !== conn) return;
      P.tableroOnline = true;
      P.sinTablero = false;
      conn.send({ t: "hola", equipo: P.equipo });   // el tablero contesta con el estado
      actualizarConexion();
    });
    conn.on("data", (d) => {
      if (P.conn !== conn || !d || d.t !== "estado") return;
      alRecibir("estado", d);
    });
    const caida = () => {
      if (P.conn !== conn) return;
      P.conn = null;
      P.tableroOnline = false;
      P.sinTablero = true;   // el tablero se cerró o se cortó
      actualizarConexion();
      programarReintento();
    };
    conn.on("close", caida);
    conn.on("error", caida);
  }

  function enviar(evento, payload) {
    if (P.rol !== "control" || !P.conn || !P.conn.open) return false;
    try {
      P.conn.send({ t: evento, ...payload });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- (tablero) controles conectados ---------- */
  function recibirControl(conn) {
    conn.on("data", (d) => {
      if (!d || typeof d !== "object") return;
      const elegido = P.conns.get(conn);   // lo que eligió al presentarse
      if (d.t === "hola") {
        P.conns.set(conn, OPCIONES.includes(d.equipo) ? d.equipo : null);
        contarControles();
        mandarEstado(conn);
      } else if (d.t === "pedir") {
        mandarEstado(conn);
      } else if (d.t === "punto" && elegido) {
        // un control de un equipo sólo marca para ese equipo
        const equipo = elegido === "ambos" ? d.equipo : elegido;
        alRecibir("punto", { eid: d.eid, equipo });
      } else if (d.t === "deshacer" && elegido) {
        alRecibir("deshacer", { eid: d.eid, permitidos: elegido === "ambos" ? EQUIPOS : [elegido] });
      }
    });
    const caida = () => {
      P.conns.delete(conn);
      contarControles();
    };
    conn.on("close", caida);
    conn.on("error", caida);
  }

  function contarControles() {
    const elegidos = [...P.conns.values()];
    P.controles = {
      a: elegidos.filter((e) => e === "a" || e === "ambos").length,
      b: elegidos.filter((e) => e === "b" || e === "ambos").length
    };
    actualizarConexion();
  }

  function mandarEstado(conn, ack) {
    try {
      if (conn.open) conn.send({ t: "estado", nombres: P.nombres, puntos: P.puntos, ack: ack || null });
    } catch (e) { /* se cayó: la saca el evento "close" */ }
  }

  /** (tablero) Manda el partido completo a todos los controles. */
  function difundir(ack) {
    P.conns.forEach((equipo, conn) => mandarEstado(conn, ack));
  }

  function alRecibir(evento, datos) {
    if (P.rol === "tablero") {
      if (evento === "pedir") return difundir();
      if (evento !== "punto" && evento !== "deshacer") return;
      if (typeof datos.eid !== "string") return;
      if (evento === "punto" && !EQUIPOS.includes(datos.equipo)) return;
      if (P.procesados.includes(datos.eid)) return difundir(datos.eid);   // repetido
      P.procesados = P.procesados.concat(datos.eid).slice(-40);
      if (evento === "punto") sumarPunto(datos.equipo, datos.eid);
      else deshacer(datos.permitidos, datos.eid);
      return;
    }
    if (P.rol === "control" && evento === "estado") {
      if (datos.nombres) P.nombres = datos.nombres;
      P.puntos = typeof datos.puntos === "string" ? datos.puntos : "";
      P.recibido = true;
      if (P.pendiente && datos.ack === P.pendiente.eid) confirmarPendiente();
      if (P.equipo) renderControl();
      else renderUnirme();
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
      else if (!hayControles) c.append(codigoLindo(P.id));
      else EQUIPOS.forEach((e) => {
        const punto = document.createElement("i");
        punto.className = `padel-dot team-${e}` + (P.controles[e] ? " is-on" : "");
        punto.title = `${nombre(e)}: ${P.controles[e] ? "conectado" : "sin control"}`;
        c.appendChild(punto);
      });
      el("padel-links-aviso").textContent = P.conexion === "ok"
        ? ""
        : "El tablero no está conectado: el código y los links van a andar cuando se conecte.";
    } else if (P.rol === "control") {
      if (P.equipo) renderControl();
      else renderUnirme();
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
    P.id = nuevoCodigo();
    P.token = nuevoId() + nuevoId();
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
    P.token = g.token || nuevoId() + nuevoId();
    P.nombres = g.nombres || { a: "", b: "" };
    P.puntos = g.puntos || "";
    P.procesados = g.procesados || [];
    P.setDescartado = g.setDescartado || 0;
  }

  function guardarPartido() {
    guardarLS(CLAVE_PARTIDO, {
      id: P.id, token: P.token, nombres: P.nombres, puntos: P.puntos,
      procesados: P.procesados, setDescartado: P.setDescartado
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

  /** Saca el último evento. Si viene de un control, sólo si es un punto que ese control puede marcar. */
  function deshacer(permitidos, eid) {
    if (!P.puntos || (permitidos && !permitidos.includes(P.puntos.slice(-1)))) return difundir(eid);
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
    el("padel-codigo").textContent = codigoLindo(P.id);
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
     Unirme con código (otro celular)
     =================================================================== */
  function abrirUnirme() {
    salirDeSala();
    el("padel-codigo-inp").value = "";
    renderUnirme();
    mostrarPantalla("padelJoin");
    el("padel-codigo-inp").focus();   // dentro del toque: así iOS abre el teclado
    sonar("click");
  }

  /** Se conecta a la sala del código escrito (y espera los nombres de los equipos). */
  function buscarTablero() {
    const codigo = el("padel-codigo-inp").value.replace(/\D/g, "");
    if (codigo.length !== 6) {
      el("padel-join-estado").textContent = "El código tiene 6 números.";
      el("padel-join-estado").className = "padel-join-estado is-bad";
      return;
    }
    if (P.rol === "control" && P.id === codigo) {
      // ya buscando esa sala: reintenta ya
      P.sinTablero = false;
      if (!enviar("pedir", {})) conectarAlTablero();
      renderUnirme();
      return;
    }
    P.rol = "control";
    P.id = codigo;
    P.equipo = null;
    P.puntos = "";
    P.nombres = { a: "", b: "" };
    P.recibido = false;
    el("padel-codigo-inp").blur();
    conectarSala();
    renderUnirme();
  }

  function renderUnirme() {
    const buscando = P.rol === "control" && !P.equipo;
    const estadoEl = el("padel-join-estado");
    let txt = "";
    let clase = "";
    if (buscando) {
      if (P.conexion === "error") { txt = "Sin conexión a internet"; clase = "is-bad"; }
      else if (P.recibido) { txt = `✓ Partido ${codigoLindo(P.id)} encontrado`; clase = "is-ok"; }
      else if (P.sinTablero) { txt = "No hay ningún tablero abierto con ese código"; clase = "is-bad"; }
      else txt = "Buscando el tablero…";
    }
    estadoEl.textContent = txt;
    estadoEl.className = `padel-join-estado ${clase}`;

    const listo = buscando && P.recibido;
    el("padel-join-equipos").hidden = !listo;
    el("btn-padel-conectar").hidden = listo;
    EQUIPOS.forEach((e) => { el(`padel-unir-${e}`).textContent = `Sólo ${nombre(e)}`; });
  }

  /** Desde la pantalla de marcar: volver a elegir equipo sin desconectarse. */
  function cambiarEquipo() {
    clearTimeout(P.pendienteTimer);
    P.pendiente = null;
    P.equipo = null;
    el("padel-codigo-inp").value = P.id;
    renderUnirme();
    mostrarPantalla("padelJoin");
    sonar("click");
  }

  /** Elegido qué marca ("a", "b" o "ambos"), pasa a la pantalla de marcar (queda en la URL por si recarga). */
  function elegirEquipo(e) {
    P.equipo = e;
    enviar("hola", { equipo: e });
    cambiarUrl(`?padel=${P.id}&equipo=${e}`);
    renderControl();
    mostrarPantalla("padelRemote");
    sonar("click");
  }

  /** Corta la conexión de un control (sin cambiar de pantalla). */
  function salirDeSala() {
    if (P.rol !== "control") return;
    clearTimeout(P.pendienteTimer);
    P.pendiente = null;
    desconectarSala();
    P.rol = null;
    P.equipo = null;
    cambiarUrl("");
  }

  /* ===================================================================
     Control (celular que marca los puntos de un equipo)
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

  /** Manda un punto (de "equipo") o un deshacer al tablero y espera la confirmación. */
  function controlEnviar(tipo, equipo) {
    if (P.pendiente) return;
    if (!P.tableroOnline) {
      mostrarToast("El tablero no está conectado");
      return;
    }
    const eid = nuevoId();
    if (!enviar(tipo, { equipo, eid })) return;
    P.pendiente = { eid, tipo, equipo };
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
    const { tipo, equipo } = P.pendiente;
    P.pendiente = null;
    if (tipo === "punto") {
      flash(el(`padel-remote-punto-${equipo}`));
      sonar("normal");
    } else {
      mostrarToast("Punto deshecho");
    }
  }

  function salirControl() {
    salirDeSala();
    mostrarPantalla("config");
    sonar("click");
  }

  function renderControl() {
    const r = calcularPadel(P.puntos);
    const listo = P.tableroOnline && P.recibido;

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
    if (listo) txt = "● Conectado al tablero";
    else if (P.conexion === "error") txt = "○ Sin conexión";
    else if (P.sinTablero) txt = "○ El tablero no está abierto";
    estadoEl.textContent = txt;
    estadoEl.classList.toggle("is-ok", listo);
    estadoEl.classList.toggle("is-bad", !listo && (P.conexion === "error" || P.sinTablero));

    // un botón gigante por equipo que este control puede marcar
    const ambos = P.equipo === "ambos";
    EQUIPOS.forEach((e) => {
      const boton = el(`padel-remote-punto-${e}`);
      const enviando = !!P.pendiente && P.pendiente.tipo === "punto" && P.pendiente.equipo === e;
      boton.hidden = !ambos && P.equipo !== e;
      boton.disabled = !listo || r.terminado;
      boton.classList.toggle("is-sending", enviando);
      boton.querySelector(".padel-boton-mas").textContent = enviando ? "…" : "+1";
      el(`padel-remote-equipo-${e}`).textContent = nombre(e);
    });

    const puedeDeshacer = ambos ? EQUIPOS.includes(r.ultimo) : r.ultimo === P.equipo;
    const btnDeshacer = el("padel-remote-deshacer");
    btnDeshacer.textContent = ambos ? "↺ Deshacer último punto" : "↺ Deshacer mi punto";
    btnDeshacer.disabled = !listo || !!P.pendiente || !puedeDeshacer;
  }

  /* ===================================================================
     Eventos
     =================================================================== */
  el("btn-open-padel").addEventListener("click", () => { abrirConfig(); sonar("click"); });

  el("btn-padel-empezar").addEventListener("click", empezarPartido);
  el("btn-padel-continuar").addEventListener("click", continuarPartido);
  el("btn-padel-volver").addEventListener("click", () => { mostrarPantalla("config"); sonar("click"); });
  el("btn-padel-unirme").addEventListener("click", abrirUnirme);

  // unirme: sólo números; al completar los 6 se conecta solo
  el("padel-codigo-inp").addEventListener("input", (ev) => {
    const limpio = ev.target.value.replace(/\D/g, "").slice(0, 6);
    if (ev.target.value !== limpio) ev.target.value = limpio;
    if (P.rol === "control" && P.id !== limpio) salirDeSala();   // cambió el código
    if (limpio.length === 6) buscarTablero();
    else renderUnirme();
  });
  el("btn-padel-conectar").addEventListener("click", buscarTablero);
  OPCIONES.forEach((e) => el(`padel-unir-${e}`).addEventListener("click", () => elegirEquipo(e)));
  el("btn-padel-join-volver").addEventListener("click", () => {
    salirDeSala();
    mostrarPantalla("padelConfig");
    sonar("click");
  });

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

  EQUIPOS.forEach((e) => el(`padel-remote-punto-${e}`).addEventListener("click", () => controlEnviar("punto", e)));
  el("padel-remote-deshacer").addEventListener("click", () => controlEnviar("deshacer"));
  el("padel-remote-cambiar").addEventListener("click", cambiarEquipo);
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
    if (Date.now() - P.ocultoDesde > 3000 || !P.peer || P.peer.destroyed) return conectarSala();
    if (P.rol === "tablero") difundir();
    else if (!enviar("pedir", {})) conectarAlTablero();
  });

  /* ---------- Arranque: ¿se abrió desde un link? ---------- */
  const params = new URLSearchParams(location.search);
  const sala = params.get("padel");
  const equipo = params.get("equipo");
  const tablero = params.get("tablero");

  if (sala && /^[a-z0-9]{4,16}$/.test(sala) && OPCIONES.includes(equipo)) {
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
