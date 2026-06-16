# -*- coding: utf-8 -*-
"""
Rádio Pulse — Flask + Shazam
Identifica a música atual gravando um pequeno excerto do stream e enviando-o ao Shazam.

Notas importantes:
- Preparado para Vercel: usa imageio-ffmpeg quando o FFmpeg do sistema não existe.
- O áudio temporário é gravado em /tmp e apagado logo após a identificação.
- Em ambiente serverless, mantém amostras curtas para evitar timeouts.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime
from typing import Any, Dict, Optional

import pytz
import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

try:
    from shazamio import Shazam
except Exception:  # permite a app arrancar mesmo sem shazamio instalado
    Shazam = None

app = Flask(__name__, template_folder="templates", static_folder="static")

# =============================
# 🔊 STREAMS OFICIAIS
# =============================
STREAMS = {
    "COMERCIAL": "https://stream-icy.bauermedia.pt/comercial.aac",
    "CIDADEFM": "https://stream-icy.bauermedia.pt/cidade.mp3",
    "RENASCENCA": "https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_RENASCENCA_SC?dist=onlineradiobox",
    "RECORDFM": "https://nl.digitalrm.pt:8010/stream",
}

# =============================
# 🎙️ PROGRAMAS
# =============================
PROGRAMAS = [
    {"nome": "Manhãs da Pulse", "inicio": 6, "fim": 10, "radio": "COMERCIAL", "descricao": "Música, humor e boa disposição para acordar em modo máximo."},
    {"nome": "As Três da Pulse", "inicio": 10, "fim": 12, "radio": "RENASCENCA", "descricao": "Conversas, entrevistas e energia positiva."},
    {"nome": "Já São Horas Pulse", "inicio": 12, "fim": 14, "radio": "CIDADEFM", "descricao": "Pop, cultura jovem e hits para o almoço."},
    {"nome": "Pulse Tardes", "inicio": 14, "fim": 17, "radio": "COMERCIAL", "descricao": "Boa música para a tarde e para o regresso a casa."},
    {"nome": "Toque de Pulse", "inicio": 17, "fim": 20, "radio": "CIDADEFM", "descricao": "Energia, participação e hits atuais."},
    {"nome": "Pulse Night Show", "inicio": 20, "fim": 23, "radio": "RECORDFM", "descricao": "Afrobeat, pop, R&B e vibração noturna."},
    {"nome": "Pulse by Night", "inicio": 23, "fim": 1, "radio": "COMERCIAL", "descricao": "Música suave para fechar o dia."},
    {"nome": "Madrugada Pulse", "inicio": 1, "fim": 6, "radio": "RENASCENCA", "descricao": "Companhia e tranquilidade durante a madrugada."},
]

DEFAULT_STREAM = {
    "nome": "Rádio Pulse",
    "inicio": 0,
    "fim": 24,
    "radio": "COMERCIAL",
    "descricao": "Música, entrevistas e comédia — o ritmo da tua geração.",
}

for p in PROGRAMAS:
    p["url"] = STREAMS[p["radio"]]
DEFAULT_STREAM["url"] = STREAMS[DEFAULT_STREAM["radio"]]

# =============================
# ⚙️ Configuração Shazam/cache/Vercel
# =============================
IS_VERCEL = os.getenv("VERCEL") == "1"

# No Vercel convém usar excertos curtos. Localmente podes aumentar para 18/24s.
SAMPLE_SECONDS = int(os.getenv("SHAZAM_SAMPLE_SECONDS", "8" if IS_VERCEL else "18"))
WARMUP_SECONDS = int(os.getenv("SHAZAM_WARMUP_SECONDS", "1" if IS_VERCEL else "4"))
SHAZAM_ATTEMPTS = int(os.getenv("SHAZAM_ATTEMPTS", "1" if IS_VERCEL else "3"))
TRACK_CACHE_TTL = int(os.getenv("TRACK_CACHE_TTL", "90"))

def resolve_ffmpeg_bin() -> str:
    """Resolve o FFmpeg.

    Em PC/Render usa o ffmpeg do sistema, se existir.
    Em Vercel usa o binário empacotado pelo pacote imageio-ffmpeg.
    """
    env_bin = os.getenv("FFMPEG_BIN")
    if env_bin:
        return env_bin

    system_bin = shutil.which("ffmpeg")
    if system_bin:
        return system_bin

    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"

FFMPEG_BIN = resolve_ffmpeg_bin()
TRACK_CACHE: Dict[str, Dict[str, Any]] = {}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
}

# =============================
# 🧭 Programação
# =============================
def programa_atual() -> Dict[str, Any]:
    agora = datetime.now(pytz.timezone("Europe/Lisbon"))
    hora = agora.hour
    atual = None

    for p in PROGRAMAS:
        ini, fim = p["inicio"], p["fim"]
        if (ini < fim and ini <= hora < fim) or (ini > fim and (hora >= ini or hora < fim)):
            atual = p
            break

    if not atual:
        atual = DEFAULT_STREAM

    proximos = sorted(PROGRAMAS, key=lambda x: x["inicio"])
    proximo = next((p for p in proximos if p["inicio"] > hora), proximos[0])

    return {"atual": atual, "proximo": proximo}

# =============================
# 🧼 Utilitários
# =============================
def clean(txt: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (txt or "").strip())


def current_radio_key() -> str:
    return programa_atual()["atual"].get("radio", "COMERCIAL")


def public_track_response(base: Dict[str, Any], radio_key: str, station: str) -> Dict[str, Any]:
    base.setdefault("artist", None)
    base.setdefault("title", "Tocando")
    base.setdefault("album", None)
    base.setdefault("cover", None)
    base.setdefault("url", None)
    base.setdefault("source", "unknown")
    base.setdefault("ok", bool(base.get("title") and base.get("title") != "Tocando"))
    base["radio_key"] = radio_key
    base["station"] = station
    base["ts"] = int(time.time())
    return base

# =============================
# 🎧 Captura de áudio para Shazam
# =============================
def ffmpeg_available() -> bool:
    if os.path.isabs(FFMPEG_BIN):
        return os.path.exists(FFMPEG_BIN) and os.access(FFMPEG_BIN, os.X_OK)
    return shutil.which(FFMPEG_BIN) is not None


def gravar_excerto(stream_url: str, seconds: int = SAMPLE_SECONDS) -> str:
    """Grava um excerto curto do stream para /tmp e devolve o caminho do wav.

    Melhorias para aumentar a taxa de acerto do Shazam:
    - usa reconexão automática
    - grava um pouco mais e corta os primeiros segundos
    - normaliza para mono WAV 44.1k, que tende a resultar melhor
    """
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg não encontrado. Instala o ffmpeg ou define FFMPEG_BIN.")

    warmup_seconds = max(0, WARMUP_SECONDS)
    capture_seconds = seconds + warmup_seconds

    # Vercel só permite escrita temporária em /tmp. tempfile já aponta para /tmp em Linux,
    # mas deixamos explícito quando a variável VERCEL existe.
    tmp_dir = "/tmp" if IS_VERCEL and os.path.isdir("/tmp") else tempfile.gettempdir()
    fd, out_path = tempfile.mkstemp(prefix="radio_pulse_shazam_", suffix=".wav", dir=tmp_dir)
    os.close(fd)

    cmd = [
        FFMPEG_BIN,
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-user_agent", HEADERS["User-Agent"],
        "-i", stream_url,
        "-t", str(capture_seconds),
        "-vn",
        "-af", f"atrim=start={warmup_seconds},loudnorm=I=-16:LRA=11:TP=-1.5",
        "-ac", "1",
        "-ar", "44100",
        "-sample_fmt", "s16",
        out_path,
    ]

    completed = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=max(12, capture_seconds + 12),
        check=False,
    )

    if completed.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 50000:
        err = completed.stderr.decode("utf-8", errors="ignore")[-700:]
        try:
            os.remove(out_path)
        except OSError:
            pass
        raise RuntimeError(f"Não consegui gravar o excerto do stream. {err}")

    return out_path


async def _reconhecer_ficheiro_shazam(path: str) -> Dict[str, Any]:
    if Shazam is None:
        raise RuntimeError("shazamio não está instalado.")

    shazam = Shazam()

    # Compatível com versões diferentes do shazamio.
    if hasattr(shazam, "recognize"):
        return await shazam.recognize(path)
    if hasattr(shazam, "recognize_song"):
        return await shazam.recognize_song(path)

    raise RuntimeError("A versão instalada do shazamio não tem método recognize/recognize_song.")


def reconhecer_com_shazam(stream_url: str) -> Dict[str, Any]:
    last_error = None
    attempt_seconds_list = [SAMPLE_SECONDS, SAMPLE_SECONDS + 6, SAMPLE_SECONDS + 10][:max(1, SHAZAM_ATTEMPTS)]

    for attempt_seconds in attempt_seconds_list:
        audio_path = None
        try:
            audio_path = gravar_excerto(stream_url, seconds=attempt_seconds)
            result = asyncio.run(_reconhecer_ficheiro_shazam(audio_path))
            track = result.get("track") or {}

            title = clean(track.get("title"))
            artist = clean(track.get("subtitle"))
            album = None

            sections = track.get("sections") or []
            for section in sections:
                metadata = section.get("metadata") or []
                for item in metadata:
                    label = clean(item.get("title")).lower()
                    value = clean(item.get("text"))
                    if label in {"album", "álbum"} and value:
                        album = value
                        break
                if album:
                    break

            images = track.get("images") or {}
            cover = images.get("coverarthq") or images.get("coverart") or images.get("background")
            shazam_url = track.get("url") or None

            if not title:
                raise RuntimeError("O Shazam não devolveu um título válido.")

            return {
                "ok": True,
                "artist": artist or None,
                "title": title,
                "album": album,
                "cover": cover,
                "url": shazam_url,
                "source": "shazam",
                "source_detail": f"áudio {attempt_seconds}s",
                "message": f"Identificado pelo Shazam a partir do áudio real da rádio ({attempt_seconds}s).",
            }
        except Exception as e:
            last_error = e
        finally:
            if audio_path and os.path.exists(audio_path):
                try:
                    os.remove(audio_path)
                except OSError:
                    pass

    raise RuntimeError(str(last_error) if last_error else "O Shazam não reconheceu nenhuma música neste excerto.")

# =============================
# 🧯 Fallback scraping antigo
# =============================
PLAYLISTS = {
    "CIDADEFM": "https://onlineradiobox.com/pt/cidadept/playlist/",
    "RENASCENCA": "https://onlineradiobox.com/pt/renascenca/playlist/",
    "COMERCIAL": "https://onlineradiobox.com/pt/comercial/playlist/",
    "RECORDFM": "https://onlineradiobox.com/pt/recordfm/playlist/",
}

BAD_WORDS = re.compile(
    r"(ouça|app|instalar|download|radio box|favoritos|smartphone|portugal|rádio|radio|fm|antena|tsf|m80|rfm|comercial|renascença|publicidade)",
    re.I,
)


def obter_faixa_scraping(radio_key: str) -> Optional[Dict[str, Any]]:
    url = PLAYLISTS.get(radio_key)
    if not url:
        return None

    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        candidatos = []
        for tag in soup.find_all(["a", "div", "span", "p"]):
            txt = clean(tag.get_text(" "))
            if " - " not in txt or BAD_WORDS.search(txt) or txt.count(" - ") > 2:
                continue
            artista, faixa = [clean(x) for x in txt.split(" - ", 1)]
            if 1 < len(artista) < 60 and 1 < len(faixa) < 100:
                candidatos.append({"artist": artista, "title": faixa})

        if candidatos:
            data = candidatos[0]
            data.update({
                "ok": True,
                "album": None,
                "cover": None,
                "url": None,
                "source": "scraping",
                "message": "Identificado pelo fallback de playlist online.",
            })
            return data
    except Exception as e:
        print(f"⚠️ Fallback scraping falhou ({radio_key}): {e}")

    return None


def identificar_faixa(radio_key: str, force: bool = False) -> Dict[str, Any]:
    atual = programa_atual()["atual"]
    station = atual["nome"]
    stream_url = STREAMS.get(radio_key, atual["url"])

    cached = TRACK_CACHE.get(radio_key)
    if not force and cached and time.time() - cached.get("cache_time", 0) < TRACK_CACHE_TTL:
        response = dict(cached["data"])
        response["cached"] = True
        return public_track_response(response, radio_key, station)

    errors = []

    try:
        data = reconhecer_com_shazam(stream_url)
        data["cached"] = False
        TRACK_CACHE[radio_key] = {"cache_time": time.time(), "data": data}
        return public_track_response(dict(data), radio_key, station)
    except Exception as e:
        errors.append(f"Shazam: {e}")
        print("⚠️ Shazam falhou:", e)

    fallback = obter_faixa_scraping(radio_key)
    if fallback:
        fallback["cached"] = False
        fallback["warning"] = "Shazam falhou; usei o fallback por scraping."
        fallback["errors"] = errors
        TRACK_CACHE[radio_key] = {"cache_time": time.time(), "data": fallback}
        return public_track_response(dict(fallback), radio_key, station)

    data = {
        "ok": False,
        "artist": None,
        "title": "Tocando",
        "album": None,
        "cover": None,
        "url": None,
        "source": "none",
        "cached": False,
        "message": "Ainda não consegui identificar esta música.",
        "errors": errors,
    }
    return public_track_response(data, radio_key, station)

# =============================
# 🌐 Rotas Flask
# =============================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/programa_atual")
def get_programa():
    return jsonify(programa_atual())


@app.route("/track_info")
def track_info():
    radio_key = current_radio_key()
    force = request.args.get("force") in {"1", "true", "sim", "yes"}
    return jsonify(identificar_faixa(radio_key, force=force))


@app.route("/identify_now")
def identify_now():
    radio_key = request.args.get("radio") or current_radio_key()
    radio_key = radio_key.upper()
    if radio_key not in STREAMS:
        radio_key = current_radio_key()
    return jsonify(identificar_faixa(radio_key, force=True))


@app.route("/status")
def status():
    return jsonify({
        "ok": True,
        "platform": "vercel" if IS_VERCEL else "local",
        "tmp_dir": "/tmp" if os.path.isdir("/tmp") else tempfile.gettempdir(),
        "ffmpeg": ffmpeg_available(),
        "ffmpeg_bin": FFMPEG_BIN,
        "shazamio": Shazam is not None,
        "sample_seconds": SAMPLE_SECONDS,
        "warmup_seconds": WARMUP_SECONDS,
        "shazam_attempts": SHAZAM_ATTEMPTS,
        "cache_ttl": TRACK_CACHE_TTL,
    })


@app.route("/health")
def health():
    return jsonify({"ok": True, "app": "Radio Pulse", "vercel_ready": True})


@app.route("/grelha")
def grelha():
    agora = datetime.now(pytz.timezone("Europe/Lisbon"))
    return render_template("grelha.html", programas=PROGRAMAS, hora_atual=agora.hour)

# =============================
# 🚀 Run
# =============================
if __name__ == "__main__":
    print("🎧 Rádio Pulse Shazam iniciada → http://127.0.0.1:8200")
    print(f"🎙️ FFmpeg: {'OK' if ffmpeg_available() else 'NÃO ENCONTRADO'} | ShazamIO: {'OK' if Shazam else 'NÃO INSTALADO'}")
    app.run(debug=True, host="0.0.0.0", port=8200)
