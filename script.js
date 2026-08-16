/* ===================================================================
   El Impostor — Lógica del juego (JavaScript vanilla)
   ===================================================================
   Flujo:
   1. Configuración: modo de juego, cantidad de jugadores e impostores.
   2. "Generar jugador": elige UNA palabra al azar (según el modo) y asigna
      en secreto qué participantes son impostores.
   3. Se pasa el celular de a uno. Cada participante toca "Ver mi rol":
        - Impostor  -> "Sos el impostor" (NO ve la palabra).
        - Normal    -> ve la palabra (la MISMA para toda la ronda).
   4. Al terminar -> pantalla final.
   5. "Nueva partida": mismo grupo, palabra DISTINTA, nuevos impostores.

   Modos de juego:
     - "hombres": futbolistas famosos (la versión clásica de fútbol).
     - "mixto":   cultura general argentina, divertida, para grupos mixtos.
   =================================================================== */

"use strict";

/* Versión de la app (fuente única de verdad). */
const APP_VERSION = "1.5.0";

/* ---------- Modo HOMBRES: jugadores de fútbol famosos ---------- */
const FUTBOLISTAS = [
  "Messi", "Cristiano Ronaldo", "Neymar", "Mbappé", "Haaland",
  "Modric", "Kroos", "Salah", "Lewandowski", "Suárez",
  "Di María", "Julián Álvarez", "Dibu Martínez", "Maradona", "Pelé",
  "Zidane", "Ronaldinho", "Kaká", "Beckham", "Rooney",
  "Xavi", "Iniesta", "Ramos", "Buffon", "Benzema",
  "Griezmann", "Tévez", "Riquelme", "Palermo", "Lautaro Martínez",

  // Fútbol argentino 2010-2020 (selección + liga local)
  "Sergio Agüero", "Gonzalo Higuaín", "Paulo Dybala", "Mauro Icardi", "Javier Mascherano",
  "Nicolás Otamendi", "Éver Banega", "Marcelo Gallardo", "Juan Sebastián Verón", "Pablo Aimar",
  "Ariel Ortega", "Andrés D'Alessandro", "Darío Benedetto", "Lisandro López", "Cristian Pavón",
  "Lucas Pratto", "Ignacio Scocco", "Franco Armani", "Sergio Romero", "Maxi Rodríguez",
  "Ezequiel Lavezzi", "Pity Martínez", "Rodrigo De Paul", "Giovani Lo Celso", "Leandro Paredes",

  // Ídolos de Boca Juniors
  "Guillermo Barros Schelotto", "Roberto Abbondanzieri", "Sebastián Battaglia", "Rolando Schiavi", "Hugo Ibarra",
  "Fernando Gago", "Nicolás Burdisso", "Marcelo Delgado", "Eduardo Salvio", "Sebastián Villa",
  "Agustín Orion", "Ramón Ábila",

  // Ídolos de River Plate
  "Enzo Francescoli", "Hernán Crespo", "Javier Saviola", "Marcelo Salas", "Ramón Díaz",
  "Fernando Cavenaghi", "Matías Almeyda", "Leonardo Ponzio", "Manuel Lanzini", "Ignacio Fernández",
  "Juan Fernando Quintero", "Enzo Pérez", "Marcelo Barovero",

  // Cracks internacionales 2010-2024
  "Kevin De Bruyne", "Sergio Busquets", "Gerard Piqué", "David Villa", "Fernando Torres",
  "Iker Casillas", "Manuel Neuer", "Thomas Müller", "Philipp Lahm", "Bastian Schweinsteiger",
  "Mesut Özil", "Arjen Robben", "Franck Ribéry", "Zlatan Ibrahimović", "Andrea Pirlo",
  "Francesco Totti", "Steven Gerrard", "Frank Lampard", "Eden Hazard", "Edinson Cavani",
  "Radamel Falcao", "James Rodríguez", "Sadio Mané", "Virgil van Dijk", "Gareth Bale",
  "Paul Pogba", "Vinícius Júnior", "Pedri", "Jude Bellingham", "Harry Kane",
  "Son Heung-min", "Dani Alves", "Thiago Silva", "David Silva"
];

