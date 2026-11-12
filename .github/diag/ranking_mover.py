# 12/11 (pedido do dono): os pontos do ranking do aparelho antigo dele (o iPhone antes de reinstalar) passam para o
# aparelho de agora (o que tem o plano do código dele, só por resumo sha256). MUDA o banco: só as linhas do ranking.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
ALVO = 'd28339cc764acea631cfe899566ff1daf0c76b5e43dc888ec8e0b412a084c780'   # código do plano do dono
VELHO = 'ba80afc2'   # começo do resumo do aparelho antigo
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
L = ['== ranking: aparelho antigo -> aparelho de agora']
novo = [p['aparelho'] for p in q('SELECT aparelho, codigo FROM planos') if hashlib.sha256(str(p.get('codigo') or '').upper().encode()).hexdigest() == ALVO]
velho = [r['aparelho'] for r in q('SELECT DISTINCT aparelho FROM ranking') if h(r['aparelho']) == VELHO]
L.append(f'novo: {[h(x) for x in novo]} | velho: {[h(x) for x in velho]}')
if len(novo) == 1 and len(velho) == 1 and novo[0] != velho[0]:
    n, v = novo[0], velho[0]
    antes = q(f"SELECT periodo, ganhas, jogadas FROM ranking WHERE aparelho = '{v}'")
    L.append(f'linhas do antigo: {antes}')
    q(f"UPDATE ranking SET aparelho = '{n}' WHERE aparelho = '{v}' AND periodo NOT IN (SELECT periodo FROM ranking WHERE aparelho = '{n}')")
    depois = q("SELECT periodo, ganhas, jogadas, nome FROM ranking WHERE aparelho = '%s'" % n)
    sobrou = q("SELECT COUNT(*) AS n FROM ranking WHERE aparelho = '%s'" % v)
    L.append(f'depois, no aparelho de agora: {depois}')
    L.append(f'sobrou no antigo: {sobrou}')
    tm = q(f"SELECT turma FROM turma_membros WHERE aparelho = '{v}'"); tn = q(f"SELECT turma FROM turma_membros WHERE aparelho = '{n}'")
    L.append(f'turma do antigo: {len(tm)} · turma do novo: {len(tn)}')
else:
    L.append('não mexi: não achei exatamente um aparelho de cada')
open(OUT, 'a').write('\n'.join(L) + '\n')
