# -*- coding: utf-8 -*-
import re
import requests
from bs4 import BeautifulSoup
import time

# URLs das playlists do OnlineRadioBox
RADIOS = {
    "Cidade FM": "https://onlineradiobox.com/pt/cidadept/playlist/",
    "Rádio Renascença": "https://onlineradiobox.com/pt/renascenca/playlist/",
    "Rádio Comercial": "https://onlineradiobox.com/pt/comercial/playlist/",
    "Record FM": "https://onlineradiobox.com/pt/recordfm/playlist/"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/120.0.0.0 Safari/537.36"
}

# Palavras e padrões a ignorar (banners, apps, publicidade)
BAD_WORDS = re.compile(
    r"(ouça|app|instalar|download|radio box|favoritos|smartphone|portugal|rádio|radio|fm|antena|tsf|m80|rfm|comercial|renascença)",
    re.I
)

def clean(txt):
    return re.sub(r"\s+", " ", (txt or "").strip())

def obter_faixa(nome_radio, url):
    """Extrai artista e título atuais de uma rádio via OnlineRadioBox."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        candidatos = []

        # procurar textos com " - " e ignorar lixo
        for tag in soup.find_all(["a", "div", "span", "p"]):
            txt = clean(tag.get_text(" "))
            if " - " in txt and not BAD_WORDS.search(txt):
                # evitar linhas de múltiplas rádios (muitos hífens)
                if txt.count(" - ") <= 2:
                    partes = txt.split(" - ", 1)
                    if len(partes) == 2 and len(partes[0]) < 50 and len(partes[1]) < 80:
                        candidatos.append(txt)

        if candidatos:
            artista, faixa = candidatos[0].split(" - ", 1)
            artista, faixa = clean(artista), clean(faixa)
            print(f"🎧 {nome_radio} — {artista} — {faixa}")
            return artista, faixa
        else:
            print(f"⚠️ {nome_radio}: nenhuma faixa musical encontrada.")
            return None, None

    except Exception as e:
        print(f"❌ {nome_radio}: erro ao obter faixa ({e}).")
        return None, None


def main():
    print("🌍 A acompanhar o que está a dar nas principais rádios portuguesas...\n")
    for nome, url in RADIOS.items():
        obter_faixa(nome, url)
        time.sleep(2)  # pequena pausa entre pedidos


if __name__ == "__main__":
    main()
