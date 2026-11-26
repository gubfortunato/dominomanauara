# 26/11 (pedido do dono, 3ª parte da varredura): os aparelhos sem plano com muito jogo online e quase nada contado no
# limite. Tudo o que existe deles, dia a dia. Só lê; aqui só vão resumos (sha256) dos códigos, nunca nome ou código.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or r.stdout or '')[-300:]}]
A = int(time.time() * 1000); DIA = 86400000
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
dt = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((int(ms) - 4 * 3600000) / 1000)) if ms else None
ALVOS = {'1b13c246', '1eedbc48', 'f70c5d79', 'df2289bb', 'bfd8e86b', 'dcfd01b7'}
cand = [r['aparelho'] for r in q("SELECT DISTINCT aparelho FROM ritmo WHERE jogadas >= 240")]
aps = [a for a in cand if h(a) in ALVOS]
L = ['== achados: ' + str(len(aps)) + ' de ' + str(len(ALVOS))]
lst = ', '.join("'" + a.replace("'", '') + "'" for a in aps) or "''"
def sec(t, rows):
    for r in rows:
        for c in ('aparelho',):
            if r.get(c): r[c] = h(r[c])
        for c in ('em', 'visto_em', 'desde', 'primeiro', 'ultimo', 'atualizado', 'entrou'):
            if isinstance(r.get(c), int) and r[c] > 10**12: r[c] = dt(r[c])
    L.append('== ' + t); L.append(json.dumps(rows, ensure_ascii=False))
sec('ritmo (todos os dias)', q(f"SELECT aparelho, dia, jogadas, rapidas, sem_app FROM ritmo WHERE aparelho IN ({lst}) ORDER BY aparelho, dia"))
sec('limites (todos os dias)', q(f"SELECT aparelho, dia, mesas, partidas, publicas FROM limites WHERE aparelho IN ({lst}) ORDER BY aparelho, dia"))
sec('desafio_uso e quarta', q(f"SELECT 'desafio' AS t, aparelho, dia, n FROM desafio_uso WHERE aparelho IN ({lst}) UNION ALL SELECT 'quarta', aparelho, dia, n FROM quarta_jog WHERE aparelho IN ({lst})"))
sec('ranking (partidas inteiras de 200)', q(f"SELECT aparelho, periodo, ganhas, jogadas FROM ranking WHERE aparelho IN ({lst}) ORDER BY aparelho, periodo"))
sec('calçada (pontos)', q(f"SELECT aparelho, periodo, pontos, ganhas, jogadas, ganhas_gente, jogadas_gente FROM calcada WHERE aparelho IN ({lst}) ORDER BY aparelho, periodo"))
sec('placares de evento', q(f"""SELECT 'sabado' AS ev, aparelho, dia, partidas, vitorias FROM sabado_placar WHERE aparelho IN ({lst}) UNION ALL SELECT 'segunda', aparelho, dia, partidas, vitorias FROM segunda_placar WHERE aparelho IN ({lst})
  UNION ALL SELECT 'sexta', aparelho, dia, partidas, vitorias FROM sexta_placar WHERE aparelho IN ({lst})"""))
sec('aparelho: desde, jogadores, plano, cortesia, presentes, bloqueio, dono', q(f"""SELECT a.aparelho, a.desde, j.primeiro, j.ultimo, j.partidas AS partidas_app, j.maos AS maos_app,
  (SELECT ate FROM planos WHERE aparelho = a.aparelho) AS plano_ate, (SELECT COUNT(*) FROM cortesias WHERE aparelho = a.aparelho) AS cortesia,
  (SELECT COUNT(*) FROM presentes WHERE aparelho = a.aparelho) AS presentes, (SELECT COUNT(*) FROM bloqueios WHERE aparelho = a.aparelho) AS bloqueado,
  (SELECT COUNT(*) FROM dono_aparelhos WHERE aparelho = a.aparelho) AS dono, (SELECT turma FROM turma_membros WHERE aparelho = a.aparelho) AS turma
  FROM aparelhos a LEFT JOIN jogadores j ON j.aparelho = a.aparelho WHERE a.aparelho IN ({lst})"""))
sec('burlas', q(f"SELECT aparelho, dia, tipo, via FROM burlas WHERE aparelho IN ({lst})"))
sec('partidas do app por dia', q(f"SELECT aparelho, dia, n FROM partidas_dia WHERE aparelho IN ({lst}) ORDER BY aparelho, dia"))
sec('offline por dia', q(f"SELECT aparelho, dia, n FROM offline_uso WHERE aparelho IN ({lst}) ORDER BY aparelho, dia"))
# a mesma pessoa (apelido) em outro aparelho com plano?
sec('mesmo apelido com plano valendo (outro aparelho)', q(f"""SELECT x.aparelho, (SELECT COUNT(*) FROM jogadores_nome y JOIN planos p ON p.aparelho = y.aparelho WHERE lower(y.nome) = lower(x.nome) AND p.ate > {A}) AS socios_com_o_apelido
  FROM jogadores_nome x WHERE x.aparelho IN ({lst})"""))
open(OUT, 'a').write('\n'.join(L) + '\n')
