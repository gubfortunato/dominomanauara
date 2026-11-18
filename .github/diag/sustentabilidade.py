# 18/11, 3h (só leitura): números para a análise de sustentabilidade do jogo (desde 05/11, quando começou a cobrança).
# Só totais e contagens: nenhum nome, apelido, e-mail, código ou aparelho sai daqui.
import json, os, subprocess, sys, urllib.request, datetime
OUT = sys.argv[1]; L = []
def w(t, v): L.append(t + ': ' + (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)))
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception as e: return [{'erro': (r.stderr or str(e))[-200:]}]
M = 4 * 3600000
ms = lambda d: int(datetime.datetime.fromisoformat(d + 'T00:00:00+00:00').timestamp() * 1000) + M
C05, C25 = ms('2026-11-05'), ms('2026-10-25')
dia = lambda col: f"strftime('%Y-%m-%d', ({col} - {M}) / 1000, 'unixepoch')"
L.append('== D1 (negócio)')
w('pedidos por status desde 25/10', q(f"SELECT status, produto, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor FROM pedidos WHERE criado_em >= {C25} GROUP BY status, produto ORDER BY status, produto"))
w('pagos por dia', q(f"SELECT {dia('pago_em')} AS d, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor, COUNT(DISTINCT aparelho) AS pessoas FROM pedidos WHERE status = 'pago' AND pago_em >= {C25} GROUP BY d ORDER BY d"))
w('pagos por produto desde 05/11', q(f"SELECT produto, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor FROM pedidos WHERE status = 'pago' AND pago_em >= {C05} GROUP BY produto"))
w('pagos por produto antes de 05/11', q(f"SELECT produto, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor FROM pedidos WHERE status = 'pago' AND pago_em < {C05} GROUP BY produto"))
w('pagantes: primeira vez x renovação desde 05/11', q(f"SELECT CASE WHEN (SELECT COUNT(*) FROM pedidos p2 WHERE p2.aparelho = p.aparelho AND p2.status = 'pago' AND p2.pago_em < p.pago_em) = 0 THEN 'primeira' ELSE 'de novo' END AS tipo, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor FROM pedidos p WHERE status = 'pago' AND pago_em >= {C05} GROUP BY tipo"))
w('pessoas que já pagaram (total)', q("SELECT COUNT(DISTINCT aparelho) AS n FROM pedidos WHERE status = 'pago'"))
w('assinaturas por status e produto', q("SELECT status, produto, promo, COUNT(*) AS n, ROUND(SUM(valor), 2) AS valor, SUM(pagos) AS pagos FROM assinaturas GROUP BY status, produto, promo"))
w('assinaturas canceladas por dia', q(f"SELECT {dia('cancelada_em')} AS d, COUNT(*) AS n FROM assinaturas WHERE cancelada_em IS NOT NULL GROUP BY d ORDER BY d"))
w('sócios com plano valendo agora', q("SELECT COUNT(*) AS n, SUM(CASE WHEN aparelho IN (SELECT aparelho FROM pedidos WHERE status = 'pago') THEN 1 ELSE 0 END) AS pagantes, SUM(CASE WHEN aparelho IN (SELECT aparelho FROM cortesias) THEN 1 ELSE 0 END) AS cortesia FROM planos WHERE ate > strftime('%s','now') * 1000"))
w('pagantes valendo: vence em', q("SELECT CASE WHEN ate < strftime('%s','now')*1000 + 7*86400000 THEN 'até 7 dias' WHEN ate < strftime('%s','now')*1000 + 31*86400000 THEN '8 a 31 dias' WHEN ate < strftime('%s','now')*1000 + 100*86400000 THEN '32 a 100 dias' ELSE 'mais de 100 dias' END AS vence, COUNT(*) AS n FROM planos WHERE ate > strftime('%s','now')*1000 AND aparelho IN (SELECT aparelho FROM pedidos WHERE status = 'pago') GROUP BY vence"))
w('presentes por tipo', q("SELECT tipo, COUNT(*) AS n FROM presentes GROUP BY tipo"))
L.append('== D1 (gente)')
w('novos por dia', q(f"SELECT {dia('primeiro')} AS d, COUNT(*) AS n, SUM(jogou) AS jogaram FROM jogadores WHERE semente = 0 GROUP BY d ORDER BY d"))
w('jogadores total', q("SELECT COUNT(*) AS n, SUM(jogou) AS jogaram, SUM(semente) AS semente FROM jogadores"))
w('ativos por dia', q("SELECT dia, COUNT(DISTINCT aparelho) AS n FROM acessos_hora GROUP BY dia ORDER BY dia"))
w('ativos por semana', q("SELECT strftime('%Y-%W', dia) AS s, COUNT(DISTINCT aparelho) AS n FROM acessos_hora GROUP BY s ORDER BY s"))
w('partidas por dia', q("SELECT dia, SUM(n) AS partidas, COUNT(*) AS pessoas FROM partidas_dia GROUP BY dia ORDER BY dia"))
w('faixas (dias sem abrir, quem jogou)', q("SELECT CASE WHEN ultimo > strftime('%s','now')*1000 - 3*86400000 THEN 'ativo' WHEN ultimo > strftime('%s','now')*1000 - 7*86400000 THEN 'esfriando' WHEN ultimo > strftime('%s','now')*1000 - 30*86400000 THEN 'sumido' ELSE 'abandonou' END AS f, COUNT(*) AS n FROM jogadores WHERE jogou = 1 GROUP BY f"))
w('retenção por semana de chegada (voltou outro dia, 7 dias depois)', q(f"SELECT strftime('%Y-%W', ({M} * -1 + primeiro) / 1000, 'unixepoch') AS s, COUNT(*) AS novos, SUM(CASE WHEN ultimo - primeiro > 86400000 THEN 1 ELSE 0 END) AS voltou, SUM(CASE WHEN ultimo - primeiro >= 7*86400000 THEN 1 ELSE 0 END) AS ficou7, SUM(CASE WHEN ultimo - primeiro >= 14*86400000 THEN 1 ELSE 0 END) AS ficou14 FROM jogadores WHERE semente = 0 GROUP BY s ORDER BY s"))
w('lembretes ligados', q("SELECT COUNT(*) AS n FROM avisos"))
w('tamanho das tabelas (linhas)', q("SELECT (SELECT COUNT(*) FROM jogadores) AS jogadores, (SELECT COUNT(*) FROM acessos_hora) AS acessos_hora, (SELECT COUNT(*) FROM partidas_dia) AS partidas_dia, (SELECT COUNT(*) FROM calcada) AS calcada, (SELECT COUNT(*) FROM pedidos) AS pedidos, (SELECT COUNT(*) FROM caixa) AS caixa"))
r = subprocess.run(['wrangler', 'd1', 'info', 'dominomanauara', '--json'], capture_output=True, text=True); w('d1 info', r.stdout.strip()[:600] or r.stderr[-200:])
L.append('== Cloudflare (uso por dia desde 01/11)')
TK, AC = os.environ.get('CLOUDFLARE_API_TOKEN', ''), os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
def gql(query):
    r = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql', data=json.dumps({'query': query}).encode(), headers={'Authorization': 'Bearer ' + TK, 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as x: j = json.loads(x.read().decode())
        return j.get('errors') or j['data']['viewer']['accounts'][0]
    except Exception as e: return {'erro': str(e)[:200]}
