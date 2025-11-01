document.addEventListener("DOMContentLoaded", () => {
  const progNome = document.getElementById("progNome");
  const progDesc = document.getElementById("progDesc");
  const proximoTxt = document.getElementById("proximoTxt");
  const player = document.getElementById("player");
  const canvas = document.getElementById("equalizer");
  const ctx = canvas.getContext("2d");
  const autoBtn = document.getElementById("autoBtn");
  const logContent = document.getElementById("logContent");
  const logPanel = document.getElementById("logPanel");
  const toggleLogs = document.getElementById("toggleLogs");
  const showLogsBtn = document.getElementById("showLogsBtn");
  const weatherEl = document.getElementById("weather");
  const datetime = document.getElementById("datetime");
  const trackNow = document.getElementById("trackNow");

  let auto = true, lastProgram = null, hls = null;
  let audioCtx, analyser, source, dataArray, smoothArray;

  // Hora
  setInterval(() => {
    const agora = new Date();
    datetime.textContent = agora.toLocaleString("pt-PT", {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, 1000);

  // Meteo
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
      else if ([51, 53, 55, 61, 63, 65].includes(code)) ic = "🌧️";
      else if ([95, 96, 99].includes(code)) ic = "⛈️";

      weatherEl.textContent = `${ic} Lisboa • ${t.toFixed(1)} °C`;
    } catch {
      weatherEl.textContent = "🌤️ Lisboa • — °C";
    }
  }
  atualizarTempo();
  setInterval(atualizarTempo, 15 * 60 * 1000);

  // Logs
  function log(msg) {
    const ts = new Date().toLocaleTimeString("pt-PT", { hour12: false });
    const line = document.createElement("div");
    line.textContent = `[${ts}] ${msg}`;
    logContent.prepend(line);
    if (logContent.childElementCount > 20) logContent.lastChild.remove();
  }

  // === Novo sistema de abrir/fechar consola ===
  if (toggleLogs && showLogsBtn && logPanel) {
    // Ocultar
    toggleLogs.onclick = () => {
      logPanel.style.display = "none";
      showLogsBtn.style.display = "block";
    };

    // Mostrar
    showLogsBtn.onclick = () => {
      logPanel.style.display = "block";
      showLogsBtn.style.display = "none";
    };
  }

  // Player
  async function playStream(url) {
    if (!url) return;
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (url.endsWith(".m3u8") && Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(player);
    } else {
      player.src = url;
    }
    player.play().catch(() => {});
  }

  // Equalizer
  // 🎛️ Equalizer Profissional — efeito onda suave
function initEq() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256; // resolução mais alta = movimento mais suave
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  analyser.smoothingTimeConstant = 0.8; // suavização entre frames
  source = audioCtx.createMediaElementSource(player);
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  smoothArray = new Float32Array(analyser.frequencyBinCount);
  drawEq();
}

function drawEq() {
  requestAnimationFrame(drawEq);
  if (!analyser) return;

  analyser.getByteFrequencyData(dataArray);
  const w = canvas.width,
        h = canvas.height,
        bars = 60,                     // número de barras visíveis
        step = Math.floor(dataArray.length / bars);

  ctx.clearRect(0, 0, w, h);

  for (let i = 0; i < bars; i++) {
    // média local para suavizar
    let avg = 0;
    for (let j = 0; j < step; j++) avg += dataArray[i * step + j];
    avg /= step;

    // suavização temporal (muito mais fluido)
    smoothArray[i] += (avg - smoothArray[i]) * 0.1;

    // altura proporcional à energia
   const bh = (smoothArray[i] / 255) * h * 1.8;

 // controla o “volume visual”

    // cor dinâmica com gradiente “onda”
    const hue = (i * 6 + Date.now() / 40) % 360;
    const gradient = ctx.createLinearGradient(0, h - bh, 0, h);
    gradient.addColorStop(0, `hsl(${hue},100%,65%)`);
    gradient.addColorStop(1, `hsl(${(hue + 40) % 360},100%,40%)`);
    ctx.fillStyle = gradient;

    const x = (i * w) / bars;
    ctx.fillRect(x, h - bh, w / bars - 2, bh);
  }

  // efeito de fade no fundo (ligeiro rasto)
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(0, 0, w, h);
}



  player.addEventListener("play", () => {
    initEq();
    audioCtx.resume();
  });

  // Atualiza programa
  async function atualizarPrograma() {
    if (!auto) return;
    const res = await fetch("/programa_atual");
    if (!res.ok) return;
    const data = await res.json();
    const atual = data.atual, prox = data.proximo;
   if (!lastProgram || lastProgram.nome !== atual.nome) {
      log(`🎙 Mudou para: ${atual.nome}`);
      progNome.textContent = atual.nome;
      progDesc.textContent = atual.descricao;
      playStream(atual.url);
      lastProgram = atual;

  // 🔹 Limpa a faixa anterior (novo programa, novo stream)
      trackNow.textContent = "🎧 Tocando";
      trackNow.classList.add("tocando");
 }


    proximoTxt.textContent = `⏭ Próximo: ${prox.nome} às ${prox.inicio}h`;
  }

  // Atualiza faixa (artista + música)
  async function atualizarFaixa() {
    try {
      const res = await fetch("/track_info");
      if (!res.ok) return;
      const d = await res.json();
      let texto;
      if (d.title && d.title !== "Tocando") {
        texto = d.artist ? `🎵 ${d.artist} — ${d.title}` : `🎵 ${d.title}`;
        trackNow.classList.remove("tocando");
      } else {
        texto = "🎧 Tocando";
        trackNow.classList.add("tocando");
      }
      if (trackNow.textContent !== texto) {
        trackNow.textContent = texto;
        log(`🎶 ${texto}`);
      }
    } catch {}
  }

  setInterval(atualizarPrograma, 60000);
  setInterval(atualizarFaixa, 60000);
  atualizarPrograma();
  atualizarFaixa();

  // Botão automático
  autoBtn.onclick = () => {
    auto = !auto;
    autoBtn.classList.toggle("active", auto);
    log(auto ? "🔄 Modo automático ligado" : "🛑 Modo automático desligado");
    if (auto) atualizarPrograma();
  };
});


