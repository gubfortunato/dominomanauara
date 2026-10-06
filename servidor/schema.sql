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
