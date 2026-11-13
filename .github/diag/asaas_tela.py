# 13/11 (pedido do dono: "excesso de informações para preencher"): o que a tela de pagamento do Asaas pede, de verdade.
# Cria 3 checkouts de teste (R$ 5,90, expiram em 10 minutos, ninguém paga), abre cada um num navegador e anota os campos
# visíveis (rótulos e nomes) e uma foto da tela. Não cria cliente, não guarda nada no banco. A chave nunca é impressa.
import os, sys, json, base64, urllib.request, asyncio
OUT = sys.argv[1]; K = os.environ.get('ASAAS_API_KEY', '')
AS = 'https://api-sandbox.asaas.com/v3' if '_hmlg_' in K else 'https://api.asaas.com/v3'
def criar(tipos):
    corpo = {'billingTypes': tipos, 'chargeTypes': ['DETACHED'], 'minutesToExpire': 10,
             'callback': {'successUrl': 'https://dominomanauara.com.br/?pago=teste', 'cancelUrl': 'https://dominomanauara.com.br/?pago=cancelado', 'expiredUrl': 'https://dominomanauara.com.br/?pago=expirado'},
             'items': [{'name': 'Teste - não pagar', 'description': 'Teste da tela de pagamento', 'quantity': 1, 'value': 5.9}]}
    req = urllib.request.Request(AS + '/checkouts', data=json.dumps(corpo).encode(), method='POST', headers={'access_token': K, 'content-type': 'application/json', 'User-Agent': 'dominomanauara-diag'})
    try: j = json.loads(urllib.request.urlopen(req, timeout=30).read().decode()); return j.get('id'), j.get('link')
    except urllib.error.HTTPError as e: return None, 'erro %s %s' % (e.code, e.read().decode()[:200])
def cancelar(cid):
    try: urllib.request.urlopen(urllib.request.Request(AS + '/checkouts/%s/cancel' % cid, data=b'{}', method='POST', headers={'access_token': K, 'content-type': 'application/json', 'User-Agent': 'dominomanauara-diag'}), timeout=30)
    except Exception as e: pass
CAMPOS = """() => [...document.querySelectorAll('input, select, textarea')].filter(e => e.offsetParent !== null && e.type !== 'hidden').map(e => {
  const l = (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('aria-label') || e.placeholder || e.name || e.id;
  return (l || '?').replace(/\\s+/g, ' ').trim() + (e.required ? ' (obrigatório)' : '') + ' [' + (e.name || e.id || e.type) + ']'; })"""
TEXTO = "() => document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1500)"
async def olhar(pg, nome, link, saida):
    await pg.goto(link, wait_until='networkidle', timeout=60000); await pg.wait_for_timeout(2500)
    saida.append('== %s: campos na primeira tela' % nome); saida.append(json.dumps(await pg.evaluate(CAMPOS), ensure_ascii=False))
    saida.append('-- texto da tela:\n' + await pg.evaluate(TEXTO))
    png = await pg.screenshot(full_page=True); saida.append('@@foto %s_1 %s' % (nome, base64.b64encode(png).decode()))
    # tenta avançar: escolhe a forma de pagamento e o botão de continuar, para ver se aparecem campos novos (endereço)
    for passo in range(3):
        clicou = False
        for rot in (['Pix', 'PIX'] if 'pix' in nome else ['Cartão de crédito', 'Cartão']) + ['Continuar', 'Próximo', 'Avançar', 'Ir para pagamento']:
            try:
                el = pg.get_by_text(rot, exact=False).first
                if await el.is_visible(): await el.click(timeout=3000); await pg.wait_for_timeout(1500); clicou = True; break
            except Exception: pass
        if not clicou: break
        saida.append('== %s: campos depois do passo %d' % (nome, passo + 1)); saida.append(json.dumps(await pg.evaluate(CAMPOS), ensure_ascii=False))
        png = await pg.screenshot(full_page=True); saida.append('@@foto %s_%d %s' % (nome, passo + 2, base64.b64encode(png).decode()))
async def main():
    from playwright.async_api import async_playwright
    saida = []; criados = []
    for nome, tipos in (('pix', ['PIX']), ('cartao', ['CREDIT_CARD']), ('os_dois', ['PIX', 'CREDIT_CARD'])):
        cid, link = criar(tipos); saida.append('## %s: %s' % (nome, 'criado' if cid else link)); 
        if cid: criados.append((nome, cid, link))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for nome, cid, link in criados:
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='pt-BR')
            pg = await ctx.new_page()
            try: await olhar(pg, nome, link, saida)
            except Exception as e: saida.append('falhou %s: %s' % (nome, str(e)[:300]))
            await ctx.close()
        await b.close()
    for nome, cid, link in criados: cancelar(cid)
    saida.append('## checkouts de teste cancelados')
    open(OUT, 'a').write('\n'.join(saida) + '\n')
asyncio.run(main())
