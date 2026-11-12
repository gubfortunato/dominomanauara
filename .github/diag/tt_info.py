# 12/11: só confere se a "viagem no tempo" do banco (Time Travel do D1) está disponível: pega o marcador de agora e o de
# 12/11 16:59:30 (Manaus). Não restaura nada.
import json, subprocess, sys
OUT = sys.argv[1]
def w(*a):
    r = subprocess.run(['wrangler', 'd1', 'time-travel', *a], capture_output=True, text=True)
    return (r.returncode, (r.stdout or '')[-600:], (r.stderr or '')[-400:])
L = ['== time travel']
L.append('agora: ' + repr(w('info', 'dominomanauara', '--json')))
L.append('16:59:30: ' + repr(w('info', 'dominomanauara', '--timestamp=2026-11-12T20:59:30Z', '--json')))
L.append('ajuda restore: ' + repr(subprocess.run(['wrangler', 'd1', 'time-travel', 'restore', '--help'], capture_output=True, text=True).stdout[-900:]))
open(OUT, 'a').write('\n'.join(L) + '\n')
