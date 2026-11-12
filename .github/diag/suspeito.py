# 11/11 (pedido do dono): o dono acha que outro jogador está burlando o limite grátis. Acha os aparelhos pelo apelido
# (comparado só por resumo sha256 de pedaços do apelido "limpo": o apelido não fica escrito aqui), mostra o uso de cada
# aparelho e quem mais bateu limite na mesma rede. Não bloqueia ninguém. O resultado sai criptografado (só o dono lê).
import json, subprocess, hashlib, unicodedata, re, time, sys
ALVOS = {'0b3446a78a37ee2ef133ebcf6f4dbbe7821c8febb082af3288676e20f6fbfef5', '8cc4232bebd0e5d57e81b66e1381453913da918062d98ee8cc2343d646511c20',
         '976b9956071edd07c7d054e5f22371979dc868144be468605be8e4763d47de27', '34b89f8404b42b30f330db7a036f609fdf2b1f173ea437fe3f97851665a86fff'}
OUT = sys.argv[1]
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chaves(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c))
    a = re.sub('[^a-z]', '', s); b = re.sub('[^a-z]', '', s.translate(LEET))
    col = lambda x: re.sub(r'(.)\1+', r'\1', x)
    return {a, b, col(a), col(b)}
def bate(n):
    for k in chaves(n):
        for L in (7, 8, 9):
            for i in range(0, max(0, len(k) - L) + 1):
                if hashlib.sha256(k[i:i + L].encode()).hexdigest() in ALVOS: return True
    return False
ok = lambda ap: bool(re.fullmatch(r'[a-z0-9-]{8,40}', str(ap or ''), re.I))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
fontes = {
  'vistos': q('SELECT aparelho, nome, mesa, visto_em AS em FROM jogadores_vistos'),
  'presenca': q('SELECT aparelho, nome, tela, modo, visto_em AS em FROM presenca'),
  'limites_rede': q('SELECT aparelho, nome, dia, tipo, em FROM limites_rede'),
  'turmas': q('SELECT aparelho, nome, turma, entrou AS em FROM turma_membros'),
  'burlas': q('SELECT aparelho, nome, dia, tipo, via, em FROM burlas'),
}
bloq = {r['aparelho']: r for r in q('SELECT aparelho, nome, motivo, em FROM bloqueios')}
achados = {}
for f, rows in fontes.items():
    for r in rows:
        if ok(r.get('aparelho')) and bate(r.get('nome')): achados.setdefault(r['aparelho'], []).append((f, r))
L = [f'== aparelhos com o apelido: {len(achados)}']
for ap, onde in sorted(achados.items(), key=lambda x: min(int(r.get('em') or 0) for _, r in x[1])):
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{ap}'") or [{}])[0].get('ate')
    li = q(f"SELECT dia, mesas, partidas, publicas FROM limites WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 4")
    of = q(f"SELECT dia, n FROM offline_uso WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 4")
    du = q(f"SELECT dia, n FROM desafio_uso WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 3")
    jg = (q(f"SELECT primeiro, ultimo, partidas, maos FROM jogadores WHERE aparelho = '{ap}'") or [{}])[0]
    nomes = sorted({str(r.get('nome')) for _, r in onde})
    L.append(f'-- aparelho {h(ap)} | nomes: {", ".join(nomes)} | desde {quando(d)} | visto {quando(max(int(r.get("em") or 0) for _, r in onde))} | sócio até {quando(pl)} | bloqueado: {(bloq[ap].get("motivo") if ap in bloq else "não")}')
    L.append(f'   jogos: {jg} | limites: {li} | offline: {of} | desafios: {du}')
    L.append('   onde: ' + '; '.join(f'{f}:' + ','.join(f'{k}={v}' for k, v in r.items() if k not in ('aparelho', 'nome')) for f, r in onde)[:900])
marcas = q("SELECT DISTINCT dia, marca FROM limites_rede WHERE aparelho IN (" + ','.join(f"'{a}'" for a in achados) + ")") if achados else []
L.append(f'== redes onde esses aparelhos bateram limite: {len(marcas)}')
for m in marcas[:20]:
    outros = q(f"SELECT aparelho, nome, tipo, em FROM limites_rede WHERE dia = '{m['dia']}' AND marca = '{m['marca']}' ORDER BY em")
    L.append(f"   {m['dia']}: " + ' | '.join(f"{h(o['aparelho'])}={o.get('nome')} {o['tipo']} {quando(o['em'])}{' (é ele)' if o['aparelho'] in achados else ''}{' (bloq)' if o['aparelho'] in bloq else ''}" for o in outros))
# aparelhos novos (últimos 3 dias) com o mesmo apelido de outro aparelho: o padrão de quem burla com vários aparelhos
novos = q(f"SELECT aparelho, desde FROM aparelhos WHERE desde > {agora - 3 * 86400000}")
nm = {}
for f in ('vistos', 'presenca'):
    for r in fontes[f]:
        if ok(r.get('aparelho')) and r.get('nome'): nm.setdefault(r['aparelho'], r['nome'])
grupos = {}
for ap, nome in nm.items():
    k = max(chaves(nome), key=len, default='')
    if len(k) >= 4: grupos.setdefault(k, set()).add(ap)
nov = {r['aparelho']: r['desde'] for r in novos}
L.append('== mesmo apelido em 2+ aparelhos, com algum aparelho novo (3 dias): apelido | aparelhos (desde)')
for k, aps in sorted(grupos.items(), key=lambda x: -len(x[1])):
    if len(aps) >= 2 and len(aps) <= 6 and any(a in nov for a in aps):
        L.append(f'   {nm[next(iter(aps))]} | ' + ', '.join(f"{h(a)} ({quando(nov.get(a))}){' bloq' if a in bloq else ''}" for a in sorted(aps, key=lambda a: nov.get(a) or 0)))
open(OUT, 'a').write('\n'.join(L) + '\n')
