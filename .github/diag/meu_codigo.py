# 12/11 (pedido do dono): o código de sócio dos aparelhos do dono (dono_aparelhos: os aparelhos em que ele abriu o painel).
# Só lê; não muda nada. Sai criptografado.
import json, subprocess, time, sys, hashlib
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
agora = int(time.time() * 1000)
L = []
for d in q('SELECT aparelho, em FROM dono_aparelhos ORDER BY em DESC'):
    ap = d['aparelho']
    p = (q(f"SELECT ate, codigo FROM planos WHERE aparelho = '{ap}'") or [None])[0]
    c = (q(f"SELECT nivel FROM cortesias WHERE aparelho = '{ap}'") or [None])[0]
    n = (q(f"SELECT nome FROM presenca WHERE aparelho = '{ap}'") or q(f"SELECT nome FROM jogadores_vistos WHERE aparelho = '{ap}'") or [{}])[0].get('nome')
    L.append(f"aparelho {hashlib.sha256(ap.encode()).hexdigest()[:8]} | painel aberto {quando(d['em'])} | apelido {n} | plano: {('até ' + quando(p['ate']) + (' ativo' if int(p['ate'] or 0) > agora else ' vencido') + ' | código ' + str(p['codigo'])) if p else 'nenhum'} | cortesia: {bool(c)}")
open(OUT, 'a').write('== aparelhos do dono\n' + '\n'.join(L or ['nenhum aparelho registrado']) + '\n')
