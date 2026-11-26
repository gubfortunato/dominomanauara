# 26/11 (pedido do dono): um caso de agora. Os aparelhos cujo apelido (limpo) começa com o pedaço cujo resumo sha256 está
# abaixo: limites de hoje, internet de hoje, barrados, vigia, plano e se está no app agora. Só lê; aqui não vai nome.
import json, subprocess, time, sys, hashlib, unicodedata, re
OUT = sys.argv[1]
PEDACO = {'n': 6, 'sha': '7355d0ddb0b59339'}
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or r.stdout or '')[-300:]}]
A = int(time.time() * 1000); H = 3600000
HOJE = time.strftime('%Y-%m-%d', time.gmtime((A - 3 * H) / 1000))
chave = lambda n: re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()))
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
h = lambda ap: sh(str(ap))[:8]
dt = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((int(ms) - 4 * H) / 1000)) if ms else None
rows = q("SELECT aparelho, nome FROM jogadores_nome") + q("SELECT aparelho, nome FROM presenca") + q("SELECT aparelho, nome FROM jogadores_vistos") + q(f"SELECT aparelho, nome FROM pessoa_dia WHERE dia >= '{time.strftime('%Y-%m-%d', time.gmtime((A - 51 * H) / 1000))}'")
aps = sorted({r['aparelho'] for r in rows if r.get('aparelho') and sh(chave(r.get('nome'))[:PEDACO['n']])[:16] == PEDACO['sha']})
L = ['== agora ' + dt(A) + ' · dia dos limites ' + HOJE + ' · aparelhos achados: ' + str(len(aps))]
lst = ', '.join("'" + a.replace("'", '') + "'" for a in aps) or "''"
def sec(t, rs):
    for r in rs:
        if r.get('aparelho'): r['aparelho'] = h(r['aparelho'])
        for c in ('em', 'visto_em', 'desde', 'ate', 'primeiro', 'ultimo'):
            if isinstance(r.get(c), int) and r[c] > 10**12: r[c] = dt(r[c])
    L.append('== ' + t); L.append(json.dumps(rs, ensure_ascii=False))
sec('aparelhos', q(f"""SELECT a.aparelho, a.desde, (SELECT nome FROM jogadores_nome WHERE aparelho = a.aparelho) AS nome, (SELECT ate FROM planos WHERE aparelho = a.aparelho) AS ate,
  (SELECT motivo FROM bloqueios WHERE aparelho = a.aparelho) AS bloqueio, (SELECT visto_em FROM presenca WHERE aparelho = a.aparelho) AS visto_em,
  (SELECT tela || '/' || modo FROM presenca WHERE aparelho = a.aparelho) AS tela FROM aparelhos a WHERE a.aparelho IN ({lst})"""))
sec('limites (3 dias)', q(f"SELECT aparelho, dia, mesas, partidas, publicas FROM limites WHERE aparelho IN ({lst}) AND dia >= '{time.strftime('%Y-%m-%d', time.gmtime((A - 75 * H) / 1000))}' ORDER BY dia, aparelho"))
sec('offline (3 dias)', q(f"SELECT aparelho, dia, n FROM offline_uso WHERE aparelho IN ({lst}) AND dia >= '{time.strftime('%Y-%m-%d', time.gmtime((A - 75 * H) / 1000))}' ORDER BY dia"))
sec('internet por dia (2 dias)', q(f"SELECT aparelho, dia, nome, substr(marca, 1, 6) AS rede, em FROM pessoa_dia WHERE aparelho IN ({lst}) ORDER BY dia, em"))
sec('outros aparelhos na mesma internet hoje', q(f"""SELECT d.aparelho, d.nome, substr(d.marca, 1, 6) AS rede, (SELECT publicas FROM limites WHERE dia = '{HOJE}' AND aparelho = d.aparelho) AS publicas,
  (SELECT COUNT(*) FROM planos WHERE aparelho = d.aparelho AND ate > {A}) AS socio FROM pessoa_dia d WHERE d.dia = '{HOJE}' AND d.marca IN (SELECT marca FROM pessoa_dia WHERE dia = '{HOJE}' AND aparelho IN ({lst}))"""))
sec('barrados e limite batido', q(f"SELECT 'burla' AS t, aparelho, dia, tipo, via, em FROM burlas WHERE aparelho IN ({lst}) UNION ALL SELECT 'limite', aparelho, dia, tipo, substr(marca, 1, 6), em FROM limites_rede WHERE aparelho IN ({lst}) ORDER BY em"))
sec('ritmo (3 dias)', q(f"SELECT aparelho, dia, jogadas FROM ritmo WHERE aparelho IN ({lst}) ORDER BY dia"))
sec('vigia', q(f"SELECT motivo, desde, ate, avisado, bloqueado FROM apelidos_vigia WHERE nome IN (SELECT DISTINCT nome FROM pessoa_dia WHERE aparelho IN ({lst}))"))
open(OUT, 'a').write('\n'.join(L) + '\n')
