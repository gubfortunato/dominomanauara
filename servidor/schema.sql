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

-- 3.39: progresso do jogo guardado para quem apoia (nível, conquistas, avatar e histórico), para não perder ao trocar de
-- celular ou se o navegador apagar os dados. Ligado ao código do aparelho; vai junto com o código do plano.
CREATE TABLE IF NOT EXISTS progresso (aparelho TEXT PRIMARY KEY, dados TEXT NOT NULL, atualizado INTEGER NOT NULL);
-- 3.41: o administrador pediu outro apelido (apelido ofensivo que passou pelo filtro); some quando o apelido muda
CREATE TABLE IF NOT EXISTS apelidos_trocar (aparelho TEXT PRIMARY KEY, nome TEXT NOT NULL, em INTEGER NOT NULL);
-- 3.41: ritmo das jogadas por aparelho e dia (robôs de fora); 30 dias
CREATE TABLE IF NOT EXISTS ritmo (dia TEXT NOT NULL, aparelho TEXT NOT NULL, jogadas INTEGER NOT NULL DEFAULT 0, rapidas INTEGER NOT NULL DEFAULT 0, soma_ms INTEGER NOT NULL DEFAULT 0, sem_app INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, aparelho));

-- 3.41: caixa de notificações do app (mensagens para todos e avisos de evento; o celular busca no máximo a cada 30 min)
CREATE TABLE IF NOT EXISTS caixa (id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, titulo TEXT NOT NULL, texto TEXT NOT NULL, url TEXT, em INTEGER NOT NULL);

-- 28/10: o aparelho do teste automático de cada publicação nunca fica bloqueado (ele cria uma mesa, entra e sai)
DELETE FROM bloqueios WHERE aparelho LIKE 'teste-publicacao-%';
DELETE FROM ritmo WHERE aparelho LIKE 'teste-publicacao-%';

-- 3.42: papo da mesa (mesa com os amigos). As mensagens ficam só na mesa enquanto ela existe; aqui fica apenas a
-- mensagem denunciada (com as 10 de antes) para o administrador ver, por até 30 dias.
CREATE TABLE IF NOT EXISTS papo_denuncias (id INTEGER PRIMARY KEY AUTOINCREMENT, em INTEGER NOT NULL, mesa TEXT NOT NULL, msg_em INTEGER NOT NULL,
  autor TEXT NOT NULL, autor_nome TEXT, denunciante TEXT NOT NULL, texto TEXT, contexto TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS papo_denuncias_um ON papo_denuncias (mesa, msg_em, autor, denunciante);
CREATE INDEX IF NOT EXISTS papo_denuncias_em ON papo_denuncias (em);

-- 28/10: planos. Sem plano: nas mesas com os amigos, cria 1 mesa e joga 1 partida por dia; na mesa rápida, 5 partidas
-- completas por dia (dia de Brasília). Guarda só a contagem do dia por aparelho, por 7 dias.
CREATE TABLE IF NOT EXISTS limites (dia TEXT NOT NULL, aparelho TEXT NOT NULL, mesas INTEGER NOT NULL DEFAULT 0, partidas INTEGER NOT NULL DEFAULT 0,
  publicas INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, aparelho));
-- 28/10 (pedido do dono): contra quem apaga os dados do app para jogar mais de graça no mesmo dia. aparelhos: quando cada
-- código de aparelho apareceu numa mesa online pela 1ª vez (os que já existiam ficam com 0). limites_rede: quem bateu o
-- limite hoje, por rede (só um resumo do endereço com o dia, que muda todo dia; o endereço nunca é guardado), por 2 dias.
CREATE TABLE IF NOT EXISTS marcos (chave TEXT PRIMARY KEY, em INTEGER NOT NULL);   -- (o que roda uma vez só; criada aqui antes do 1º uso)
CREATE TABLE IF NOT EXISTS aparelhos (aparelho TEXT PRIMARY KEY, desde INTEGER NOT NULL);
INSERT OR IGNORE INTO aparelhos (aparelho, desde)
  SELECT aparelho, 0 FROM (SELECT aparelho FROM jogadores_vistos UNION SELECT aparelho FROM planos UNION SELECT aparelho FROM presenca
    UNION SELECT aparelho FROM ranking UNION SELECT aparelho FROM calcada UNION SELECT aparelho FROM pedidos WHERE aparelho IS NOT NULL)
  WHERE aparelho IS NOT NULL AND aparelho <> '' AND NOT EXISTS (SELECT 1 FROM marcos WHERE chave = 'aparelhos-antigos');
