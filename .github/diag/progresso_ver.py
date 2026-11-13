# 13/11, 6h (só leitura): o progresso guardado do aparelho do dono continua o recuperado? E a foto online (aparelho antigo e novo)?
import json, subprocess, sys, hashlib, time
OUT = sys.argv[1]
ALVO = 'd28339cc764acea631cfe899566ff1daf0c76b5e43dc888ec8e0b412a084c780'
L = ['== progresso do dono (só leitura)']
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return None
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
hm = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((ms - 4 * 3600000) / 1000)) if ms else None
def resumo(d):
    try:
        nv = json.loads(d.get('dmz-nivel') or 'null') or {}; hi = json.loads(d.get('dmz-historico') or 'null') or {}; pf = json.loads(d.get('dmz-perfil') or 'null') or {}
        return f"moral {nv.get('xp')} · partidas {hi.get('jogos')} · mãos {hi.get('maos')} · avatar {pf.get('av')} · chaves {len(d)}"
    except Exception as e: return f'ilegível {e}'
novo = None
for p in q('SELECT aparelho, codigo FROM planos') or []:
    if hashlib.sha256(str(p.get('codigo') or '').upper().encode()).hexdigest() == ALVO: novo = p['aparelho']
L.append(f'aparelho com o plano: {h(novo) if novo else None}')
if novo:
    g = q(f"SELECT dados, atualizado FROM progresso WHERE aparelho = '{novo}'") or []
    L.append(f"guardado: {resumo(json.loads(g[0]['dados'])) if g else None} · atualizado {hm(g[0]['atualizado']) if g else None}")
# fotos online: só tamanho, tipo e situação (a imagem não sai daqui)
for ap in q("SELECT aparelho, mime, LENGTH(dados) AS n, status, criado_em FROM fotos") or []:
    if h(ap['aparelho']) in ('ba80afc2', h(novo) if novo else '-'):
        L.append(f"foto de {h(ap['aparelho'])}: {ap['mime']} · {ap['n']} letras · {ap['status']} · {hm(ap['criado_em'])}")
open(OUT, 'a').write('\n'.join(L) + '\n')
