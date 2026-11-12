# 11/11 (pedido do dono): confere se um jogador é sócio (não bloqueia) e bloqueia por burla do limite grátis os aparelhos de
# outros dois (os apelidos são comparados só por resumo sha256; não ficam escritos aqui). O apelido de quem foi bloqueado
# entra na lista de apelidos bloqueados (quem volta com outro aparelho cai sozinho). Sócio nunca é bloqueado aqui.
import json, subprocess, hashlib, unicodedata, re, time, sys
GRUPOS = {
  'A': {'pedaco': {'0b3446a78a37ee2ef133ebcf6f4dbbe7821c8febb082af3288676e20f6fbfef5', '8cc4232bebd0e5d57e81b66e1381453913da918062d98ee8cc2343d646511c20',
                   '976b9956071edd07c7d054e5f22371979dc868144be468605be8e4763d47de27', '34b89f8404b42b30f330db7a036f609fdf2b1f173ea437fe3f97851665a86fff'}, 'bloquear': True},
  'B': {'inteiro': {'beb874a60023bf73ebb945577c70d2ff02eb07eba2e3e3b0ebdd4235e056bec7'}, 'bloquear': True},
  'C': {'inteiro': {'f2e7c15785010e3c10f33e776114397a336add1069c85e34d1f4e4e4b8985301', '19dddeae00220c3837b51f7e4f8ffd97621e1f785bfec0642a45e1ec3c29127f'}, 'bloquear': False},
}
MOTIVO = 'burla do limite grátis (vários aparelhos)'
OUT = sys.argv[1]
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
def ex(sql): subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--command', sql], capture_output=True, text=True)
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
col = lambda x: re.sub(r'(.)\1+', r'\1', x)
def chaves(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c))
    a = re.sub('[^a-z]', '', s); b = re.sub('[^a-z]', '', s.translate(LEET))
    return {a, b, col(a), col(b)}
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
def grupo(n):
    ks = chaves(n)
    for g, d in GRUPOS.items():
        if any(sh(k) in d.get('inteiro', set()) for k in ks): return g
        if 'pedaco' in d and any(sh(k[i:i + L]) in d['pedaco'] for k in ks for L in (7, 8, 9) for i in range(0, max(0, len(k) - L) + 1)): return g
    return None
ok = lambda ap: bool(re.fullmatch(r'[a-z0-9-]{8,40}', str(ap or ''), re.I))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
rows = q('SELECT aparelho, nome, visto_em AS em FROM jogadores_vistos') + q('SELECT aparelho, nome, visto_em AS em FROM presenca') + q('SELECT aparelho, nome, em FROM limites_rede') + q('SELECT aparelho, nome, entrou AS em FROM turma_membros')
bloq = {r['aparelho']: r for r in q('SELECT aparelho, motivo FROM bloqueios')}
achados = {}
for r in rows:
    if not ok(r.get('aparelho')): continue
    g = grupo(r.get('nome'))
    if g: achados.setdefault(g, {}).setdefault(r['aparelho'], set()).add(str(r.get('nome')))
L = []
for g in sorted(GRUPOS):
    aps = achados.get(g, {})
    L.append(f'== grupo {g}: {len(aps)} aparelhos ' + ('(bloquear)' if GRUPOS[g]['bloquear'] else '(só conferir se é sócio)'))
    bloqueados = 0
    for ap, nomes in aps.items():
        pl = (q(f"SELECT ate, desde, codigo FROM planos WHERE aparelho = '{ap}'") or [{}])[0]
        socio = bool(pl.get('ate') and int(pl['ate']) > agora)
        pg = q(f"SELECT produto, valor, status, pago_em FROM pedidos WHERE aparelho = '{ap}' AND status = 'pago' ORDER BY pago_em DESC LIMIT 3")
        d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
        li = q(f"SELECT dia, partidas, publicas FROM limites WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 2")
        L.append(f"-- {h(ap)} | {', '.join(sorted(nomes))} | desde {quando(d)} | sócio: {'SIM até ' + quando(pl['ate']) if socio else ('venceu ' + quando(pl['ate']) if pl.get('ate') else 'não')} | pagos: {pg} | limites: {li} | bloqueado antes: {bloq.get(ap, {}).get('motivo', 'não')}")
        if GRUPOS[g]['bloquear'] and not socio and ap not in bloq:
            nm = sorted(nomes)[0][:16].replace("'", "''")
            ex(f"INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES ('{ap}', '{nm}', '{MOTIVO}', {agora}) ON CONFLICT (aparelho) DO NOTHING")
            ex(f"UPDATE fotos SET status = 'recusada', dados = '', revisado_em = {agora} WHERE aparelho = '{ap}'")
            bloqueados += 1
    if GRUPOS[g]['bloquear'] and aps:
        termos = {}
        for nomes in aps.values():
            for n in nomes:
                k = col(re.sub('[^a-z]', '', unicodedata.normalize('NFD', n).encode('ascii', 'ignore').decode().lower().translate(LEET)))
                if len(k) >= 4: termos[k] = termos.get(k, 0) + 1
        for t in termos:
            ex(f"INSERT OR IGNORE INTO apelidos_bloqueados (termo, parte, motivo, em) VALUES ('{t}', 0, '{MOTIVO}', {agora})")
        L.append(f'   bloqueados agora: {bloqueados} | apelidos na lista: {len(termos)}')
L.append('== lista de apelidos bloqueados: ' + ', '.join(f"{r['termo']}{' (pedaço)' if r['parte'] else ''}" for r in q('SELECT termo, parte FROM apelidos_bloqueados ORDER BY em DESC')))
open(OUT, 'a').write('\n'.join(L) + '\n')
