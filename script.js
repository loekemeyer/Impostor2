/* ===================================================================
   El Impostor · Fútbol — Lógica del juego (JavaScript vanilla)
   ===================================================================
   Flujo:
   1. Configuración: cantidad de jugadores e impostores.
   2. "Generar jugador": elige UN futbolista al azar y asigna en secreto
      qué participantes son impostores.
   3. Se pasa el celular de a uno. Cada participante toca "Ver mi rol":
        - Impostor  -> "Sos el impostor" (NO ve al jugador).
        - Normal    -> ve al futbolista (el MISMO para toda la ronda).
   4. Al terminar -> pantalla final.
   5. "Nueva partida": mismo grupo, futbolista DISTINTO, nuevos impostores.
   =================================================================== */

"use strict";

/* ---------- Lista inicial de jugadores famosos ---------- */
const FUTBOLISTAS = [
  "Messi", "Cristiano Ronaldo", "Neymar", "Mbappé", "Haaland",
  "Modric", "Kroos", "Salah", "Lewandowski", "Suárez",
  "Di María", "Julián Álvarez", "Dibu Martínez", "Maradona", "Pelé",
  "Zidane", "Ronaldinho", "Kaká", "Beckham", "Rooney",
  "Xavi", "Iniesta", "Ramos", "Buffon", "Benzema",
  "Griezmann", "Tévez", "Riquelme", "Palermo", "Lautaro Martínez"
];

/* ---------- Estado de la partida ---------- */
const estado = {
  totalJugadores: 5,
  totalImpostores: 1,
  futbolista: null,        // el jugador elegido para toda la ronda
  rolesImpostor: [],       // array de booleanos: true = ese participante es impostor
  jugadorActual: 0,        // índice 0-based del participante con el celu
  sonido: true
};

/* ===================================================================
   Utilidades
   =================================================================== */

/** Devuelve un entero aleatorio entre 0 y max-1. */
function aleatorio(max) {
  return Math.floor(Math.random() * max);
}

/**
 * Elige un futbolista al azar de la lista, evitando repetir el anterior
 * (para que "Nueva partida" siempre dé uno distinto cuando se pueda).
 */
function elegirFutbolista(anterior) {
  let elegido;
  do {
    elegido = FUTBOLISTAS[aleatorio(FUTBOLISTAS.length)];
  } while (elegido === anterior && FUTBOLISTAS.length > 1);
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
  config:  document.getElementById("screen-config"),
  handoff: document.getElementById("screen-handoff"),
  reveal:  document.getElementById("screen-reveal"),
  final:   document.getElementById("screen-final")
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
const inpSound     = document.getElementById("inp-sound");
const configHint   = document.getElementById("config-hint");

const counter       = document.getElementById("counter");
const counterReveal = document.getElementById("counter-reveal");

const cardPlayer   = document.getElementById("reveal-player");
const cardImpostor = document.getElementById("reveal-impostor");
const playerName   = document.getElementById("player-name");

/* ===================================================================
   Configuración: steppers + / −
   =================================================================== */
document.querySelectorAll(".step-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const campo = btn.dataset.step;          // "players" | "impostors"
    const dir = parseInt(btn.dataset.dir, 10); // 1 | -1
    const input = campo === "players" ? inpPlayers : inpImpostors;

    let valor = parseInt(input.value, 10) + dir;
    const min = parseInt(input.min, 10);
    const max = parseInt(input.max, 10);
    valor = Math.max(min, Math.min(max, valor));
    input.value = valor;

    validarConfig();
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
   Inicio de partida
   =================================================================== */
function iniciarPartida() {
  if (!validarConfig()) return;

  estado.totalJugadores = parseInt(inpPlayers.value, 10);
  estado.totalImpostores = parseInt(inpImpostors.value, 10);
  estado.sonido = inpSound.checked;
  estado.futbolista = elegirFutbolista(estado.futbolista);
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
    playerName.textContent = estado.futbolista;
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
   Nueva partida (mismo grupo, futbolista distinto)
   =================================================================== */
function nuevaPartida() {
  estado.futbolista = elegirFutbolista(estado.futbolista);
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
  const texto = FUTBOLISTAS.join(", ");

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

/* Validación inicial al cargar */
validarConfig();
