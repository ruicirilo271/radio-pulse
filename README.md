# Rádio Pulse — Vercel / PC — versão estável

Esta versão foi ajustada para resolver o problema da rádio desligar passado algum tempo.

## O que mudou

- O player voltou a tocar o stream oficial direto da rádio.
- O proxy `/stream/<RADIO>` continua no `app.py`, mas fica desligado por defeito.
- No Vercel, `PLAYER_USES_PROXY=0`, porque serverless não é indicado para retransmitir rádio contínua.
- O auto-reconnect continua ativo para recuperar falhas normais do browser/stream.
- O spectrum fica visual no modo estável, para não cortar nem silenciar a rádio por causa de CORS.

## Porque isto era necessário

O spectrum analyzer 100% real no browser exige WebAudio. Muitos streams de rádio externos não enviam permissões CORS. A alternativa era passar o áudio por `/stream/<RADIO>`, mas isso cria uma ligação contínua no Flask/Vercel que pode cair e causar o erro do player.

Por isso, a versão final dá prioridade à rádio não desligar.

## Correr no PC

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Abrir:

```txt
http://127.0.0.1:8200
```

## Publicar no Vercel

1. Envia todos estes ficheiros para o GitHub.
2. Importa o repositório no Vercel.
3. Não cries variável `TZ`.
4. Mantém `PLAYER_USES_PROXY=0`.

## Rotas úteis

- `/` — emissão
- `/grelha` — grelha
- `/status` — diagnóstico
- `/health` — health check
- `/track_info` — identificação com cache
- `/identify_now` — força identificação

## Modo experimental de spectrum real local

Só para testar no PC, podes tentar:

```bash
set PLAYER_USES_PROXY=1
python app.py
```

Mas se a rádio voltar a desligar, volta para:

```bash
set PLAYER_USES_PROXY=0
python app.py
```
