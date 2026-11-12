# 12/11: o Asaas aceita cobrança de R$ 4,90 (Passe da semana)? E quais as taxas da conta? Cria e cancela na hora.
import json, os, sys, urllib.request
OUT = sys.argv[1]
K = os.environ.get('ASAAS_API_KEY', '')
AS = 'https://api-sandbox.asaas.com/v3' if '_hmlg_' in K else 'https://api.asaas.com/v3'
def req(path, metodo='GET', corpo=None):
    r = urllib.request.Request(AS + path, method=metodo, data=json.dumps(corpo).encode() if corpo else None,
        headers={'access_token': K, 'content-type': 'application/json', 'User-Agent': 'dominomanauara-servidor'})
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return x.status, json.loads(x.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or '{}')
        except Exception: return e.code, {}
with open(OUT, 'a') as f:
    if not K: f.write('sem chave\n'); sys.exit()
    st, j = req('/myAccount/fees')
    f.write(f'== taxas ({st})\n'); f.write(json.dumps(j.get('payment', j), ensure_ascii=False)[:3000] + '\n')
    for valor, tipos in [(4.90, ['PIX', 'CREDIT_CARD']), (4.90, ['PIX']), (1.00, ['PIX'])]:
        corpo = {'billingTypes': tipos, 'chargeTypes': ['DETACHED'], 'minutesToExpire': 10,
                 'callback': {'successUrl': 'https://dominomanauara.com.br/?pago=teste', 'cancelUrl': 'https://dominomanauara.com.br/?pago=cancelado', 'expiredUrl': 'https://dominomanauara.com.br/?pago=expirado'},
                 'items': [{'name': 'Dominó Manauara - 7 dias', 'description': 'Teste do passe da semana (cancelado na hora).', 'quantity': 1, 'value': valor}]}
        st, j = req('/checkouts', 'POST', corpo)
        erro = (j.get('errors') or [{}])[0].get('description') if isinstance(j, dict) else None
        f.write(f'== checkout {valor} {tipos}: status {st}, abriu {bool(j.get("link"))}, erro {erro}\n')
        if j.get('id'):
            c, _ = req(f'/checkouts/{j["id"]}/cancel', 'POST')
            f.write(f'   cancelado: {c}\n')
