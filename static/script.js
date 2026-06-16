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
  let currentUrls = [];
  let currentUrlIndex = 0;
  let currentCleanUrl = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let hls = null;
  let softBufferTimer = null;
  let firstAutoIdentifyDone = false;

  let audioCtx = null;
  let analyser = null;
  let sourceNode = null;
  let frequencyData = null;
  let smoothArray = null;
  let usingRealSpectrum = false;
  let realSpectrumLogged = false;
  let stableSpectrumLogged = false;

  const GLOBAL_SAFE_FALLBACKS = [
    "https://stream-icy.bauermedia.pt/comercial.aac",
    "https://stream-icy.bauermedia.pt/cidade.mp3",
  ];

  function log(msg) {
    if (!logContent) return;
    const ts = new Date().toLocaleTimeString("pt-PT", { hour12: false });
    const line = document.createElement("div");
    line.innerHTML = `<b>[${ts}]</b> ${msg}`;
    logContent.prepend(line);
    while (logContent.childElementCount > 50) logContent.lastChild.remove();
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

  function drawVisualSpectrum(w, h) {
    const bars = player.paused ? 72 : 92;
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
      drawVisualSpectrum(w, h);
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
    else drawVisualSpectrum(w, h);

    ctx.shadowBlur = 0;
  }

  drawSpectrum();

  function isInternalStreamUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, window.location.origin);
      return u.origin === window.location.origin && u.pathname.startsWith("/stream/");
    } catch {
      return false;
    }
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

  function maybeEnableRealSpectrum() {
    const clean = currentCleanUrl || currentUrls[currentUrlIndex] || player.currentSrc || player.src;
    if (isInternalStreamUrl(clean)) {
      ensureRealSpectrum();
      return;
    }

    usingRealSpectrum = false;
    if (!stableSpectrumLogged) {
      log("🎚️ Modo ultra estável: stream direto. Spectrum visual para não cortar a rádio.");
      stableSpectrumLogged = true;
    }
  }

  function dedupeUrls(urls) {
    const seen = new Set();
    const out = [];
    for (const url of urls || []) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
    return out;
  }

  function urlsForProgram(program) {
    const fromServer = program?.player_urls || [];
    const basics = [program?.stream_url_for_player, program?.direct_url, program?.url];
    return dedupeUrls([...fromServer, ...basics, ...GLOBAL_SAFE_FALLBACKS]);
  }

  function cacheBust(url) {
    if (!url) return url;
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.set("_pulse", `${Date.now()}_${Math.floor(Math.random() * 99999)}`);
      return u.toString();
    } catch {
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}_pulse=${Date.now()}`;
    }
  }

  function destroyHls() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
  }

  function setPlayerSource(cleanUrl) {
    if (!cleanUrl) return;
    destroyHls();
    currentCleanUrl = cleanUrl;
    const playableUrl = cacheBust(cleanUrl);

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

  function currentUrl() {
    if (!currentUrls.length && currentProgram) currentUrls = urlsForProgram(currentProgram);
    if (!currentUrls.length) return null;
    return currentUrls[currentUrlIndex % currentUrls.length];
  }

  function nextUrl() {
    if (!currentUrls.length && currentProgram) currentUrls = urlsForProgram(currentProgram);
    if (!currentUrls.length) return null;
    currentUrlIndex = (currentUrlIndex + 1) % currentUrls.length;
    return currentUrls[currentUrlIndex];
  }

  function scheduleReconnect(reason = "stream interrompido", delay = 2000) {
    if (!wantPlaying || reconnectTimer) return;

    reconnectAttempts += 1;
    const wait = Math.min(delay + reconnectAttempts * 800, 12000);
    setStatus(`A rádio caiu por instantes. A tentar alternativa… (${reconnectAttempts})`, "loading");
    log(`🔁 ${reason}. A tentar de novo em ${(wait / 1000).toFixed(1)}s...`);

    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      await reconnectPlayback(reason);
    }, wait);
  }

  async function reconnectPlayback(reason = "religação") {
    if (!wantPlaying) return;

    try {
      const url = reconnectAttempts <= 1 ? currentUrl() : nextUrl();
      if (!url) throw new Error("sem URL de stream");
      setPlayerSource(url);
      maybeEnableRealSpectrum();
      await player.play();
      playBtn.textContent = "⏸ Pausar rádio";
      setStatus("Rádio religada automaticamente.", "ok");
      log(`✅ Rádio religada automaticamente (${reason}).`);
    } catch (err) {
      console.error(err);
      scheduleReconnect("nova tentativa de religação", 2500);
    }
  }

  async function startPlayback(forceNewSource = false) {
    if (!currentProgram) await atualizarPrograma(true, false);

    if (!currentUrls.length) currentUrls = urlsForProgram(currentProgram);
    const url = currentUrl();
    if (!url) {
      setStatus("Não encontrei URL de stream para este programa.", "error");
      return;
    }

    try {
      if (forceNewSource || !player.src || player.error || currentCleanUrl !== url) {
        setPlayerSource(url);
      }

      maybeEnableRealSpectrum();
      await player.play();
      wantPlaying = true;
      playBtn.textContent = "⏸ Pausar rádio";
      setStatus("Rádio ligada em modo ultra estável.", "ok");
      log("✅ Rádio ligada.");
    } catch (err) {
      console.error(err);
      wantPlaying = true;
      playBtn.textContent = "⏸ A religar...";
      scheduleReconnect("falha ao iniciar", 800);
    }
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

  player.addEventListener("play", () => {
    if (userStarted) wantPlaying = true;
    maybeEnableRealSpectrum();
    playBtn.textContent = "⏸ Pausar rádio";
  });

  player.addEventListener("playing", () => {
    reconnectAttempts = 0;
    clearReconnectTimer();
    playBtn.textContent = "⏸ Pausar rádio";
    setStatus("Rádio ligada em modo ultra estável.", "ok");
  });

  player.addEventListener("pause", () => {
    if (!wantPlaying) playBtn.textContent = "▶ Ligar rádio";
  });

  player.addEventListener("waiting", () => {
    log("⏳ A rádio está a criar buffer...");
    if (softBufferTimer) clearTimeout(softBufferTimer);
    softBufferTimer = setTimeout(() => {
      if (wantPlaying && !player.paused && player.readyState < 2) {
        player.play().catch(() => scheduleReconnect("buffer sem resposta", 1000));
      }
    }, 25000);
  });

  player.addEventListener("stalled", () => {
    log("⚠️ Pequena paragem no buffer. Vou esperar antes de trocar de stream.");
    if (softBufferTimer) clearTimeout(softBufferTimer);
    softBufferTimer = setTimeout(() => {
      if (wantPlaying && !player.paused && player.readyState < 2) {
        scheduleReconnect("stream parado durante demasiado tempo", 1000);
      }
    }, 30000);
  });

  player.addEventListener("canplay", () => {
    if (softBufferTimer) clearTimeout(softBufferTimer);
  });

  player.addEventListener("ended", () => {
    log("⚠️ O stream terminou. A religar...");
    if (wantPlaying) scheduleReconnect("stream terminou", 500);
  });

  player.addEventListener("error", () => {
    const code = player.error?.code || "?";
    log(`❌ Erro no player de áudio. Código: ${code}`);
    if (wantPlaying) {
      scheduleReconnect("erro no player de áudio", 700);
    } else {
      setStatus("Erro no player de áudio. Clica em Ligar rádio para tentar outra vez.", "error");
    }
  });

  playBtn.onclick = async () => {
    userStarted = true;

    if (player.paused || player.ended || player.error || !wantPlaying) {
      wantPlaying = true;
      await atualizarPrograma(true, false);
      await startPlayback(Boolean(player.error));
    } else {
      wantPlaying = false;
      clearReconnectTimer();
      if (softBufferTimer) clearTimeout(softBufferTimer);
      player.pause();
      playBtn.textContent = "▶ Ligar rádio";
      setStatus("Rádio em pausa.", "idle");
      log("⏸ Rádio em pausa.");
    }
  };

  async function atualizarPrograma(force = false, reloadSource = false) {
    if (!auto && !force) return;

    try {
      const res = await fetch("/programa_atual", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const atual = data.atual;
      const prox = data.proximo;
      const changed = lastProgramName !== atual.nome;

      currentProgram = atual;
      stationLabel.textContent = `${atual.radio} • emissão automática`;
      progNome.textContent = atual.nome;
      progDesc.textContent = atual.descricao;
      proximoTxt.textContent = `⏭ Próximo: ${prox.nome} às ${String(prox.inicio).padStart(2, "0")}h`;

      if (changed || reloadSource || !currentUrls.length) {
        currentUrls = urlsForProgram(atual);
        currentUrlIndex = 0;
        lastProgramName = atual.nome;
        log(`🎙️ Programa ativo: ${atual.nome} (${atual.radio})`);

        if (changed) resetTrack("🎧 A aguardar identificação…", "Novo programa carregado.");

        if (userStarted && wantPlaying) {
          setPlayerSource(currentUrl());
          await startPlayback(false);
        }
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
    if (auto) atualizarPrograma(true, false);
  };

  setInterval(() => atualizarPrograma(false, false), 60 * 1000);

  // Segurança: se o browser colocou em pausa sozinho, tenta retomar sem recarregar.
  setInterval(() => {
    if (!wantPlaying) return;
    if (player.error || player.ended) {
      scheduleReconnect("verificação de segurança", 800);
      return;
    }
    if (player.paused && userStarted) {
      player.play().catch(() => scheduleReconnect("browser pausou a emissão", 1200));
    }
  }, 20000);

  // Identificação automática mais espaçada para não sobrecarregar o servidor.
  setInterval(() => {
    if (!player.paused && !player.ended && !player.error) atualizarFaixa(false);
  }, 4 * 60 * 1000);

  atualizarPrograma(true, false);

  // Primeira identificação só depois de algum tempo de rádio ligada.
  player.addEventListener("playing", () => {
    if (!firstAutoIdentifyDone) {
      firstAutoIdentifyDone = true;
      setTimeout(() => {
        if (!player.paused && !player.ended && !player.error) atualizarFaixa(false);
      }, 45000);
    }
  });
});