F = '{date_geq: "2026-11-01"}'
w('workers', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: workersInvocationsAdaptive(limit:100, filter:%s, orderBy:[date_ASC]){dimensions{date} sum{requests errors subrequests cpuTimeUs}}}}}' % (AC, F)))
w('durable objects pedidos', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: durableObjectsInvocationsAdaptiveGroups(limit:100, filter:%s, orderBy:[date_ASC]){dimensions{date} sum{requests}}}}}' % (AC, F)))
w('durable objects tempo', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: durableObjectsPeriodicGroups(limit:100, filter:%s, orderBy:[date_ASC]){dimensions{date} sum{activeTime cpuTime inboundWebsocketMsgCount outboundWebsocketMsgCount storageReadUnits storageWriteUnits}}}}}' % (AC, F)))
w('durable objects armazenamento', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: durableObjectsStorageGroups(limit:40, filter:%s, orderBy:[date_DESC]){dimensions{date} max{storedBytes}}}}}' % (AC, F)))
w('d1', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: d1AnalyticsAdaptiveGroups(limit:100, filter:%s, orderBy:[date_ASC]){dimensions{date} sum{readQueries writeQueries rowsRead rowsWritten}}}}}' % (AC, F)))
w('d1 armazenamento', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: d1StorageAdaptiveGroups(limit:40, filter:%s, orderBy:[date_DESC]){dimensions{date} max{databaseSizeBytes}}}}}' % (AC, F)))
w('workers ai', gql('{viewer{accounts(filter:{accountTag:"%s"}){x: aiInferenceAdaptiveGroups(limit:100, filter:%s, orderBy:[date_ASC]){dimensions{date} sum{totalNeurons}}}}}' % (AC, F)))
try:
    r = urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{AC}/subscriptions', headers={'Authorization': 'Bearer ' + TK})
    with urllib.request.urlopen(r, timeout=30) as x: j = json.loads(x.read().decode())
    w('assinaturas cloudflare', [{'produto': (s.get('rate_plan') or {}).get('public_name') or (s.get('product') or {}).get('name'), 'preco': s.get('price'), 'freq': s.get('frequency')} for s in j.get('result') or []])
