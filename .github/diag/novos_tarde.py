# 12/11: aparelhos que apareceram hoje entre 16h30 e 18h (Manaus), para entender as reinstalações do dono. Só lê.
import json, subprocess, time, sys, hashlib, calendar
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M:%S', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
ini = (calendar.timegm((2026, 11, 12, 20, 30, 0)) * 1000); fim = (calendar.timegm((2026, 11, 12, 22, 30, 0)) * 1000)
L = ['== aparelhos novos de 16h30 a 18h30 (Manaus)']
for r in q(f"SELECT aparelho, desde FROM aparelhos WHERE desde BETWEEN {ini} AND {fim} ORDER BY desde"):
    ap = r['aparelho']
    n = (q(f"SELECT nome, visto_em FROM presenca WHERE aparelho = '{ap}'") or [{}])[0]
    pl = (q(f"SELECT codigo FROM planos WHERE aparelho = '{ap}'") or [{}])[0]
    pg = (q(f"SELECT atualizado FROM progresso WHERE aparelho = '{ap}'") or [{}])[0]
    L.append(f"   {h(ap)} · desde {quando(r['desde'])} · presença {n.get('nome')} {quando(n.get('visto_em'))} · plano {'sim' if pl else 'não'} · progresso {quando(pg.get('atualizado'))}")
L.append('== tentativas de trazer plano (por hora, todas as redes) hoje à tarde: ' + json.dumps(q(f"SELECT COUNT(*) AS n, MIN(criado_em) AS primeira, MAX(criado_em) AS ultima FROM tentativas WHERE tipo = 'trazer' AND criado_em BETWEEN {ini} AND {fim}")))
for r in q(f"SELECT criado_em FROM tentativas WHERE tipo = 'trazer' AND criado_em BETWEEN {ini} AND {fim} ORDER BY criado_em"): L.append('   trazer às ' + quando(r['criado_em']))
open(OUT, 'a').write('\n'.join(L) + '\n')