/* ---------- Modo MIXTO: cultura general argentina (50 palabras) ----------
   Cosas conocidas y divertidas para jugar en grupo mixto: comidas, lugares,
   íconos, música y costumbres bien argentas. Fáciles de disimular. */
const MIXTO = [
  // Comida y bebida
  "Mate", "Asado", "Empanadas", "Milanesa", "Choripán",
  "Dulce de leche", "Alfajor", "Fernet", "Facturas", "Locro",
  "Provoleta", "Medialunas", "Malbec",

  // Lugares
  "Obelisco", "Bariloche", "Cataratas del Iguazú", "La Bombonera", "Caminito",
  "Mar del Plata", "Ushuaia", "Cordillera de los Andes", "Glaciar Perito Moreno", "Casa Rosada",

  // Íconos y personajes
  "Maradona", "Messi", "Carlos Gardel", "Mercedes Sosa", "Charly García",
  "Gustavo Cerati", "Papa Francisco", "Mafalda", "Ricardo Darín", "Susana Giménez",
  "Mirtha Legrand", "Marcelo Tinelli",

  // Música y baile
  "Tango", "Cumbia", "Cuarteto", "Rock nacional", "Folclore",

  // Costumbres y cotidiano
  "Colectivo", "Siesta", "Feria americana", "Kiosco", "Truco",
  "Che", "Yerba", "Vermú", "Selección Argentina", "Gauchito Gil"
];

/* ---------- Configuración de los modos de juego ----------
   Cada modo define su lista de palabras y los textos que se muestran. */
const MODOS = {
  hombres: {
    etiqueta:  "Hombres ⚽",
    subtitulo: "Versión Fútbol",
    eyebrow:   "Tu jugador es",
    copiar:    "Copiar lista de jugadores",
    unidad:    "jugadores",
    lista:     FUTBOLISTAS
  },
  mixto: {
    etiqueta:  "Mixto 🎉",
    subtitulo: "Cultura general 🇦🇷",
    eyebrow:   "Tu palabra es",
    copiar:    "Copiar lista de palabras",
    unidad:    "palabras",
    lista:     MIXTO
  }
};

/* ---------- Estado de la partida ---------- */
const estado = {
  modo: "mixto",           // "hombres" | "mixto" (arranca en mixto para jugar en grupo)
  totalJugadores: 5,
  totalImpostores: 1,
  palabra: null,           // la palabra/jugador elegido para toda la ronda
  rolesImpostor: [],       // array de booleanos: true = ese participante es impostor
  jugadorActual: 0,        // índice 0-based del participante con el celu
  sonido: true
};

/** Devuelve la configuración del modo activo. */
function modoActual() {
  return MODOS[estado.modo];
}

/** Devuelve la lista de palabras del modo activo. */
function listaActual() {
  return modoActual().lista;
}

/* ===================================================================
   Utilidades
   =================================================================== */

/** Devuelve un entero aleatorio entre 0 y max-1. */
function aleatorio(max) {
  return Math.floor(Math.random() * max);
}

/**
 * Elige una palabra al azar de la lista del modo activo, evitando repetir
 * la anterior (para que "Nueva partida" siempre dé una distinta cuando se pueda).
 */
function elegirPalabra(anterior) {
  const lista = listaActual();
  let elegido;
  do {
    elegido = lista[aleatorio(lista.length)];
  } while (elegido === anterior && lista.length > 1);
  return elegido;
}

/**
 * Asigna aleatoriamente qué participantes son impostores.
 * Devuelve un array de booleanos de largo = totalJugadores.
 */
