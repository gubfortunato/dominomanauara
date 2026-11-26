# 26/11 (pedido do dono): varredura de possíveis fraudes, burlas e brechas de quem não tem plano. Só lê.
# O resultado sai só no arquivo criptografado; aqui não tem nome, apelido nem código de ninguém.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or r.stdout or '')[-300:]}]
A = int(time.time() * 1000); DIA = 86400000
dia = lambda ms: time.strftime('%Y-%m-%d', time.gmtime((ms - 4 * 3600000) / 1000))
D14, D7 = dia(A - 14 * DIA), dia(A - 7 * DIA)
def livre(col): return f"{col} NOT IN (SELECT aparelho FROM planos WHERE ate > {A}) AND {col} NOT IN (SELECT aparelho FROM cortesias)"
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
def com_hash(rows, cols=('aparelho', 'a', 'b')):
    for r in rows:
        for c in cols:
            if c in r and r[c]: r[c] = h(r[c])
    return rows
L = []
def sec(t, rows): L.append('== ' + t); L.append(json.dumps(rows, ensure_ascii=False))
NOME = "(SELECT nome FROM jogadores_nome jn WHERE jn.aparelho = {c})"
sec('visão geral', q(f"""SELECT (SELECT COUNT(*) FROM planos WHERE ate > {A}) AS planos_ativos, (SELECT COUNT(*) FROM cortesias) AS cortesias,
  (SELECT COUNT(*) FROM presenca WHERE visto_em > {A - 7 * DIA}) AS vistos_7d, (SELECT COUNT(*) FROM presenca WHERE visto_em > {A - 7 * DIA} AND {livre('presenca.aparelho')}) AS vistos_7d_sem_plano,
  (SELECT COUNT(*) FROM aparelhos WHERE desde > {A - 14 * DIA}) AS aparelhos_novos_14d, (SELECT COUNT(*) FROM bloqueios) AS bloqueados"""))
# 1) as burlas que o servidor já pegou (limite herdado pela rede, pelo apelido, por pessoa)
sec('burlas por tipo e via (14 dias)', q("SELECT tipo, via, COUNT(*) AS n, COUNT(DISTINCT aparelho) AS aparelhos, COUNT(DISTINCT nome) AS apelidos FROM burlas GROUP BY tipo, via ORDER BY n DESC"))
sec('burlas por apelido (mais vezes)', q("SELECT nome, COUNT(*) AS n, COUNT(DISTINCT aparelho) AS aparelhos, COUNT(DISTINCT dia) AS dias, GROUP_CONCAT(DISTINCT tipo) AS tipos, GROUP_CONCAT(DISTINCT via) AS vias FROM burlas GROUP BY lower(nome) ORDER BY n DESC LIMIT 25"))
# 2) passou do limite sem plano (não devia acontecer: brecha)
sec('acima do limite sem plano (amigos > 3 ou rápida > 5)', com_hash(q(f"SELECT l.dia, l.aparelho, {NOME.format(c='l.aparelho')} AS nome, l.mesas, l.partidas, l.publicas FROM limites l WHERE l.dia >= '{D14}' AND (l.partidas > 3 OR l.publicas > 5) AND {livre('l.aparelho')} ORDER BY l.dia DESC LIMIT 40")))
# 3) muito jogo online sem fechar partida (a mesa rápida só conta partida terminada): jogadas no dia x partidas contadas
sec('mais jogadas online no dia, sem plano (7 dias)', com_hash(q(f"""SELECT r.dia, r.aparelho, {NOME.format(c='r.aparelho')} AS nome, r.jogadas, r.rapidas, r.sem_app,
  COALESCE(l.publicas, 0) AS publicas, COALESCE(l.partidas, 0) AS amigos, COALESCE(qj.n, 0) AS quarta, COALESCE(pd.n, 0) AS partidas_app, COALESCE(ab.n, 0) AS abandonos
  FROM ritmo r LEFT JOIN limites l ON l.dia = r.dia AND l.aparelho = r.aparelho LEFT JOIN quarta_jog qj ON qj.dia = r.dia AND qj.aparelho = r.aparelho
  LEFT JOIN partidas_dia pd ON pd.dia = r.dia AND pd.aparelho = r.aparelho LEFT JOIN abandonos ab ON ab.dia = r.dia AND ab.aparelho = r.aparelho
  WHERE r.dia >= '{D7}' AND {livre('r.aparelho')} ORDER BY r.jogadas DESC LIMIT 40""")))
