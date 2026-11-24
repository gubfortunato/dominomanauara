# 24/11 (só leitura): ligar ou não a regra dos aparelhos antigos (LIMITE_IRMAO_LIGADO, planos.js)? Simula a regra nos dias
# que o banco ainda guarda (limites_rede e pessoa_dia ficam 2 dias; burlas, 14). Só contagens; nenhum apelido ou código de
# aparelho sai daqui. As mensagens do "Fale com a gente" sobre limite saem cortadas, sem números, e só no arquivo criptografado.
import json, subprocess, sys, time, unicodedata, re, collections
OUT = sys.argv[1]
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception as e: return [{'erro': (r.stderr or str(e))[-200:]}]
def chave(n): return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFD', str(n or '').lower()))
AGORA = int(time.time() * 1000); DIA = 86400000
L = ['== aparelhos antigos (só leitura)']
def add(t, v): L.append(t + ': ' + json.dumps(v, ensure_ascii=False))
def lote(sql_fmt, ids):
    res = []
    ids = list(ids)
    for i in range(0, len(ids), 80):
        parte = ids[i:i + 80]
        if not parte: continue
        lista = ','.join("'" + x.replace("'", "") + "'" for x in parte)
        res += q(sql_fmt % lista)
    return res

lr = q("SELECT dia, tipo, aparelho, nome, MIN(em) AS em FROM limites_rede GROUP BY dia, tipo, aparelho")
pd = q("SELECT dia, nome, marca, aparelho, MIN(em) AS em FROM pessoa_dia GROUP BY dia, nome, marca, aparelho")
add('dias guardados (limites_rede / pessoa_dia)', [sorted({x.get('dia') for x in lr if 'dia' in x}), sorted({x.get('dia') for x in pd if 'dia' in x})])
add('bateram o limite por dia e tipo (aparelhos)', collections.Counter(f"{x['dia']} {x['tipo']}" for x in lr if 'dia' in x).most_common())

# quantos jogadores online já usaram cada apelido (a regra só vale com até 3)
jv = q("SELECT nome, av, aparelho FROM jogadores_vistos")
uso = collections.Counter(chave(x.get('nome')) for x in jv)
av = {x.get('aparelho'): x.get('av') for x in jv}
socios = {x['aparelho'] for x in q(f"SELECT aparelho FROM planos WHERE ate > {AGORA}") if 'aparelho' in x}
ids = {x['aparelho'] for x in lr if 'aparelho' in x} | {x['aparelho'] for x in pd if 'aparelho' in x}
desde = {x['aparelho']: x['desde'] for x in lote("SELECT aparelho, desde FROM aparelhos WHERE aparelho IN (%s)", ids) if 'aparelho' in x}
lim = {(x['dia'], x['aparelho']): x for x in lote("SELECT dia, aparelho, partidas, publicas FROM limites WHERE aparelho IN (%s)", ids) if 'aparelho' in x}
redes = collections.defaultdict(set)
for x in pd:
    if 'aparelho' in x: redes[(x['dia'], x['aparelho'])].add(x['marca'])

# simulação: no dia, o 1º aparelho com o apelido bate o limite; quem mais (outro aparelho, mesmo apelido pouco comum, sem plano)
# bateu o limite depois dele jogou o limite de novo: com a regra ligada, ficaria sem partida grátis naquele dia
grupos = collections.defaultdict(list)
for x in lr:
    if 'nome' in x and x['nome'] and len(x['nome']) >= 4: grupos[(x['dia'], x['tipo'], x['nome'])].append(x)
casos = []
for (dia, tipo, nome), l in grupos.items():
    aps = {}
    for x in sorted(l, key=lambda y: y['em']): aps.setdefault(x['aparelho'], x)
    if len(aps) < 2: continue
    prim = min(aps.values(), key=lambda y: y['em'])
    for apa, x in aps.items():
        if apa == prim['aparelho']: continue
        comum = uso.get(nome, 0) > 3
        r_a, r_b = redes.get((dia, prim['aparelho']), set()), redes.get((dia, apa), set())
        casos.append({'dia': dia, 'tipo': tipo, 'comum': comum, 'socio': apa in socios,
                      'novo': (desde.get(apa) or 0) > x['em'] - DIA, 'mesma_rede': bool(r_a & r_b),
                      'mesmo_avatar': bool(av.get(apa)) and av.get(apa) == av.get(prim['aparelho']),
                      'partidas_no_dia': ((lim.get((dia, apa)) or {}).get('partidas') or 0) + ((lim.get((dia, apa)) or {}).get('publicas') or 0),
                      'min_depois': round((x['em'] - prim['em']) / 60000)})
