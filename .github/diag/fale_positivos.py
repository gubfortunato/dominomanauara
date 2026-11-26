# 25/11 (pedido do dono: comprovação social): todas as mensagens do "Fale com a gente", para achar os elogios.
# Só lê. O texto sai só no arquivo criptografado; nome, contato e aparelho não saem.
import json, subprocess, time, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
L = ['== total por tipo: ' + json.dumps(q("SELECT tipo, COUNT(*) AS n FROM mensagens GROUP BY tipo"))]
for r in q("SELECT criado_em, tipo, status, versao, texto FROM mensagens ORDER BY criado_em DESC LIMIT 3000"):
    L.append(f"-- {quando(r['criado_em'])} · {r['tipo']} · {r['status']} · {r['versao']}\n{(r['texto'] or '')[:900]}")
open(OUT, 'a').write('\n'.join(L) + '\n')
