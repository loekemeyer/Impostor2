/* ===================================================================
   Pádel — Reglas de puntaje (sin DOM, se usa en el tablero y en los
   celulares que marcan, y se puede testear con Node)
   -------------------------------------------------------------------
   El partido se guarda como la lista de puntos en orden: "aabab…"
   ("a" = punto del equipo A, "b" = del B). El marcador se recalcula
   siempre desde cero; así "deshacer" es sólo sacar la última letra y
   todos los celulares muestran exactamente lo mismo.

   Configuración:
     sets:    1 | 3          (a cuántos sets: 1, o al mejor de 3)
     oro:     true | false   (punto de oro en 40-40, o ventaja)
     superTb: true | false   (con 3 sets: el 3ro es súper tie-break a 10)
   =================================================================== */

"use strict";

const PADEL_PUNTOS = ["0", "15", "30", "40"];

/**
 * Calcula el marcador completo a partir de la configuración y los puntos.
 * Los puntos que lleguen después de terminado el partido se ignoran.
 */
function calcularPadel(cfg, puntos) {
  const setsParaGanar = cfg.sets === 1 ? 1 : 2;
  const sets = [];                 // sets terminados: { a, b, tb?:{a,b}, super? }
  const setsGanados = { a: 0, b: 0 };
  let games = { a: 0, b: 0 };      // games del set en curso
  let pts = { a: 0, b: 0 };        // puntos del game (o del tie-break) en curso
  let ganador = null;
  let validos = 0;                 // puntos que contaron (sin los de después del final)
  let ultimo = null;               // equipo del último punto que contó

  const esSuperTb = () => cfg.sets === 3 && cfg.superTb && sets.length === 2;
  const esTb = () => esSuperTb() || (games.a === 6 && games.b === 6);

  function cerrarSet(p, set) {
    sets.push(set);
    setsGanados[p]++;
    games = { a: 0, b: 0 };
    pts = { a: 0, b: 0 };
    if (setsGanados[p] === setsParaGanar) ganador = p;
  }

  for (const p of puntos) {
    if (ganador) break;
    if (p !== "a" && p !== "b") continue;
    const o = p === "a" ? "b" : "a";
    validos++;
    ultimo = p;

    if (esTb()) {
      const superTb = esSuperTb();
      pts[p]++;
      const meta = superTb ? 10 : 7;
      if (pts[p] >= meta && pts[p] - pts[o] >= 2) {
        const tb = { a: pts.a, b: pts.b };
        if (superTb) {
          cerrarSet(p, { a: tb.a, b: tb.b, super: true });
        } else {
          const g = { a: games.a, b: games.b };
          g[p]++;
          cerrarSet(p, { a: g.a, b: g.b, tb });
        }
      }
      continue;
    }

    pts[p]++;
    // game: a 4 puntos con 2 de diferencia; con punto de oro, en 40-40 define el siguiente
    const ganaGame = pts[p] >= 4 && (pts[p] - pts[o] >= 2 || (cfg.oro && pts[o] === 3));
    if (!ganaGame) continue;

    games[p]++;
    pts = { a: 0, b: 0 };
    // set: a 6 games con 2 de diferencia (7-5); en 6-6 se juega tie-break
    if (games[p] >= 6 && games[p] - games[o] >= 2) {
      cerrarSet(p, { a: games.a, b: games.b });
    }
  }

  const tb = !ganador && esTb();
  const superTb = !ganador && esSuperTb();
  const iguales = !tb && pts.a >= 3 && pts.a === pts.b;
  let ventaja = null;
  let display;

  if (tb) {
    display = { a: String(pts.a), b: String(pts.b) };
  } else if (pts.a >= 3 && pts.b >= 3) {
    // 40-40 o ventaja (con punto de oro nunca se pasa de 40-40)
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
    ganador,
    tb,
    superTb,
    iguales,
    oroAhora: iguales && !!cfg.oro,
    ventaja,
    validos,
    ultimo
  };
}

/** Texto corto de un set terminado: "6-4", "7-6 (7-5)", "[10-8]". */
function textoSet(set) {
  if (set.super) return `[${set.a}-${set.b}]`;
  if (set.tb) return `${set.a}-${set.b} (${set.tb.a}-${set.tb.b})`;
  return `${set.a}-${set.b}`;
}

if (typeof module !== "undefined") module.exports = { calcularPadel, textoSet };
