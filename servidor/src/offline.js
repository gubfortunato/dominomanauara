// 04/11 (dono): trava do jogo offline. O jogo offline funciona sem internet, mas o app precisa conferir aqui pelo menos
// uma vez a cada 48 h (o "passe"): o servidor guarda quantas partidas offline o aparelho jogou hoje (dia de Brasília),
// devolve a hora certa (contra quem mexe no relógio do celular) e, para quem apagou os dados do app e voltou com outro
// código na mesma rede logo depois de bater o limite, mantém o limite (a mesma regra das mesas online).
import { limitesValem, diaBR, temPlano, marcaRede, aparelhoDesde, anotarLimite, limiteHerdado, limiteDoIrmao } from './planos.js';
import { bloqueado, pegaPeloApelido } from './bloqueio.js';
import { limitePessoa } from './pessoa.js';

const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
export const OFFLINE_POR_DIA = 5;   // o app soma +1 de quem cumpre as missões do dia

export async function conferir(req, env, origin, h) {
  const b = await req.json().catch(() => null);
  const ap = b && String(b.aparelho || '');
  if (!idOk(ap)) return h.json({ erro: 'dados' }, 400, origin);
  // 11/11 (pedido do dono: endurecer): quem está bloqueado (ou volta com outro aparelho e o mesmo apelido) fica sem o jogo
  // offline também (antes, o bloqueio era só das mesas online). Sócio continua.
  if (!(await temPlano(env, ap)) && (await bloqueado(env, ap) || await pegaPeloApelido(env, ap, b.nome))) return h.json({ erro: 'bloqueado' }, 403, origin);
  const dia = diaBR(), agora = Date.now();
  const local = b.dia === dia ? Math.max(0, Math.min(60, Number(b.n) | 0)) : 0;
  let n = local;
  try {
    await env.DB.prepare('INSERT INTO offline_uso (dia, aparelho, n) VALUES (?, ?, ?) ON CONFLICT (dia, aparelho) DO UPDATE SET n = MAX(n, excluded.n)').bind(dia, ap, local).run();
    const r = await env.DB.prepare('SELECT n FROM offline_uso WHERE dia = ? AND aparelho = ?').bind(dia, ap).first();
    n = (r && r.n) || 0;
    if (Math.random() < .03) await env.DB.prepare('DELETE FROM offline_uso WHERE dia < ?').bind(diaBR(agora - 7 * 86400000)).run();
  } catch (e) {}
  let herdou = false, pessoa = false;
  if (limitesValem(env) && !(await temPlano(env, ap))) {
    const rede = await marcaRede(req.headers.get('cf-connecting-ip'), env);
    await aparelhoDesde(env, ap);
    if (n >= OFFLINE_POR_DIA) await anotarLimite(env, rede, 'offline', ap, b.nome);
    else {
      // 12/11 (pessoa.js): o limite é por pessoa: as partidas offline dos outros aparelhos dela hoje contam junto
      const lp = await limitePessoa(env, { rede, tipo: 'offline', aparelho: ap, nome: b.nome, proprio: n, limite: OFFLINE_POR_DIA });
      if (lp.barrar) herdou = pessoa = true;
      else if (!n) herdou = await limiteHerdado(env, rede, 'offline', ap, b.nome);   // 10/11: pela rede ou pelo apelido
    }
    if (!herdou && n < OFFLINE_POR_DIA) herdou = await limiteDoIrmao(env, 'offline', ap, b.nome);   // 10/11 (desligado)
  }
  return h.json({ dia, agora, n, herdou, pessoa }, 200, origin);
}
