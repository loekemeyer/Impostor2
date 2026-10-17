/* ===================================================================
   TRUCO — Contador de puntos con fósforos
   -------------------------------------------------------------------
   Dos equipos, un celular sobre la mesa. Se juega a 15 o a 30 (15 malas
   + 15 buenas). Tocar la columna de un equipo = +1; el «−» de abajo
   resta uno; ↺ deshace la última anotación. Los puntos se dibujan como
   fósforos: 4 palitos en cuadrado y el 5.º cruzado.

   El partido queda guardado en el celular (localStorage), así que si se
   cierra la app o se apaga la pantalla, se sigue donde estaba.

   Usa de script.js: pantallas, mostrarPantalla, sonar.
   =================================================================== */

(function () {
  "use strict";

  const CLAVE = "truco-partido";   // localStorage: partido en curso
  const EQUIPOS = ["a", "b"];

  pantallas.trucoConfig = document.getElementById("screen-truco-config");
  pantallas.truco       = document.getElementById("screen-truco");

  const el = (id) => document.getElementById(id);

  /* ---------- Estado ---------- */
  const T = {
    meta: 30,                       // 15 | 30
    nombres: { a: "", b: "" },
    puntos: { a: 0, b: 0 },
    historial: []                   // ["a", "b", "-a", …] para deshacer
  };

  const nombre = (e) => T.nombres[e] || (e === "a" ? "Nosotros" : "Ellos");
  const ganador = () => EQUIPOS.find((e) => T.puntos[e] >= T.meta) || null;

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(T)); } catch (e) { /* sin storage: sigue en memoria */ }
  }

  function cargar() {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE));
      if (!g || !g.puntos) return;
      T.meta = g.meta === 15 ? 15 : 30;
      T.nombres = { a: g.nombres?.a || "", b: g.nombres?.b || "" };
      T.puntos = { a: +g.puntos.a || 0, b: +g.puntos.b || 0 };
      T.historial = Array.isArray(g.historial) ? g.historial : [];
    } catch (e) { /* guardado roto: arranca de cero */ }
  }

  /* ---------- Fósforos ---------- */
  /* Un cuadradito de 1 a 5 palitos (SVG): arriba, derecha, abajo, izquierda, diagonal. */
  const PALITOS = [
    "M6 6 L38 6", "M38 6 L38 38", "M38 38 L6 38", "M6 38 L6 6", "M6 6 L38 38"
  ];
  function cuadradito(n) {
    const lineas = PALITOS.map((d, i) =>
      `<path d="${d}" class="${i < n ? "on" : "off"}"/>`).join("");
    return `<svg viewBox="0 0 44 44" class="truco-cuadro" aria-hidden="true">${lineas}</svg>`;
  }

  /* Columna de fósforos de un equipo; a 30, una raya separa malas de buenas. */
  function dibujarFosforos(e) {
    const grupos = T.meta / 5;
    let html = "";
    for (let g = 0; g < grupos; g++) {
      if (T.meta === 30 && g === 3) html += `<span class="truco-raya">buenas</span>`;
      html += cuadradito(Math.max(0, Math.min(5, T.puntos[e] - g * 5)));
    }
    el(`truco-fosforos-${e}`).innerHTML = html;
  }

  /* "malas" / "buenas" bajo el número, sólo a 30 */
  function etapa(p) {
    if (T.meta !== 30) return "";
    return p < 15 ? "malas" : "buenas";
  }

  function render() {
    EQUIPOS.forEach((e) => {
      el(`truco-name-${e}`).textContent = nombre(e);
      el(`truco-pts-${e}`).textContent = T.puntos[e];
      el(`truco-etapa-${e}`).textContent = etapa(T.puntos[e]);
      el(`truco-menos-${e}`).disabled = T.puntos[e] === 0;
      dibujarFosforos(e);
    });
    el("truco-meta").textContent = `A ${T.meta}`;
    el("truco-deshacer").disabled = T.historial.length === 0;

    const g = ganador();
    el("truco-fin").hidden = !g;
    if (g) {
      el("truco-fin-titulo").textContent = `¡Ganó ${nombre(g)}!`;
      el("truco-fin-total").textContent = `${T.puntos.a} a ${T.puntos.b}`;
    }
  }

  /* ---------- Acciones ---------- */
  function sumar(e) {
    if (ganador()) return;
    T.puntos[e]++;
    T.historial.push(e);
    guardar();
    const col = el(`truco-tap-${e}`);
    col.classList.remove("is-flash");
    void col.offsetWidth;   // reinicia la animación
    col.classList.add("is-flash");
    sonar(ganador() ? "normal" : "click");
    render();
  }

  function restar(e) {
    if (T.puntos[e] === 0) return;
    T.puntos[e]--;
    T.historial.push("-" + e);
    guardar();
    sonar("click");
    render();
  }

  function deshacer() {
    const ultimo = T.historial.pop();
    if (!ultimo) return;
    if (ultimo[0] === "-") T.puntos[ultimo[1]]++;
    else T.puntos[ultimo]--;
    guardar();
    sonar("click");
    render();
  }

  function nuevoPartido() {
    T.puntos = { a: 0, b: 0 };
    T.historial = [];
    guardar();
  }

  /* ---------- Configuración ---------- */
  function renderConfig() {
    document.querySelectorAll(".truco-metas .seg-btn").forEach((b) => {
      b.classList.toggle("is-selected", +b.dataset.meta === T.meta);
    });
    el("truco-nombre-a").value = T.nombres.a;
    el("truco-nombre-b").value = T.nombres.b;
    const enCurso = (T.puntos.a || T.puntos.b) && !ganador();
    el("btn-truco-seguir").hidden = !enCurso;
    el("btn-truco-empezar").textContent = enCurso ? "Partido nuevo" : "Empezar";
  }

  function leerConfig() {
    T.nombres.a = el("truco-nombre-a").value.trim();
    T.nombres.b = el("truco-nombre-b").value.trim();
  }

  el("btn-open-truco").addEventListener("click", () => {
    renderConfig();
    mostrarPantalla("trucoConfig");
    sonar("click");
  });

  document.querySelectorAll(".truco-metas .seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      T.meta = +b.dataset.meta;
      renderConfig();
      sonar("click");
    });
  });

  el("btn-truco-empezar").addEventListener("click", () => {
    leerConfig();
    nuevoPartido();
    render();
    mostrarPantalla("truco");
    sonar("click");
  });

  el("btn-truco-seguir").addEventListener("click", () => {
    leerConfig();
    guardar();
    render();
    mostrarPantalla("truco");
    sonar("click");
  });

  el("btn-truco-volver").addEventListener("click", () => {
    leerConfig();
    guardar();
    mostrarPantalla("config");
    sonar("click");
  });

  /* ---------- Tablero ---------- */
  EQUIPOS.forEach((e) => {
    el(`truco-tap-${e}`).addEventListener("click", () => sumar(e));
    el(`truco-menos-${e}`).addEventListener("click", () => restar(e));
  });
  el("truco-deshacer").addEventListener("click", deshacer);
  el("truco-fin-deshacer").addEventListener("click", deshacer);
  el("truco-salir").addEventListener("click", () => {
    renderConfig();
    mostrarPantalla("trucoConfig");
    sonar("click");
  });
  el("btn-truco-revancha").addEventListener("click", () => {
    nuevoPartido();
    render();
    sonar("click");
  });

  cargar();
})();