pegaria = [c for c in casos if not c['comum'] and not c['socio']]
add('pares (2º aparelho com o mesmo apelido que bateu o limite depois do 1º)', len(casos))
add('  apelido comum (a regra não vale)', sum(c['comum'] for c in casos))
add('  2º aparelho é de sócio (a regra não vale)', sum(c['socio'] for c in casos))
add('  a regra pegaria', len(pegaria))
add('    por dia e tipo', collections.Counter(f"{c['dia']} {c['tipo']}" for c in pegaria).most_common())
add('    2º aparelho antigo / novo', [sum(not c['novo'] for c in pegaria), sum(c['novo'] for c in pegaria)])
add('    mesma rede no dia (já dividem pelo pessoa.js)', sum(c['mesma_rede'] for c in pegaria))
add('    mesmo avatar (quase certo que é a mesma pessoa) / avatar diferente', [sum(c['mesmo_avatar'] for c in pegaria), sum(not c['mesmo_avatar'] for c in pegaria)])
add('    partidas do 2º aparelho no dia (soma, máx)', [sum(c['partidas_no_dia'] for c in pegaria), max([c['partidas_no_dia'] for c in pegaria] or [0])])
add('    minutos entre um e outro (mediana)', sorted(c['min_depois'] for c in pegaria)[len(pegaria) // 2] if pegaria else None)
add('    apelidos diferentes', len({(c['dia'], c['tipo']) for c in pegaria}))

# o que já é barrado hoje (painel "Possíveis burlas") e a vigia
add('barrados por dia, via e tipo (14 dias)', q("SELECT dia, via, tipo, COUNT(*) AS n FROM burlas GROUP BY dia, via, tipo ORDER BY dia"))
add('vigia: total, valendo, bloqueados, perdoados', q(f"SELECT COUNT(*) AS total, SUM(ate > {AGORA}) AS valendo, SUM(bloqueado IS NOT NULL AND bloqueado > 0) AS bloqueados, SUM(perdao IS NOT NULL AND perdao > 0) AS perdoados FROM apelidos_vigia"))
add('bloqueios automáticos por burla (total / 7 dias)', q(f"SELECT COUNT(*) AS total, SUM(em > {AGORA - 7 * DIA}) AS d7 FROM bloqueios WHERE motivo LIKE 'burla%'"))

# Fale com a gente desde 10/11: reclamação de limite ou bloqueio
desde10 = 1794283200000   # 10/11/2026 0h Manaus
msgs = q(f"SELECT tipo, texto, aparelho, criado_em FROM mensagens WHERE criado_em > {desde10}")
pal = re.compile(r'limite|bloque|n[aã]o consigo jogar|n[aã]o deixa jogar|partida gr[aá]tis|sem partida|travad|n[aã]o entra', re.I)
sobre = [m for m in msgs if 'texto' in m and pal.search(m['texto'] or '')]
barr = {x['aparelho'] for x in q("SELECT DISTINCT aparelho FROM burlas") if 'aparelho' in x}
add('mensagens desde 10/11 / sobre limite ou bloqueio / de aparelho barrado', [len(msgs), len(sobre), sum(m['aparelho'] in barr for m in sobre)])
for m in sorted(sobre, key=lambda y: y['criado_em'])[-12:]:
    t = re.sub(r'\d', '#', re.sub(r'\s+', ' ', m['texto'] or ''))[:220]
    L.append('  - ' + json.dumps({'dia': time.strftime('%d/%m', time.gmtime(m['criado_em'] / 1000 - 4 * 3600)), 'barrado': m['aparelho'] in barr, 'texto': t}, ensure_ascii=False))
open(OUT, 'a').write('\n'.join(L) + '\n')
