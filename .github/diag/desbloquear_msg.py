# 13/11, 19h45 (pedido do dono, "vamos na 2"): desbloqueia só o celular principal de um jogador bloqueado por burla
# (o aparelho que mandou a mensagem do suporte; o apelido da mensagem entra só como hash). Os outros aparelhos ficam
# bloqueados. Trava: só apaga se o aparelho achado é exatamente o esperado (hash curto) e o bloqueio é de burla.
import json, subprocess, sys, hashlib, re, unicodedata
OUT, ALVO, ESPERADO = sys.argv[1], sys.argv[2], sys.argv[3]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return None
chave = lambda n: re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()))
L = ['== desbloqueio do celular principal']
msgs = [r for r in (q('SELECT id, nome FROM mensagens ORDER BY criado_em DESC LIMIT 400') or []) if hashlib.sha256(chave(r.get('nome')).encode()).hexdigest() == ALVO]
ids = ','.join(str(int(r['id'])) for r in msgs) or '0'
aps = sorted({r['aparelho'] for r in (q(f"SELECT DISTINCT aparelho FROM suporte WHERE de = 'j' AND msg IN ({ids})") or []) if r.get('aparelho')})
alvo = [a for a in aps if hashlib.sha256(a.encode()).hexdigest()[:8] == ESPERADO]
L.append(f'aparelhos achados: {len(aps)} · o esperado: {len(alvo)}')
if len(alvo) == 1 and re.fullmatch(r'[A-Za-z0-9-]{8,40}', alvo[0]):
    a = alvo[0]
    b = q(f"SELECT motivo FROM bloqueios WHERE aparelho = '{a}'") or []
    L.append(f"bloqueio antes: {b[0]['motivo'] if b else 'nenhum'}")
    if b and re.search('burla|voltou com outro aparelho', b[0]['motivo'] or '', re.I):
        r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', f"DELETE FROM bloqueios WHERE aparelho = '{a}'"], capture_output=True, text=True)
        L.append(f'apagou: {r.returncode == 0}')
        d = q(f"SELECT COUNT(*) AS n FROM bloqueios WHERE aparelho = '{a}'") or [{}]
        L.append(f"bloqueio depois: {d[0].get('n')}")
    n = q("SELECT COUNT(*) AS n FROM bloqueios WHERE motivo LIKE '%burla%'") or [{}]
    L.append(f"bloqueios por burla que continuam: {n[0].get('n')}")
open(OUT, 'a').write('\n'.join(L) + '\n')
