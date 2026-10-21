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
CREATE INDEX IF NOT EXISTS pedidos_aparelho ON pedidos (aparelho, status);
-- Lembrete de renovação: qual inscrição de aviso é de qual aparelho, e quais avisos de "seu plano está acabando" já foram
CREATE TABLE IF NOT EXISTS avisos_id (endpoint TEXT PRIMARY KEY, aparelho TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS avisos_id_aparelho ON avisos_id (aparelho);
-- Foto na mesa online (Plano Apoiador): uma por aparelho; "pub" é o código público da foto (o do aparelho nunca aparece)
CREATE TABLE IF NOT EXISTS fotos (aparelho TEXT PRIMARY KEY, pub TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, dados TEXT NOT NULL, status TEXT NOT NULL, criado_em INTEGER NOT NULL, revisado_em INTEGER, denuncias INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS fotos_status ON fotos (status, criado_em);
-- O que a IA achou de cada foto (o motivo que o jogador lê quando é recusada) e o teste de saúde da IA
CREATE TABLE IF NOT EXISTS fotos_ia (aparelho TEXT PRIMARY KEY, pub TEXT, veredito TEXT, categoria TEXT, modelo TEXT, em INTEGER, tentou_em INTEGER, denuncias_vistas INTEGER);
CREATE TABLE IF NOT EXISTS ia_teste (id INTEGER PRIMARY KEY, em INTEGER NOT NULL, resultado TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lembretes_plano (aparelho TEXT NOT NULL, ate INTEGER NOT NULL, enviado_em INTEGER NOT NULL, PRIMARY KEY (aparelho, ate));
-- 3.38: aviso no dia em que o tempo de Apoiador acaba (um por vencimento)
CREATE TABLE IF NOT EXISTS lembretes_plano_fim (aparelho TEXT NOT NULL, ate INTEGER NOT NULL, enviado_em INTEGER NOT NULL, PRIMARY KEY (aparelho, ate));

-- Patrocinadores (cadastrados pelo dono) e quantas vezes cada espaço apareceu / foi tocado por dia
CREATE TABLE IF NOT EXISTS patrocinadores (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, texto TEXT, link TEXT, logo INTEGER, banners TEXT, espacos TEXT NOT NULL, inicio INTEGER, fim INTEGER, ativo INTEGER NOT NULL DEFAULT 1, peso INTEGER NOT NULL DEFAULT 1, criado_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS patro_imgs (id INTEGER PRIMARY KEY AUTOINCREMENT, mime TEXT NOT NULL, dados TEXT NOT NULL, criado_em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS patro_contagem (patro INTEGER NOT NULL, dia TEXT NOT NULL, espaco TEXT NOT NULL, vistas INTEGER NOT NULL DEFAULT 0, cliques INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (patro, dia, espaco));

-- Turmas (grupos por código) e o Desafio das Confrarias (1º/11 a 20/12; 3 títulos = Grande Taça)
CREATE TABLE IF NOT EXISTS turmas (codigo TEXT PRIMARY KEY, nome TEXT NOT NULL, criador TEXT, criada INTEGER NOT NULL, titulos INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS turmas_nome ON turmas (lower(nome));
CREATE TABLE IF NOT EXISTS turma_membros (aparelho TEXT PRIMARY KEY, turma TEXT NOT NULL, nome TEXT, entrou INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS turma_membros_turma ON turma_membros (turma, entrou);
CREATE TABLE IF NOT EXISTS desafio_pontos (edicao INTEGER NOT NULL, turma TEXT NOT NULL, pontos INTEGER NOT NULL DEFAULT 0, ultimo INTEGER, PRIMARY KEY (edicao, turma));
CREATE TABLE IF NOT EXISTS desafio_jogos (edicao INTEGER NOT NULL, dia TEXT NOT NULL, vencedora TEXT NOT NULL, perdedora TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (edicao, dia, vencedora, perdedora));
CREATE TABLE IF NOT EXISTS desafio_campeas (edicao INTEGER PRIMARY KEY, turma TEXT, pontos INTEGER, fechada_em INTEGER);

-- "Hoje no Dominó Manauara" (3.24): partidas terminadas, galos e batidas de carroça do dia (dia de Manaus)
CREATE TABLE IF NOT EXISTS vivo_dia (dia TEXT PRIMARY KEY, partidas INTEGER NOT NULL DEFAULT 0, galos INTEGER NOT NULL DEFAULT 0, carrocas INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS vivo_envios (marca TEXT NOT NULL, criado_em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS vivo_envios_marca ON vivo_envios (marca, criado_em);

-- Cortesia do dono (3.25): o aparelho do administrador fica com selo de doador e tempo de Apoiador, sem pagamento
CREATE TABLE IF NOT EXISTS cortesias (aparelho TEXT PRIMARY KEY, nivel INTEGER NOT NULL DEFAULT 1, desde INTEGER NOT NULL);

-- Bloqueio de jogadores pelo administrador (3.25) e a lista de quem jogou online nos últimos dias (para bloquear)
CREATE TABLE IF NOT EXISTS bloqueios (aparelho TEXT PRIMARY KEY, nome TEXT, motivo TEXT, em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jogadores_vistos (aparelho TEXT PRIMARY KEY, nome TEXT, av TEXT, mesa TEXT, visto_em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jogadores_vistos_em ON jogadores_vistos (visto_em);

-- "No app agora" (3.26): em que parte do jogo cada pessoa está (o app avisa a cada minuto); some depois de 1 dia
CREATE TABLE IF NOT EXISTS presenca (aparelho TEXT PRIMARY KEY, nome TEXT, av TEXT, nv INTEGER, tela TEXT, modo TEXT, detalhe TEXT, menor INTEGER NOT NULL DEFAULT 0, visto_em INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS presenca_visto ON presenca (visto_em);

-- Ranking da calçada (3.29): partidas online ganhas e jogadas (inteiras) por pessoa, por semana (S2026-10-19) e por mês
-- (M2026-10); quem pediu para não aparecer fica em ranking_fora
CREATE TABLE IF NOT EXISTS ranking (periodo TEXT NOT NULL, aparelho TEXT NOT NULL, nome TEXT, av TEXT, nv INTEGER, ganhas INTEGER NOT NULL DEFAULT 0, jogadas INTEGER NOT NULL DEFAULT 0, atualizado INTEGER NOT NULL, PRIMARY KEY (periodo, aparelho));
CREATE INDEX IF NOT EXISTS ranking_top ON ranking (periodo, ganhas DESC, jogadas, atualizado);
CREATE TABLE IF NOT EXISTS ranking_fora (aparelho TEXT PRIMARY KEY, em INTEGER NOT NULL);

-- 3.37: ranking por pontos (semanas a partir de 26/10/2026 e meses a partir de novembro). Vitória contra pessoas +3,
-- contra robôs +1 (só as 3 primeiras do dia), derrota contra pessoas -1 (nunca abaixo de 0); contra a mesma pessoa,
-- só as 5 primeiras partidas do dia contam ponto. calcada_robo e calcada_par guardam essas contas do dia (2 dias).
CREATE TABLE IF NOT EXISTS calcada (periodo TEXT NOT NULL, aparelho TEXT NOT NULL, nome TEXT, av TEXT, nv INTEGER, pontos INTEGER NOT NULL DEFAULT 0, ganhas INTEGER NOT NULL DEFAULT 0, jogadas INTEGER NOT NULL DEFAULT 0, ganhas_gente INTEGER NOT NULL DEFAULT 0, jogadas_gente INTEGER NOT NULL DEFAULT 0, atualizado INTEGER NOT NULL, PRIMARY KEY (periodo, aparelho));
CREATE INDEX IF NOT EXISTS calcada_top ON calcada (periodo, pontos DESC);
CREATE TABLE IF NOT EXISTS calcada_robo (dia TEXT NOT NULL, aparelho TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, aparelho));
CREATE TABLE IF NOT EXISTS calcada_par (dia TEXT NOT NULL, a TEXT NOT NULL, b TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, a, b));
