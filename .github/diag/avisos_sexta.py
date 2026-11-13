# 13/11, 14h (só leitura): os avisos da Sexta (sx:...) e da Quarta (qa:...) que já saíram, por chave, e quantas inscrições existem
import json, subprocess, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
L = ['== avisos de evento (só leitura)']
L.append(f"inscrições de aviso: {(q('SELECT COUNT(*) AS n FROM avisos') or [{}])[0].get('n')}")
for r in q("SELECT chave, COUNT(*) AS n, MIN(em) AS de, MAX(em) AS ate FROM avisos_ev WHERE chave LIKE 'sx:%' OR chave LIKE 'qa:%' OR chave LIKE 'cp:%' GROUP BY chave ORDER BY chave"):
    L.append(f"{r['chave']}: {r['n']}")
open(OUT, 'a').write('\n'.join(L) + '\n')
