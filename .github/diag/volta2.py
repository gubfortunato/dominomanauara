# 12/11 (pedido do dono): um jogador bloqueado por burla voltou. Acha os aparelhos com o pedaço do apelido (só por resumo
# sha256), como estão (bloqueio, plano, uso de hoje) e por que o apelido bloqueado não pegou. Só lê; não muda nada.
import json, subprocess, time, sys, hashlib, unicodedata, re
OUT = sys.argv[1]
PEDACO = '05b44f4aa0e1b1de75c4ed641fb9c3c6b42b9186c59c78411bb1e2d34f26977e'   # 5 letras
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chave(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    return re.sub('[^a-z]', '', ''.join(c for c in s if not unicodedata.combining(c)).translate(LEET))
junta = lambda x: re.sub(r'(.)\1+', r'\1', x)
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
def bate(n):
    k = chave(n); return any(sh(k[i:i + 5]) == PEDACO for i in range(max(0, len(k) - 4)))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
agora = int(time.time() * 1000); dia = time.strftime('%Y-%m-%d', time.gmtime((agora - 3 * 3600000) / 1000))
aps = {}
for f, sql in [('presenca', 'SELECT aparelho, nome, visto_em AS t FROM presenca'), ('vistos', 'SELECT aparelho, nome, visto_em AS t FROM jogadores_vistos'),
               ('ranking', 'SELECT aparelho, nome, MAX(atualizado) AS t FROM ranking GROUP BY aparelho, nome'), ('bloqueio', 'SELECT aparelho, nome, em AS t FROM bloqueios'),
               ('limite', 'SELECT aparelho, nome, em AS t FROM limites_rede'), ('pessoa', 'SELECT aparelho, nome, em AS t FROM pessoa_dia')]:
    for r in q(sql):
        if r.get('aparelho') and bate(r.get('nome')): aps.setdefault(r['aparelho'], []).append((f, r.get('nome'), quando(r.get('t'))))
L = [f'== aparelhos com o pedaço do apelido: {len(aps)}']
for ap, ns in sorted(aps.items(), key=lambda x: max((y[2] for y in x[1]), default='')):
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    bl = q(f"SELECT motivo, em FROM bloqueios WHERE aparelho = '{ap}'")
    pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{ap}'") or [{}])[0].get('ate')
    u = (q(f"SELECT mesas, partidas, publicas FROM limites WHERE dia = '{dia}' AND aparelho = '{ap}'") or [{}])[0]
    off = (q(f"SELECT n FROM offline_uso WHERE dia = '{dia}' AND aparelho = '{ap}'") or [{}])[0].get('n')
    L.append(f"-- {h(ap)} · desde {quando(d)} · bloqueio {[(b['motivo'], quando(b['em'])) for b in bl]} · plano {quando(pl) if pl else 'não'} · hoje {u} offline {off}")
    L.append(f"   apelidos: {sorted(set(ns), key=lambda x: x[2])[-6:]}")
L.append('== apelidos bloqueados (os do pedaço): ' + str([(r['termo'], r['parte'], r['motivo'], quando(r['em'])) for r in q('SELECT termo, parte, motivo, em FROM apelidos_bloqueados') if any(sh(r['termo'][i:i + 5]) == PEDACO for i in range(max(0, len(r['termo']) - 4)))]))
L.append('== vigia: ' + str([(r['nome'], r['motivo'], quando(r['desde']), quando(r['ate']), r['avisado'], r['bloqueado']) for r in q('SELECT * FROM apelidos_vigia') if bate(r['nome'])]))
L.append('== burlas de hoje com o pedaço: ' + str([(r['tipo'], r['via'], r['nome'], quando(r['em'])) for r in q(f"SELECT * FROM burlas WHERE dia = '{dia}'") if bate(r['nome'])]))
open(OUT, 'a').write('\n'.join(L) + '\n')
