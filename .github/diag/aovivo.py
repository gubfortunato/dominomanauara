# 26/11 (pedido do dono: "continue monitorando"): retrato de agora de quem joga sem plano: limites, burlas barradas,
# aparelhos novos e a mesma internet com vários aparelhos. Só lê. Sem nome ou código aqui; o resultado sai criptografado.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or r.stdout or '')[-300:]}]
A = int(time.time() * 1000); H = 3600000
HOJE = time.strftime('%Y-%m-%d', time.gmtime((A - 3 * H) / 1000))   # o dia dos limites (Brasília)
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
dt = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((int(ms) - 4 * H) / 1000)) if ms else None
def livre(col): return f"{col} NOT IN (SELECT aparelho FROM planos WHERE ate > {A}) AND {col} NOT IN (SELECT aparelho FROM cortesias)"
L = ['== agora: ' + dt(A) + ' (Manaus) · dia dos limites ' + HOJE]
def sec(t, rows):
    for r in rows:
        for c in ('aparelho',):
            if r.get(c): r[c] = h(r[c])
        for c in ('em', 'visto_em', 'desde', 'primeiro', 'ultimo'):
            if isinstance(r.get(c), int) and r[c] > 10**12: r[c] = dt(r[c])
    L.append('== ' + t); L.append(json.dumps(rows, ensure_ascii=False))
NOME = "(SELECT nome FROM jogadores_nome jn WHERE jn.aparelho = {c})"
sec('no app agora (10 min)', q(f"SELECT COUNT(*) AS todos, SUM(CASE WHEN {livre('aparelho')} THEN 1 ELSE 0 END) AS sem_plano, SUM(CASE WHEN tela = 'game' OR modo = 'on' THEN 1 ELSE 0 END) AS jogando FROM presenca WHERE visto_em > {A - 10 * 60000}"))
sec('no app agora, por tela (sem plano)', q(f"SELECT tela, modo, COUNT(*) AS n FROM presenca WHERE visto_em > {A - 10 * 60000} AND {livre('aparelho')} GROUP BY tela, modo ORDER BY n DESC LIMIT 12"))
sec('barrados hoje (burlas)', q(f"SELECT tipo, via, nome, em FROM burlas WHERE dia = '{HOJE}' ORDER BY em DESC LIMIT 40"))
sec('bateram o limite hoje', q(f"SELECT tipo, nome, substr(marca, 1, 6) AS rede, em FROM limites_rede WHERE dia = '{HOJE}' ORDER BY em DESC LIMIT 40"))
sec('uso de hoje, sem plano (mais jogado)', q(f"""SELECT l.aparelho, {NOME.format(c='l.aparelho')} AS nome, l.mesas, l.partidas, l.publicas, COALESCE(r.jogadas, 0) AS jogadas, COALESCE(o.n, 0) AS offline
  FROM limites l LEFT JOIN ritmo r ON r.dia = l.dia AND r.aparelho = l.aparelho LEFT JOIN offline_uso o ON o.dia = l.dia AND o.aparelho = l.aparelho
  WHERE l.dia = '{HOJE}' AND {livre('l.aparelho')} ORDER BY l.publicas + l.partidas DESC, jogadas DESC LIMIT 30"""))
sec('acima do limite hoje, sem plano', q(f"SELECT l.aparelho, {NOME.format(c='l.aparelho')} AS nome, l.partidas, l.publicas FROM limites l WHERE l.dia = '{HOJE}' AND (l.partidas > 3 OR l.publicas > 5) AND {livre('l.aparelho')}"))
sec('jogando muito hoje sem contar (ritmo alto, limite baixo)', q(f"""SELECT r.aparelho, {NOME.format(c='r.aparelho')} AS nome, r.jogadas, COALESCE(l.publicas, 0) AS publicas, COALESCE(l.partidas, 0) AS amigos
  FROM ritmo r LEFT JOIN limites l ON l.dia = r.dia AND l.aparelho = r.aparelho WHERE r.dia = '{HOJE}' AND {livre('r.aparelho')} AND r.jogadas > 60 * (1 + COALESCE(l.publicas, 0) + COALESCE(l.partidas, 0)) ORDER BY r.jogadas DESC LIMIT 20"""))
sec('mesma internet hoje com 2+ aparelhos sem plano', q(f"""SELECT substr(d.marca, 1, 6) AS rede, COUNT(DISTINCT d.aparelho) AS aparelhos, GROUP_CONCAT(DISTINCT d.nome) AS apelidos,
  SUM(COALESCE(l.publicas, 0)) AS publicas, SUM(COALESCE(l.partidas, 0)) AS amigos
  FROM (SELECT DISTINCT marca, aparelho, nome FROM pessoa_dia WHERE dia = '{HOJE}' AND marca <> '') d LEFT JOIN limites l ON l.dia = '{HOJE}' AND l.aparelho = d.aparelho
  WHERE {livre('d.aparelho')} GROUP BY d.marca HAVING aparelhos >= 2 ORDER BY publicas + amigos DESC LIMIT 25"""))
sec('aparelhos novos (3 h)', q(f"""SELECT a.aparelho, a.desde, {NOME.format(c='a.aparelho')} AS nome, (SELECT publicas FROM limites WHERE dia = '{HOJE}' AND aparelho = a.aparelho) AS publicas
  FROM aparelhos a WHERE a.desde > {A - 3 * H} ORDER BY a.desde DESC LIMIT 40"""))
sec('vigia ativa', q(f"SELECT apelido, motivo, desde, avisado, bloqueado FROM apelidos_vigia WHERE ate > {A} ORDER BY desde DESC LIMIT 20"))
sec('bloqueios recentes (7 dias)', q(f"SELECT nome, motivo, em FROM bloqueios WHERE em > {A - 7 * 24 * H} ORDER BY em DESC LIMIT 20"))
open(OUT, 'a').write('\n'.join(L) + '\n')