function asignarImpostores(total, impostores) {
  const roles = new Array(total).fill(false);
  let asignados = 0;
  while (asignados < impostores) {
    const i = aleatorio(total);
    if (!roles[i]) {        // evita asignar dos veces al mismo
      roles[i] = true;
      asignados++;
    }
  }
  return roles;
}

/* ===================================================================
   Sonidos opcionales (Web Audio API, sin archivos externos)
   =================================================================== */
let audioCtx = null;

/** Reproduce un beep corto. tipo: "normal" | "impostor" | "click". */
function sonar(tipo) {
  if (!estado.sonido) return;
  try {
    // se crea el contexto en el primer gesto del usuario
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const frecuencias = { normal: 660, impostor: 180, click: 440 };
    osc.type = tipo === "impostor" ? "sawtooth" : "sine";
    osc.frequency.value = frecuencias[tipo] || 440;

    const ahora = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, ahora);
    gain.gain.exponentialRampToValueAtTime(0.25, ahora + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.35);

    osc.start(ahora);
    osc.stop(ahora + 0.36);
  } catch (e) {
    /* si el navegador no soporta audio, se ignora silenciosamente */
  }
}

/* ===================================================================
   Manejo de pantallas (con transición elegante)
   =================================================================== */
const pantallas = {
  config:       document.getElementById("screen-config"),
  handoff:      document.getElementById("screen-handoff"),
  reveal:       document.getElementById("screen-reveal"),
  final:        document.getElementById("screen-final"),
  clockConfig:  document.getElementById("screen-clock-config"),
  clock:        document.getElementById("screen-clock")
};

/** Muestra una pantalla y anima la salida de la anterior. */
function mostrarPantalla(nombre) {
  const destino = pantallas[nombre];
  const actual = document.querySelector(".screen.is-active");

  if (actual && actual !== destino) {
    actual.classList.remove("is-active");
    actual.classList.add("is-leaving");
    // al terminar la animación de salida, se oculta del todo
    actual.addEventListener("animationend", function limpiar() {
      actual.classList.remove("is-leaving");
      actual.removeEventListener("animationend", limpiar);
    });
  }
  destino.classList.add("is-active");
}

/* ===================================================================
   Referencias a elementos del DOM
   =================================================================== */
const inpPlayers   = document.getElementById("inp-players");
const inpImpostors = document.getElementById("inp-impostors");
const inpMinutes   = document.getElementById("inp-minutes");
const inpSound     = document.getElementById("inp-sound");
const configHint   = document.getElementById("config-hint");

const counter       = document.getElementById("counter");
const counterReveal = document.getElementById("counter-reveal");

const cardPlayer   = document.getElementById("reveal-player");
const cardImpostor = document.getElementById("reveal-impostor");
const playerName   = document.getElementById("player-name");
const revealEyebrow = document.getElementById("reveal-eyebrow");

const subtitle   = document.getElementById("app-subtitle");
const btnCopy    = document.getElementById("btn-copy");
const segButtons = document.querySelectorAll(".seg-btn[data-modo]");

/* ===================================================================
   Configuración: steppers + / −
   =================================================================== */
document.querySelectorAll(".step-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const campo = btn.dataset.step;          // "players" | "impostors" | "minutes"
    const dir = parseInt(btn.dataset.dir, 10); // 1 | -1
    const inputs = { players: inpPlayers, impostors: inpImpostors, minutes: inpMinutes };
    const input = inputs[campo];

    let valor = parseInt(input.value, 10) + dir;
    const min = parseInt(input.min, 10);
    const max = parseInt(input.max, 10);
    valor = Math.max(min, Math.min(max, valor));
    input.value = valor;

    if (campo !== "minutes") validarConfig();
    sonar("click");
  });
});

