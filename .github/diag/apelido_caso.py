# 13/11, 11h (só leitura): um jogador bloqueado por "vários aparelhos" diz que outra pessoa usa o mesmo apelido.
# O apelido entra só como hash (sha256 da chave limpa). Sai: cada aparelho com esse apelido (hash curto), quando apareceu,
# rede do dia (hash), uso do limite, bloqueio, vigia e tentativas; e de qual aparelho veio a mensagem do suporte.
import json, subprocess, sys, hashlib, time, unicodedata, re
OUT = sys.argv[1]
ALVO = '0b3446a78a37ee2ef133ebcf6f4dbbe7821c8febb082af3288676e20f6fbfef5'
L = ['== caso do apelido (só leitura)']
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
chave = lambda n: re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()))
eh = lambda n: hashlib.sha256(chave(n).encode()).hexdigest() == ALVO
h = lambda x: hashlib.sha256(str(x).encode()).hexdigest()[:8] if x else '-'
hm = lambda ms: time.strftime('%d/%m %H:%M', time.gmtime((ms - 4 * 3600000) / 1000)) if ms else '-'
aps = {}
def ap(a):
    return aps.setdefault(a, {'nomes': set(), 'av': set(), 'fontes': set()})
for t, sql in [('vistos', 'SELECT aparelho, nome, av, visto_em AS em FROM jogadores_vistos'), ('presenca', 'SELECT aparelho, nome, av, visto_em AS em FROM presenca'),
               ('bloqueios', 'SELECT aparelho, nome, NULL AS av, em FROM bloqueios'), ('pessoa_dia', 'SELECT aparelho, nome, NULL AS av, em FROM pessoa_dia'),
               ('limites_rede', 'SELECT aparelho, nome, NULL AS av, em FROM limites_rede'), ('burlas', 'SELECT aparelho, nome, NULL AS av, em FROM burlas')]:
    for r in q(sql):
        if eh(r.get('nome')):
            x = ap(r['aparelho']); x['fontes'].add(t); x['nomes'].add(r.get('nome'))
            if r.get('av'): x['av'].add(r['av'])
            x['ult'] = max(x.get('ult', 0), r.get('em') or 0)
for r in q('SELECT nome, aparelho FROM vigia_tentativas'):
    if r['nome'] and hashlib.sha256(r['nome'].encode()).hexdigest() == ALVO: ap(r['aparelho'])['fontes'].add('vigia_tentativas')
L.append(f'aparelhos com o apelido: {len(aps)}')
lista = list(aps)
if lista:
    marcas = ','.join("'" + a.replace("'", "") + "'" for a in lista)
    desde = {r['aparelho']: r['desde'] for r in q(f'SELECT aparelho, desde FROM aparelhos WHERE aparelho IN ({marcas})')}
    bloq = {r['aparelho']: r for r in q(f'SELECT aparelho, motivo, em FROM bloqueios WHERE aparelho IN ({marcas})')}
    plano = {r['aparelho']: r['ate'] for r in q(f'SELECT aparelho, ate FROM planos WHERE aparelho IN ({marcas})')}
    lim = {}; [lim.setdefault(r['aparelho'], []).append(f"{r['dia'][5:]}: rápidas {r['publicas']}, amigos {r['partidas']}") for r in q(f'SELECT dia, aparelho, publicas, partidas FROM limites WHERE aparelho IN ({marcas}) ORDER BY dia DESC')]
    off = {}; [off.setdefault(r['aparelho'], []).append(f"{r['dia'][5:]}: {r['n']}") for r in q(f'SELECT dia, aparelho, n FROM offline_uso WHERE aparelho IN ({marcas}) ORDER BY dia DESC')]
    redes = {}; [redes.setdefault(r['aparelho'], set()).add(f"{r['dia'][5:]} rede {h(r['marca'])}") for r in q(f'SELECT dia, aparelho, marca FROM pessoa_dia WHERE aparelho IN ({marcas})')]
    rk = {r['aparelho']: r['n'] for r in q(f'SELECT aparelho, COUNT(*) AS n FROM ranking WHERE aparelho IN ({marcas}) GROUP BY aparelho')}
    sup = {r['aparelho'] for r in q(f'SELECT DISTINCT aparelho FROM suporte WHERE aparelho IN ({marcas})')}
    for a in sorted(lista, key=lambda a: desde.get(a) or 0):
        x = aps[a]; b = bloq.get(a)
        L.append(f"- {h(a)} · apareceu {hm(desde.get(a))} · visto por último {hm(x.get('ult'))} · grafias {len(x['nomes'])} · avatar {','.join(sorted(x['av'])) or '-'} · fontes {','.join(sorted(x['fontes']))}"
                 + f" · plano {'até ' + hm(plano[a]) if a in plano else 'não'} · bloqueio {(b['motivo'] + ' em ' + hm(b['em'])) if b else 'não'} · mandou mensagem {'SIM' if a in sup else 'não'}")
        L.append(f"    limites: {' | '.join(lim.get(a, [])[:4]) or '-'} · offline: {' | '.join(off.get(a, [])[:4]) or '-'} · redes: {' | '.join(sorted(redes.get(a, set()))) or '-'} · linhas no ranking {rk.get(a, 0)}")
for r in q('SELECT nome, motivo, desde, ate, avisado, bloqueado, aparelhos, perdao FROM apelidos_vigia'):
    if r['nome'] and hashlib.sha256(r['nome'].encode()).hexdigest() == ALVO:
        L.append(f"vigia: {r['motivo']} · desde {hm(r['desde'])} até {hm(r['ate'])} · avisado {hm(r['avisado'])} · bloqueado {hm(r['bloqueado'])} · perdão {hm(r['perdao'])} · aparelhos {len(json.loads(r['aparelhos'] or '[]'))}")
open(OUT, 'a').write('\n'.join(L) + '\n')
