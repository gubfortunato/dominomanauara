# 25/11 (3.61.31 no ar): confere o /campeoes de produção e a tabela campeoes. Só contagens e formatos, sem nomes. Só lê.
import json, subprocess, sys, urllib.request
OUT = sys.argv[1]; L = []
def get(path):
    r = urllib.request.Request('https://dominomanauara.gubfort.workers.dev' + path, headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Origin': 'https://dominomanauara.com.br'})
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, x.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:120]
    except Exception as e: return 0, str(e)[:120]
for pth in ('/saude', '/ranking?aparelho=diag-verificacao-0001', '/campeoes?aparelho=diag-verificacao-0001'):
    st, tx = get(pth)
    if st == 200 and pth.startswith('/campeoes'):
        d = json.loads(tx); a = d.get('atuais') or {}; h = d.get('hall') or {}
        L.append('campeoes 200 | atuais: ' + ', '.join(f"{k}={'sim (' + str((v or {}).get('quando')) + ')' if v else 'vazio'}" for k, v in a.items()))
        L.append('hall: ' + ', '.join(f'{k}={len(v)}' for k, v in h.items()) + ' | campo aparelho no json: ' + str('"aparelho"' in tx) + ' | todos com k: ' + str(all(x.get('k') for k in ('semana', 'mes', 'copa', 'sabado') for x in h.get(k, []))))
    else: L.append(f'{pth.split("?")[0]} -> {st} ' + (tx[:100] if pth == '/saude' or st != 200 else 'ok'))
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return [{'erro': (r.stderr or '')[-200:]}]
L.append('tabela campeoes: ' + json.dumps(q("SELECT tipo, COUNT(*) n, MIN(periodo) de, MAX(periodo) ate, SUM(aparelho IS NULL) sem_ap FROM campeoes GROUP BY tipo")))
open(OUT, 'a').write('\n'.join(L) + '\n')
