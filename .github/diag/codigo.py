# 11/11 (pedido do dono): de quem é o plano de sócio com um certo código (o código fica só como resumo sha256 aqui: ele
# serve para levar o plano para outro aparelho). Mostra o aparelho do plano, os apelidos dele e os pagamentos. Não muda nada.
import json, subprocess, hashlib, unicodedata, re, time, sys
ALVO = '6a4badd4c29935681444a8d96d73d77b77f34217eee613da9ed0db83caf2c137'
JIM = {'e365e378ca', '182c206cc3', 'e359a953e3', '3928259046', '385aed2b1b', 'c6491f3c15'}
OUT = sys.argv[1]
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
L = []
planos = q('SELECT aparelho, ate, desde, codigo FROM planos')
achou = [p for p in planos if hashlib.sha256(str(p.get('codigo') or '').upper().encode()).hexdigest() == ALVO]
L.append(f'== planos lidos: {len(planos)} | com o código: {len(achou)}')
for p in achou:
    ap = p['aparelho']
    nomes = q(f"SELECT 'vistos' AS f, nome, visto_em AS em FROM jogadores_vistos WHERE aparelho = '{ap}'") + q(f"SELECT 'presenca' AS f, nome, visto_em AS em FROM presenca WHERE aparelho = '{ap}'") \
          + q(f"SELECT 'turma' AS f, nome, entrou AS em FROM turma_membros WHERE aparelho = '{ap}'") + q(f"SELECT 'limite' AS f, nome, em FROM limites_rede WHERE aparelho = '{ap}' LIMIT 3")
    pg = q(f"SELECT produto, valor, status, criado_em, pago_em FROM pedidos WHERE aparelho = '{ap}' ORDER BY criado_em DESC LIMIT 5")
    asn = q(f"SELECT produto, status, criado_em FROM assinaturas WHERE aparelho = '{ap}' ORDER BY criado_em DESC LIMIT 3")
    ct = q(f"SELECT nivel, desde FROM cortesias WHERE aparelho = '{ap}'")
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    bl = q(f"SELECT motivo, em FROM bloqueios WHERE aparelho = '{ap}'")
    L.append(f"-- aparelho {h(ap)} {'(É UM DOS 6 DO JIM)' if h(ap) in JIM else '(não é nenhum dos 6 aparelhos com o apelido)'} | plano até {quando(p['ate'])} ({'ativo' if int(p['ate'] or 0) > agora else 'vencido'}) | sócio desde {quando(p['desde'])} | aparelho visto desde {quando(d)}")
    L.append(f"   apelidos: {[(n['f'], n.get('nome'), quando(n.get('em'))) for n in nomes]}")
    L.append(f"   pagamentos: {[(x['produto'], x['valor'], x['status'], quando(x['pago_em'])) for x in pg]} | assinaturas: {[(x['produto'], x['status']) for x in asn]} | cortesia: {ct} | bloqueado: {bl}")
# os pagos sem aparelho com plano (o plano foi levado para outro aparelho pelo código)
L.append('== pagamentos pagos dos aparelhos com o apelido: ' + str([(h(x['aparelho']), x['produto'], x['valor']) for x in q("SELECT aparelho, produto, valor FROM pedidos WHERE status = 'pago'") if h(x['aparelho']) in JIM]))
open(OUT, 'a').write('\n'.join(L) + '\n')