except Exception as e: w('assinaturas cloudflare', 'sem acesso: ' + str(e)[:120])
L.append('== Asaas (só leitura, só totais)')
K = os.environ.get('ASAAS_API_KEY', '')
AS = 'https://api-sandbox.asaas.com/v3' if '_hmlg_' in K else 'https://api.asaas.com/v3'
def ag(path):
    r = urllib.request.Request(AS + path, headers={'access_token': K, 'User-Agent': 'dominomanauara-servidor'})
    try:
        with urllib.request.urlopen(r, timeout=30) as x: return json.loads(x.read().decode() or '{}')
    except Exception as e: return {'erro': str(e)[:160]}
if K:
    pays, off = [], 0
    while off < 2000:
        j = ag(f'/payments?dateCreated[ge]=2026-10-20&limit=100&offset={off}')
        d = j.get('data') or []; pays += d
        if not j.get('hasMore'): break
        off += 100
    agg = {}
    for p in pays:
        dom = 'domino' if 'domin' in str(p.get('description') or '').lower() else 'outro'
        k = (dom, p.get('status'), p.get('billingType'), str(p.get('paymentDate') or p.get('dateCreated') or '')[:7])
        a = agg.setdefault(k, [0, 0.0, 0.0]); a[0] += 1; a[1] += float(p.get('value') or 0); a[2] += float(p.get('netValue') or 0)
    w('cobranças (descrição, status, forma, mês): n, valor, líquido', [[*k, v[0], round(v[1], 2), round(v[2], 2)] for k, v in sorted(agg.items(), key=lambda x: str(x[0]))])
    for st in ('ACTIVE', 'INACTIVE', 'EXPIRED'):
        subs, off = [], 0
        while off < 1000:
            j = ag(f'/subscriptions?status={st}&limit=100&offset={off}'); d = j.get('data') or []; subs += d
            if not j.get('hasMore'): break
            off += 100
        a = {}
        for s in subs:
            dom = 'domino' if 'domin' in str(s.get('description') or '').lower() else 'outro'
            k = (dom, s.get('cycle'), s.get('value')); a[k] = a.get(k, 0) + 1
        w(f'assinaturas Asaas {st} (descrição, ciclo, valor): n', [[*k, v] for k, v in sorted(a.items(), key=lambda x: str(x[0]))])
    f = ag('/myAccount/fees'); w('taxas Asaas', json.dumps(f.get('payment', f), ensure_ascii=False)[:1500])
    a = ag('/myAccount'); w('conta Asaas (tipo)', {'personType': a.get('personType'), 'companyType': a.get('companyType')})
open(OUT, 'a').write('\n'.join(L) + '\n')