sec('base: jogadas por partida contada (sócios, 7 dias)', q(f"""SELECT COUNT(*) AS dias, SUM(r.jogadas) AS jogadas, SUM(COALESCE(pd.n, 0)) AS partidas_app FROM ritmo r
  LEFT JOIN partidas_dia pd ON pd.dia = r.dia AND pd.aparelho = r.aparelho WHERE r.dia >= '{D7}' AND r.aparelho IN (SELECT aparelho FROM planos WHERE ate > {A})"""))
# 4) um apelido em vários aparelhos (2 dias) e várias pessoas na mesma rede
sec('mesmo apelido em 3+ aparelhos no dia (2 dias)', q(f"""SELECT dia, nome, COUNT(DISTINCT aparelho) AS aparelhos, COUNT(DISTINCT marca) AS redes,
  SUM(CASE WHEN {livre('aparelho')} THEN 1 ELSE 0 END) AS sem_plano FROM pessoa_dia GROUP BY dia, nome HAVING aparelhos >= 3 ORDER BY aparelhos DESC LIMIT 30"""))
sec('mesma rede com 4+ aparelhos sem plano no dia (2 dias)', q(f"""SELECT dia, substr(marca, 1, 6) AS rede, COUNT(DISTINCT aparelho) AS aparelhos, COUNT(DISTINCT nome) AS apelidos, GROUP_CONCAT(DISTINCT nome) AS quais
  FROM pessoa_dia WHERE marca <> '' AND {livre('aparelho')} GROUP BY dia, marca HAVING aparelhos >= 4 ORDER BY aparelhos DESC LIMIT 20"""))
sec('limite batido por vários aparelhos na mesma rede (14 dias)', q("""SELECT dia, tipo, substr(marca, 1, 6) AS rede, COUNT(DISTINCT aparelho) AS aparelhos, GROUP_CONCAT(DISTINCT nome) AS apelidos
  FROM limites_rede GROUP BY dia, tipo, marca HAVING aparelhos >= 2 ORDER BY dia DESC, aparelhos DESC LIMIT 30"""))
sec('apelido com 3+ aparelhos novos em 14 dias', q(f"""SELECT jn.nome, COUNT(*) AS aparelhos, SUM(CASE WHEN {livre('a.aparelho')} THEN 1 ELSE 0 END) AS sem_plano
  FROM aparelhos a JOIN jogadores_nome jn ON jn.aparelho = a.aparelho WHERE a.desde > {A - 14 * DIA} GROUP BY lower(jn.nome) HAVING aparelhos >= 3 ORDER BY aparelhos DESC LIMIT 30"""))
# 5) abandonos (a mesa rápida trava na 3ª do dia)
sec('abandonos no dia, sem plano (2 dias)', com_hash(q(f"SELECT ab.dia, ab.aparelho, {NOME.format(c='ab.aparelho')} AS nome, ab.n FROM abandonos ab WHERE {livre('ab.aparelho')} ORDER BY ab.n DESC LIMIT 20")))
# 6) ranking: pares que jogam muito entre si (fazenda de pontos) e quem ganha muito de robô
sec('pares que mais se enfrentaram num dia', com_hash(q(f"SELECT dia, a, {NOME.format(c='a')} AS nome_a, b, {NOME.format(c='b')} AS nome_b, n FROM calcada_par WHERE n >= 5 ORDER BY n DESC LIMIT 25")))
sec('ranking da semana (pontos), quem não tem plano', com_hash(q(f"SELECT c.aparelho, c.nome, c.pontos, c.ganhas, c.jogadas, c.ganhas_gente, c.jogadas_gente FROM calcada c WHERE c.periodo = (SELECT MAX(periodo) FROM calcada WHERE periodo LIKE 'S%') AND {livre('c.aparelho')} ORDER BY c.pontos DESC LIMIT 15")))
# 7) ritmo de robô (jogada rápida demais) e pedidos de fora do app
sec('jogadas rápidas demais ou fora do app (7 dias, sem plano)', com_hash(q(f"""SELECT r.aparelho, {NOME.format(c='r.aparelho')} AS nome, SUM(r.jogadas) AS jogadas, SUM(r.rapidas) AS rapidas, SUM(r.sem_app) AS sem_app, ROUND(1.0 * SUM(r.soma_ms) / MAX(1, SUM(r.jogadas))) AS ms_medio
  FROM ritmo r WHERE r.dia >= '{D7}' AND {livre('r.aparelho')} GROUP BY r.aparelho HAVING (SUM(r.jogadas) >= 40 AND 1.0 * SUM(r.rapidas) / SUM(r.jogadas) > .25) OR SUM(r.sem_app) > 0 ORDER BY rapidas DESC LIMIT 25""")))
