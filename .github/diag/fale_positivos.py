# 25/11 (pedido do dono: comprovação social): o que os jogadores responderam nas conversas do suporte (depois da resposta
# do dono), para achar os elogios. Só lê. O texto sai só no arquivo criptografado; nome, contato e aparelho não saem.
import json, subprocess, time, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
L = ['== conversas do suporte: ' + json.dumps(q("SELECT de, COUNT(*) AS n FROM suporte GROUP BY de"))]
for r in q("SELECT em, texto FROM suporte WHERE de = 'j' ORDER BY em DESC LIMIT 2000"):
    L.append(f"-- {quando(r['em'])}\n{(r['texto'] or '')[:900]}")
open(OUT, 'a').write('\n'.join(L) + '\n')
