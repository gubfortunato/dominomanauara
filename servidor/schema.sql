-- Caixa de mensagens do "Fale com a gente"
CREATE TABLE IF NOT EXISTS mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em INTEGER NOT NULL,
  tipo TEXT NOT NULL,
  texto TEXT NOT NULL,
  nome TEXT,
  contato TEXT,
  versao TEXT,
  aparelho TEXT,
  marca TEXT,
  status TEXT NOT NULL DEFAULT 'novo'
);
CREATE INDEX IF NOT EXISTS mensagens_status ON mensagens (status, criado_em);
CREATE INDEX IF NOT EXISTS mensagens_marca ON mensagens (marca, criado_em);

-- Lembretes para jogar (Web Push)
CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  aparelho TEXT,
  criado_em INTEGER NOT NULL,
  ultimo_jogo INTEGER,
  ultimo_envio INTEGER,
  envios INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS avisos_envio ON avisos (ultimo_envio);

-- Mesa online: limite de mesas criadas por hora (resumo do endereço que muda todo dia)
CREATE TABLE IF NOT EXISTS mesas_criadas (marca TEXT NOT NULL, criado_em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mesas_criadas_marca ON mesas_criadas (marca, criado_em);

-- Plano Apoiador e doações (Asaas). Só código do aparelho, produto, valor e datas; nada de CPF ou cartão.
CREATE TABLE IF NOT EXISTS pedidos (id TEXT PRIMARY KEY, checkout TEXT, aparelho TEXT, produto TEXT NOT NULL, valor REAL NOT NULL, status TEXT NOT NULL, criado_em INTEGER NOT NULL, pago_em INTEGER, marca TEXT);
CREATE INDEX IF NOT EXISTS pedidos_checkout ON pedidos (checkout);
CREATE INDEX IF NOT EXISTS pedidos_marca ON pedidos (marca, criado_em);
CREATE TABLE IF NOT EXISTS planos (aparelho TEXT PRIMARY KEY, ate INTEGER NOT NULL, desde INTEGER NOT NULL, codigo TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS planos_codigo ON planos (codigo);
CREATE TABLE IF NOT EXISTS eventos_asaas (id TEXT PRIMARY KEY, recebido_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tentativas (marca TEXT NOT NULL, tipo TEXT NOT NULL, criado_em INTEGER NOT NULL);
