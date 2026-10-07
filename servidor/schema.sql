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