INSERT OR IGNORE INTO marcos (chave, em) VALUES ('aparelhos-antigos', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
CREATE TABLE IF NOT EXISTS limites_rede (dia TEXT NOT NULL, marca TEXT NOT NULL, tipo TEXT NOT NULL, aparelho TEXT NOT NULL, nome TEXT, em INTEGER NOT NULL,
  PRIMARY KEY (dia, marca, tipo, aparelho));
-- 28/10: aviso dos planos no sino, uma vez (7 dias antes de os limites valerem)
INSERT OR IGNORE INTO caixa (chave, titulo, texto, url, em) VALUES ('planos-2026-11-05', 'Chegou o Sócio da Calçada',
  'Sócio da Calçada: partidas sem limite, ranking completo, estatísticas, foto, selo e avatares. Promoção de lançamento até 4/11: R$ 9,90 por mês nos 3 primeiros meses (depois R$ 14,90). Quem já tinha pago ganhou 1 ano de sócio de presente. A partir de 5/11, sem plano: 5 partidas por dia na mesa rápida e 1 partida por dia com os amigos. O jogo offline continua sem limite. Toque para ver.',
  './?apoio=renovar', CAST(strftime('%s', 'now') AS INTEGER) * 1000);   -- a hora da publicação (não no futuro: o sino marcaria como nova de novo)

-- 28/10: Sócio da Calçada que renova sozinho (assinatura do Asaas, no cartão): mensal, trimestral ou anual. Uma linha por
-- pedido de assinatura: o aparelho, o checkout, a assinatura e o cliente do Asaas (só os códigos, para ligar cada cobrança
-- ao aparelho), o produto, o valor da 1ª cobrança, quantas cobranças têm o preço da promoção (0 = sem promoção), quantas
-- já foram pagas e quando o valor passou para o normal no Asaas (reajustada; reajuste_erro guarda o último erro).
CREATE TABLE IF NOT EXISTS assinaturas (pedido TEXT PRIMARY KEY, aparelho TEXT NOT NULL, checkout TEXT, assinatura TEXT, cliente TEXT,
  status TEXT NOT NULL, criado_em INTEGER NOT NULL, pago_em INTEGER, cancelada_em INTEGER,
  produto TEXT NOT NULL DEFAULT 'apm', valor REAL, promo INTEGER NOT NULL DEFAULT 0, pagos INTEGER NOT NULL DEFAULT 0,
  reajustada INTEGER, reajuste_tentado INTEGER, reajuste_erro TEXT);
CREATE INDEX IF NOT EXISTS assinaturas_ass ON assinaturas (assinatura);
CREATE INDEX IF NOT EXISTS assinaturas_cli ON assinaturas (cliente);
CREATE INDEX IF NOT EXISTS assinaturas_ap ON assinaturas (aparelho);
CREATE INDEX IF NOT EXISTS assinaturas_ck ON assinaturas (checkout);

-- 28/10 (pedido do dono: honrar quem já pagou): na primeira publicação com o Sócio da Calçada, todo aparelho que já tinha
-- pago qualquer valor ganha 1 ano (365 dias) de sócio de presente, contados do lançamento dos limites (LANCAMENTO_MS) e
-- somados ao tempo que ainda tiver. Roda uma vez só (marco 'presente-fundador'); quem pagar depois não entra.
CREATE TABLE IF NOT EXISTS marcos (chave TEXT PRIMARY KEY, em INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presentes (aparelho TEXT NOT NULL, tipo TEXT NOT NULL, dias INTEGER NOT NULL, ate INTEGER NOT NULL, em INTEGER NOT NULL, PRIMARY KEY (aparelho, tipo));
INSERT OR IGNORE INTO presentes (aparelho, tipo, dias, ate, em)
  SELECT DISTINCT aparelho, 'fundador', 365, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM pedidos
  WHERE status = 'pago' AND aparelho IS NOT NULL AND aparelho <> '' AND aparelho NOT LIKE 'teste-publicacao-%'
    AND NOT EXISTS (SELECT 1 FROM marcos WHERE chave = 'presente-fundador');
INSERT OR IGNORE INTO planos (aparelho, ate, desde, codigo)
  SELECT p.aparelho, 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000, upper(hex(randomblob(4))) FROM presentes p
  WHERE p.tipo = 'fundador' AND NOT EXISTS (SELECT 1 FROM planos x WHERE x.aparelho = p.aparelho)
    AND NOT EXISTS (SELECT 1 FROM marcos WHERE chave = 'presente-fundador');
UPDATE planos SET ate = MAX(ate, 1793847600000) + 365 * 86400000   -- LANCAMENTO_MS; 28/10 (dono): 1 ano de presente
  WHERE aparelho IN (SELECT aparelho FROM presentes WHERE tipo = 'fundador')
    AND NOT EXISTS (SELECT 1 FROM marcos WHERE chave = 'presente-fundador');
UPDATE presentes SET ate = (SELECT ate FROM planos WHERE planos.aparelho = presentes.aparelho)
  WHERE tipo = 'fundador' AND NOT EXISTS (SELECT 1 FROM marcos WHERE chave = 'presente-fundador');
INSERT OR IGNORE INTO marcos (chave, em) VALUES ('presente-fundador', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
