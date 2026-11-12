# 12/11 (pedido do dono): procura mais fundo o progresso dele: todo progresso guardado hoje, e o que o ranking tem dos
# aparelhos com o apelido dele. Só lê; não muda nada.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
agora = int(time.time() * 1000); hoje = agora - 20 * 3600000
L = ['== progresso guardado nas últimas 20 h']
for r in q(f"SELECT aparelho, dados, atualizado FROM progresso WHERE atualizado > {hoje} ORDER BY atualizado DESC"):
    try:
        d = json.loads(r['dados']); nv = json.loads(d.get('dmz-nivel') or 'null') or {}; hi = json.loads(d.get('dmz-historico') or 'null') or {}; pf = json.loads(d.get('dmz-perfil') or 'null') or {}
        if 'gust' in str(pf.get('name') or '').lower() or not pf.get('name'):
            L.append(f"   {h(r['aparelho'])} · {quando(r['atualizado'])} · apelido {pf.get('name')} · moral {nv.get('xp')} · partidas {hi.get('jogos')} · chaves {sorted(d.keys())}")
    except Exception: pass
L.append('== aparelhos com apelido "gust..." (vistos, presença, ranking)')
aps = {}
for f, sql in [('vistos', 'SELECT aparelho, nome, visto_em AS t FROM jogadores_vistos'), ('presenca', 'SELECT aparelho, nome, visto_em AS t FROM presenca'), ('ranking', 'SELECT aparelho, nome, MAX(atualizado) AS t FROM ranking GROUP BY aparelho, nome')]:
    for r in q(sql):
        if 'gust' in str(r.get('nome') or '').lower(): aps.setdefault(r['aparelho'], []).append((f, r.get('nome'), quando(r.get('t'))))
for ap, ns in aps.items():
    rk = (q(f"SELECT COUNT(*) AS n FROM ranking WHERE aparelho = '{ap}'") or [{}])[0].get('n')
    pr = (q(f"SELECT atualizado FROM progresso WHERE aparelho = '{ap}'") or [{}])[0].get('atualizado')
    pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{ap}'") or [{}])[0].get('ate')
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    L.append(f"   {h(ap)} · desde {quando(d)} · linhas no ranking {rk} · progresso {quando(pr)} · plano {'sim' if pl else 'não'} · {ns}")
L.append('== presença de hoje sem apelido')
for r in q(f"SELECT aparelho, visto_em FROM presenca WHERE (nome IS NULL OR nome = '') AND visto_em > {hoje}"):
    L.append(f"   {h(r['aparelho'])} · {quando(r['visto_em'])}")
open(OUT, 'a').write('\n'.join(L) + '\n')
