# 12/11: o backup do progresso dos sócios está funcionando? (só números; só lê)
import json, subprocess, time, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
agora = int(time.time() * 1000); D = 86400000
L = ['== backup do progresso dos sócios']
r = q(f"""SELECT COUNT(*) AS socios,
  SUM(CASE WHEN g.aparelho IS NOT NULL THEN 1 ELSE 0 END) AS com_backup,
  SUM(CASE WHEN g.atualizado > {agora - 2 * D} THEN 1 ELSE 0 END) AS backup_2d,
  SUM(CASE WHEN v.visto_em > {agora - 2 * D} OR pr.visto_em > {agora - 2 * D} THEN 1 ELSE 0 END) AS ativos_2d,
  SUM(CASE WHEN (v.visto_em > {agora - 2 * D} OR pr.visto_em > {agora - 2 * D}) AND g.aparelho IS NULL THEN 1 ELSE 0 END) AS ativos_sem_backup,
  MAX(length(g.dados)) AS maior, AVG(length(g.dados)) AS media
  FROM planos p LEFT JOIN progresso g ON g.aparelho = p.aparelho LEFT JOIN jogadores_vistos v ON v.aparelho = p.aparelho LEFT JOIN presenca pr ON pr.aparelho = p.aparelho
  WHERE p.ate > {agora}""")
L.append(json.dumps(r))
L.append('== cortesias: ' + json.dumps(q(f"SELECT COUNT(*) AS n, SUM(CASE WHEN g.aparelho IS NOT NULL THEN 1 ELSE 0 END) AS com_backup FROM cortesias c LEFT JOIN progresso g ON g.aparelho = c.aparelho")))
L.append('== linhas de progresso: ' + json.dumps(q("SELECT COUNT(*) AS n, MAX(atualizado) AS ultimo FROM progresso")))
open(OUT, 'a').write('\n'.join(L) + '\n')
