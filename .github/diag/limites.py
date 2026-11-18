# 18/11 (só leitura): o servidor está batendo nos limites do plano do Cloudflare? Erros por dia e por hora (Workers e mesas).
import json, os, sys, urllib.request
OUT = sys.argv[1]; L = ['== limites do Cloudflare (só leitura)']
TK, AC = os.environ.get('CLOUDFLARE_API_TOKEN', ''), os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
def gql(query):
    r = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql', data=json.dumps({'query': query}).encode(), headers={'Authorization': 'Bearer ' + TK, 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as x: j = json.loads(x.read().decode())
        return j.get('errors') or j['data']['viewer']['accounts'][0]
    except Exception as e: return {'erro': str(e)[:200]}
F = '{date_geq: "2026-11-10"}'
L.append('mesas por dia e status: ' + json.dumps(gql('{viewer{accounts(filter:{accountTag:"%s"}){x: durableObjectsInvocationsAdaptiveGroups(limit:200, filter:%s, orderBy:[date_ASC]){dimensions{date status} sum{requests errors}}}}}' % (AC, F))))
L.append('workers por dia e status: ' + json.dumps(gql('{viewer{accounts(filter:{accountTag:"%s"}){x: workersInvocationsAdaptive(limit:200, filter:%s, orderBy:[date_ASC]){dimensions{date status} sum{requests errors}}}}}' % (AC, F))))
L.append('mesas por hora 16-18/11: ' + json.dumps(gql('{viewer{accounts(filter:{accountTag:"%s"}){x: durableObjectsInvocationsAdaptiveGroups(limit:200, filter:{datetimeHour_geq: "2026-11-16T00:00:00Z"}, orderBy:[datetimeHour_ASC]){dimensions{datetimeHour status} sum{requests errors}}}}}' % (AC,))))
L.append('d1 por hora 16-18/11: ' + json.dumps(gql('{viewer{accounts(filter:{accountTag:"%s"}){x: d1AnalyticsAdaptiveGroups(limit:200, filter:{datetimeHour_geq: "2026-11-16T00:00:00Z"}, orderBy:[datetimeHour_ASC]){dimensions{datetimeHour} sum{rowsRead rowsWritten readQueries writeQueries}}}}}' % (AC,))))
open(OUT, 'a').write('\n'.join(L) + '\n')
