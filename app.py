# -*- coding: utf-8 -*-
from flask import Flask, render_template, jsonify
from datetime import datetime
import pytz, re, requests
from bs4 import BeautifulSoup

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
# 🎙️ TOP PROGRAMAS
# =============================
PROGRAMAS = [
    {"nome": "Manhãs da Pulse (insp. Comercial)", "inicio": 6, "fim": 10,
     "url": STREAMS["COMERCIAL"], "descricao": "Música, humor e boa disposição."},
    {"nome": "As Três da Pulse (insp. Renascença)", "inicio": 10, "fim": 12,
     "url": STREAMS["RENASCENCA"], "descricao": "Humor inteligente e entrevistas."},
    {"nome": "Já São Horas Pulse (insp. Cidade FM)", "inicio": 12, "fim": 14,
     "url": STREAMS["CIDADEFM"], "descricao": "Talk jovem e cultura pop."},
    {"nome": "Pulse Tardes (insp. Comercial)", "inicio": 14, "fim": 17,
     "url": STREAMS["COMERCIAL"], "descricao": "Boa música para o regresso a casa."},
    {"nome": "Toque de Pulse (insp. Cidade FM)", "inicio": 17, "fim": 20,
     "url": STREAMS["CIDADEFM"], "descricao": "Humor e participação dos ouvintes."},
    {"nome": "Pulse Night Show (insp. Record FM)", "inicio": 20, "fim": 23,
     "url": STREAMS["RECORDFM"], "descricao": "Afrobeat, pop e R&B."},
    {"nome": "Pulse by Night (insp. Comercial)", "inicio": 23, "fim": 1,
     "url": STREAMS["COMERCIAL"], "descricao": "Música suave e relaxante."},
    {"nome": "Madrugada Pulse (insp. Renascença)", "inicio": 1, "fim": 6,
     "url": STREAMS["RENASCENCA"], "descricao": "Companhia e tranquilidade noturna."},
]

DEFAULT_STREAM = {
    "nome": "Rádio Pulse",
    "url": STREAMS["COMERCIAL"],
    "descricao": "Música, entrevistas e comédia — o ritmo da tua geração."
}

# =============================
# 🧭 Programação
# =============================
def programa_atual():
    agora = datetime.now(pytz.timezone("Europe/Lisbon"))
    hora = agora.hour
    atual = None
    for p in PROGRAMAS:
        ini, fim = p["inicio"], p["fim"]
        if ini < fim and ini <= hora < fim or ini > fim and (hora >= ini or hora < fim):
            atual = p
            break
    if not atual:
        atual = DEFAULT_STREAM
    proximos = sorted(PROGRAMAS, key=lambda x: x["inicio"])
    proximo = next((p for p in proximos if p["inicio"] > hora), proximos[0])
    return {"atual": atual, "proximo": proximo}

# =============================
# 🎵 Scraper de faixa atual
# =============================
PLAYLISTS = {
    "CIDADEFM": "https://onlineradiobox.com/pt/cidadept/playlist/",
    "RENASCENCA": "https://onlineradiobox.com/pt/renascenca/playlist/",
    "COMERCIAL": "https://onlineradiobox.com/pt/comercial/playlist/",
    "RECORDFM": "https://onlineradiobox.com/pt/recordfm/playlist/",
}

BAD_WORDS = re.compile(r"(ouça|app|instalar|download|radio box|favoritos|smartphone|portugal|rádio|radio|fm|antena|tsf|m80|rfm|comercial|renascença)", re.I)
HEADERS = {"User-Agent": "Mozilla/5.0"}

def clean(txt): return re.sub(r"\s+", " ", (txt or "").strip())

def obter_faixa(radio_key):
    """Scraping da faixa atual via OnlineRadioBox."""
    url = PLAYLISTS.get(radio_key)
    if not url:
        return None
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        for tag in soup.find_all(["a", "div", "span", "p"]):
            txt = clean(tag.get_text(" "))
            if " - " in txt and not BAD_WORDS.search(txt) and txt.count(" - ") <= 2:
                artista, faixa = txt.split(" - ", 1)
                return {"artist": clean(artista), "title": clean(faixa)}
    except Exception as e:
        print(f"⚠️ Erro ao obter faixa ({radio_key}):", e)
    return None

# =============================
# 🌐 Rotas Flask
# =============================
@app.route("/")
def index(): return render_template("index.html")

@app.route("/programa_atual")
def get_programa(): return jsonify(programa_atual())

@app.route("/track_info")
def track_info():
    atual = programa_atual()["atual"]
    radio_key = next((k for k, v in STREAMS.items() if v == atual["url"]), "COMERCIAL")
    faixa = obter_faixa(radio_key)
    if not faixa or not faixa.get("artist") or not faixa.get("title"):
        faixa = {"artist": None, "title": "Tocando"}
    faixa["station"] = atual["nome"]
    return jsonify(faixa)

@app.route("/grelha")
def grelha():
    agora = datetime.now(pytz.timezone("Europe/Lisbon"))
    return render_template("grelha.html", programas=PROGRAMAS, hora_atual=agora.hour)

# =============================
# 🚀 Run
# =============================
if __name__ == "__main__":
    print("🎧 Rádio Pulse iniciada → http://127.0.0.1:8200")
    app.run(debug=True, port=8200)
