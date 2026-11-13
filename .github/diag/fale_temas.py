# 12/11 (pedido do dono): o que os jogadores perguntam no "Fale com a gente" (últimos 30 dias), para montar a Ajuda.
# Só lê. O texto sai só no arquivo criptografado; nome, contato e aparelho não saem.
import json, subprocess, time, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
desde = int(time.time() * 1000) - 30 * 86400000
L = ['== total por tipo (30 dias): ' + json.dumps(q(f"SELECT tipo, status, COUNT(*) AS n FROM mensagens WHERE criado_em > {desde} GROUP BY tipo, status"))]
L.append('== total geral: ' + json.dumps(q("SELECT COUNT(*) AS n, MIN(criado_em) AS primeira FROM mensagens")))
L.append('== com contato: ' + json.dumps(q(f"SELECT COUNT(*) AS n FROM mensagens WHERE criado_em > {desde} AND contato IS NOT NULL AND contato <> ''")))
for r in q(f"SELECT criado_em, tipo, status, versao, texto FROM mensagens WHERE criado_em > {desde} ORDER BY criado_em DESC LIMIT 400"):
    L.append(f"-- {quando(r['criado_em'])} · {r['tipo']} · {r['status']} · {r['versao']}\n{(r['texto'] or '')[:600]}")
open(OUT, 'a').write('\n'.join(L) + '\n')
