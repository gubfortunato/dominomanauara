# 26/11 (pedido do dono, 2ª parte da varredura): confere os casos que chamaram atenção. Só lê. Sem nome, apelido ou
# código de ninguém aqui; o resultado sai só no arquivo criptografado.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or r.stdout or '')[-300:]}]
A = int(time.time() * 1000); DIA = 86400000
dia = lambda ms: time.strftime('%Y-%m-%d', time.gmtime((ms - 4 * 3600000) / 1000))
D14, D7 = dia(A - 14 * DIA), dia(A - 7 * DIA)
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
dt = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((int(ms) - 4 * 3600000) / 1000)) if ms else None
L = []
def sec(t, rows): L.append('== ' + t); L.append(json.dumps(rows, ensure_ascii=False))
NOME = "(SELECT nome FROM jogadores_nome jn WHERE jn.aparelho = {c})"
# 1) quem jogou muito online num dia: tinha plano naquele dia? (o plano pode ter vencido depois)
rows = q(f"""SELECT r.dia, r.aparelho, {NOME.format(c='r.aparelho')} AS nome, r.jogadas, COALESCE(l.publicas, 0) AS publicas, COALESCE(l.partidas, 0) AS amigos,
  COALESCE(qj.n, 0) AS quarta, p.desde AS plano_desde, p.ate AS plano_ate, (SELECT COUNT(*) FROM presentes pr WHERE pr.aparelho = r.aparelho) AS presentes,
  (SELECT COUNT(*) FROM pedidos pe WHERE pe.aparelho = r.aparelho AND pe.status = 'pago') AS pagos
  FROM ritmo r LEFT JOIN limites l ON l.dia = r.dia AND l.aparelho = r.aparelho LEFT JOIN quarta_jog qj ON qj.dia = r.dia AND qj.aparelho = r.aparelho
  LEFT JOIN planos p ON p.aparelho = r.aparelho WHERE r.dia >= '{D7}' AND r.jogadas >= 120
  AND r.aparelho NOT IN (SELECT aparelho FROM planos WHERE ate > {A}) ORDER BY r.jogadas DESC LIMIT 40""")
for r in rows:
    if 'aparelho' in r: r['aparelho'] = h(r['aparelho'])
    r['plano_desde'], r['plano_ate'] = dt(r.get('plano_desde')), dt(r.get('plano_ate'))
sec('muito jogo online sem plano hoje: e naquele dia?', rows)
# 2) o mesmo apelido em vários aparelhos: somando os aparelhos, passou do limite da pessoa no dia?
sec('por apelido (aparelhos novos em 14 dias, 3+): soma do dia de todos os aparelhos', q(f"""WITH ap AS (SELECT a.aparelho, lower(jn.nome) AS n FROM aparelhos a JOIN jogadores_nome jn ON jn.aparelho = a.aparelho
    WHERE a.desde > {A - 14 * DIA} AND jn.nome IS NOT NULL), gr AS (SELECT n FROM ap GROUP BY n HAVING COUNT(*) >= 3),
  todos AS (SELECT jn.aparelho, lower(jn.nome) AS n FROM jogadores_nome jn WHERE lower(jn.nome) IN (SELECT n FROM gr))
  SELECT t.n AS apelido, l.dia, COUNT(DISTINCT l.aparelho) AS aparelhos, SUM(l.publicas) AS publicas, SUM(l.partidas) AS amigos,
  SUM(CASE WHEN t.aparelho IN (SELECT aparelho FROM planos WHERE ate > {A}) THEN 1 ELSE 0 END) AS com_plano
  FROM todos t JOIN limites l ON l.aparelho = t.aparelho WHERE l.dia >= '{D14}' GROUP BY t.n, l.dia HAVING aparelhos >= 2 ORDER BY publicas + amigos DESC LIMIT 40"""))
# 3) a mesma rede no mesmo dia: vários aparelhos (apelidos parecidos) somando acima do limite
sec('mesma rede no dia (2 dias): soma de todos os aparelhos', q(f"""SELECT d.dia, substr(d.marca, 1, 6) AS rede, COUNT(DISTINCT d.aparelho) AS aparelhos, GROUP_CONCAT(DISTINCT d.nome) AS apelidos,
  SUM(COALESCE(l.publicas, 0)) AS publicas, SUM(COALESCE(l.partidas, 0)) AS amigos,
  SUM(CASE WHEN d.aparelho IN (SELECT aparelho FROM planos WHERE ate > {A}) THEN 1 ELSE 0 END) AS com_plano
  FROM (SELECT DISTINCT dia, marca, aparelho, nome FROM pessoa_dia WHERE marca <> '') d LEFT JOIN limites l ON l.dia = d.dia AND l.aparelho = d.aparelho
  GROUP BY d.dia, d.marca HAVING aparelhos >= 2 AND (SUM(COALESCE(l.publicas, 0)) > 5 OR SUM(COALESCE(l.partidas, 0)) > 3) ORDER BY publicas DESC LIMIT 30"""))
# 4) os pares que mais se enfrentam: mesma rede (mesma pessoa?) e plano
rows = q(f"""SELECT cp.dia, cp.a, cp.b, cp.n, {NOME.format(c='cp.a')} AS nome_a, {NOME.format(c='cp.b')} AS nome_b,
  (SELECT COUNT(*) FROM pessoa_dia x JOIN pessoa_dia y ON x.dia = y.dia AND x.marca = y.marca AND x.marca <> '' WHERE x.aparelho = cp.a AND y.aparelho = cp.b) AS mesma_rede,
  (SELECT COUNT(*) FROM planos WHERE aparelho = cp.a AND ate > {A}) AS plano_a, (SELECT COUNT(*) FROM planos WHERE aparelho = cp.b AND ate > {A}) AS plano_b
  FROM calcada_par cp WHERE cp.n >= 10 ORDER BY cp.n DESC LIMIT 20""")
for r in rows:
    for c in ('a', 'b'):
        if r.get(c): r[c] = h(r[c])
sec('pares com 10+ partidas no dia: mesma rede? plano?', rows)
sec('ranking da semana (todos): os 10 primeiros', q("SELECT nome, pontos, ganhas, jogadas, ganhas_gente, jogadas_gente FROM calcada WHERE periodo = (SELECT MAX(periodo) FROM calcada WHERE periodo LIKE 'S%') ORDER BY pontos DESC LIMIT 10"))
open(OUT, 'a').write('\n'.join(L) + '\n')
