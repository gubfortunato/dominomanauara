# 11/11 (pedido do dono): uma jogadora bloqueada voltou com outro aparelho. Acha os aparelhos com o mesmo apelido
# (comparado só por resumo sha256 do apelido "limpo": o apelido não fica escrito aqui), bloqueia os que ainda não estão
# bloqueados e conta o que se sabe deles. O resultado sai criptografado (só o dono lê).
import json, subprocess, hashlib, unicodedata, re, time, sys
ALVO = 'd7532d770f573da97ed517884afffd60d5efedda99ca37a0f1e9c534b0cd3c23'
OUT = sys.argv[1]
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
def ex(sql): subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--command', sql], capture_output=True, text=True)
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chaves(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c))
    a = re.sub('[^a-z]', '', s); b = re.sub('[^a-z]', '', s.translate(LEET))
    col = lambda x: re.sub(r'(.)\1+', r'\1', x)
    return {a, b, col(a), col(b)}
def bate(n): return any(hashlib.sha256(k.encode()).hexdigest() == ALVO for k in chaves(n) if k)
ok = lambda ap: bool(re.fullmatch(r'[a-z0-9-]{8,40}', str(ap or ''), re.I))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
fontes = {
  'vistos': q('SELECT aparelho, nome, mesa, visto_em AS em FROM jogadores_vistos'),
  'presenca': q('SELECT aparelho, nome, tela, modo, visto_em AS em FROM presenca'),
  'bloqueios': q('SELECT aparelho, nome, motivo, em FROM bloqueios'),
  'turmas': q('SELECT aparelho, nome, turma, entrou AS em FROM turma_membros'),
}
achados = {}
for f, rows in fontes.items():
    for r in rows:
        if ok(r.get('aparelho')) and bate(r.get('nome')): achados.setdefault(r['aparelho'], []).append((f, r))
bloq = {r['aparelho']: r for r in fontes['bloqueios']}
L = []
L.append(f'== aparelhos com o apelido: {len(achados)} (lidos: vistos {len(fontes["vistos"])}, presença {len(fontes["presenca"])}, bloqueios {len(fontes["bloqueios"])})')
novos = []
for ap, onde in sorted(achados.items(), key=lambda x: -max(int(r.get('em') or 0) for _, r in x[1])):
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{ap}'") or [{}])[0].get('ate')
    li = q(f"SELECT dia, mesas, partidas, publicas FROM limites WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 3")
    bu = q(f"SELECT dia, tipo, via FROM burlas WHERE aparelho = '{ap}' ORDER BY em DESC LIMIT 5")
    of = q(f"SELECT dia, n FROM offline_uso WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 3")
    jg = (q(f"SELECT primeiro, ultimo, partidas, maos FROM jogadores WHERE aparelho = '{ap}'") or [{}])[0]
    b = bloq.get(ap)
    L.append(f'-- aparelho {h(ap)} | nomes: ' + ', '.join(sorted({str(r.get("nome")) for _, r in onde})) + f' | desde {quando(d)} | visto por último {quando(max(int(r.get("em") or 0) for _, r in onde))}')
    L.append('   onde: ' + '; '.join(f'{f}:' + ','.join(f'{k}={v}' for k, v in r.items() if k not in ('aparelho', 'nome', 'em')) for f, r in onde))
    L.append(f'   bloqueado: {"sim, " + quando(b["em"]) + " (" + str(b.get("motivo")) + ")" if b else "NÃO"} | sócio até: {quando(pl)} | jogos: {jg} | limites: {li} | offline: {of} | burlas: {bu}')
    if not b: novos.append((ap, sorted({str(r.get("nome")) for _, r in onde})[0]))
# a mesma rede (resumo do endereço do dia) de quem tem o apelido: outros aparelhos que bateram limite ali
marcas = q("SELECT DISTINCT dia, marca FROM limites_rede WHERE aparelho IN (" + ','.join(f"'{a}'" for a in achados) + ")") if achados else []
L.append(f'== redes (dia + resumo) desses aparelhos: {len(marcas)}')
for m in marcas[:20]:
    outros = q(f"SELECT DISTINCT aparelho, nome FROM limites_rede WHERE dia = '{m['dia']}' AND marca = '{m['marca']}'")
    L.append(f"   {m['dia']}: " + ', '.join(f"{h(o['aparelho'])}={o.get('nome')}{' (bloq)' if o['aparelho'] in bloq else ''}" for o in outros))
# bloqueia agora quem ainda não está bloqueado
for ap, nome in novos:
    nm = str(nome)[:16].replace("'", "''")
    ex(f"INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES ('{ap}', '{nm}', 'voltou com outro aparelho (pedido do dono)', {agora}) ON CONFLICT (aparelho) DO UPDATE SET motivo = excluded.motivo, em = excluded.em")
    ex(f"UPDATE fotos SET status = 'recusada', dados = '', revisado_em = {agora} WHERE aparelho = '{ap}'")
L.append(f'== bloqueados agora: {len(novos)}: ' + ', '.join(h(a) for a, _ in novos))
L.append('== bloqueios (todos, mais recentes): ' + ' | '.join(f"{h(r['aparelho'])}={r.get('nome')} {quando(r['em'])} ({r.get('motivo')})" for r in sorted(fontes['bloqueios'], key=lambda r: -int(r['em']))[:15]))
open(OUT, 'a').write('\n'.join(L) + '\n')
