# 12/11 (pedido do dono, "Fale com a gente"): jogador(a) que apagou os dados do navegador e diz que o código de sócio "não
# existe". Acha o plano pelo apelido (só por resumo sha256, também como pedaço do apelido) e pelo telefone que a pessoa deixou
# na mensagem (só por resumo, cruzando com o cadastro de quem pagou no Asaas). Só lê; não muda nada. Sai criptografado.
import json, subprocess, hashlib, unicodedata, re, time, sys, os, urllib.request
OUT = sys.argv[1]
APELIDO = '6691e5b156b310785dab0355c34a3f9c2cb6d13c8fed40ead5c3883514097308'   # 5 letras
FONE = 'fd1d22ded7b0f9184ec48e1ca02bb0f7ac95f2e3960e7d60b5d0a157d850105b'      # DDD + número
agora = int(time.time() * 1000)
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return []
LEET = str.maketrans({'4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '5': 's', '$': 's', '7': 't'})
def chave(n):
    s = unicodedata.normalize('NFD', str(n or '')).lower()
    return re.sub('[^a-z]', '', ''.join(c for c in s if not unicodedata.combining(c)).translate(LEET))
sh = lambda t: hashlib.sha256(t.encode()).hexdigest()
bate = lambda n: any(sh(chave(n)[i:i + 5]) == APELIDO for i in range(max(0, len(chave(n)) - 4)))
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:10]
quando = lambda t: time.strftime('%d/%m %H:%M', time.gmtime((int(t or 0) - 4 * 3600000) / 1000)) if t else '-'
L = []
aps = {}
for f, sql in [('presenca', 'SELECT aparelho, nome, visto_em AS t FROM presenca'), ('vistos', 'SELECT aparelho, nome, visto_em AS t FROM jogadores_vistos'),
               ('ranking', 'SELECT aparelho, nome, MAX(atualizado) AS t FROM ranking GROUP BY aparelho, nome'), ('turma', 'SELECT aparelho, nome, entrou AS t FROM turma_membros'),
               ('limite', 'SELECT aparelho, nome, em AS t FROM limites_rede'), ('bloqueio', 'SELECT aparelho, nome, em AS t FROM bloqueios'), ('calcada', 'SELECT aparelho, nome, MAX(em) AS t FROM calcada GROUP BY aparelho, nome')]:
    for r in q(sql):
        if r.get('aparelho') and bate(r.get('nome')): aps.setdefault(r['aparelho'], []).append((f, r.get('nome'), quando(r.get('t'))))
L.append(f'== aparelhos com o apelido (inteiro ou pedaço): {len(aps)}')
def mostra(ap, origem):
    p = (q(f"SELECT ate, desde, codigo FROM planos WHERE aparelho = '{ap}'") or [None])[0]
    pg = q(f"SELECT id, produto, valor, status, criado_em, pago_em, checkout FROM pedidos WHERE aparelho = '{ap}' ORDER BY criado_em DESC LIMIT 6")
    d = (q(f"SELECT desde FROM aparelhos WHERE aparelho = '{ap}'") or [{}])[0].get('desde')
    bl = q(f"SELECT motivo FROM bloqueios WHERE aparelho = '{ap}'")
    L.append(f"-- aparelho {h(ap)} ({origem}) | visto desde {quando(d)} | plano: {('até ' + quando(p['ate']) + (' ATIVO' if int(p['ate'] or 0) > agora else ' vencido') + ' | código ' + str(p['codigo'])) if p else 'nenhum'} | bloqueio: {bl}")
    L.append(f"   pagamentos: {[(x['produto'], x['valor'], x['status'], 'pago ' + quando(x['pago_em']) if x['pago_em'] else 'criado ' + quando(x['criado_em'])) for x in pg]}")
for ap, ns in aps.items():
    mostra(ap, 'apelido'); L.append(f"   apelidos: {ns}")
# pelo telefone, no cadastro de quem pagou (Asaas)
K = os.environ.get('ASAAS_API_KEY', '')
AS = 'https://api-sandbox.asaas.com/v3' if '_hmlg_' in K else 'https://api.asaas.com/v3'
def asq(path):
    r = urllib.request.Request(AS + path, headers={'access_token': K, 'User-Agent': 'dominomanauara-servidor'})
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return json.loads(x.read().decode())
    except Exception as e: return {'erro': str(e)[:100]}
cli = []
if K:
    off = 0
    while off < 3000:
        j = asq(f'/customers?limit=100&offset={off}')
        for c in j.get('data', []):
            for campo in ('mobilePhone', 'phone'):
                dg = re.sub(r'\D', '', str(c.get(campo) or ''))[-11:]
                if dg and sh(dg) == FONE: cli.append(c['id']); break
        if not j.get('hasMore'): break
        off += 100
L.append(f'== cadastros no Asaas com o telefone: {len(cli)}')
for cid in cli:
    j = asq(f'/payments?customer={cid}&limit=50')
    for pmt in j.get('data', []):
        chk = pmt.get('checkoutSession') or ''
        ped = q(f"SELECT id, aparelho, produto, status FROM pedidos WHERE checkout = '{chk}'") if chk else []
        L.append(f"   pagamento {pmt.get('value')} {pmt.get('billingType')} {pmt.get('status')} em {pmt.get('paymentDate') or pmt.get('dateCreated')} | descrição: {str(pmt.get('description') or '')[:40]} | pedido no jogo: {[(x['produto'], x['status']) for x in ped]}")
        for x in ped:
            if x.get('aparelho') and x['aparelho'] not in aps: mostra(x['aparelho'], 'telefone')
# o código pode ter sido levado para outro aparelho: o plano de cada pedido pago desses aparelhos
open(OUT, 'a').write('\n'.join(L) + '\n')
