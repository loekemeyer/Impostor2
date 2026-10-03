/* ===================================================================
   Pádel — Reglas de puntaje (sin DOM, se usa en el tablero y en los
   celulares que marcan, y se puede testear con Node)
   -------------------------------------------------------------------
   El partido se guarda como la lista de eventos en orden: "aabab…f"
     "a" = punto del equipo A · "b" = punto del B
     "f" = fin del partido (se elige al terminar un set)
   El marcador se recalcula siempre desde cero; así "deshacer" es sólo
   sacar la última letra y todos los celulares muestran lo mismo.

   Reglas (partido normal, sin opciones):
     - Game: 15, 30, 40; en 40-40 "iguales"; el que gana el punto
       siguiente tiene ventaja; si gana otro, game; si no, vuelve a iguales.
     - Set: a 6 games con 2 de diferencia (7-5); en 6-6, tie-break a 7
       con 2 de diferencia.
     - Sets: no hay cantidad fija. Al cerrar cada set se decide si se
       sigue jugando o se termina ("f"). Gana el que tenga más sets.
   =================================================================== */

"use strict";

const PADEL_PUNTOS = ["0", "15", "30", "40"];

/** Calcula el marcador completo a partir de la lista de eventos. */
function calcularPadel(puntos) {
  const sets = [];                 // sets terminados: { a, b, g, tb?:{a,b} } (g = quién lo ganó)
  const setsGanados = { a: 0, b: 0 };
  let games = { a: 0, b: 0 };      // games del set en curso
  let pts = { a: 0, b: 0 };        // puntos del game (o del tie-break) en curso
  let terminado = false;
  let finDeSet = false;            // el último evento cerró un set
  let validos = 0;                 // eventos que contaron
  let ultimo = null;               // último evento que contó: "a" | "b" | "f"

  function cerrarSet(p, set) {
    sets.push(set);
    setsGanados[p]++;
    games = { a: 0, b: 0 };
    pts = { a: 0, b: 0 };
    finDeSet = true;
  }

  for (const p of puntos) {
    if (terminado) break;
    if (p === "f") {
      terminado = true;
      validos++;
      ultimo = "f";
      break;
    }
    if (p !== "a" && p !== "b") continue;
    const o = p === "a" ? "b" : "a";
    validos++;
    ultimo = p;
    finDeSet = false;

    if (games.a === 6 && games.b === 6) {
      // tie-break: a 7 puntos con 2 de diferencia
      pts[p]++;
      if (pts[p] >= 7 && pts[p] - pts[o] >= 2) {
        const g = { a: games.a, b: games.b };
        g[p]++;
        cerrarSet(p, { a: g.a, b: g.b, g: p, tb: { a: pts.a, b: pts.b } });
      }
      continue;
    }

    // game: a 4 puntos con 2 de diferencia (40-40 → iguales → ventaja → game)
    pts[p]++;
    if (!(pts[p] >= 4 && pts[p] - pts[o] >= 2)) continue;

    games[p]++;
    pts = { a: 0, b: 0 };
    if (games[p] >= 6 && games[p] - games[o] >= 2) {
      cerrarSet(p, { a: games.a, b: games.b, g: p });
    }
  }

  let ganador = null;
  if (terminado) {
    if (setsGanados.a > setsGanados.b) ganador = "a";
    else if (setsGanados.b > setsGanados.a) ganador = "b";
    else ganador = "empate";
  }

  const tb = !terminado && games.a === 6 && games.b === 6;
  const iguales = !tb && pts.a >= 3 && pts.a === pts.b;
  let ventaja = null;
  let display;

  if (tb) {
    display = { a: String(pts.a), b: String(pts.b) };
  } else if (pts.a >= 3 && pts.b >= 3) {
    if (pts.a > pts.b) ventaja = "a";
    if (pts.b > pts.a) ventaja = "b";
    display = {
      a: ventaja === "a" ? "AD" : "40",
      b: ventaja === "b" ? "AD" : "40"
    };
  } else {
    display = { a: PADEL_PUNTOS[pts.a], b: PADEL_PUNTOS[pts.b] };
  }

  return {
    sets,
    setsGanados,
    games,
    pts,
    display,
    tb,
    iguales,
    ventaja,
    finDeSet: finDeSet && !terminado,
    terminado,
    ganador,
    validos,
    ultimo
  };
}

/** Texto corto de un set terminado: "6-4", "7-6 (7-5)". */
function textoSet(set) {
  if (set.tb) return `${set.a}-${set.b} (${set.tb.a}-${set.tb.b})`;
  return `${set.a}-${set.b}`;
}

if (typeof module !== "undefined") module.exports = { calcularPadel, textoSet };