/** Valida que haya al menos 1 jugador normal y actualiza el botón. */
function validarConfig() {
  const jugadores = parseInt(inpPlayers.value, 10);
  const impostores = parseInt(inpImpostors.value, 10);
  const btn = document.getElementById("btn-generate");

  if (impostores >= jugadores) {
    configHint.textContent = "Tiene que haber al menos un jugador no impostor.";
    btn.disabled = true;
    btn.style.opacity = "0.5";
    return false;
  }
  configHint.textContent = "";
  btn.disabled = false;
  btn.style.opacity = "1";
  return true;
}

inpSound.addEventListener("change", () => {
  estado.sonido = inpSound.checked;
});

/* ===================================================================
   Selector de modo de juego (Hombres / Mixto)
   =================================================================== */
segButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (estado.modo === btn.dataset.modo) return;
    estado.modo = btn.dataset.modo;
    actualizarModo();
    sonar("click");
  });
});

/**
 * Refresca todos los textos que dependen del modo activo:
 * botones del selector, subtítulo, botón de copiar y las etiquetas de versión.
 */
function actualizarModo() {
  const modo = modoActual();

  // marca visualmente el botón seleccionado
  segButtons.forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.modo === estado.modo);
    btn.setAttribute("aria-selected", btn.dataset.modo === estado.modo ? "true" : "false");
  });

  if (subtitle) subtitle.textContent = modo.subtitulo;
  if (btnCopy)  btnCopy.textContent = modo.copiar;

  document.querySelectorAll(".version").forEach((el) => {
    el.textContent = `v${APP_VERSION} · ${modo.lista.length} ${modo.unidad}`;
  });
}

/* ===================================================================
   Inicio de partida
   =================================================================== */
function iniciarPartida() {
  if (!validarConfig()) return;

  estado.totalJugadores = parseInt(inpPlayers.value, 10);
  estado.totalImpostores = parseInt(inpImpostors.value, 10);
  estado.sonido = inpSound.checked;
  estado.palabra = elegirPalabra(estado.palabra);
  estado.rolesImpostor = asignarImpostores(estado.totalJugadores, estado.totalImpostores);
  estado.jugadorActual = 0;

  prepararHandoff();
  mostrarPantalla("handoff");
}

/** Prepara la pantalla de "pasar el celular" para el jugador actual. */
function prepararHandoff() {
  const texto = `Jugador ${estado.jugadorActual + 1} de ${estado.totalJugadores}`;
  counter.textContent = texto;
  counterReveal.textContent = texto;
}

/* ===================================================================
   Revelar el rol del jugador actual
   =================================================================== */
function revelarRol() {
  const esImpostor = estado.rolesImpostor[estado.jugadorActual];

  if (esImpostor) {
    cardPlayer.hidden = true;
    cardImpostor.hidden = false;
    // reinicia la animación de la tarjeta
    cardImpostor.style.animation = "none";
    void cardImpostor.offsetWidth;
    cardImpostor.style.animation = "";
    sonar("impostor");
  } else {
    cardImpostor.hidden = true;
    cardPlayer.hidden = false;
    if (revealEyebrow) revealEyebrow.textContent = modoActual().eyebrow;
    playerName.textContent = estado.palabra;
    cardPlayer.style.animation = "none";
    void cardPlayer.offsetWidth;
    cardPlayer.style.animation = "";
    sonar("normal");
  }

  mostrarPantalla("reveal");
}

/* ===================================================================
   Avanzar al siguiente jugador (o terminar la ronda)
   =================================================================== */
function siguienteJugador() {
  estado.jugadorActual++;

  if (estado.jugadorActual >= estado.totalJugadores) {
    mostrarPantalla("final");   // ya pasaron todos
    sonar("normal");
    return;
  }

  prepararHandoff();
  mostrarPantalla("handoff");
  sonar("click");
}

/* ===================================================================
   Nueva partida (mismo grupo, palabra distinta)
   =================================================================== */
