# 13/11, 19h40 (só leitura): acha pelo apelido de quem mandou a mensagem (só hash) o aparelho dela e o apelido com que o
# aparelho foi bloqueado; depois roda o caso do apelido para esse apelido. Saída criptografada.
import json, subprocess, sys, hashlib, re, unicodedata, time, os
OUT, ALVO = sys.argv[1], sys.argv[2]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
chave = lambda n: re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()))
hs = lambda n: hashlib.sha256(chave(n).encode()).hexdigest()
hm = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((ms - 4 * 3600000) / 1000)) if ms else '-'
L = ['== quem mandou a mensagem (só leitura)']
msgs = [r for r in q('SELECT id, criado_em, tipo, nome, aparelho, versao FROM mensagens ORDER BY criado_em DESC LIMIT 400') if hs(r.get('nome')) == ALVO]
L.append(f'mensagens com esse apelido: {len(msgs)}')
ids = ','.join(str(int(r['id'])) for r in msgs) or '0'
aps = sorted({r['aparelho'] for r in q(f"SELECT DISTINCT aparelho FROM suporte WHERE de = 'j' AND msg IN ({ids})") if r.get('aparelho')})
L.append(f'aparelhos dessas mensagens: {len(aps)}')
alvos = {ALVO}
for a in aps:
    b = q(f"SELECT nome, motivo, em FROM bloqueios WHERE aparelho = '{a.replace(chr(39), '')}'")
    v = q(f"SELECT nome, visto_em FROM jogadores_vistos WHERE aparelho = '{a.replace(chr(39), '')}'")
    d = q(f"SELECT desde FROM aparelhos WHERE aparelho = '{a.replace(chr(39), '')}'")
    L.append(f"- aparelho {hashlib.sha256(a.encode()).hexdigest()[:8]} · apareceu {hm(d[0]['desde']) if d else '-'} · bloqueio: {(b[0]['motivo'] + ' em ' + hm(b[0]['em']) + ' · apelido no bloqueio: ' + str(b[0]['nome'])) if b else 'não'} · apelido na mesa: {v[0]['nome'] if v else '-'}")
    for r in b + v:
        if r.get('nome'): alvos.add(hs(r['nome']))
open(OUT, 'a').write('\n'.join(L) + '\n')
for a in sorted(alvos - {ALVO}):
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'apelido_caso.py'), OUT, a])
