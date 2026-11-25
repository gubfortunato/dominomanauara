# 24/11 (pedido do dono, "Fale com a gente"): jogador pagou no Pix (12/11) e o app diz "sem plano · nenhum pagamento".
# Acha o pagamento no Asaas pela fatura (só por resumo sha256), o cadastro pelo nome e pelo telefone (só por resumo), o
# pedido no jogo, o aparelho e o plano (com o código, que só sai no resultado criptografado), e o aparelho de quem mandou a
# mensagem (pelo apelido, só por resumo). Só lê; não muda nada.
import json, subprocess, hashlib, unicodedata, re, time, sys, os, urllib.request
OUT = sys.argv[1]
FATURA = '494997e0f50228c7f996b9b886685d38cb83daa855bb8727dbdf0611dfd9065e'
NOME = '6f494534c5556d625709128b372cca1e85eee9b926d8b8e6c7944d7a130529fc'
FONE = '1482301bfb702d7e08af969b5a0d139fec03a6fd048894b8875f736adf5831d4'
APELIDO = '31d96e115b961a1c4d3efa5e7d21757de6e781fa97577256f2be9cfed0cca9c3'
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
def chave(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    return re.sub('[^a-z]', '', ''.join(c for c in s if not unicodedata.combining(c)))
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
K = os.environ.get('ASAAS_API_KEY', '')
AS = 'https://api-sandbox.asaas.com/v3' if '_hmlg_' in K else 'https://api.asaas.com/v3'
def asq(path):
    r = urllib.request.Request(AS + path, headers={'access_token': K, 'User-Agent': 'dominomanauara-servidor'})
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return json.loads(x.read().decode())
    except Exception as e: return {'erro': str(e)[:100]}
L = []
def plano(ap, origem):
    p = (q(f"SELECT ate, desde, codigo FROM planos WHERE aparelho = '{ap}'") or [None])[0]
    pg = q(f"SELECT produto, valor, status, criado_em, pago_em FROM pedidos WHERE aparelho = '{ap}' ORDER BY criado_em DESC LIMIT 6")
    nomes = sorted({(r.get('nome') or '') for r in q(f"SELECT nome FROM jogadores_vistos WHERE aparelho = '{ap}'") + q(f"SELECT nome FROM presenca WHERE aparelho = '{ap}'") + q(f"SELECT nome FROM mensagens WHERE aparelho = '{ap}'")})
    bl = q(f"SELECT motivo FROM bloqueios WHERE aparelho = '{ap}'")
    L.append(f"-- aparelho {h(ap)} ({origem}) | apelidos: {nomes} | bloqueio: {bl}")
    L.append(f"   plano: {('até ' + quando(p['ate']) + (' ATIVO' if int(p['ate'] or 0) > agora else ' VENCIDO') + ' | sócio desde ' + quando(p['desde']) + ' | CÓDIGO ' + str(p['codigo'])) if p else 'NENHUM'}")
    L.append(f"   pedidos: {[(x['produto'], x['valor'], x['status'], 'pago ' + quando(x['pago_em']) if x['pago_em'] else 'criado ' + quando(x['criado_em'])) for x in pg]}")
# 1) o pagamento no Asaas (pela fatura) e os do mesmo cadastro
achados, clientes = [], set()
for campo in ('paymentDate', 'dateCreated'):
    off = 0
    while off < 2000:
        j = asq(f'/payments?{campo}%5Bge%5D=2026-11-11&{campo}%5Ble%5D=2026-11-13&limit=100&offset={off}')
        for pm in j.get('data', []):
            if sh(str(pm.get('invoiceNumber') or '')) == FATURA and pm['id'] not in [a['id'] for a in achados]: achados.append(pm)
        if not j.get('hasMore'): break
        off += 100
L.append(f'== pagamentos com a fatura: {len(achados)}')
for pm in achados:
    clientes.add(pm.get('customer'))
    c = asq(f"/customers/{pm.get('customer')}")
    fone = any(sh(re.sub(r'\D', '', str(c.get(k) or ''))[-11:]) == FONE for k in ('mobilePhone', 'phone'))
    L.append(f"   {pm.get('value')} {pm.get('billingType')} {pm.get('status')} | pago {pm.get('paymentDate') or pm.get('clientPaymentDate')} | criado {pm.get('dateCreated')} | checkout: {'sim' if pm.get('checkoutSession') else 'não'} | assinatura: {'sim' if pm.get('subscription') else 'não'} | descrição: {str(pm.get('description') or '')[:60]} | cadastro com o nome: {sh(chave(c.get('name'))) == NOME} | com o telefone: {fone}")
    chk = pm.get('checkoutSession') or ''
    ped = q(f"SELECT id, aparelho, produto, valor, status, criado_em, pago_em FROM pedidos WHERE checkout = '{chk}'") if chk else []
    L.append(f"   pedido no jogo: {[(x['produto'], x['valor'], x['status'], 'pago ' + quando(x['pago_em']) if x['pago_em'] else 'criado ' + quando(x['criado_em'])) for x in ped] or 'NENHUM (pagamento de fora do jogo?)'}")
    for x in ped:
        if x.get('aparelho'): plano(x['aparelho'], 'do pedido')
# 2) outros pagamentos do mesmo cadastro
for cid in clientes:
    j = asq(f'/payments?customer={cid}&limit=50')
    L.append(f"== outros pagamentos do cadastro: {[(p.get('value'), p.get('billingType'), p.get('status'), p.get('paymentDate') or p.get('dateCreated'), 'checkout' if p.get('checkoutSession') else '-') for p in j.get('data', [])]}")
# 3) o aparelho de quem mandou a mensagem (pelo apelido) e o que mais tem esse apelido
aps = {}
for f, sql in [('mensagens', 'SELECT aparelho, nome, criado_em AS t FROM mensagens'), ('presenca', 'SELECT aparelho, nome, visto_em AS t FROM presenca'), ('vistos', 'SELECT aparelho, nome, visto_em AS t FROM jogadores_vistos')]:
    for r in q(sql):
        if r.get('aparelho') and sh(chave(r.get('nome'))) == APELIDO: aps.setdefault(r['aparelho'], set()).add(f)
L.append(f'== aparelhos com o apelido da mensagem: {len(aps)}')
for ap, fs in aps.items(): plano(ap, 'apelido: ' + ','.join(sorted(fs)))
open(OUT, 'a').write('\n'.join(L) + '\n')