function nuevaPartida() {
  estado.palabra = elegirPalabra(estado.palabra);
  estado.rolesImpostor = asignarImpostores(estado.totalJugadores, estado.totalImpostores);
  estado.jugadorActual = 0;

  prepararHandoff();
  mostrarPantalla("handoff");
  sonar("click");
}

/* ===================================================================
   Copiar lista de jugadores al portapapeles
   =================================================================== */
function copiarLista() {
  const texto = listaActual().join(", ");

  const exito = () => {
    mostrarToast("¡Lista copiada!");
    sonar("click");
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(exito).catch(() => copiaFallback(texto, exito));
  } else {
    copiaFallback(texto, exito);
  }
}

/** Copia usando un textarea temporal (navegadores viejos / file://). */
function copiaFallback(texto, exito) {
  const area = document.createElement("textarea");
  area.value = texto;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try { document.execCommand("copy"); exito(); }
  catch (e) { mostrarToast("No se pudo copiar"); }
  document.body.removeChild(area);
}

/** Muestra un mensajito flotante temporal. */
let toastTimer = null;
function mostrarToast(mensaje) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

/* ===================================================================
   Conexión de botones
   =================================================================== */
document.getElementById("btn-generate").addEventListener("click", iniciarPartida);
document.getElementById("btn-reveal").addEventListener("click", revelarRol);
document.getElementById("btn-next").addEventListener("click", siguienteJugador);
document.getElementById("btn-newgame").addEventListener("click", nuevaPartida);
document.getElementById("btn-copy").addEventListener("click", copiarLista);
document.getElementById("btn-back-config").addEventListener("click", () => {
  mostrarPantalla("config");
  sonar("click");
});

/* Aplica el modo inicial (subtítulo, selector, botón de copiar y versión). */
actualizarModo();

/* Validación inicial al cargar */
validarConfig();

/* ===================================================================
   RELOJ DE AJEDREZ (modo extra)
   -------------------------------------------------------------------
   Dos jugadores, un celular. Se elige cuántos minutos tiene cada uno.
   Cada mitad de la pantalla es el reloj de un jugador; al tocar tu
   mitad, tu reloj se detiene y arranca el del rival (como un reloj de
   ajedrez de verdad). El que se queda sin tiempo, pierde.
   =================================================================== */
const reloj = {
  minutos: 5,
  restanteTop: 0,      // milisegundos que le quedan al jugador de arriba
  restanteBottom: 0,   // milisegundos que le quedan al jugador de abajo
  activo: null,        // "top" | "bottom" | null (nadie corriendo todavía)
  pausado: false,
  terminado: false,
  ultimoTick: 0,       // marca de tiempo del último cálculo
  intervalo: null
};

/* Referencias del DOM del reloj */
const inpMinutesEl = inpMinutes;
const clockTop     = document.getElementById("clock-top");
const clockBottom  = document.getElementById("clock-bottom");
const timeTop      = document.getElementById("time-top");
const timeBottom   = document.getElementById("time-bottom");
const btnClockPause = document.getElementById("clock-pause");

/** Formatea milisegundos como m:ss (nunca negativo). */
function formatearTiempo(ms) {
  if (ms < 0) ms = 0;
  const totalSeg = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeg / 60);
  const s = totalSeg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Refresca los números y el estado visual de cada mitad. */
function actualizarRelojUI() {
  timeTop.textContent = formatearTiempo(reloj.restanteTop);
  timeBottom.textContent = formatearTiempo(reloj.restanteBottom);

  const corriendo = reloj.activo && !reloj.pausado && !reloj.terminado;
  clockTop.classList.toggle("is-active", corriendo && reloj.activo === "top");
  clockBottom.classList.toggle("is-active", corriendo && reloj.activo === "bottom");

  clockTop.classList.toggle("is-low", reloj.restanteTop > 0 && reloj.restanteTop <= 10000);
  clockBottom.classList.toggle("is-low", reloj.restanteBottom > 0 && reloj.restanteBottom <= 10000);

  clockTop.classList.toggle("is-flag", reloj.terminado && reloj.restanteTop <= 0);
  clockBottom.classList.toggle("is-flag", reloj.terminado && reloj.restanteBottom <= 0);

  btnClockPause.textContent = reloj.pausado ? "▶" : "⏸";
}

