# 13/11, 5h (pedido do dono, 12/11): recupera o progresso dele, apagado quando o app foi reinstalado no iPhone.
# 1) marca o "agora" do banco; 2) volta o banco para 12/11 16:59:30 (Manaus), antes de ele usar o código no app novo;
# 3) copia o backup do progresso do aparelho que tinha o plano do código dele (só por resumo sha256);
# 4) DESFAZ a volta (sempre, mesmo se algo der errado no meio); 5) grava o backup copiado no aparelho que tem o plano agora.
# Com a trava da 3.53.23, o app dele recebe o progresso maior na próxima vez que abrir e restaura sozinho.
import json, subprocess, sys, hashlib, time, os, tempfile
OUT = sys.argv[1]
ALVO = 'd28339cc764acea631cfe899566ff1daf0c76b5e43dc888ec8e0b412a084c780'
QUANDO = '2026-11-12T20:59:30Z'
L = ['== recuperação do progresso do dono']
def tt(*a):
    r = subprocess.run(['wrangler', 'd1', 'time-travel', *a, '--json'], capture_output=True, text=True)
    try: return json.loads(r.stdout)
    except Exception: return {'erro': (r.stdout + r.stderr)[-300:]}
def q(sql):
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--json', '--command', sql], capture_output=True, text=True)
    try: return json.loads(r.stdout)[0]['results']
    except Exception: return None
def arquivo(sql):
    f = tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False); f.write(sql); f.close()
    r = subprocess.run(['wrangler', 'd1', 'execute', 'dominomanauara', '--remote', '--yes', f'--file={f.name}'], capture_output=True, text=True)
    os.unlink(f.name); return r.returncode, (r.stdout + r.stderr)[-200:]
h = lambda ap: hashlib.sha256(str(ap).encode()).hexdigest()[:8]
def do_codigo():
    for p in q('SELECT aparelho, codigo FROM planos') or []:
        if hashlib.sha256(str(p.get('codigo') or '').upper().encode()).hexdigest() == ALVO: return p['aparelho']
    return None
def resumo(d):
    try:
        nv = json.loads(d.get('dmz-nivel') or 'null') or {}; hi = json.loads(d.get('dmz-historico') or 'null') or {}; pf = json.loads(d.get('dmz-perfil') or 'null') or {}
        return f"moral {nv.get('xp')} · partidas {hi.get('jogos')} · mãos {hi.get('maos')} · avatar {pf.get('av')} · chaves {len(d)}"
    except Exception as e: return f'ilegível {e}'
agora = tt('info', 'dominomanauara').get('bookmark')
L.append(f'marcador de agora: {bool(agora)}')
copiado = None
if agora:
    r = tt('restore', 'dominomanauara', f'--timestamp={QUANDO}')
    voltar = r.get('previous_bookmark') or agora
    L.append(f"voltou para 16:59:30: {'erro' not in r} · {str(r)[:160]}")
    try:
        if 'erro' not in r:
            ap = do_codigo(); L.append(f'aparelho com o plano às 16:59: {h(ap) if ap else None}')
            if ap:
                g = q(f"SELECT dados, atualizado FROM progresso WHERE aparelho = '{ap}'") or []
                if g:
                    copiado = json.loads(g[0]['dados']); L.append(f"backup de {time.strftime('%d/%m %H:%M', time.gmtime((g[0]['atualizado'] - 4 * 3600000) / 1000))}: {resumo(copiado)}")
                else: L.append('sem backup nesse aparelho às 16:59')
    finally:
        if 'erro' not in r:
            r2 = tt('restore', 'dominomanauara', f'--bookmark={voltar}')
            L.append(f"desfez a volta: {'erro' not in r2} · {str(r2)[:160]}")
            if 'erro' in r2:   # segunda tentativa
                time.sleep(5); r3 = tt('restore', 'dominomanauara', f'--bookmark={voltar}'); L.append(f"desfez (2ª tentativa): {'erro' not in r3}")
# confere que o banco está no presente (o ranking que passou ontem está no aparelho novo)
novo = do_codigo()
rk = q("SELECT COUNT(*) AS n FROM ranking WHERE aparelho = '%s'" % novo) if novo else None
L.append(f"aparelho com o plano agora: {h(novo) if novo else None} · linhas do ranking nele: {rk}")
if copiado and novo:
    txt = json.dumps(copiado, ensure_ascii=False).replace("'", "''")
    rc, msg = arquivo(f"INSERT INTO progresso (aparelho, dados, atualizado) VALUES ('{novo}', '{txt}', {int(time.time() * 1000)}) ON CONFLICT(aparelho) DO UPDATE SET dados = excluded.dados, atualizado = excluded.atualizado;")
    L.append(f'gravou no aparelho de agora: {rc == 0} {msg if rc else ""}')
    g = q(f"SELECT dados FROM progresso WHERE aparelho = '{novo}'") or []
    if g: L.append('conferido: ' + resumo(json.loads(g[0]['dados'])))
open(OUT, 'a').write('\n'.join(L) + '\n')