# 8) tentar adivinhar número de mesa ou código de sócio
sec('números errados por rede (só contagem)', q("SELECT substr(marca, 1, 6) AS rede, COUNT(*) AS errados FROM codigos_errados GROUP BY marca ORDER BY errados DESC LIMIT 10"))
sec('tentativas por tipo (7 dias)', q(f"SELECT tipo, COUNT(*) AS n, COUNT(DISTINCT marca) AS redes FROM tentativas WHERE criado_em > {A - 7 * DIA} GROUP BY tipo ORDER BY n DESC"))
sec('trazer plano por rede (7 dias)', q(f"SELECT substr(marca, 1, 6) AS rede, COUNT(*) AS n FROM tentativas WHERE tipo = 'trazer' AND criado_em > {A - 7 * DIA} GROUP BY marca ORDER BY n DESC LIMIT 10"))
# 9) offline e desafios acima do limite
sec('offline acima de 6 no dia, sem plano (7 dias)', com_hash(q(f"SELECT o.dia, o.aparelho, {NOME.format(c='o.aparelho')} AS nome, o.n FROM offline_uso o WHERE o.dia >= '{D7}' AND o.n > 6 AND {livre('o.aparelho')} ORDER BY o.n DESC LIMIT 15")))
sec('desafios acima de 2 no dia, sem plano (7 dias)', com_hash(q(f"SELECT d.dia, d.aparelho, {NOME.format(c='d.aparelho')} AS nome, d.n FROM desafio_uso d WHERE d.dia >= '{D7}' AND d.n > 2 AND {livre('d.aparelho')} ORDER BY d.n DESC LIMIT 15")))
# 10) Desafio das Confrarias: placares muito tortos entre duas Turmas (combinação?) e quem sem plano mais pontua
sec('Desafio: vitórias de uma Turma sobre outra', q("SELECT vencedora, perdedora, SUM(n) AS n, COUNT(DISTINCT dia) AS dias FROM desafio_jogos GROUP BY vencedora, perdedora ORDER BY n DESC LIMIT 20"))
sec('Desafio: quem sem plano mais pontuou', com_hash(q(f"SELECT m.turma, m.aparelho, {NOME.format(c='m.aparelho')} AS nome, m.pontos FROM desafio_membros m WHERE {livre('m.aparelho')} ORDER BY m.pontos DESC LIMIT 15")))
# 11) plano sem pagamento conhecido (brecha?): sem pedido pago, sem assinatura paga, sem presente do dono, sem prêmio da Copa
sec('plano ativo sem pagamento conhecido', com_hash(q(f"""SELECT p.aparelho, {NOME.format(c='p.aparelho')} AS nome, p.desde, p.ate FROM planos p WHERE p.ate > {A}
  AND p.aparelho NOT IN (SELECT aparelho FROM pedidos WHERE status IN ('pago', 'PAGO', 'confirmado', 'recebido'))
  AND p.aparelho NOT IN (SELECT aparelho FROM assinaturas WHERE pagos > 0 OR pago_em IS NOT NULL)
  AND p.aparelho NOT IN (SELECT aparelho FROM presentes_dono) AND p.aparelho NOT IN (SELECT aparelho FROM copa_premios)
  AND p.aparelho NOT IN (SELECT aparelho FROM presentes) AND p.aparelho NOT IN (SELECT aparelho FROM cortesias) LIMIT 30""")))
sec('status de pedidos (contagem)', q("SELECT status, COUNT(*) AS n FROM pedidos GROUP BY status"))
open(OUT, 'a').write('\n'.join(L) + '\n')