/** Descuenta el tiempo transcurrido al jugador que está corriendo. */
function tickReloj() {
  if (reloj.pausado || reloj.terminado || !reloj.activo) return;

  const ahora = Date.now();
  const dt = ahora - reloj.ultimoTick;
  reloj.ultimoTick = ahora;

  if (reloj.activo === "top") reloj.restanteTop -= dt;
  else                        reloj.restanteBottom -= dt;

  if (reloj.restanteTop <= 0 || reloj.restanteBottom <= 0) {
    reloj.restanteTop = Math.max(0, reloj.restanteTop);
    reloj.restanteBottom = Math.max(0, reloj.restanteBottom);
    reloj.terminado = true;
    reloj.activo = null;
    sonar("impostor");
  }
  actualizarRelojUI();
}

/** Deja los dos relojes en el tiempo elegido y frena todo. */
function reiniciarReloj() {
  const ms = reloj.minutos * 60 * 1000;
  reloj.restanteTop = ms;
  reloj.restanteBottom = ms;
  reloj.activo = null;
  reloj.pausado = false;
  reloj.terminado = false;
  actualizarRelojUI();
}

/** Arranca el reloj desde la pantalla de configuración. */
function iniciarReloj() {
  reloj.minutos = parseInt(inpMinutesEl.value, 10);
  reiniciarReloj();
  if (!reloj.intervalo) reloj.intervalo = setInterval(tickReloj, 100);
  mostrarPantalla("clock");
}

/**
 * Al tocar una mitad: ese jugador terminó su jugada, así que su reloj
 * se detiene y arranca el del rival.
 */
function tocarMitad(mitad) {
  if (reloj.terminado) return;
  const rival = mitad === "top" ? "bottom" : "top";
  reloj.pausado = false;
  reloj.activo = rival;
  reloj.ultimoTick = Date.now();
  actualizarRelojUI();
  sonar("click");
}

/** Pausa o reanuda la partida. */
function togglePausaReloj() {
  if (reloj.terminado || !reloj.activo) return;
  reloj.pausado = !reloj.pausado;
  if (!reloj.pausado) reloj.ultimoTick = Date.now();
  actualizarRelojUI();
  sonar("click");
}

/** Sale del reloj y detiene el intervalo. */
function salirReloj() {
  if (reloj.intervalo) {
    clearInterval(reloj.intervalo);
    reloj.intervalo = null;
  }
  mostrarPantalla("clockConfig");
  sonar("click");
}

/* Botón de la pantalla principal que abre la config del reloj */
document.getElementById("btn-open-clock").addEventListener("click", () => {
  mostrarPantalla("clockConfig");
  sonar("click");
});

/* Presets rápidos de minutos (1', 3', 5', 10') */
document.querySelectorAll(".clock-presets .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    inpMinutesEl.value = btn.dataset.preset;
    sonar("click");
  });
});

/* Botones de la config del reloj */
document.getElementById("btn-clock-start").addEventListener("click", iniciarReloj);
document.getElementById("btn-clock-back").addEventListener("click", () => {
  mostrarPantalla("config");
  sonar("click");
});

/* Zonas tocables y controles del reloj en juego */
clockTop.addEventListener("click", () => tocarMitad("top"));
clockBottom.addEventListener("click", () => tocarMitad("bottom"));
btnClockPause.addEventListener("click", togglePausaReloj);
document.getElementById("clock-reset").addEventListener("click", () => {
  reiniciarReloj();
  sonar("click");
});
document.getElementById("clock-exit").addEventListener("click", salirReloj);
