# Servidor do Dominó Manauara

Cloudflare Workers + D1 (plano grátis). Publicado automaticamente pelo GitHub Actions
(`.github/workflows/servidor.yml`) a cada mudança nesta pasta.

Segredos no GitHub (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN`: token com Workers Scripts (edit) e D1 (edit)
- `CLOUDFLARE_ACCOUNT_ID`: ID da conta (também já está no fluxo `.github/workflows/servidor.yml`, porque não é senha)

O resultado de cada publicação fica no ramo `servidor-status` (arquivo `status.txt`).

## Mesa online (por convite)

- Cada mesa é um Durable Object (`src/mesa.js`), com código de 5 números.
- `src/motor.js` é gerado a partir do jogo (mesmas regras do app); não editar à mão.
- Rotas: `POST /mesa/nova` cria a mesa, `GET /mesa/NNNNN` diz se ela existe, `GET /mesa/NNNNN/ws` é a conexão do jogo.
- O servidor guarda as pedras; cada celular recebe só a própria mão. A mesa some 24 h depois da última jogada.
- A cada publicação, `teste_publicado.mjs` cria uma mesa de teste, entra e sai (ela some na hora).
