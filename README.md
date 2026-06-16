# Rádio Pulse — Shazam Live Scanner — Modo Deus

Aplicação Flask pronta para publicar no Vercel.

A Rádio Pulse muda automaticamente de stream conforme a grelha de programação, toca a emissão no browser, mostra equalizador visual, capa default e tenta identificar a música atual com Shazam a partir de um pequeno excerto real do áudio.

## Estrutura do projeto

```txt
radio_pulse_vercel/
├── app.py
├── requirements.txt
├── vercel.json
├── README.md
├── .gitignore
├── .vercelignore
├── static/
│   ├── default_cover.png
│   ├── script.js
│   └── style.css
└── templates/
    ├── grelha.html
    └── index.html
```

## Rotas principais

```txt
/                 Página principal da rádio
/grelha           Grelha de programação
/status           Diagnóstico: FFmpeg, ShazamIO, /tmp, cache
/health           Health check simples para testar o deploy
/track_info       Identificação com cache
/track_info?force=1  Força nova identificação
/identify_now     Força identificação da rádio atual
```

## Preparação feita para Vercel

Esta versão já vem preparada com:

- `app.py` na raiz, com a variável Flask `app` exposta.
- `templates/` e `static/` organizados corretamente.
- `vercel.json` com `@vercel/python` e runtime Python 3.11.
- `imageio-ffmpeg` no `requirements.txt`, para ter FFmpeg disponível mesmo quando o sistema não tem `ffmpeg` instalado.
- Gravação temporária em `/tmp`, que é o local correto para ficheiros temporários em ambiente serverless.
- Amostra curta para o Shazam no Vercel: 8 segundos + 1 segundo de warmup.
- Apenas 1 tentativa de Shazam por pedido no Vercel, para reduzir risco de timeout.

## Publicar no Vercel

1. Cria um repositório no GitHub.
2. Coloca estes ficheiros na raiz do repositório.
3. Vai ao Vercel.
4. Clica em **Add New Project**.
5. Importa o repositório.
6. Em **Framework Preset**, deixa como **Other** ou automático.
7. Faz **Deploy**.

Depois de publicado, testa:

```txt
https://teu-dominio.vercel.app/health
https://teu-dominio.vercel.app/status
```

Se `/status` mostrar `ffmpeg: true` e `shazamio: true`, a parte principal está pronta.

## Variáveis de ambiente opcionais

No Vercel, podes configurar estas variáveis em **Settings → Environment Variables**:

```txt
PYTHONUNBUFFERED=1
TZ=Europe/Lisbon
SHAZAM_SAMPLE_SECONDS=8
SHAZAM_WARMUP_SECONDS=1
SHAZAM_ATTEMPTS=1
TRACK_CACHE_TTL=90
```

Para maior precisão no teu PC, podes usar:

```txt
SHAZAM_SAMPLE_SECONDS=18
SHAZAM_WARMUP_SECONDS=4
SHAZAM_ATTEMPTS=3
```

## Correr localmente

Instala Python 3.11, cria o ambiente virtual e instala as dependências:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abre:

```txt
http://127.0.0.1:8200
```

## Nota importante sobre Shazam no Vercel

A aplicação está preparada para Vercel, mas a identificação por áudio depende de rede, stream da rádio, FFmpeg e tempo de execução da função. Se a página tocar rádio mas a identificação demorar ou falhar, reduz `SHAZAM_SAMPLE_SECONDS` para `6` ou usa a app localmente/Render para maior estabilidade.

## Correção: a rádio não ligava no PC

Nesta versão o player foi corrigido para evitar um problema comum dos browsers: quando um stream externo de rádio é ligado ao WebAudio para fazer equalizer real, muitos servidores não enviam permissões CORS e o resultado pode ser silêncio. Agora o player toca diretamente no `<audio>` e o equalizer fica visual/animado, sem cortar o som.

Também foi removido o `crossorigin="anonymous"` do player e a identificação automática só arranca depois de a rádio estar a tocar, para não bloquear a app localmente.

## Correção Vercel — variável TZ

A Vercel não permite configurar a variável `TZ`, porque é reservada pelo runtime.
Esta versão já removeu `TZ` do `vercel.json`. A app continua a usar a hora de Portugal diretamente no código com `pytz.timezone("Europe/Lisbon")`.

No painel da Vercel, não cries a variável `TZ`.
