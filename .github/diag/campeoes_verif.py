# 25/11 (3.61.31 no ar): confere o /campeoes de produção e a tabela campeoes. Só contagens e formatos, sem nomes. Só lê.
import json, subprocess, sys, urllib.request
OUT = sys.argv[1]; L = []
try:
    r = urllib.request.Request('https://dominomanauara.gubfort.workers.dev/campeoes?aparelho=diag-verificacao', headers={'User-Agent': 'dominomanauara-diag'})
    with urllib.request.urlopen(r, timeout=30) as x: d = json.loads(x.read().decode())
    a = d.get('atuais') or {}; h = d.get('hall') or {}
    L.append('atuais: ' + ', '.join(f"{k}={'sim (' + str((v or {}).get('quando')) + ')' if v else 'vazio'}" for k, v in a.items()))
    L.append('hall: ' + ', '.join(f'{k}={len(v)}' for k, v in h.items()))
    L.append('campo aparelho no json: ' + str('"aparelho"' in json.dumps(d)) + ' | todos com k: ' + str(all(x.get('k') for k in ('semana', 'mes', 'copa', 'sabado') for x in h.get(k, []))))
    L.append('meus: ' + json.dumps(d.get('meus')))
except Exception as e: L.append('erro no /campeoes: ' + str(e)[:200])
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or '')[-200:]}]
L.append('tabela campeoes: ' + json.dumps(q("SELECT tipo, COUNT(*) n, MIN(periodo) de, MAX(periodo) ate, SUM(aparelho IS NULL) sem_ap FROM campeoes GROUP BY tipo")))
open(OUT, 'a').write('\n'.join(L) + '\n')
