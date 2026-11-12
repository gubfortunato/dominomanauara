# 12/11 (pedido do dono): análise de uma jogadora (o apelido fica só como resumo sha256 aqui). Para cada aparelho com o
# apelido: desde quando, quanto joga, limites, offline, Turma, plano, bloqueio, e se apareceu na mesma rede (resumo do dia)
# de aparelhos bloqueados. Também os aparelhos com apelido que começa ou termina com o mesmo nome. Só lê; não muda nada.
import json, subprocess, hashlib, unicodedata, re, time, sys
ALVO = '24d4b96f58da6d4a8512313bbd02a28ebf0ca95dec6e4c86ef78ce7f01e788ac'
OUT = sys.argv[1]
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chave(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    s = ''.join(c for c in s if not unicodedata.combining(c)).translate(LEET)
    return re.sub(r'(.)\1+', r'\1', re.sub('[^a-z]', '', s))
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
h = lambda ap: sh(str(ap))[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
fontes = {
  'vistos': q('SELECT aparelho, nome, mesa, visto_em AS em FROM jogadores_vistos'),
  'presenca': q('SELECT aparelho, nome, tela, modo, visto_em AS em FROM presenca'),
  'limites_rede': q('SELECT aparelho, nome, dia, tipo, marca, em FROM limites_rede'),
  'turmas': q('SELECT aparelho, nome, turma, entrou AS em FROM turma_membros'),
  'ranking': q('SELECT aparelho, nome, periodo, ganhas, jogadas, atualizado AS em FROM ranking'),
  'burlas': q('SELECT aparelho, nome, dia, tipo, via, em FROM burlas'),
}
bloq = {r['aparelho']: r for r in q('SELECT aparelho, nome, motivo, em FROM bloqueios')}
exato, parecido = {}, {}
for f, rows in fontes.items():
    for r in rows:
        ap = r.get('aparelho'); k = chave(r.get('nome'))
        if not ap or not k: continue
        if sh(k) == ALVO: exato.setdefault(ap, []).append((f, r))
        elif len(k) <= 12 and any(sh(k[:3]) == ALVO or sh(k[-3:]) == ALVO for _ in [0]) and k[:3] != k[-3:] or (len(k) <= 12 and (sh(k[:3]) == ALVO or sh(k[-3:]) == ALVO)):
            parecido.setdefault(ap, []).append((f, r))
# redes (resumo do dia) dos aparelhos bloqueados
redes_bloq = {}
for r in fontes['limites_rede']:
    if r['aparelho'] in bloq: redes_bloq.setdefault((r['dia'], r['marca']), set()).add(r['aparelho'])
def ficha(ap, onde):
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    pl = (q(f"SELECT ate FROM planos WHERE aparelho = '{ap}'") or [{}])[0].get('ate')
    pg = q(f"SELECT produto, valor, pago_em FROM pedidos WHERE aparelho = '{ap}' AND status = 'pago'")
    li = q(f"SELECT dia, mesas, partidas, publicas FROM limites WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 5")
    of = q(f"SELECT dia, n FROM offline_uso WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 5")
    du = q(f"SELECT dia, n FROM desafio_uso WHERE aparelho = '{ap}' ORDER BY dia DESC LIMIT 3")
    jg = (q(f"SELECT primeiro, ultimo, partidas, maos FROM jogadores WHERE aparelho = '{ap}'") or [{}])[0]
    ult = max([int(r.get('em') or 0) for _, r in onde] + [int(jg.get('ultimo') or 0)])
    nomes = sorted({str(r.get('nome')) for _, r in onde})
    redes = {(r['dia'], r['marca']) for f, r in onde if f == 'limites_rede'}
    junto = sorted({f"{dia}: {', '.join(h(b) + '=' + str(bloq[b].get('nome')) for b in redes_bloq[(dia, m)])}" for dia, m in redes if (dia, m) in redes_bloq and ap not in redes_bloq[(dia, m)]})
    s = [f"-- {h(ap)} | {', '.join(nomes)} | aparelho desde {quando(d)} | 1ª partida {quando(jg.get('primeiro'))} | último sinal {quando(ult)} | partidas {jg.get('partidas', 0)}, mãos {jg.get('maos', 0)}",
         f"   sócio: {('até ' + quando(pl)) if pl and int(pl) > agora else ('venceu ' + quando(pl) if pl else 'não')} | pagou: {[(x['produto'], x['valor'], quando(x['pago_em'])) for x in pg]} | bloqueado: {bloq[ap]['motivo'] + ' ' + quando(bloq[ap]['em']) if ap in bloq else 'não'}",
         f"   limites: {li} | offline: {of} | desafios: {du}",
         f"   turma: {[r.get('turma') for f, r in onde if f == 'turmas']} | burlas: {[(r['dia'], r['tipo'], r['via']) for f, r in onde if f == 'burlas']}",
         f"   mesma rede que bloqueados: {junto or 'não'}"]
    return '\n'.join(s)
L = [f'== aparelhos com o apelido exato: {len(exato)}']
for ap, onde in sorted(exato.items(), key=lambda x: -max(int(r.get('em') or 0) for _, r in x[1])): L.append(ficha(ap, onde))
L.append(f'== apelidos que começam ou terminam com o mesmo nome (até 12 letras): {len(parecido)}')
for ap, onde in sorted(parecido.items(), key=lambda x: -max(int(r.get('em') or 0) for _, r in x[1]))[:25]:
    L.append(f"   {h(ap)} | {', '.join(sorted({str(r.get('nome')) for _, r in onde}))} | último {quando(max(int(r.get('em') or 0) for _, r in onde))}{' | BLOQ: ' + bloq[ap]['motivo'] if ap in bloq else ''}")
open(OUT, 'a').write('\n'.join(L) + '\n')
