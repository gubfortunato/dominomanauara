# Servidor do Dominó Manauara

Cloudflare Workers + D1 (plano grátis). Publicado automaticamente pelo GitHub Actions
(`.github/workflows/servidor.yml`) a cada mudança nesta pasta.

Segredos no GitHub (Settings → Secrets and variables → Actions):
- `CLOUDFLARE_API_TOKEN`: token com Workers Scripts (edit) e D1 (edit)
- `CLOUDFLARE_ACCOUNT_ID`: ID da conta (também já está no fluxo `.github/workflows/servidor.yml`, porque não é senha)

O resultado de cada publicação fica no ramo `servidor-status` (arquivo `status.txt`).
