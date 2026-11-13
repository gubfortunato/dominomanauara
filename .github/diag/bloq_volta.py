# 12/11 (pedido do dono): o jogador bloqueado por burla voltou com um aparelho que tinha escapado do bloqueio. MUDA o banco:
# bloqueia os aparelhos com o apelido dele que ainda estão livres (motivo burla: virar sócio desbloqueia), recusa a foto,
# e põe o apelido inteiro na lista de apelidos bloqueados (quem voltar com outro aparelho e esse apelido cai sozinho).
# Também acerta a lista para os outros bloqueados por burla cujo apelido não entrou nela. Nomes só por resumo sha256.
import json, subprocess, time, sys, hashlib, unicodedata, re, os, tempfile
OUT = sys.argv[1]
PEDACO = '05b44f4aa0e1b1de75c4ed641fb9c3c6b42b9186c59c78411bb1e2d34f26977e'
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return None
def termo(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c)).translate(LEET)
    return re.sub(r'(.)\1+', r'\1', re.sub('[^a-z]', '', s))
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
bate = lambda n: any(sh(termo(n)[i:i + 5]) == PEDACO for i in range(max(0, len(termo(n)) - 4))) or any(sh(re.sub('[^a-z]', '', termo(n))[i:i + 5]) == PEDACO for i in range(9))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
agora = int(time.time() * 1000)
MOT = 'burla do limite grátis (vários aparelhos)'
L = ['== bloqueio do que voltou']
aps = {}
for sql in ['SELECT aparelho, nome FROM presenca', 'SELECT aparelho, nome FROM jogadores_vistos', 'SELECT DISTINCT aparelho, nome FROM ranking', 'SELECT DISTINCT aparelho, nome FROM pessoa_dia']:
    for r in q(sql) or []:
        if r.get('aparelho') and bate(r.get('nome')): aps.setdefault(r['aparelho'], r.get('nome'))
for ap, nome in aps.items():
    if not re.match(r'^[a-z0-9-]{8,40}$', ap, re.I): continue
    if q(f"SELECT 1 AS x FROM bloqueios WHERE aparelho = '{ap}'"): continue
    if q(f"SELECT 1 AS x FROM planos WHERE aparelho = '{ap}' AND ate > {agora}"): L.append(f'   {h(ap)}: é sócio, não mexi'); continue
    n = str(nome or '')[:16].replace("'", "''")
    q(f"INSERT INTO bloqueios (aparelho, nome, motivo, em) VALUES ('{ap}', '{n}', '{MOT}', {agora}) ON CONFLICT (aparelho) DO NOTHING")
    q(f"UPDATE fotos SET status = 'recusada', dados = '', revisado_em = {agora} WHERE aparelho = '{ap}'")
    L.append(f'   bloqueado: {h(ap)} ({nome})')
# o apelido dele (e os dos outros bloqueados por burla) na lista de apelidos bloqueados
lista = {r['termo'] for r in q('SELECT termo FROM apelidos_bloqueados') or []}
novos = []
for r in q("SELECT DISTINCT nome FROM bloqueios WHERE motivo LIKE '%burla%' OR motivo LIKE '%voltou com outro aparelho%'") or []:
    t = termo(r.get('nome'))
    if len(t) >= 5 and t not in lista:
        q(f"INSERT OR IGNORE INTO apelidos_bloqueados (termo, parte, motivo, em) VALUES ('{t}', 0, 'burla (acertado em 12/11)', {agora})"); lista.add(t); novos.append(t)
L.append(f'== apelidos que entraram na lista: {novos}')
L.append('== lista agora: ' + str(sorted((r['termo'], r['parte']) for r in q('SELECT termo, parte FROM apelidos_bloqueados') or [])))
open(OUT, 'a').write('\n'.join(L) + '\n')
