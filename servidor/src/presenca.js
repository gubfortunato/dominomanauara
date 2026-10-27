// "No app agora" (3.26): enquanto o app está aberto e na tela, ele avisa a cada minuto (e quando troca de tela) em que
// parte do jogo a pessoa está — início, partida offline, mesa online, sala de espera... O administrador vê a lista.
// Guarda o código aleatório do aparelho, o apelido, o avatar, o nível e a tela, por no máximo 1 dia. Menor de 18 entra
// só na contagem (sem apelido nem avatar).
const idOk = v => /^[a-z0-9-]{8,40}$/i.test(String(v || ''));
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// 27/10 (limite de escritas do plano grátis): o app avisa a cada 20 s, mas o banco só é escrito quando algo muda
// (tela, modo, detalhe, apelido...) ou a cada 85 s; a lista "no app agora" passa a olhar os últimos 120 s.
const REPETE_MS = 85000, JANELA_MS = 120000, ULT = new Map();
export const JANELA_PRESENCA = JANELA_MS;
const TELAS = ['who', 'home', 'setup', 'game', 'sala', 'profile', 'apoio', 'estilo', 'fale', 'anuncie', 'patro', 'instalar', 'dono', 'calcada', 'mais'];

// 3.26.2: em tempo real — o app avisa a cada 20 s e na hora em que troca de tela; ao sair do app (ou fechar), avisa
// que saiu ({saiu: true}, mandado como texto pelo sendBeacon) e some da lista na hora.
// POST /presenca {aparelho, nome, av, nv, tela, modo, detalhe, menor} ou {aparelho, saiu: true}
export async function avisar(req, env, origin, h) {
  let b; try { b = JSON.parse(await req.text()); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!b || !idOk(b.aparelho)) return h.json({ erro: 'aparelho' }, 400, origin);
  if (b.saiu) { ULT.delete(b.aparelho); try { await env.DB.prepare('UPDATE presenca SET visto_em = 0 WHERE aparelho = ?').bind(b.aparelho).run(); } catch (e) {} return h.json({ ok: true }, 200, origin); }
  const menor = !!b.menor;
  const tela = TELAS.includes(b.tela) ? b.tela : 'home';
  const modo = ['off', 'on'].includes(b.modo) ? b.modo : null;
  const vals = [b.aparelho, menor ? null : limpa(b.nome, 16) || null, menor ? null : (/^[a-z0-9_-]{1,16}$/i.test(String(b.av || '')) ? String(b.av) : null),
      Math.max(1, Math.min(50, Math.floor(Number(b.nv) || 1))), tela, modo, menor ? null : limpa(b.detalhe, 60) || null, menor ? 1 : 0, Date.now()];
  const chave = JSON.stringify(vals.slice(0, -1)), u = ULT.get(b.aparelho), agora = Date.now();
  if (u && u.k === chave && agora - u.t < REPETE_MS) return h.json({ ok: true }, 200, origin);
  if (ULT.size > 3000) ULT.clear();
  try {
    await env.DB.prepare(`INSERT INTO presenca (aparelho, nome, av, nv, tela, modo, detalhe, menor, visto_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (aparelho) DO UPDATE SET nome = excluded.nome, av = excluded.av, nv = excluded.nv, tela = excluded.tela, modo = excluded.modo,
        detalhe = excluded.detalhe, menor = excluded.menor, visto_em = excluded.visto_em`)
      .bind(...vals).run();
    ULT.set(b.aparelho, { k: chave, t: agora });
  } catch (e) {}   // banco sem escrita (limite do dia): o jogo segue; a lista do administrador fica sem esta pessoa

  return h.json({ ok: true }, 200, origin);
}
// GET /dono/presenca -> quem está com o app aberto agora (avisou nos últimos 50 s e não saiu)
export async function donoPresenca(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const { results } = await env.DB.prepare(`SELECT p.aparelho, p.nome, p.av, p.nv, p.tela, p.modo, p.detalhe, p.menor, p.visto_em,
      (SELECT 1 FROM bloqueios b WHERE b.aparelho = p.aparelho) AS bloq
    FROM presenca p WHERE p.visto_em > ? ORDER BY p.visto_em DESC LIMIT 120`).bind(Date.now() - JANELA_MS).all();
  const lista = results || [];
  // 3.26.1: quem está na entrada sem cadastro (sem apelido) entra só na contagem, como os menores
  // 3.30: quantos abriram o app nas últimas 24 h (a presença guarda 1 dia; só a contagem, sem nomes)
  const dia = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN menor THEN 1 ELSE 0 END) AS menores FROM presenca WHERE visto_em > ?').bind(Date.now() - 86400000).first();
  return h.json({ agora: lista.filter(x => !x.menor && x.nome), menores: lista.filter(x => x.menor).length,
    semCadastro: lista.filter(x => !x.menor && !x.nome).length, agoraServidor: Date.now(),
    dia: { n: (dia && dia.n) || 0, menores: (dia && dia.menores) || 0 } }, 200, origin);
}
// No agendado: some quem não aparece há mais de 1 dia
export async function limparPresenca(env) {
  await env.DB.prepare('DELETE FROM presenca WHERE visto_em < ?').bind(Date.now() - 86400000).run();
}
