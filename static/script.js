document.addEventListener("DOMContentLoaded", () => {
  const DEFAULT_COVER = window.DEFAULT_COVER_URL || "/static/default_cover.png";
  const $ = (id) => document.getElementById(id);

  const progNome = $("progNome");
  const progDesc = $("progDesc");
  const proximoTxt = $("proximoTxt");
  const stationLabel = $("stationLabel");
  const player = $("player");
  const canvas = $("equalizer");
  const ctx = canvas.getContext("2d");
  const autoBtn = $("autoBtn");
  const playBtn = $("playBtn");
  const identifyBtn = $("identifyBtn");
  const logContent = $("logContent");
  const logPanel = $("logPanel");
  const toggleLogs = $("toggleLogs");
  const showLogsBtn = $("showLogsBtn");
  const weatherEl = $("weather");
  const datetime = $("datetime");
  const trackNow = $("trackNow");
  const trackMeta = $("trackMeta");
  const shazamStatus = $("shazamStatus");
  const coverArt = $("coverArt");
  const coverFallback = $("coverFallback");
  const defaultCoverImg = $("defaultCoverImg");

  if (defaultCoverImg) defaultCoverImg.src = DEFAULT_COVER;

  let auto = true;
  let userStarted = false;
  let wantPlaying = false;
  let identifying = false;
  let currentProgram = null;
  let lastProgramName = null;
  let currentBaseUrl = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let lastTimeUpdate = Date.now();
  let bufferTimer = null;
  let hls = null;

  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let frequencyData = null;
  let smoothArray = null;
  let usingRealSpectrum = false;
  let spectrumLoopStarted = false;
  let realSpectrumLogged = false;
  let stableSpectrumLogged = false;

  function log(msg) {
    const ts = new Date().toLocaleTimeString("pt-PT", { hour12: false });
    const line = document.createElement("div");
    line.innerHTML = `<b>[${ts}]</b> ${msg}`;
    logContent.prepend(line);

    while (logContent.childElementCount > 40) {
      logContent.lastChild.remove();
    }
  }

  function setStatus(text, mode = "idle") {
    shazamStatus.textContent = text;
    shazamStatus.dataset.mode = mode;
  }

  function updateClock() {
    const now = new Date();
    datetime.textContent = now.toLocaleString("pt-PT", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  updateClock();
  setInterval(updateClock, 1000);

  async function atualizarTempo() {
    try {
      const resp = await fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=38.72&longitude=-9.14&current_weather=true&timezone=Europe/Lisbon"
      );
      const data = await resp.json();
      const t = data.current_weather?.temperature;
      const code = data.current_weather?.weathercode;
      const isDay = data.current_weather?.is_day;
      if (t === undefined) return;

      let ic = "☀️";
      if ([0, 1].includes(code)) ic = isDay ? "☀️" : "🌙";
      else if ([2, 3].includes(code)) ic = "🌤️";
      else if ([45, 48].includes(code)) ic = "🌫️";
      else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) ic = "🌧️";
      else if ([95, 96, 99].includes(code)) ic = "⛈️";

      weatherEl.textContent = `${ic} Lisboa • ${t.toFixed(1)} °C`;
    } catch {
      weatherEl.textContent = "🌤️ Lisboa • — °C";
    }
  }

  atualizarTempo();
  setInterval(atualizarTempo, 15 * 60 * 1000);

  if (toggleLogs && showLogsBtn && logPanel) {
    toggleLogs.onclick = () => {
      logPanel.classList.add("closed");
      showLogsBtn.style.display = "block";
    };
    showLogsBtn.onclick = () => {
      logPanel.classList.remove("closed");
      showLogsBtn.style.display = "none";
    };
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  function roundRect(c, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + width, y, x + width, y + height, r);
    c.arcTo(x + width, y + height, x, y + height, r);
    c.arcTo(x, y + height, x, y, r);
    c.arcTo(x, y, x + width, y, r);
    c.closePath();
  }

  function drawIdleSpectrum(w, h) {
    const bars = player.paused ? 72 : 88;
    const now = performance.now();

    for (let i = 0; i < bars; i++) {
      const x = (i * w) / bars;
      const wave1 = Math.sin(i * 0.38 + now / 310) * 0.5 + 0.5;
      const wave2 = Math.sin(i * 0.11 + now / 170) * 0.5 + 0.5;
      const pulse = player.paused ? wave1 * 0.16 : wave1 * 0.55 + wave2 * 0.45;
      const bh = Math.max(6, (0.18 + pulse * 0.65) * h * (player.paused ? 0.45 : 0.95));
      const hue = (188 + i * 2.7 + now / 45) % 360;

      ctx.shadowColor = `hsla(${hue}, 100%, 65%, ${player.paused ? ".25" : ".70"})`;
      ctx.shadowBlur = player.paused ? 8 : 16;

      const grad = ctx.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, `hsl(${hue}, 100%, 72%)`);
      grad.addColorStop(0.55, `hsl(${(hue + 55) % 360}, 100%, 58%)`);
      grad.addColorStop(1, `hsl(${(hue + 110) % 360}, 100%, 44%)`);

      ctx.fillStyle = grad;
      roundRect(ctx, x + 2, h - bh, Math.max(3, w / bars - 4), bh, 9);
      ctx.fill();
    }
  }

  function drawRealSpectrum(w, h) {
    if (!analyser || !frequencyData || !smoothArray) {
      drawIdleSpectrum(w, h);
      return;
    }

    analyser.getByteFrequencyData(frequencyData);
    const bars = 96;
    const step = Math.max(1, Math.floor(frequencyData.length / bars));
    const now = performance.now();

    for (let i = 0; i < bars; i++) {
      let avg = 0;
      const start = i * step;
      for (let j = 0; j < step; j++) avg += frequencyData[start + j] || 0;
      avg /= step;

      smoothArray[i] += (avg - smoothArray[i]) * 0.22;
      const energy = Math.min(1, smoothArray[i] / 255);
      const bh = Math.max(5, Math.pow(energy, 0.72) * h * 1.18);
      const x = (i * w) / bars;
      const hue = (188 + i * 2.8 + now / 55) % 360;

      ctx.shadowColor = `hsla(${hue}, 100%, 65%, .72)`;
      ctx.shadowBlur = 18;

      const grad = ctx.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, `hsl(${hue}, 100%, 76%)`);
      grad.addColorStop(0.55, `hsl(${(hue + 52) % 360}, 100%, 58%)`);
      grad.addColorStop(1, `hsl(${(hue + 105) % 360}, 100%, 42%)`);

      ctx.fillStyle = grad;
      roundRect(ctx, x + 2, h - bh, Math.max(3, w / bars - 4), bh, 9);
      ctx.fill();
    }
  }

  function drawSpectrum() {
    requestAnimationFrame(drawSpectrum);
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (usingRealSpectrum && !player.paused) drawRealSpectrum(w, h);
    else drawIdleSpectrum(w, h);

    ctx.shadowBlur = 0;
  }

  function ensureRealSpectrum() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      if (!sourceNode) {
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.minDecibels = -92;
        analyser.maxDecibels = -8;
        analyser.smoothingTimeConstant = 0.72;

        sourceNode = audioCtx.createMediaElementSource(player);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);

        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        smoothArray = new Float32Array(128);
      }

      if (audioCtx.state === "suspended") audioCtx.resume();
      usingRealSpectrum = true;

      if (!realSpectrumLogged) {
        log("🎚️ Spectrum analyzer real ligado ao áudio da rádio.");
        realSpectrumLogged = true;
      }
    } catch (err) {
      console.warn(err);
      usingRealSpectrum = false;
      log("⚠️ Não consegui ligar o spectrum real. Mantive animação visual.");
    }
  }


  function isInternalStreamUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.origin);
      return u.origin === window.location.origin && u.pathname.startsWith("/stream/");
    } catch {
      return false;
    }
  }

  function realSpectrumAllowed() {
    const url = getProgramPlayerUrl() || currentBaseUrl || player.currentSrc || player.src;
    return isInternalStreamUrl(url);
  }

  function maybeEnableRealSpectrum() {
    // Só ligamos WebAudio quando o áudio vem do nosso domínio (/stream/...).
    // Em streams externos diretos, o browser pode cortar/mutar o som por CORS.
    // Por isso, no modo estável, mantemos o player direto e usamos spectrum visual.
    if (realSpectrumAllowed()) {
      ensureRealSpectrum();
      return;
    }

    usingRealSpectrum = false;
    if (!stableSpectrumLogged) {
      log("🎚️ Modo estável ativo: rádio direta sem proxy. Spectrum visual para não cortar a emissão.");
      stableSpectrumLogged = true;
    }
  }

  if (!spectrumLoopStarted) {
    spectrumLoopStarted = true;
    drawSpectrum();
  }

  function resetTrack(title, meta) {
    trackNow.textContent = title;
    trackNow.classList.add("tocando");
    trackMeta.textContent = meta || "";
    coverArt.hidden = true;
    coverArt.removeAttribute("src");
    if (defaultCoverImg) defaultCoverImg.src = DEFAULT_COVER;
    coverFallback.hidden = false;
  }

  function freshUrl(url) {
    if (!url) return url;

    // Só forçamos cache-buster no proxy interno. Assim cada religação abre uma
    // ligação nova ao Flask e evita que o browser reutilize uma ligação quebrada.
    if (url.startsWith("/stream/") || url.includes("/stream/")) {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}r=${Date.now()}`;
    }

    return url;
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function getProgramPlayerUrl() {
    if (!currentProgram) return currentBaseUrl;
    return currentProgram.stream_url_for_player || currentProgram.proxy_url || currentProgram.url || currentProgram.direct_url;
  }

  function setPlayerSource(url, forceFresh = false) {
    if (!url) return;

    const baseUrl = url;
    const playableUrl = forceFresh ? freshUrl(baseUrl) : baseUrl;

    if (!forceFresh && currentBaseUrl === baseUrl && player.src) return;

    destroyHls();
    currentBaseUrl = baseUrl;

    if (playableUrl.includes(".m3u8") && window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(playableUrl);
      hls.attachMedia(player);
    } else {
      player.src = playableUrl;
      player.load();
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(reason = "stream interrompido", delay = 1600) {
    if (!wantPlaying) return;
    if (reconnectTimer) return;

    reconnectAttempts += 1;
    const wait = Math.min(delay + reconnectAttempts * 600, 7000);

    setStatus(`A rádio caiu por instantes. A religar automaticamente… (${reconnectAttempts})`, "loading");
    log(`🔁 ${reason}. A religar automaticamente em ${(wait / 1000).toFixed(1)}s...`);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await reconnectPlayback(reason);
    }, wait);
  }

  async function reconnectPlayback(reason = "religação") {
    if (!wantPlaying) return;

    try {
      const url = getProgramPlayerUrl();
      setPlayerSource(url, true);
      maybeEnableRealSpectrum();
      await player.play();
      playBtn.textContent = "⏸ Pausar rádio";
      setStatus(usingRealSpectrum ? "Rádio religada automaticamente com spectrum real." : "Rádio religada em modo estável.", "ok");
      log(`✅ Rádio religada automaticamente (${reason}).`);
    } catch (err) {
      console.error(err);
      scheduleReconnect("nova tentativa de religação", 2500);
    }
  }

  async function startPlayback(forceFresh = false) {
    if (!currentProgram) {
      await atualizarPrograma(true, false);
    }

    const url = getProgramPlayerUrl();
    if (url) setPlayerSource(url, forceFresh);

    try {
      maybeEnableRealSpectrum();
      await player.play();
      wantPlaying = true;
      playBtn.textContent = "⏸ Pausar rádio";
      setStatus(usingRealSpectrum ? "Rádio ligada com spectrum real." : "Rádio ligada em modo estável. Spectrum visual ativo.", "ok");
      log("✅ Rádio ligada.");
    } catch (err) {
      console.error(err);
      playBtn.textContent = "▶ Ligar rádio";
      setStatus("Não consegui iniciar o stream. Vou tentar religar automaticamente.", "loading");
      scheduleReconnect("falha ao iniciar", 1200);
    }
  }

  player.addEventListener("play", () => {
    if (userStarted) wantPlaying = true;
    maybeEnableRealSpectrum();
    playBtn.textContent = "⏸ Pausar rádio";
  });

  player.addEventListener("playing", () => {
    reconnectAttempts = 0;
    lastTimeUpdate = Date.now();
    clearReconnectTimer();
    playBtn.textContent = "⏸ Pausar rádio";
    setStatus(usingRealSpectrum ? "Rádio ligada com spectrum real." : "Rádio ligada em modo estável. Spectrum visual ativo.", "ok");
  });

  player.addEventListener("timeupdate", () => {
    lastTimeUpdate = Date.now();
  });

  player.addEventListener("pause", () => {
    if (!wantPlaying) playBtn.textContent = "▶ Ligar rádio";
  });

  player.addEventListener("waiting", () => {
    log("⏳ A carregar buffer da rádio...");
    if (bufferTimer) clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => {
      if (wantPlaying && !player.paused && player.readyState < 3) {
        scheduleReconnect("buffer preso", 500);
      }
    }, 12000);
  });

  player.addEventListener("canplay", () => {
    if (bufferTimer) clearTimeout(bufferTimer);
  });

  player.addEventListener("stalled", () => {
    log("⚠️ O stream ficou em espera. A tentar continuar...");
    scheduleReconnect("stream em espera", 5000);
  });

  player.addEventListener("ended", () => {
    log("⚠️ O stream terminou. A religar...");
    scheduleReconnect("stream terminou", 800);
  });

  player.addEventListener("error", () => {
    const code = player.error?.code || "?";
    log(`❌ Erro no player de áudio. Código: ${code}`);

    if (wantPlaying) {
      scheduleReconnect("erro no player de áudio", 1200);
    } else {
      setStatus("Erro no player de áudio. Clica em Ligar rádio para tentar outra vez.", "error");
    }
  });

  playBtn.onclick = async () => {
    userStarted = true;

    if (player.paused || player.ended || player.error) {
      wantPlaying = true;
      await atualizarPrograma(true, false);
      await startPlayback(Boolean(player.error));
    } else {
      wantPlaying = false;
      clearReconnectTimer();
      player.pause();
      playBtn.textContent = "▶ Ligar rádio";
      setStatus("Rádio em pausa.", "idle");
      log("⏸ Rádio em pausa.");
    }
  };

  async function atualizarPrograma(forcePlay = false, forceReload = false) {
    if (!auto && !forcePlay) return;

    try {
      const res = await fetch("/programa_atual", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const atual = data.atual;
      const prox = data.proximo;

      currentProgram = atual;
      stationLabel.textContent = `${atual.radio} • emissão automática`;
      progNome.textContent = atual.nome;
      progDesc.textContent = atual.descricao;
      proximoTxt.textContent = `⏭ Próximo: ${prox.nome} às ${String(prox.inicio).padStart(2, "0")}h`;

      const changed = lastProgramName !== atual.nome;
      const playerUrl = getProgramPlayerUrl();

      if (forceReload || changed || !currentBaseUrl) {
        log(`🎙️ Programa ativo: ${atual.nome} (${atual.radio})`);
        setPlayerSource(playerUrl, false);
        lastProgramName = atual.nome;

        if (changed) resetTrack("🎧 A aguardar identificação…", "Novo programa carregado.");
        if (userStarted && wantPlaying) await startPlayback(true);
      }
    } catch (err) {
      console.error(err);
      log("⚠️ Erro ao atualizar programa.");
      setStatus("Erro ao carregar a programação.", "error");
    }
  }

  function renderTrack(d) {
    if (d.ok && d.title && d.title !== "Tocando") {
      const main = d.artist ? `${d.artist} — ${d.title}` : d.title;
      trackNow.textContent = `🎵 ${main}`;
      trackNow.classList.remove("tocando");

      const source = d.source === "shazam" ? "Shazam" : d.source === "scraping" ? "playlist online" : "desconhecido";
      const album = d.album ? ` • Álbum: ${d.album}` : "";
      trackMeta.textContent = `Fonte: ${source}${album}${d.cached ? " • cache" : ""}`;

      setStatus(d.message || "Música identificada.", d.source === "shazam" ? "ok" : "warn");

      if (d.cover) {
        coverArt.src = d.cover;
        coverArt.hidden = false;
        coverFallback.hidden = true;
      } else {
        coverArt.hidden = true;
        coverArt.removeAttribute("src");
        if (defaultCoverImg) defaultCoverImg.src = DEFAULT_COVER;
        coverFallback.hidden = false;
      }

      log(`🎶 ${main} (${source})`);
    } else {
      resetTrack("🎧 Tocando", d.message || "Ainda sem identificação.");
      setStatus(d.message || "Não identificado.", "warn");
      log("⚠️ Música ainda não identificada.");
    }
  }

  async function atualizarFaixa(force = false) {
    if (identifying) return;
    identifying = true;
    identifyBtn.disabled = true;
    identifyBtn.classList.add("loading");

    setStatus(force ? "A gravar excerto e a enviar ao Shazam…" : "A verificar música…", "loading");

    try {
      const res = await fetch(`/track_info${force ? "?force=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      renderTrack(d);
      if (d.errors?.length) console.warn(d.errors);
    } catch (err) {
      console.error(err);
      setStatus("Erro ao identificar. Confirma FFmpeg e shazamio no servidor.", "error");
      log("❌ Erro no pedido de identificação.");
    } finally {
      identifying = false;
      identifyBtn.disabled = false;
      identifyBtn.classList.remove("loading");
    }
  }

  identifyBtn.onclick = () => atualizarFaixa(true);

  autoBtn.onclick = () => {
    auto = !auto;
    autoBtn.classList.toggle("active", auto);
    log(auto ? "🔄 Modo automático ligado." : "🛑 Modo automático desligado.");
    if (auto) atualizarPrograma(true, true);
  };

  setInterval(() => atualizarPrograma(false, false), 60 * 1000);

  // Watchdog: se o browser ficar sem progresso no áudio, religa sozinho.
  setInterval(() => {
    if (!wantPlaying) return;

    if (player.error || player.ended) {
      scheduleReconnect("watchdog detetou erro/fim", 800);
      return;
    }

    if (!player.paused && Date.now() - lastTimeUpdate > 35000) {
      scheduleReconnect("watchdog sem progresso no áudio", 1200);
    }
  }, 15000);

  // Identificação automática só depois de a rádio estar a tocar.
  setInterval(() => {
    if (!player.paused && !player.ended && !player.error) atualizarFaixa(false);
  }, 95 * 1000);

  atualizarPrograma(true, true);
});
