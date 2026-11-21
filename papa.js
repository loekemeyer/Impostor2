/* Papa Caliente: juego de categorías. Modo "Un celular" (se pasa el teléfono) y modo "Online"
   (salas por código con Supabase Realtime: broadcast + presence, sin tablas).
   En online manda el anfitrión: él tiene la mecha, valida respuestas y difunde el estado. */
(function () {
  "use strict";
  const SUPA_URL = "https://kwkclwhmoygunqmlegrg.supabase.co";
  const SUPA_KEY = "sb_publishable_mVX5MnjwM770cNjgiL6yLw_LDNl9pML";
  const SUPA_LIB = {
    src: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
    sri: "sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok"
  };
  const STAR = 6, MAX_H = 5, BOOM_MS = 4000;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const DICT = {};
  for (const k in CATS) DICT[k] = [...new Set(CATS[k].split(",").map(norm))];
  const sing = (a) => a.replace(/(es|s)$/, "");
  function rarity(cat, a) {
    const arr = DICT[cat];
    let i = arr.indexOf(a);
    if (i < 0) i = arr.findIndex((x) => sing(x) === sing(a));
    if (i < 0) return 0;
    return i < arr.length / 3 ? 1 : i < (2 * arr.length) / 3 ? 2 : 3;
  }
  const newId = () => Math.random().toString(36).slice(2, 10);

  /* ---------------- estado ---------------- */
  let mode = "local";          // local | online
  let isHost = true;
  const myId = newId();
  let S = null;                // estado del juego (lo dueño: el anfitrión)
  let catsLeft = [];
  let fuseTimer = null, nextTimer = null;
  let roundT0 = 0;             // reloj local para el calor
  let chan = null, roomCode = "", lobbyPeople = [];

  /* ---------------- motor (sólo anfitrión) ---------------- */
  function alive() { return S.ps.filter((p) => p.h > 0); }
  function nextIdx(i) {
    const n = S.ps.length;
    for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (S.ps[j].h > 0) return j; }
    return i;
  }
  function pickCat() {
    if (!catsLeft.length) catsLeft = Object.keys(CATS).sort(() => Math.random() - 0.5);
    return catsLeft.pop();
  }
  function baseSecs() { return Math.max(9, 22 - S.round) * S.speed; }
  function startGame(people, lives, speed) {
    S = { ps: people.map((p) => ({ id: p.id, n: p.n, h: lives, s: 0 })), cur: 0, round: 0, speed,
      phase: "play", cat: "", used: [], last: null, boom: null };
    hostNewRound();
  }
  function hostNewRound() {
    clearTimeout(nextTimer);
    S.round++; S.cat = pickCat(); S.used = []; S.last = null; S.boom = null; S.phase = "play";
    S.seq = (S.seq || 0) + 1;
    const fuse = baseSecs() * (0.55 + Math.random() * 0.9) * 1000;
    clearTimeout(fuseTimer);
    fuseTimer = setTimeout(hostExplode, fuse);
    publish();
  }
  function hostAnswer(fromId, raw) {
    if (!S || S.phase !== "play") return;
    const p = S.ps[S.cur];
    if (p.id !== fromId) return;
    const a = norm(raw || "");
    if (a.length < 2) return reply(fromId, "Escribí algo.", "bad");
    const key = sing(a);
    if (S.used.some((u) => u.k === key)) return reply(fromId, `"${raw.trim()}" ya se dijo.`, "bad");
    const r = rarity(S.cat, a);
    S.used.push({ a: raw.trim().slice(0, 40), k: key, r });
    let txt = `${p.n}: ` + (r === 3 ? "rarísima, +3" : r === 2 ? "buena, +2" : r === 1 ? "vale, +1" : "no la conozco, pasa con +0");
    p.s += r;
    if (p.s >= STAR) { p.s -= STAR; if (p.h < MAX_H) { p.h++; txt += " · ¡corazón extra!"; } }
    S.last = { txt, cls: r === 3 ? "rare" : r === 0 ? "" : "ok", r };
    S.cur = nextIdx(S.cur);
    publish();
  }
  function hostExplode() {
    if (!S || S.phase !== "play") return;
    const p = S.ps[S.cur];
    p.h--;
    const left = alive();
    if (left.length <= 1) {
      S.phase = "end";
      S.boom = { victim: p.n, winner: left[0] ? left[0].n : "nadie" };
    } else {
      S.phase = "boom";
      S.boom = { victim: p.n, h: p.h };
      if (p.h <= 0) S.cur = nextIdx(S.cur);
      if (mode === "online") nextTimer = setTimeout(hostNewRound, BOOM_MS);
    }
    publish();
  }
  function hostDrop(id) {             // alguien se fue de la sala online
    if (!S || S.phase === "end") return;
    const i = S.ps.findIndex((p) => p.id === id);
    if (i < 0 || S.ps[i].h <= 0) return;
    S.ps[i].h = 0;
    if (alive().length <= 1) {
      clearTimeout(fuseTimer);
      S.phase = "end"; S.boom = { victim: S.ps[i].n + " (se fue)", winner: alive()[0] ? alive()[0].n : "nadie" };
    } else if (S.cur === i) S.cur = nextIdx(i);
    publish();
  }

  /* ---------------- red ---------------- */
  function publish() {
    if (mode === "online" && chan) chan.send({ type: "broadcast", event: "state", payload: S });
    applyState(S);
  }
  function reply(toId, txt, cls) {
    if (toId === myId || mode === "local") return flash(txt, cls);
    if (chan) chan.send({ type: "broadcast", event: "note", payload: { to: toId, txt, cls } });
  }
  function loadLib() {
    if (window.supabase) return Promise.resolve(window.supabase);
    return new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = SUPA_LIB.src; s.integrity = SUPA_LIB.sri; s.crossOrigin = "anonymous";
      s.onload = () => (window.supabase ? ok(window.supabase) : bad(new Error("lib")));
      s.onerror = () => bad(new Error("lib"));
      document.head.appendChild(s);
    });
  }
  async function connect(code, name, host) {
    const lib = await loadLib();
    const client = lib.createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    chan = client.channel("papa-" + code, { config: { presence: { key: myId }, broadcast: { self: false } } });
    chan.on("presence", { event: "sync" }, () => {
      const st = chan.presenceState();
      lobbyPeople = Object.keys(st).map((id) => ({ id, n: st[id][0].n, host: !!st[id][0].host, t: st[id][0].t }))
        .sort((a, b) => a.t - b.t);
      if (isHost && S) S.ps.forEach((p) => { if (p.h > 0 && !st[p.id]) hostDrop(p.id); });
      if (!isHost && S && S.phase !== "end" && !lobbyPeople.some((p) => p.host)) {
        flash("El anfitrión se fue de la sala.", "bad");
      }
      renderLobby();
    });
    chan.on("broadcast", { event: "state" }, ({ payload }) => { if (!isHost) applyState(payload); });
    chan.on("broadcast", { event: "answer" }, ({ payload }) => { if (isHost) hostAnswer(payload.id, payload.a); });
    chan.on("broadcast", { event: "hello" }, () => { if (isHost && S) publish(); });
    chan.on("broadcast", { event: "note" }, ({ payload }) => { if (payload.to === myId) flash(payload.txt, payload.cls); });
    await new Promise((ok, bad) => {
      const t = setTimeout(() => bad(new Error("timeout")), 10000);
      chan.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(t);
          await chan.track({ n: name, host, t: Date.now() });
          if (!host) chan.send({ type: "broadcast", event: "hello", payload: {} });
          ok();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(t); bad(new Error(status)); }
      });
    });
  }

  /* ---------------- pantallas ---------------- */
  function show(id) { ["setup", "lobby", "game", "boom"].forEach((s) => ($(s).hidden = s !== id && !(id === "boom" && s === "game"))); }
  function flash(t, c) { $("msg").textContent = t; $("msg").className = "msg " + (c || ""); }

  let lastSeq = -1, lastUsed = 0;
  function applyState(st) {
    if (!st) return;
    S = isHost ? S : st;
    const view = st;
    if (view.phase === "play" && view.seq !== lastSeq) {   // ronda nueva
      lastSeq = view.seq; lastUsed = 0; roundT0 = performance.now(); live = true;
      $("cat").textContent = view.cat; flash("", "");
      show("game");
      $("ansIn").value = "";
      requestAnimationFrame(loop);
    }
    if (view.used.length > lastUsed) { lastUsed = view.used.length; if (view.last) { flash(view.last.txt, view.last.cls); beep(view.last.r >= 2 ? 880 : 660, 0.08, "sine", 0.08); } }
    renderGame(view);
    if (view.phase === "boom" || view.phase === "end") { live = false; showBoom(view); }
  }
  function myTurn(view) { return mode === "local" || (view.ps[view.cur] && view.ps[view.cur].id === myId); }
  function renderGame(v) {
    $("players").innerHTML = v.ps.map((p, i) =>
      `<div class="pl ${i === v.cur && v.phase === "play" ? "on" : ""} ${p.h <= 0 ? "out" : ""}"><span class="n">${esc(p.n)}${p.id === myId && mode === "online" ? " (vos)" : ""}</span>` +
      `<span class="hearts" aria-label="${p.h} corazones">${"♥".repeat(Math.max(0, p.h)) || "—"}</span>` +
      `<div class="bar" title="Rareza ${p.s}/${STAR}"><i style="width:${(p.s / STAR) * 100}%"></i></div></div>`).join("");
    const holder = v.ps[v.cur];
    const mine = myTurn(v);
    $("turn").innerHTML = mode === "online" && mine ? "<b>¡La papa la tenés vos!</b>" : `La papa la tiene <b>${esc(holder.n)}</b>`;
    $("ansIn").disabled = !mine || v.phase !== "play";
    $("ansIn").placeholder = mine ? "Tu respuesta" : "Esperá tu turno";
    if (mine && v.phase === "play" && document.activeElement !== $("ansIn")) $("ansIn").focus();
    $("used").innerHTML = v.used.map((u) => `<span class="r${u.r}">${esc(u.a)}</span>`).join("");
  }
  function showBoom(v) {
    boomSound(); drawPapa(1, 0, true);
    $("boomT").textContent = "¡Explotó!";
    $("boom").hidden = false;
    if (v.phase === "end") {
      $("boomP").innerHTML = `Le explotó a ${esc(v.boom.victim)}. <b>Gana ${esc(v.boom.winner)}</b>.`;
      $("nextBtn").hidden = mode === "online" && !isHost;
      $("nextBtn").textContent = mode === "online" ? "Volver a la sala" : "Jugar de nuevo";
      $("nextBtn").onclick = () => {
        if (mode === "online") { S = { ...S, phase: "lobby" }; publish(); }
        else { S = null; show("setup"); }
      };
    } else {
      $("boomP").textContent = v.boom.h > 0 ? `${v.boom.victim} pierde un corazón (le quedan ${v.boom.h}).` : `${v.boom.victim} queda afuera.`;
      $("nextBtn").hidden = mode === "online";
      $("nextBtn").textContent = "Siguiente ronda";
      $("nextBtn").onclick = hostNewRound;
      if (mode === "online") $("boomP").textContent += " La próxima ronda arranca sola.";
    }
    if (!$("nextBtn").hidden) $("nextBtn").focus();
  }
  // vuelta a la sala (online)
  const _apply = applyState;
  applyState = function (st) {
    if (st && st.phase === "lobby") { if (!isHost) S = st; lastSeq = -1; live = false; show("lobby"); renderLobby(); return; }
    _apply(st);
  };

  $("ansForm").onsubmit = (e) => {
    e.preventDefault();
    if (!S || S.phase !== "play") return;
    const raw = $("ansIn").value;
    if (!myTurn(S)) return;
    $("ansIn").value = "";
    const who = mode === "local" ? S.ps[S.cur].id : myId;
    if (isHost) hostAnswer(who, raw);
    else chan.send({ type: "broadcast", event: "answer", payload: { id: myId, a: raw } });
  };

  /* ---------------- configuración ---------------- */
  let players = ["Ana", "Bruno", "Caro"];
  function renderChips() {
    $("chips").innerHTML = players.map((p, i) => `<span class="chip">${esc(p)}<button type="button" aria-label="Sacar ${esc(p)}" data-i="${i}">×</button></span>`).join("");
  }
  $("addForm").onsubmit = (e) => {
    e.preventDefault();
    const v = $("nameIn").value.trim();
    if (!v) return;
    if (players.length >= 10) return ($("setupMsg").textContent = "Máximo 10 jugadores.");
    if (players.some((p) => p.toLowerCase() === v.toLowerCase())) return ($("setupMsg").textContent = "Ese nombre ya está.");
    players.push(v); $("nameIn").value = ""; $("setupMsg").textContent = ""; renderChips();
  };
  $("chips").onclick = (e) => { const i = e.target.dataset.i; if (i !== undefined) { players.splice(+i, 1); renderChips(); } };
  renderChips();
  try { $("myName").value = localStorage.getItem("papa-nombre") || ""; } catch (e) { /* sin storage */ }

  function setMode(m) {
    mode = m;
    $("tabLocal").setAttribute("aria-pressed", m === "local");
    $("tabOnline").setAttribute("aria-pressed", m === "online");
    $("localBox").hidden = m !== "local";
    $("onlineBox").hidden = m !== "online";
    $("startBtn").hidden = m !== "local";
    $("setupMsg").textContent = "";
  }
  $("tabLocal").onclick = () => setMode("local");
  $("tabOnline").onclick = () => setMode("online");

  function unlockAudio() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* sin audio */ } }

  $("startBtn").onclick = () => {
    if (players.length < 2) return ($("setupMsg").textContent = "Hacen falta al menos 2 jugadores.");
    unlockAudio(); isHost = true;
    startGame(players.map((n) => ({ id: newId(), n })), +$("livesSel").value, +$("speedSel").value);
  };

  function myNameOk() {
    const n = $("myName").value.trim();
    if (!n) { $("setupMsg").textContent = "Poné tu nombre."; return null; }
    try { localStorage.setItem("papa-nombre", n); } catch (e) { /* sin storage */ }
    return n.slice(0, 16);
  }
  async function enterRoom(code, host) {
    const n = myNameOk(); if (!n) return;
    unlockAudio(); isHost = host; roomCode = code;
    $("setupMsg").className = "msg"; $("setupMsg").textContent = "Conectando…";
    try {
      await connect(code, n, host);
      $("setupMsg").textContent = "";
      $("lobbyCode").textContent = code;
      try { history.replaceState(null, "", "#" + code); } catch (e) { /* nada */ }
      show("lobby"); renderLobby();
    } catch (e) {
      $("setupMsg").className = "msg bad";
      $("setupMsg").textContent = "No se pudo conectar a la sala. Revisá la conexión y probá de nuevo.";
    }
  }
  $("hostBtn").onclick = () => {
    const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let c = ""; for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
    enterRoom(c, true);
  };
  $("joinBtn").onclick = () => {
    const c = $("codeIn").value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return ($("setupMsg").textContent = "El código son 4 letras.");
    enterRoom(c, false);
  };
  const hashCode = (location.hash || "").slice(1).toUpperCase();
  if (/^[A-Z]{4}$/.test(hashCode)) { setMode("online"); $("codeIn").value = hashCode; }

  function renderLobby() {
    if ($("lobby").hidden) return;
    $("lobbyList").innerHTML = lobbyPeople.map((p) => `<span class="chip" style="padding-right:12px">${esc(p.n)}${p.host ? " · anfitrión" : ""}${p.id === myId ? " (vos)" : ""}</span>`).join("");
    $("lobbyStart").hidden = !isHost;
    if (isHost) {
      if ($("optsBox").parentNode !== $("lobbyOpts")) $("lobbyOpts").append($("optsBox"));
      $("lobbyMsg").textContent = lobbyPeople.length < 2 ? "Esperando que entre alguien más." : `${lobbyPeople.length} en la sala.`;
    } else {
      $("lobbyMsg").textContent = "Esperando que el anfitrión empiece.";
    }
  }
  $("lobbyStart").onclick = () => {
    if (lobbyPeople.length < 2) return ($("lobbyMsg").textContent = "Hacen falta al menos 2 jugadores.");
    const people = lobbyPeople.slice(0, 10).map((p) => ({ id: p.id, n: p.n }));
    startGame(people, +$("livesSel").value, +$("speedSel").value);
  };

  /* ---------------- sonido ---------------- */
  let AC = null;
  function beep(f, d, t = "square", v = 0.05) {
    if (!AC) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = t; o.frequency.value = f; g.gain.value = v; o.connect(g); g.connect(AC.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d); o.stop(AC.currentTime + d);
  }
  function boomSound() {
    if (!AC) return;
    const b = AC.createBuffer(1, AC.sampleRate * 0.6, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const s = AC.createBufferSource(), g = AC.createGain(); g.gain.value = 0.4;
    s.buffer = b; s.connect(g); g.connect(AC.destination); s.start();
  }

  /* ---------------- dibujo ---------------- */
  const cv = $("cv"), ctx = cv.getContext("2d");
  function drawPapa(heat, t, exploded) {
    ctx.clearRect(0, 0, 400, 400);
    const css = getComputedStyle(document.documentElement);
    const papa = css.getPropertyValue("--papa").trim(), dark = css.getPropertyValue("--papa-dark").trim(), fire = css.getPropertyValue("--fire").trim();
    ctx.save(); ctx.translate(200, 210);
    if (exploded) {
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; ctx.fillStyle = i % 2 ? fire : papa; ctx.beginPath(); ctx.arc(Math.cos(a) * 120, Math.sin(a) * 120, 18, 0, 7); ctx.fill(); }
      ctx.restore(); return;
    }
    const shake = heat * heat * 10;
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const s = 1 + heat * 0.18 + Math.sin(t / (200 - heat * 150)) * 0.03 * (1 + heat * 3); ctx.scale(s, s);
    ctx.strokeStyle = fire; ctx.globalAlpha = 0.25 + heat * 0.6; ctx.lineWidth = 6; ctx.lineCap = "round";
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); const ox = i * 40; for (let y = 0; y < 60; y += 4) ctx.lineTo(ox + Math.sin(y / 10 + t / 150 + i) * 8, -110 - y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = papa; ctx.strokeStyle = dark; ctx.lineWidth = 6; ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, r = Math.cos(a) ** 2 * 25 + 85 + Math.sin(a * 3) * 6; ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 0.85); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = fire; ctx.globalAlpha = heat * 0.55; ctx.beginPath(); ctx.ellipse(0, 0, 110, 75, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = dark;
    [[-50, -30], [40, 10], [-10, 40], [70, -35], [-80, 20]].forEach(([x, y]) => { ctx.beginPath(); ctx.ellipse(x, y, 5, 3, 0.4, 0, 7); ctx.fill(); });
    ctx.restore();
  }
  let live = false, lastTick = 0;
  function loop(now) {
    if (!live || !S) return;
    const minF = Math.max(9, 22 - S.round) * S.speed * 550;
    const heat = Math.min(1, (now - roundT0) / minF);
    drawPapa(heat, now, false);
    if (now - lastTick > Math.max(140, 700 - heat * 560)) { lastTick = now; beep(heat > 0.7 ? 1000 : 600, 0.04, "square", 0.03); }
    requestAnimationFrame(loop);
  }
  drawPapa(0, 0, false);
})();
