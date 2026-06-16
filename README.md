# Rádio Pulse — Vercel / PC — versão ultra estável

Esta versão foi ajustada para evitar que a rádio se desligue passado algum tempo.

## O que foi alterado

- O player usa streams diretos, sem proxy Flask por defeito.
- O proxy `/stream/<RADIO>` continua no código, mas fica desligado por defeito porque pode cair em Vercel/serverless.
- O JavaScript agora faz cache-buster em cada nova ligação ao stream.
- Se o stream falhar, o browser tenta religar automaticamente.
- Se houver URLs alternativas para a rádio, a aplicação tenta a próxima URL.
- O watchdog agressivo foi removido para não recarregar a rádio sem necessidade.
- Eventos `waiting` e `stalled` já não cortam logo a emissão; a app espera antes de trocar de stream.
- A identificação automática por Shazam foi espaçada para 4 minutos para não sobrecarregar o servidor.

## Como correr no PC

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

## Vercel

Não cries a variável `TZ`, porque a Vercel não permite essa variável.

Variáveis recomendadas:

```txt
PLAYER_USES_PROXY=0
SHAZAM_SAMPLE_SECONDS=8
SHAZAM_WARMUP_SECONDS=1
SHAZAM_ATTEMPTS=1
TRACK_CACHE_TTL=90
```

## Spectrum analyzer

No modo ultra estável, o spectrum é visual/animado para não cortar a rádio. O spectrum real só deve ser usado localmente com:

```txt
PLAYER_USES_PROXY=1
```

Se com `PLAYER_USES_PROXY=1` a rádio voltar a cair, usa sempre `PLAYER_USES_PROXY=0`.
