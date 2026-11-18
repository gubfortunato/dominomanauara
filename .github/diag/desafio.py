# 17/11, 23h40 (só leitura): ritmo do Desafio das Confrarias. Só contagens; nenhum nome de pessoa ou de Turma.
import json, subprocess, sys
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception as e: return [{'erro': (r.stderr or str(e))[-200:]}]
L = ['== desafio das confrarias (só leitura)']
def add(t, sql): L.append(t + ': ' + json.dumps(q(sql), ensure_ascii=False))
add('turmas por tamanho', "SELECT n AS membros, COUNT(*) AS turmas FROM (SELECT turma, COUNT(*) AS n FROM turma_membros GROUP BY turma) GROUP BY n ORDER BY n")
add('turmas total', "SELECT COUNT(*) AS n FROM turmas")
add('membros total', "SELECT COUNT(*) AS n FROM turma_membros")
add('membros ativos 7d', "SELECT COUNT(*) AS n FROM turma_membros m JOIN jogadores j ON j.aparelho = m.aparelho WHERE j.ultimo > (strftime('%s','now') - 7*86400) * 1000")
add('turmas com 2+ membros ativos 7d', "SELECT COUNT(*) AS n FROM (SELECT m.turma FROM turma_membros m JOIN jogadores j ON j.aparelho = m.aparelho WHERE j.ultimo > (strftime('%s','now') - 7*86400) * 1000 GROUP BY m.turma HAVING COUNT(*) >= 2)")
add('pontos por turma (ordenado, sem nome)', "SELECT pontos FROM desafio_pontos WHERE edicao = 2026 ORDER BY pontos DESC LIMIT 15")
add('turmas que pontuaram', "SELECT COUNT(*) AS n, SUM(pontos) AS total FROM desafio_pontos WHERE edicao = 2026 AND pontos > 0")
add('confrontos com vencedor por dia', "SELECT dia, SUM(n) AS jogos, COUNT(DISTINCT vencedora) AS venc, COUNT(DISTINCT perdedora) AS perd FROM desafio_jogos WHERE edicao = 2026 GROUP BY dia ORDER BY dia")
add('pares de turmas distintos', "SELECT COUNT(*) AS pares, SUM(n) AS jogos FROM (SELECT vencedora, perdedora, SUM(n) AS n FROM desafio_jogos WHERE edicao = 2026 GROUP BY vencedora, perdedora)")
add('pontos por dia', "SELECT dia, SUM(pontos) AS pontos, COUNT(*) AS turmas FROM desafio_dia WHERE edicao = 2026 GROUP BY dia ORDER BY dia")
add('desafios usados por dia (pessoas e partidas)', "SELECT dia, COUNT(*) AS pessoas, SUM(n) AS partidas FROM desafio_uso GROUP BY dia ORDER BY dia")
add('membros que pontuaram', "SELECT COUNT(*) AS n FROM desafio_membros WHERE edicao = 2026 AND pontos > 0")
add('avisos de confronto enviados', "SELECT COUNT(*) AS n FROM avisos_ev WHERE chave LIKE 'cf:%'")
open(OUT, 'a').write('\n'.join(L) + '\n')
