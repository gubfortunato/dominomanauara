# 11/11 (pedido do dono): sócios que podem ter "perdido" o plano: o plano está num aparelho que parou de aparecer e o mesmo
# apelido segue jogando em outro aparelho, sem plano (trocou de celular, apagou os dados, joga pelo app instalado e pagou
# pelo navegador...). Só lê; não muda nada. O resultado sai criptografado (só o dono lê).
import json, subprocess, hashlib, unicodedata, re, time, sys
OUT = sys.argv[1]
agora = int(time.time() * 1000); DIA = 86400000
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chave(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c)).translate(LEET)
    return re.sub(r'(.)\1+', r'\1', re.sub('[^a-z]', '', s))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
planos = {r['aparelho']: r for r in q(f'SELECT aparelho, ate, desde FROM planos WHERE ate > {agora}')}
# o último sinal de cada aparelho e o apelido
ult, nome = {}, {}
def marca(ap, t, n):
    if not ap: return
    if t and int(t) > ult.get(ap, 0): ult[ap] = int(t)
    if n and ap not in nome: nome[ap] = n
for r in q('SELECT aparelho, nome, visto_em AS t FROM presenca'): marca(r['aparelho'], r['t'], r['nome'])
for r in q('SELECT aparelho, nome, visto_em AS t FROM jogadores_vistos'): marca(r['aparelho'], r['t'], r['nome'])
for r in q('SELECT aparelho, nome, MAX(atualizado) AS t FROM ranking GROUP BY aparelho'): marca(r['aparelho'], r['t'], r['nome'])
for r in q('SELECT aparelho, ultimo AS t FROM jogadores'): marca(r['aparelho'], r['t'], None)
por_nome = {}
for ap, n in nome.items():
    k = chave(n)
    if len(k) >= 3: por_nome.setdefault(k, []).append(ap)
L = [f'== sócios ativos: {len(planos)}']
perdidos = 0
for ap, p in sorted(planos.items(), key=lambda x: -int(x[1]['desde'] or 0)):
    n = nome.get(ap); k = chave(n) if n else ''
    outros = [o for o in por_nome.get(k, []) if o != ap and o not in planos] if k else []
    recentes = [o for o in outros if ult.get(o, 0) > ult.get(ap, 0)]
    parado = agora - ult.get(ap, 0) > 2 * DIA
    if recentes and (parado or len(por_nome.get(k, [])) <= 8):
        perdidos += 1
        L.append(f"-- {n} | plano no aparelho {h(ap)}: sócio desde {quando(p['desde'])}, até {quando(p['ate'])}, último sinal {quando(ult.get(ap))}")
        L.append('   joga em outro(s) aparelho(s) sem plano, mais recente(s): ' + ', '.join(f'{h(o)} (último sinal {quando(ult.get(o))})' for o in sorted(recentes, key=lambda o: -ult.get(o, 0))[:6]) + f' | aparelhos com esse apelido: {len(por_nome.get(k, []))}')
L.append(f'== possíveis planos "perdidos": {perdidos}')
sem_nome = [ap for ap in planos if ap not in nome]
L.append(f'== sócios sem apelido em nenhum registro: {len(sem_nome)}')
open(OUT, 'a').write('\n'.join(L) + '\n')
