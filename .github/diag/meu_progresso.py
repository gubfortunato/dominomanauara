# 12/11 (pedido do dono): reinstalou o app no iPhone e perdeu o progresso. Onde está o plano do código dele (só por resumo
# sha256) e o progresso guardado na nuvem (nível e partidas), e os aparelhos dele de hoje. Só lê; não muda nada.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
ALVO = 'd28339cc764acea631cfe899566ff1daf0c76b5e43dc888ec8e0b412a084c780'
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
def prog(ap):
    r = (q(f"SELECT dados, atualizado FROM progresso WHERE aparelho = '{ap}'") or [None])[0]
    if not r: return 'sem progresso na nuvem'
    try:
        d = json.loads(r['dados']); nv = json.loads(d.get('dmz-nivel') or 'null') or {}; hi = json.loads(d.get('dmz-historico') or 'null') or {}
        pf = json.loads(d.get('dmz-perfil') or 'null') or {}
        return f"progresso de {quando(r['atualizado'])}: moral {nv.get('xp')} · partidas {hi.get('jogos')} · apelido {pf.get('name')} · chaves {len(d)}"
    except Exception as e: return f'progresso ilegível ({e})'
L = []
for p in q('SELECT aparelho, ate, desde, codigo FROM planos'):
    if hashlib.sha256(str(p.get('codigo') or '').upper().encode()).hexdigest() == ALVO:
        L.append(f"== plano do código: aparelho {h(p['aparelho'])} · até {quando(p['ate'])} · {prog(p['aparelho'])}")
        d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{p['aparelho']}'") or [{}])[0].get('desde')
        L.append(f"   aparelho visto desde {quando(d)}")
for d in q('SELECT aparelho, em FROM dono_aparelhos ORDER BY em DESC'):
    p = (q(f"SELECT codigo FROM planos WHERE aparelho = '{d['aparelho']}'") or [{}])[0]
    L.append(f"== aparelho do dono {h(d['aparelho'])} (painel {quando(d['em'])}) · tem o código: {bool(p.get('codigo')) and hashlib.sha256(str(p.get('codigo')).upper().encode()).hexdigest() == ALVO} · {prog(d['aparelho'])}")
# aparelhos com o apelido Gustavo vistos hoje (presença) e o progresso de cada um
agora = int(time.time() * 1000)
for r in q(f"SELECT aparelho, nome, visto_em FROM presenca WHERE visto_em > {agora - 86400000}"):
    if str(r.get('nome') or '').strip().lower() in ('gustavo',):
        pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{r['aparelho']}'") or [{}])[0]
        d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{r['aparelho']}'") or [{}])[0].get('desde')
        L.append(f"-- hoje, apelido Gustavo: aparelho {h(r['aparelho'])} · visto {quando(r['visto_em'])} · desde {quando(d)} · plano {'sim' if pl.get('ate') else 'não'} · {prog(r['aparelho'])}")
open(OUT, 'a').write('\n'.join(L) + '\n')
