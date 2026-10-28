// Mesa online do Dominó Manauara: um Durable Object por mesa (código de 5 números).
// O servidor guarda as pedras e aplica as regras; cada celular só recebe a própria mão.
// Cadeiras vazias viram robôs da turma do bairro; quem cai da internet tem o lugar guardado
// e, se demorar na vez dele, um robô joga por ele até voltar.
// Mesa rápida: um objeto à parte (nome "fila") junta quem quer jogar com qualquer um. As mesas públicas
// começam sozinhas depois de uma espera curta (robôs nas cadeiras vazias) e quem chega depois entra no lugar de um robô.
import { newGame, startHand, legalMoves, applyMove, applyPass, nextHand, botChoose, reacaoRobo, tkey, nomeOfensivo, BOT_NAMES, pedirPonto } from './motor.js';
import { nivelDoador, cortesiaDe } from './pagamentos.js';
import { fotoPublica } from './fotos.js';
import { pontuar, nomeDaTurma, apelido as apelidoNaTurma } from './turmas.js';
import { somarVivo } from './vivo.js';
import { somarRanking, reiDaSemana } from './ranking.js';
import { bloqueado, visto, apelidoBarrado, exigeApp, appAberto, anotarRitmo, RAPIDA_MS } from './bloqueio.js';
// 3.38.2: na Calçada, apelido que o filtro passou a barrar (de quem entrou antes) aparece como "Jogador"
const nomeVisivel = c => !c.bot && nomeOfensivo(c.nome) ? 'Jogador' : c.nome;

const TEMPO = {
  jogada: 4500,      // robô: espera antes de jogar (igual ao jogo offline)
  torneio: 20000,    // modo torneio: tempo de cada jogada; passou, o robô joga pela pessoa
  vez: 20000,        // 3.41 (pedido do dono): toda jogada online tem 20 s, com o relógio à vista; passou, o robô joga pela pessoa
  passe: 3000,       // robô: espera antes de passar
  semPedra: 2600,    // pessoa sem pedra que encaixe: passa sozinha
  distribuir: 4300,  // tempo da animação de embaralhar e distribuir no celular
  ausente: 25000,    // pessoa sem conexão: o robô joga por ela depois disso
  largou: 90000,     // 28/10: sem conexão por 1 min e meio no meio do jogo: um robô da turma entra no lugar (com aviso)
  conferir: 60000,   // vez de uma pessoa conectada: confere de novo se ela continua lá
  espera: 20000,     // mesa rápida: espera por mais gente antes de começar com robôs
  cheia: 2500,       // mesa rápida completa: começa logo (dá tempo de ver quem sentou)
  sentaRobo: 5000,   // (mesas abertas antes da troca) faltando 5 s, a turma começa a sentar
  entreRobos: 1300,  // (mesas abertas antes da troca) intervalo entre um robô e outro
  vazia: 180000      // 3.25: fim de mão sem nenhuma pessoa conectada: espera 3 min e encerra a mesa
};
const FILA = { mesas: 20, idade: 60 * 60 * 1000 };   // mesas rápidas lembradas pela fila e por quanto tempo
// 28/10: quadro das mesas na fila: vale 30 min sem notícia, some depois de 3 h, até 80 mesas; a mesa repete a cada 5 min jogando
const QUADRO = { validade: 30 * 60000, guarda: 3 * 3600000, max: 80, renova: 5 * 60000 };
const SILENCIO = 50000;
const REACAO = { intervalo: 2000, porMinuto: 8, maior: 23 };   // reações: só o número de uma frase pronta, nunca texto              // sem sinal do celular há 50 s: conta como desconectado
const VIDA = 24 * 60 * 60 * 1000;    // a mesa some 24 h depois da última ação
const ASSISTIR_MAX = 30;           // 3.28: quantas pessoas podem assistir a mesma mesa

// Mesa (tema) escolhida por quem criou: todo mundo joga nela. Só o nome curto (madeira, ponte, teatro...).
// Nível do jogador (1 a 50, vem do aparelho; não muda nada no jogo, só aparece no cartão). Robô ganha um nível
// parecido com o de gente: quase sempre baixo ou médio, às vezes alto.
const nivelOk = v => { const n = Math.floor(Number(v)); return n >= 1 && n <= 50 ? n : 1; };
const nivelRobo = () => 1 + Math.floor(Math.pow(Math.random(), 1.8) * 24);
const temaOk = v => typeof v === 'string' && /^[a-z][a-z0-9]{2,15}$/.test(v) ? v : null;   // manaus357 tem número
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

// Ranking (3.29; 3.37): quem conta na partida que acabou — só quem jogou a partida inteira (sem robô no lugar). Para os
// pontos (3.37), "gente" diz se tinha pelo menos uma pessoa do outro lado que também jogou a partida inteira, e
// "oponente" é o código dela (o menor, se forem duas), para o limite de partidas por dia contra a mesma pessoa.
export function quemContaNoRanking(m, vencedor) {
  const inteiro = p => { const c = m.cad[p]; return !!(c && !c.bot && !c.saiu && c.id && m.naPartida && m.naPartida[p] === c.id && !(m.robo && m.robo.partida[p])); };
  const quem = [];
  m.cad.forEach((c, p) => {
    if (!inteiro(p)) return;
    const ops = [0, 1, 2, 3].filter(q => q % 2 !== p % 2 && inteiro(q)).map(q => m.cad[q].id).sort();
    quem.push({ id: c.id, nome: c.nome, av: c.av, nv: c.nv, menor: !!c.menor, ganhou: p % 2 === vencedor, gente: ops.length > 0, oponente: ops[0] || null });
  });
  return quem;
}
export class Mesa {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.m = null; this.reacoes = {};
    // TEMPO_FATOR só existe no teste local (acelera os robôs); no Cloudflare vale 1
    const f = Number(env && env.TEMPO_FATOR) || 1;
    this.cacheVivo = Number(env && env.CACHE_VIVO_MS) || Math.max(3000, 15000 * Math.min(1, f));   // 27/10: lista das mesas guardada por 15 s (no teste, menos)
    this.T = Object.fromEntries(Object.entries(TEMPO).map(([k, v]) => [k, v * f]));
    this.T.vez = TEMPO.vez * (Number(env && env.VEZ_FATOR) || 1);   // 3.41: nos testes, os 20 s da vez só encurtam com VEZ_FATOR
    // "ping" responde sozinho, sem acordar a mesa (economiza)
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) {}
    ctx.blockConcurrencyWhile(async () => { this.m = (await ctx.storage.get('m')) || null; });
  }

  // ---------- Entrada HTTP (chamada pelo Worker) ----------
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/criar' && req.method === 'POST') return this.criar(await req.json());
    if (url.pathname === '/reservar' && req.method === 'POST') return this.reservar(await req.json());
    if (url.pathname === '/fila' && req.method === 'POST') return this.naFila(await req.json());
    if (url.pathname === '/fila/status') return Response.json(await this.statusFila());
    if (url.pathname === '/fila/vivo') return Response.json(await this.mesasAoVivo(!!url.searchParams.get('todas')));
    if (url.pathname === '/fila/ativa' && req.method === 'POST') return Response.json(await this.mesaAtiva(await req.json()));
    if (url.pathname === '/expulsar' && req.method === 'POST') return Response.json(await this.expulsar(await req.json()));
    if (url.pathname === '/info' && url.searchParams.get('vivo')) return Response.json(this.infoVivo());
    if (url.pathname === '/info') {
      const m = this.viva();
      return Response.json(m ? { existe: true, fase: m.fase, publica: !!m.publica, humanos: m.cad.filter(c => c && !c.bot).length, livres: m.cad.filter(c => !c || (c.bot && !c.saiu)).length } : { existe: false });
    }
    if ((req.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
      const par = new WebSocketPair();
      const [cli, srv] = Object.values(par);
      this.aceitar(srv);
      return new Response(null, { status: 101, webSocket: cli });
    }
    return new Response('nao-encontrado', { status: 404 });
  }
  aceitar(ws) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ id: null, visto: Date.now() });
  }
  viva() { return this.m && this.m.ultimo > Date.now() - VIDA ? this.m : null; }

  async criar(b) {
    if (this.viva()) return Response.json({ erro: 'ocupado' }, { status: 409 });
    const quem = this.pessoa(b);
    if (!quem) return Response.json({ erro: 'dados' }, { status: 400 });
    const agora = Date.now();
    this.m = { codigo: limpa(b.codigo, 5), criada: agora, ultimo: agora, fase: 'espera', seq: 0, dono: quem.id,
      cad: [quem, null, null, null], G: null, proximo: null, turnoDesde: agora, porRobo: null,
      publica: !!b.publica, iniciaEm: b.publica ? agora + this.T.espera : null };
    if (this.m.publica) this.m.chegadas = this.sortearChegadas(this.m.iniciaEm);
    if (this.m.publica) this.agendar();
    await this.salvar();
    return Response.json({ ok: true }, { status: 201 });
  }

  // ---------- Mesa rápida ----------
  // A fila (um objeto só, de nome "fila") procura uma mesa pública esperando gente; se não houver, uma já começada
  // com robô para trocar por gente; se não houver, cria uma nova. Um pedido de cada vez, para ninguém sentar duas vezes.
  naFila(b) {
    const vez = (this.filaVez || Promise.resolve()).then(() => this.procurarMesa(b));
    this.filaVez = vez.catch(() => {});
    return vez.catch(() => Response.json({ erro: 'tente-de-novo' }, { status: 503 }));
  }
  async procurarMesa(b) {
    const quem = this.pessoa(b);
    if (!quem) return Response.json({ erro: 'dados' }, { status: 400 });
    const agora = Date.now();
    let l = ((await this.ctx.storage.get('abertas')) || []).filter(x => agora - x.criada < FILA.idade);
    const mesa = cod => this.env.MESA.get(this.env.MESA.idFromName(cod));
    const fim = async (codigo, nova) => { await this.ctx.storage.put('abertas', l.slice(0, FILA.mesas)); return Response.json({ codigo, nova }, { status: nova ? 201 : 200 }); };
    // 28/10: pelo quadro, pula a mesa que acabou ou que não serve agora (a não ser que a pessoa já esteja nela)
    const q = await this.quadro(), acabaram = this.acabaram || new Set();
    l = l.filter(x => !acabaram.has(x.codigo));
    const naoServe = (x, so) => {
      const e = q.get(x.codigo), j = e && e.resumo;
      if (!j || agora - e.t >= QUADRO.validade || (Array.isArray(j.ids) && j.ids.includes(String(b.id || '')))) return false;
      return j.fase !== so || !j.publica || !(so === 'espera' ? j.vagaEspera : j.vagaJogo);
    };
    for (const so of ['espera', 'jogo']) {
      for (const x of l.slice()) {
        if (naoServe(x, so)) continue;
        const r = await mesa(x.codigo).fetch('https://mesa/reservar', { method: 'POST', body: JSON.stringify(Object.assign({}, b, { so })) });
        if (r.status === 200) return fim(x.codigo, false);
        if (r.status === 410) l = l.filter(y => y.codigo !== x.codigo);   // acabou ou não serve mais
      }
    }
    for (let k = 0; k < 8; k++) {
      const codigo = String(10000 + Math.floor(Math.random() * 90000));
      const r = await mesa(codigo).fetch('https://mesa/criar', { method: 'POST', body: JSON.stringify({ id: b.id, nome: b.nome, av: b.av, bairro: b.bairro, nv: b.nv, codigo, publica: true }) });
      if (r.status === 201) { l.unshift({ codigo, criada: agora }); return fim(codigo, true); }
      if (r.status === 400) return Response.json({ erro: 'dados' }, { status: 400 });
    }
    return Response.json({ erro: 'tente-de-novo' }, { status: 503 });
  }
  // Quantas pessoas estão numa mesa rápida com lugar sobrando (esperando gente ou jogando com robô).
  // Só números, sem nome de ninguém; guardado por alguns segundos para não acordar as mesas a cada pergunta.
  async statusFila() {
    // 28/10: sai do quadro (cada mesa conta à fila como está); antes, a fila perguntava a cada mesa
    const agora = Date.now(), q = await this.quadro();
    const l = ((await this.ctx.storage.get('abertas')) || []).filter(x => agora - x.criada < FILA.idade);
    let pessoas = 0, mesas = 0, esperando = 0;
    for (const x of l) {
      const e = q.get(x.codigo), j = e && agora - e.t < QUADRO.validade ? e.resumo : null;
      if (!j || !j.publica || !(j.livres > 0) || !(j.humanos > 0)) continue;
      pessoas += j.humanos; mesas++; if (j.fase === 'espera') esperando += j.humanos;
    }
    return { pessoas, mesas, esperando };
  }
  // 28/10: o quadro — o que cada mesa contou por último (fica na memória e no armazenamento da fila)
  async quadro() {
    if (!this.quadroMem) {
      const mapa = new Map();
      try { const l = await this.ctx.storage.list({ prefix: 'q:' }); for (const [k, v] of l) mapa.set(k.slice(2), v); } catch (e) {}
      this.quadroMem = new Map([...mapa.values()].sort((a, b) => a.t - b.t).map(v => [v.codigo, v]));
    }
    return this.quadroMem;
  }
  // 3.25: "Agora na calçada" — as mesas rápidas que estão jogando agora com pelo menos uma pessoa de verdade conectada
  // (mesa só de robôs não aparece). Só mesas públicas (as com os amigos são por convite e não aparecem).
  // 3.26.3: toda mesa em jogo se registra aqui, mesmo as com os amigos. A lista para os jogadores mostra só as mesas
  // rápidas; o administrador vê todas. 28/10: cada mesa manda junto como está (o quadro); a mesa que acabou avisa.
  async mesaAtiva(b) {
    const codigo = String((b && b.codigo) || ''); if (!/^\d{5}$/.test(codigo)) return { ok: false };
    const agora = Date.now(), q = await this.quadro();
    this.acabaram = this.acabaram && this.acabaram.size < 300 ? this.acabaram : new Set();
    if (b.fim) {
      q.delete(codigo); this.acabaram.add(codigo);
      try { await this.ctx.storage.delete('q:' + codigo); } catch (e) {}
      return { ok: true };
    }
    const v = { codigo, publica: !!b.publica, t: agora, info: b.info || null, resumo: b.resumo || null };
    q.delete(codigo); q.set(codigo, v); this.acabaram.delete(codigo);   // a mais recente fica por último
    const fora = [];
    for (const x of q.values()) if (agora - x.t > QUADRO.guarda) fora.push(x.codigo);
    let sobra = q.size - fora.length - QUADRO.max;
    for (const x of q.values()) { if (sobra <= 0) break; if (!fora.includes(x.codigo)) { fora.push(x.codigo); sobra--; } }
    for (const c of fora) q.delete(c);
    try { await this.ctx.storage.put('q:' + codigo, v); if (fora.length) await this.ctx.storage.delete(fora.map(c => 'q:' + c)); } catch (e) {}
    return { ok: true };
  }
  async mesasAoVivo(todas) {
    const agora = Date.now(), q = await this.quadro();
    const l = [...q.values()].filter(x => x.info && agora - x.t < QUADRO.validade).reverse();   // a que deu notícia por último primeiro
    let mesas = [];
    for (const x of l) {
      const j = x.info;
      if (todas && j && j.existe && j.fase !== 'jogo' && j.on > 0) mesas.push(Object.assign({ codigo: x.codigo }, j, { espera: true }));
      else if (j && j.existe && j.fase === 'jogo' && j.on > 0) {
        if (todas) mesas.push(Object.assign({ codigo: x.codigo }, j));
        // 3.27: a lista pública (aba Calçada) não leva o bairro de ninguém
        else if (j.publica) mesas.push(Object.assign({ codigo: x.codigo }, j, { cad: (j.cad || []).map(c => c ? Object.assign({}, c, { bairro: null, menor: undefined }) : c) }));
        // 3.27: mesa com os amigos sem número da mesa (só entra e assiste quem tem o número).
        // 3.37.1 (pedido do dono): aparece o apelido, o avatar desenhado e o nível de quem está jogando — menos de quem
        // tem menos de 18 anos, que continua só na conta ("1 pessoa"); robô continua sem nome
        else mesas.push({ publica: false, existe: true, fase: 'jogo', tema: j.tema || null, on: j.on, livres: 0,
          cad: (j.cad || []).map(c => !c ? null : c.bot || c.menor ? { bot: !!c.bot, tipo: c.tipo } : { nome: c.nome, bot: false, av: c.av || null, nv: c.nv || 1, tipo: c.tipo }),
          partida: j.partida, mao: j.mao, placar: j.placar,
          lance: j.lance ? { type: j.lance.type, pts: j.lance.pts, carroca: j.lance.carroca, voided: j.lance.voided } : null });
      }
      if (mesas.length >= 16) break;
    }
    // primeiro as mesas rápidas com lugar vago (dá para entrar), depois as rápidas cheias, depois as com os amigos
    const ordem = v => v.espera ? 3 : v.publica ? (v.livres > 0 ? 0 : 1) : 2;   // as da sala (só o administrador vê) por último
    mesas = mesas.map((v, i) => [v, i]).sort((a, b) => ordem(a[0]) - ordem(b[0]) || a[1] - b[1]).map(x => x[0]).slice(0, todas ? 16 : 10);
    return { mesas };
  }
  // 28/10: a mesa conta à fila como está — só quando muda o que a lista mostra (quem está, conexão, placar), ou a cada
  // 5 min jogando. Antes, a fila perguntava a cada mesa a cada 15 s: eram 2 de cada 3 pedidos das mesas no Cloudflare.
  resumoFila(m) {
    return { fase: m.fase, publica: !!m.publica, humanos: m.cad.filter(c => c && !c.bot).length,
      livres: m.cad.filter(c => !c || (c.bot && !c.saiu)).length,
      vagaEspera: m.cad.some(c => !c || c.bot), vagaJogo: m.cad.some(c => c && c.bot),
      ids: m.cad.filter(c => c && (c.id || c.lugarDe)).map(c => c.id || c.lugarDe) };   // só para a fila saber quem volta para a própria mesa
  }
  async contarAFila(fim) {
    const m = this.m, codigo = m && m.codigo;
    if (!codigo || !/^\d{5}$/.test(codigo)) return;
    let corpo;
    if (fim) corpo = { codigo, fim: true };
    else {
      if (!this.viva()) return;
      const info = this.infoVivo(), resumo = this.resumoFila(m);
      const sig = JSON.stringify([resumo, info.fase, info.on, info.livres, info.cad, info.placar, info.tema]);
      if (sig === this.sigFila && Date.now() - (this.tFila || 0) < QUADRO.renova) return;
      this.sigFila = sig; this.tFila = Date.now();
      corpo = { codigo, publica: !!m.publica, info, resumo };
    }
    // um aviso de cada vez e na ordem, sem a mesa esperar a fila (a fila pode estar esperando esta mesa, na mesa rápida)
    this.stubFila = this.stubFila || this.env.MESA.get(this.env.MESA.idFromName('fila'));
    const corpoTx = JSON.stringify(corpo);
    this.envioFila = (this.envioFila || Promise.resolve()).then(async () => {
      try { const r = await this.stubFila.fetch('https://mesa/fila/ativa', { method: 'POST', body: corpoTx }); if (!r.ok) this.sigFila = null; }
      catch (e) { this.sigFila = null; }   // não deu: tenta de novo na próxima mudança
    });
  }
  async registrarAtiva() { await this.contarAFila(); }
  infoVivo() {
    const m = this.viva();
    if (!m) return { existe: false, fase: null };
    if (!m.G) return { existe: true, fase: m.fase, publica: !!m.publica, tema: m.tema || null,   // 3.35: sala, antes da 1ª partida
      on: m.cad.filter((c, p) => c && !c.bot && this.conectado(p)).length, livres: 0,
      cad: m.cad.map((c, p) => c ? { nome: nomeVisivel(c), bot: !!c.bot, av: c.bot ? null : c.av || null, tipo: c.bot ? 'robo' : this.conectado(p) ? 'pessoa' : 'fora', nv: c.bot ? null : c.nv || 1, bairro: null } : null),
      partida: 0, mao: 0, criada: m.criada || null, placar: [0, 0], lance: null };
    const G = m.G, evs = G.events || [];
    const ev = ['galo', 'batida', 'play', 'pass'].map(t => evs.find(e => e.type === t)).find(Boolean) || null;
    return { existe: true, fase: m.fase, publica: !!m.publica, tema: m.tema || null,
      on: m.cad.filter((c, p) => c && !c.bot && this.conectado(p)).length,
      livres: m.cad.filter(c => c && c.bot).length,
      // 3.25.1: quem é quem na cadeira — pessoa conectada, pessoa sem conexão (o robô joga por ela na vez), quem saiu
      // (o robô ficou no lugar) e robô da turma
      cad: m.cad.map((c, p) => c ? { nome: nomeVisivel(c), bot: !!c.bot, av: c.bot ? null : c.av || null,
        tipo: c.bot ? (c.saiu ? 'saiu' : 'robo') : this.conectado(p) ? 'pessoa' : 'fora',
        nv: c.bot ? null : c.nv || 1, bairro: c.bot ? null : c.bairro || null, menor: !c.bot && !!c.menor } : null),
      partida: G.partida || 1, mao: G.handNo || 1, criada: m.criada || null,
      placar: G.score, lance: ev ? { type: ev.type, p: ev.p, pts: ev.pts || 0, carroca: !!ev.carroca, voided: !!ev.voided } : null };
  }

  // Senta alguém da fila numa mesa pública (200), ou diz que não deu agora (409) ou que a mesa não serve mais (410)
  async reservar(b) {
    const m = this.viva();
    if (!m || !m.publica) return Response.json({ erro: 'nao' }, { status: 410 });
    const quem = this.pessoa(b);
    if (!quem) return Response.json({ erro: 'dados' }, { status: 400 });
    if (await bloqueado(this.env, quem.id)) return Response.json({ erro: 'bloqueado' }, { status: 403 });
    if (await apelidoBarrado(this.env, quem.id, quem.nome)) return Response.json({ erro: 'apelido' }, { status: 403 });   // 3.41
    let p = m.cad.findIndex(c => c && c.id === quem.id);
    if (p >= 0) {
      const c = m.cad[p];
      if (c.saiu) { c.saiu = false; c.bot = false; }
    } else if (m.fase === 'espera') {
      if (b.so !== 'espera') return Response.json({ erro: 'cheia' }, { status: 409 });
      // o segundo senta de adversário, o terceiro de parceiro do primeiro, o quarto completa
      p = this.cadeiraNaEspera();
      if (p == null) return Response.json({ erro: 'cheia' }, { status: 409 });
      quem.nome = this.nomeUnico(quem.nome, p);
      m.cad[p] = quem;
      if (m.cad.every(c => c && !c.bot)) m.iniciaEm = Math.min(m.iniciaEm || Infinity, Date.now() + this.T.cheia);
    } else {
      if ((p = this.voltarAoLugar(quem)) < 0) {   // 28/10: quem volta retoma a cadeira que o robô guardava
        if (b.so !== 'jogo') return Response.json({ erro: 'cheia' }, { status: 409 });
        // na mesa rápida, quem saiu de vez libera a cadeira (o robô que estava no lugar dá a vez)
        p = m.cad.findIndex(c => c && c.bot && !c.lugarDe);
        if (p < 0) p = m.cad.findIndex(c => c && c.bot);
        if (p < 0) return Response.json({ erro: 'cheia' }, { status: 409 });
        quem.nome = this.nomeUnico(quem.nome, p);
        m.cad[p] = quem; m.G.names[p] = quem.nome;
      }
    }
    m.ultimo = Date.now();
    this.agendar();
    await this.salvar(); this.espalhar();
    return Response.json({ ok: true }, { status: 200 });
  }
  // Mesa rápida na hora de começar: quem reservou e não apareceu sai; sem ninguém, a mesa acaba
  async comecarPublica() {
    const m = this.m;
    m.cad = m.cad.map((c, p) => c && !c.bot && !this.conectado(p) ? null : c);
    const humanos = m.cad.filter(c => c && !c.bot);
    if (!humanos.length) { await this.apagar(); return; }
    if (!humanos.some(c => c.id === m.dono)) m.dono = humanos[0].id;
    return this.comecar();
  }
  // Valida quem chega: código do aparelho, apelido (filtrado) e avatar.
  pessoa(b) {
    const id = String((b && b.id) || '');
    if (!/^[a-z0-9-]{8,40}$/i.test(id)) return null;
    let nome = limpa(b.nome, 16);
    const ruim = nome.length >= 2 && nomeOfensivo(nome);   // 3.38.2: entra como "Jogador" e, no fim da partida, sai para trocar o apelido
    if (nome.length < 2 || ruim) nome = 'Jogador';
    const av = /^[a-z0-9_-]{1,16}$/i.test(String(b.av || '')) ? String(b.av) : null;
    let bairro = limpa(b.bairro, 28);
    if (bairro.length < 2 || nomeOfensivo(bairro)) bairro = null;
    return { id, nome, av, bairro, nv: nivelOk(b.nv), bot: false, saiu: false, menor: !!b.menor, apelidoRuim: ruim };
  }

  // ---------- Mensagens dos celulares ----------
  async webSocketMessage(ws, data) {
    if (data === 'ping') { try { ws.send('pong'); } catch (e) {} return; }
    let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    const att = ws.deserializeAttachment() || {};
    att.visto = Date.now(); ws.serializeAttachment(att);
    const m = this.viva();
    if (!m) { this.enviar(ws, { t: 'erro', cod: 'nao-existe' }); try { ws.close(4004, 'nao-existe'); } catch (e) {} return; }
    const p = att.id ? m.cad.findIndex(c => c && c.id === att.id) : -1;
    switch (msg.t) {
      case 'entrar': return this.entrar(ws, att, msg);
      case 'assistir': return this.assistir(ws, att);
      case 'sentar': if (p >= 0) return this.sentar(p, msg.cadeira); return;
      case 'comecar': if (p >= 0) return m.publica ? this.comecarPublica() : this.comecarAmigos(ws); return;
      case 'jogar': if (p >= 0) return this.jogar(ws, p, msg); return;
      case 'proxima': if (p >= 0) return this.proxima(msg); return;
      case 'sair': if (p >= 0) return this.sair(ws, p); return this.sairDaFila(ws, att.id);
      case 'reacao': if (p >= 0) return this.reagir(p, msg.k); return;
      case 'mesa': if (p >= 0 && m.cad[p].id === m.dono) return this.trocarTema(msg.id); return;
      case 'torneio': if (p >= 0 && m.cad[p].id === m.dono) return this.ligarTorneio(msg.on); return;
      case 'ponto': if (p >= 0) return this.pontoPedido(p); return;
    }
  }
  async webSocketClose(ws) { await this.mudouConexao(ws); }
  async webSocketError(ws) { await this.mudouConexao(ws); }
  async mudouConexao(ws) {
    try { ws.close(1000, 'tchau'); } catch (e) {}
    const m = this.viva(); if (!m) return;
    if (m.fase === 'jogo') { this.agendar(); await this.salvar(); }
    this.espalhar(ws);
  }

  // Selo na mesa: ★ para quem tem o plano, ♥ / ♥♥ / ♥♥♥ para quem doou
  async apoiador(id) {
    try {
      const p = await this.env.DB.prepare('SELECT ate FROM planos WHERE aparelho = ?').bind(id).first();
      const d = await this.env.DB.prepare("SELECT COALESCE(SUM(valor), 0) AS t FROM pedidos WHERE aparelho = ? AND status = 'pago'").bind(id).first();
      let foto = null; try { foto = await fotoPublica(this.env, id); } catch (e) {}
      let turma = null; try { turma = await nomeDaTurma(this.env, id); } catch (e) {}
      let ct = null; try { ct = await cortesiaDe(this.env, id); } catch (e) {}
      let rei = false; try { const k = await reiDaSemana(this.env); rei = !!(k && k.aparelho === id); } catch (e) {}   // 3.37: coroa do Rei da Calçada
      return { apoiador: !!(p && p.ate > Date.now()), doador: Math.max(nivelDoador((d && d.t) || 0), (ct && ct.nivel) || 0), foto, turma, rei };
    } catch (e) { return { apoiador: false, doador: 0, foto: null, turma: null, rei: false }; }
  }
  async entrar(ws, att, msg) {
    const m = this.m;
    const quem = this.pessoa(msg);
    if (!quem) return this.enviar(ws, { t: 'erro', cod: 'dados' });
    att.apelido = !!msg.apelido;   // 3.38.2: este app entende o aviso 'apelido' (escolher outro apelido)
    if (await bloqueado(this.env, quem.id)) return this.recusar(ws, 'bloqueado');
    // 3.41: o administrador pediu outro apelido e a pessoa voltou com o mesmo (app antigo: 'nao-existe', volta ao início)
    if (await apelidoBarrado(this.env, quem.id, quem.nome)) return this.recusar(ws, att.apelido ? 'apelido' : 'nao-existe');
    // 3.41: quem chega agora (não estava sentado nem na fila) precisa estar com o app aberto
    const jaEstava = m.cad.some(c => c && c.id === quem.id) || (m.fila || []).some(c => c.id === quem.id);
    if (!jaEstava && exigeApp(this.env) && !(await appAberto(this.env, quem.id))) { await anotarRitmo(this.env, quem.id, { semApp: 1 }); return this.recusar(ws, 'app'); }
    Object.assign(quem, await this.apoiador(quem.id));
    try { await apelidoNaTurma(this.env, quem.id, quem.nome); } catch (e) {}
    let p = m.cad.findIndex(c => c && c.id === quem.id);
    const f = (m.fila || []).findIndex(c => c.id === quem.id);
    if (p < 0 && f >= 0) {
      // já estava na fila (voltou): continua esperando a vez
      Object.assign(m.fila[f], { apoiador: quem.apoiador, doador: quem.doador, foto: quem.foto, turma: quem.turma, nv: quem.nv, rei: quem.rei });
      att.id = quem.id; ws.serializeAttachment(att);
      m.ultimo = Date.now(); await this.salvar(); this.espalhar();
      return;
    }
    if (p >= 0) {
      // voltou (ou abriu em outro aparelho): retoma a cadeira; se tinha saído, volta a jogar
      const c = m.cad[p];
      if (m.fase === 'espera') { c.nome = quem.nome; c.av = quem.av; c.bairro = quem.bairro; }
      c.apoiador = quem.apoiador; c.doador = quem.doador; c.foto = quem.foto; c.turma = quem.turma; c.nv = quem.nv; c.menor = quem.menor; c.rei = quem.rei; c.apelidoRuim = quem.apelidoRuim;
      if (c.saiu) { c.saiu = false; c.bot = false; }
    } else if (m.fase === 'espera') {
      p = this.cadeiraNaEspera();
      if (p == null) return (m.publica || !msg.fila) ? this.recusar(ws, 'cheia') : this.entrarNaFila(ws, att, quem);
      quem.nome = this.nomeUnico(quem.nome, p);
      m.cad[p] = quem;
    } else if ((p = this.voltarAoLugar(quem)) >= 0) {
      // 28/10: voltou: retoma a cadeira que o robô da turma guardava
    } else {
      // jogo já começou: entra no lugar de um robô da turma, se houver (na mesa rápida, também no de quem saiu de vez)
      // 28/10: primeiro o de um robô que não guarda lugar de ninguém
      p = m.cad.findIndex(c => c && c.bot && !c.saiu && !c.lugarDe);
      if (p < 0) p = m.cad.findIndex(c => c && c.bot && !c.saiu);
      if (p < 0 && m.publica) p = m.cad.findIndex(c => c && c.bot);
      if (p < 0) return (m.publica || !msg.fila) ? this.recusar(ws, 'cheia') : this.entrarNaFila(ws, att, quem);
      quem.nome = this.nomeUnico(quem.nome, p);
      m.cad[p] = quem; m.G.names[p] = quem.nome;
    }
    att.id = quem.id; ws.serializeAttachment(att);
    try { await visto(this.env, quem, m.codigo); } catch (e) {}
    if (!m.dono || !m.cad.some(c => c && c.id === m.dono && !c.bot)) m.dono = quem.id;
    // a mesa de quem criou vale para todos (até ele trocar)
    if (!m.tema && m.dono === quem.id && temaOk(msg.mesa)) m.tema = msg.mesa;
    m.ultimo = Date.now();
    if (m.fase === 'jogo') this.agendar();
    await this.salvar();
    this.espalhar();
    // 3.35: avisa a lista também na sala (antes de começar): o administrador vê quem está esperando
    await this.registrarAtiva();
  }
  // ---------- Assistir (3.28) ----------
  // Quem tem o número da mesa (mesa rápida: pela Calçada) pode assistir: recebe a mesa como quem está na fila — o
  // tabuleiro, o placar e os nomes, nunca a mão de ninguém (só no fim da mão, como todo mundo). Não ocupa cadeira, não
  // conta como gente na mesa (a mesa sem ninguém jogando acaba do mesmo jeito) e não manda nada para o jogo.
  assistir(ws, att) {
    const m = this.m;
    if (att.id) return;   // quem já está na mesa ou na fila já recebe tudo
    const n = this.ctx.getWebSockets().filter(w => (w.deserializeAttachment() || {}).assiste).length;
    if (n >= ASSISTIR_MAX) return this.recusar(ws, 'plateia-cheia');
    att.assiste = true; ws.serializeAttachment(att);
    this.enviar(ws, this.vista(null));
    this.espalhar(ws);   // quem está jogando vê que tem gente assistindo
  }
  quantosAssistem() {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) { if (ws.readyState != null && ws.readyState !== 1) continue; if ((ws.deserializeAttachment() || {}).assiste) n++; }
    return n;
  }
  // ---------- Ganha-chama (mesa com os amigos) ----------
  // Mesa cheia: quem chega (com app que já mostra a fila: msg.fila) entra na fila e espera. No fim de cada partida, a dupla que perdeu vai para o fim da fila
  // e entram os primeiros da fila; a dupla que ganhou fica ("quem come jaraqui não sai mais daqui").
  async entrarNaFila(ws, att, quem) {
    const m = this.m; m.fila = m.fila || [];
    if (m.fila.length >= 8) return this.recusar(ws, 'cheia');
    quem.nome = this.nomeUnico(quem.nome, -1);
    m.fila.push(quem);
    att.id = quem.id; ws.serializeAttachment(att);
    m.ultimo = Date.now(); await this.salvar(); this.espalhar();
  }
  async sairDaFila(ws, id) {
    const m = this.m, f = id ? (m.fila || []).findIndex(c => c.id === id) : -1;
    if (f < 0) return;
    m.fila.splice(f, 1);
    const att = ws.deserializeAttachment() || {}; att.id = null; ws.serializeAttachment(att);
    try { ws.close(1000, 'saiu'); } catch (e) {}
    m.ultimo = Date.now(); await this.salvar(); this.espalhar();
  }
  // Pessoa conectada (pelo código do aparelho), para a fila não chamar quem não está mais no celular
  conectadoId(id) {
    const agora = Date.now();
    return this.ctx.getWebSockets().some(ws => {
      if (ws.readyState != null && ws.readyState !== 1) return false;
      const a = ws.deserializeAttachment() || {};
      if (a.id !== id) return false;
      let visto = a.visto || 0;
      try { const t = this.ctx.getWebSocketAutoResponseTimestamp(ws); if (t) visto = Math.max(visto, +t); } catch (e) {}
      return agora - visto < SILENCIO;
    });
  }
  // Troca no fim da partida: devolve true se alguém entrou
  ganhaChama(w) {
    const m = this.m, fila = m.fila || [], voltam = [], sairam = [], entraram = [];
    for (const p of [0, 1, 2, 3].filter(k => k % 2 !== w)) {
      const i = fila.findIndex(c => this.conectadoId(c.id));
      if (i < 0) break;
      const c = m.cad[p];
      if (c && !c.bot && c.id) { voltam.push(Object.assign(c, { saiu: false, bot: false })); sairam.push(c.nome); }
      const novo = fila.splice(i, 1)[0];
      m.cad[p] = null; novo.nome = this.nomeUnico(novo.nome, p);
      m.cad[p] = novo; entraram.push(novo.nome);
    }
    if (!entraram.length) return false;
    fila.push(...voltam); m.fila = fila;
    // quem criou foi para a fila: quem ficou na mesa passa a mandar nela
    if (!m.cad.some(c => c && c.id === m.dono)) { const h = m.cad.find(c => c && !c.bot && c.id); if (h) m.dono = h.id; }
    const torneio = m.G.torneio;
    m.G = newGame(m.cad.map(c => c.nome)); m.G.torneio = torneio; startHand(m.G); m.robo = null; this.inicioDePartida();
    m.troca = { seq: m.seq + 1, entraram, sairam, ficam: [0, 1, 2, 3].filter(k => k % 2 === w).map(k => m.cad[k].nome) };
    return true;
  }
  // Modo torneio: quem criou a mesa liga na sala (não vale na mesa rápida)
  async ligarTorneio(on) {
    const m = this.m;
    if (m.fase !== 'espera' || m.publica || !!m.torneio === !!on) return;
    m.torneio = !!on; m.ultimo = Date.now();
    await this.salvar(); this.espalhar();
  }
  // Pedir ponto: não muda a vez (nem o relógio de quem está jogando)
  async pontoPedido(p) {
    const m = this.m, G = m.G;
    if (m.fase !== 'jogo' || !G || !G.pedirPonto || G.phase !== 'play') return;
    pedirPonto(G, p);
    m.seq++; m.ultimo = Date.now();
    this.agendar(); await this.salvar(); this.espalhar();
  }
  async trocarTema(id) {
    const m = this.m, t = temaOk(id);
    if (!t || t === m.tema) return;
    m.tema = t; m.ultimo = Date.now();
    await this.salvar(); this.espalhar();
  }
  // Na espera: o segundo senta de adversário, o terceiro de parceiro do primeiro, o quarto completa.
  // Se um robô da turma já sentou nessa cadeira (mesa rápida), a pessoa fica com ela.
  cadeiraNaEspera() {
    const m = this.m;
    return [1, 2, 3, 0].find(i => !m.cad[i] || m.cad[i].bot);
  }
  // Mesa rápida: a turma do bairro vai chegando em momentos sorteados da espera (ex.: faltando 15, 12 e 7 s),
  // um de cada vez, entre ~18 s e 3 s antes de começar, com pelo menos 1,5 s entre um e outro
  sortearChegadas(iniciaEm) {
    const E = this.T.espera, de = iniciaEm - E * 0.88, ate = iniciaEm - E * 0.15, folga = E * 0.075;
    for (let tent = 0; tent < 50; tent++) {
      const t = [0, 1, 2].map(() => de + Math.random() * (ate - de)).sort((a, b) => a - b);
      if (t[1] - t[0] >= folga && t[2] - t[1] >= folga) return t;
    }
    return [de, (de + ate) / 2, ate];
  }
  // Hora do próximo robô sentar na espera da mesa rápida
  horaDoRobo() {
    const m = this.m;
    if (Array.isArray(m.chegadas)) return m.chegadas.length ? m.chegadas[0] : Infinity;
    return Math.max(m.iniciaEm - this.T.sentaRobo, m.proxRobo || 0);
  }
  // Um robô senta numa cadeira vazia (sorteada), com um nome que ninguém da mesa está usando
  sentarUmRobo() {
    const m = this.m, vazias = [1, 2, 3, 0].filter(k => !m.cad[k]);
    if (!vazias.length) return;
    const usados = m.cad.filter(Boolean).map(c => c.nome.toLowerCase());
    const nomes = BOT_NAMES.filter(n => !usados.includes(n.toLowerCase()));
    const k = vazias[Math.floor(Math.random() * vazias.length)];
    m.cad[k] = { id: null, nome: nomes[Math.floor(Math.random() * nomes.length)], av: null, nv: nivelRobo(), bot: true, saiu: false };
  }
  // Robôs da turma nas cadeiras vazias, com nomes que ninguém da mesa está usando
  sentarRobos() {
    const m = this.m;
    const usados = m.cad.filter(Boolean).map(c => c.nome.toLowerCase());
    const livres = BOT_NAMES.filter(n => !usados.includes(n.toLowerCase()));
    for (let i = livres.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [livres[i], livres[j]] = [livres[j], livres[i]]; }
    m.cad = m.cad.map(c => c || { id: null, nome: livres.pop(), av: null, nv: nivelRobo(), bot: true, saiu: false });
  }
  recusar(ws, cod) { this.enviar(ws, { t: 'erro', cod }); try { ws.close(4000, cod); } catch (e) {} }
  nomeUnico(nome, p) {
    const usados = this.m.cad.filter((c, k) => c && k !== p).concat(this.m.fila || []).map(c => c.nome.toLowerCase());
    if (!usados.includes(nome.toLowerCase())) return nome;
    for (let n = 2; n < 9; n++) { const t = `${nome.slice(0, 13)} ${n}`; if (!usados.includes(t.toLowerCase())) return t; }
    return nome;
  }

  async sentar(p, k) {
    const m = this.m;
    if (m.fase !== 'espera' || !Number.isInteger(k) || k < 0 || k > 3 || m.cad[k]) return;
    m.cad[k] = m.cad[p]; m.cad[p] = null; m.ultimo = Date.now();
    await this.salvar(); this.espalhar();
  }

  // 3.38.1 (pedido do dono): mesa com os amigos só começa com pelo menos 2 pessoas; os robôs completam o resto.
  // (Quem chega depois continua entrando no lugar de um robô, e quem sai continua sendo trocado por um robô.)
  minAmigos() { const n = Number(this.env && this.env.AMIGOS_MIN); return n >= 1 && n <= 4 ? n : 2; }
  async comecarAmigos(ws) {
    const m = this.m;
    if (m.fase !== 'espera') return;
    const gente = m.cad.filter(c => c && !c.bot).length, min = this.minAmigos();
    if (gente < min) return this.enviar(ws, { t: 'erro', cod: 'poucos', min });
    return this.comecar();
  }
  async comecar() {
    const m = this.m;
    if (m.fase !== 'espera') return;
    this.sentarRobos();
    m.G = newGame(m.cad.map(c => c.nome)); m.G.torneio = !!m.torneio && !m.publica; startHand(m.G); m.robo = null; this.inicioDePartida();
    m.fase = 'jogo'; m.seq++; m.porRobo = null; m.iniciaEm = null;
    m.ultimo = m.turnoDesde = Date.now();
    this.agendar(this.T.distribuir);
    await this.salvar(); this.espalhar();
    await this.registrarAtiva();
  }

  async jogar(ws, p, msg) {
    const m = this.m, G = m.G;
    if (m.fase !== 'jogo' || !G || G.phase !== 'play' || G.turn !== p) return this.enviar(ws, { t: 'erro', cod: 'vez' });
    if (msg.seq !== m.seq) return this.enviar(ws, { t: 'erro', cod: 'mudou' });
    const t = Array.isArray(msg.pedra) ? msg.pedra : [];
    const i = G.hands[p].findIndex(x => tkey(x) === tkey(t));
    const mv = legalMoves(G, p).find(x => x.i === i && x.side === msg.lado);
    if (!mv) return this.enviar(ws, { t: 'erro', cod: 'jogada' });
    // 3.41: ritmo da jogada (tempo desde que a vez chegou); vai para o banco no fim da mão
    const c = m.cad[p], dt = Date.now() - (m.turnoDesde || 0);
    if (c && !c.bot && c.id && m.turnoDesde && dt >= 0 && dt < 120000) {
      const r = (m.ritmo || (m.ritmo = {}))[c.id] || (m.ritmo[c.id] = { n: 0, rapidas: 0, soma: 0 });
      r.n++; if (dt < RAPIDA_MS) r.rapidas++; r.soma += Math.min(dt, 30000);
    }
    applyMove(G, p, mv);
    await this.depoisDaAcao(null);
    this.reacaoDosRobos();
  }

  async proxima(msg) {
    const m = this.m, G = m.G;
    if (m.fase !== 'jogo' || !G || G.phase !== 'handEnd' || msg.seq !== m.seq) return;
    const r = G.result;
    // 3.38.2: sem esperar nada aqui (dois 'proxima' ao mesmo tempo não podem passar juntos); só apaga se não sobrou ninguém
    if (r && r.matchWinner != null && this.tirarApelidosRuins() === 'vazia') { await this.apagar(); return; }
    if (r && r.matchWinner != null && !m.publica) {
      const w = r.matchWinner;
      m.fica = m.fica && m.fica.team === w ? { team: w, n: m.fica.n + 1 } : { team: w, n: 1 };
      if ((m.fila || []).length && this.ganhaChama(w)) { this.novaMaoRobo(true); return this.depoisDaAcao(null, this.T.distribuir); }
    }
    nextHand(G);
    this.novaMaoRobo(r && r.matchWinner != null);
    await this.depoisDaAcao(null, this.T.distribuir);
    if (r && r.matchWinner != null) await this.registrarAtiva();
  }

  // 28/10 (pedido do dono): a cadeira de quem saiu no meio do jogo (ou ficou sem conexão) — antes ficava com o nome da
  // pessoa e o robô jogava escondido. Agora entra o primeiro da fila (mesa com os amigos) ou um robô da turma do bairro com
  // o nome dele, e todos na mesa recebem o aviso. O robô guarda o lugar: se a pessoa voltar, retoma a cadeira.
  nomeDeRobo() {
    const usados = this.m.cad.filter(Boolean).concat(this.m.fila || []).map(x => x.nome.toLowerCase());
    const livres = BOT_NAMES.filter(n => !usados.includes(n.toLowerCase()));
    return livres[Math.floor(Math.random() * livres.length)] || 'Juca';
  }
  avisarTroca(t) {
    const m = this.m;
    m.trocaN = (m.trocaN || 0) + 1;
    m.troca = Object.assign({ seq: m.seq, ficam: [], n: m.trocaN }, t);
  }
  substituir(p, motivo) {
    const m = this.m, c = m.cad[p];
    if (!c || c.bot || !c.id) return false;
    const i = !m.publica ? (m.fila || []).findIndex(x => this.conectadoId(x.id)) : -1;
    if (i >= 0) {
      const novo = m.fila.splice(i, 1)[0];
      m.cad[p] = null; novo.nome = this.nomeUnico(novo.nome, p);
      m.cad[p] = novo; if (m.G) m.G.names[p] = novo.nome;
      this.avisarTroca({ entraram: [novo.nome], sairam: [c.nome], motivo });
      return true;
    }
    const robo = this.nomeDeRobo();
    m.cad[p] = { id: null, nome: robo, av: null, nv: nivelRobo(), bot: true, saiu: false, lugarDe: c.id };
    if (m.G) m.G.names[p] = robo;
    this.avisarTroca({ entraram: [robo], sairam: [c.nome], robo: true, motivo });
    return true;
  }
  // quem voltou para a mesa onde um robô guardava o lugar dele: retoma a cadeira (devolve a cadeira, ou -1)
  voltarAoLugar(quem) {
    const m = this.m;
    if (m.fase !== 'jogo' || !m.G) return -1;
    const p = m.cad.findIndex(c => c && c.bot && c.lugarDe && c.lugarDe === quem.id);
    if (p < 0) return -1;
    const robo = m.cad[p].nome;
    quem.nome = this.nomeUnico(quem.nome, p);
    m.cad[p] = quem; m.G.names[p] = quem.nome;
    this.avisarTroca({ entraram: [quem.nome], sairam: [robo], volta: true });
    return p;
  }
  // sem conexão no meio do jogo por mais de 1 min e meio: o robô da turma entra no lugar. Só se tiver mais alguém
  // conectado na mesa (mesa só com quem caiu fica como está e acaba sozinha, como antes)
  verificarAusentes() {
    const m = this.m; if (!m || m.fase !== 'jogo' || !m.G || m.G.phase !== 'play') return false;
    const agora = Date.now(); let trocou = false;
    for (let p = 0; p < 4; p++) {
      const c = m.cad[p]; if (!c || c.bot || !c.id) continue;
      if (this.conectado(p)) { if (c.foraDesde) delete c.foraDesde; continue; }
      if (!c.foraDesde) { c.foraDesde = agora; continue; }
      if (agora - c.foraDesde < this.T.largou - 50) continue;
      if (!m.cad.some((x, k) => k !== p && x && !x.bot && x.id && this.conectado(k))) continue;
      const id = c.id;
      if (this.substituir(p, 'conexao')) {
        trocou = true;
        // se o celular dela ainda estiver pendurado na mesa, fecha: ao voltar, o app entra de novo e retoma a cadeira
        for (const ws of this.ctx.getWebSockets()) { const a = ws.deserializeAttachment() || {}; if (a.id === id) { try { ws.close(4002, 'voltar'); } catch (e) {} } }
      }
    }
    return trocou;
  }

  async sair(ws, p) {
    const m = this.m;
    if (m.fase === 'espera') {
      m.cad[p] = null;
      // mesa com os amigos: o primeiro da fila senta na cadeira que ficou vazia
      const i = !m.publica ? (m.fila || []).findIndex(c => this.conectadoId(c.id)) : -1;
      if (i >= 0) { const novo = m.fila.splice(i, 1)[0]; novo.nome = this.nomeUnico(novo.nome, p); m.cad[p] = novo; }
    } else {
      // no meio do jogo: se tem gente na fila, o primeiro entra no lugar; senão, um robô da turma do bairro (28/10: com o
      // nome dele, não mais o de quem saiu) assume a cadeira até a pessoa voltar
      this.substituir(p, 'saiu');
    }
    const att = ws.deserializeAttachment() || {}; att.id = null; ws.serializeAttachment(att);
    try { ws.close(1000, 'saiu'); } catch (e) {}
    const humanos = m.cad.filter(c => c && !c.bot);
    if (!humanos.length) { await this.apagar(); return; }
    if (!humanos.some(c => c.id === m.dono)) m.dono = humanos[0].id;
    m.ultimo = Date.now();
    if (m.fase === 'jogo') this.agendar();
    await this.salvar(); this.espalhar();
  }

  // 3.38.2 (pedido do dono, sem bloquear): apelido que o filtro passou a barrar depois que a pessoa entrou na mesa
  // ("Sokomo Kazada"): no fim da partida ela sai (um robô da turma assume a cadeira) e o app a leva para o início para
  // escolher outro apelido; depois pode voltar a jogar. App antigo (sem o aviso 'apelido') recebe 'nao-existe' e vai
  // para o início do mesmo jeito; ao atualizar, o app pede o apelido novo.
  tirarApelidosRuins() {
    const m = this.m; let tirou = false;
    for (let p = 0; p < 4; p++) {
      const c = m.cad[p];
      if (!c || c.bot || !c.id || !(c.apelidoRuim || nomeOfensivo(c.nome))) continue;
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() || {};
        if (a.id !== c.id) continue;
        this.enviar(ws, { t: 'erro', cod: a.apelido ? 'apelido' : 'nao-existe' });
        a.id = null; ws.serializeAttachment(a); try { ws.close(4000, 'apelido'); } catch (e) {}
      }
      const usados = m.cad.filter(Boolean).map(x => x.nome.toLowerCase());
      const livres = BOT_NAMES.filter(n => !usados.includes(n.toLowerCase()));
      const robo = livres[Math.floor(Math.random() * livres.length)] || 'Juca';
      m.cad[p] = { id: null, nome: robo, av: null, nv: nivelRobo(), bot: true, saiu: false };
      if (m.G) m.G.names[p] = robo;
      tirou = true;
    }
    if (!tirou) return 'nada';
    const humanos = m.cad.filter(x => x && !x.bot);
    if (!humanos.length) return 'vazia';
    if (!humanos.some(x => x.id === m.dono)) m.dono = humanos[0].id;
    return 'tirou';   // quem chamou continua e grava a mesa
  }

  // 3.25: o administrador bloqueou alguém: sai da mesa na hora e um robô da turma assume a cadeira (com nome de robô)
  // 3.41: com motivo 'apelido' (pediu outro apelido), o aviso é para trocar o apelido, não de bloqueio
  async expulsar(b) {
    const m = this.viva(); if (!m) return { id: null };
    const p = Number.isInteger(b.cadeira) ? b.cadeira : m.cad.findIndex(c => c && c.id && c.id === b.id);
    const c = p >= 0 && p < 4 ? m.cad[p] : null;
    if (!c || !c.id || (c.bot && !c.saiu)) return { id: null };
    const id = c.id, nome = c.nome;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id !== id) continue;
      const cod = b.motivo === 'apelido' ? (a.apelido ? 'apelido' : 'nao-existe') : 'bloqueado';
      this.enviar(ws, { t: 'erro', cod }); a.id = null; ws.serializeAttachment(a); try { ws.close(cod === 'bloqueado' ? 4003 : 4000, cod); } catch (e) {}
    }
    if (m.fase === 'espera') m.cad[p] = null;
    else if (!c.bot && this.substituir(p, 'saiu')) {
      // 28/10: robô da turma com nome próprio e etiqueta "robô", e todos na mesa recebem o aviso
    } else {
      const usados = m.cad.filter(Boolean).map(x => x.nome.toLowerCase());
      const livres = BOT_NAMES.filter(n => !usados.includes(n.toLowerCase()));
      const robo = livres[Math.floor(Math.random() * livres.length)] || 'Juca';
      m.cad[p] = { id: null, nome: robo, av: null, nv: nivelRobo(), bot: true, saiu: false };
      if (m.G) m.G.names[p] = robo;
    }
    m.fila = (m.fila || []).filter(x => x.id !== id);
    const humanos = m.cad.filter(x => x && !x.bot);
    if (!humanos.length) { await this.apagar(); return { id, nome }; }
    if (!humanos.some(x => x.id === m.dono)) m.dono = humanos[0].id;
    m.ultimo = Date.now();
    if (m.fase === 'jogo') this.agendar();
    await this.salvar(); this.espalhar();
    return { id, nome };
  }

  // Reação rápida: frase pronta (o celular sabe o texto pelo número). Sem gravar nada; com limite por pessoa.
  reagir(p, k) {
    if (this.m.fase !== 'jogo' || !Number.isInteger(k) || k < 0 || k > REACAO.maior) return;
    const agora = Date.now();
    const h = (this.reacoes[p] || []).filter(t => agora - t < 60000);
    if ((h.length && agora - h[h.length - 1] < REACAO.intervalo) || h.length >= REACAO.porMinuto) return;
    h.push(agora); this.reacoes[p] = h;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id || a.assiste) this.enviar(ws, { t: 'reacao', p, k });
    }
  }

  // ---------- Relógio: robôs, passe automático e quem caiu ----------
  agendar(extra) {
    const m = this.m, G = m.G;
    m.proximo = null; m.turnoEm = null;
    if (m.fase === 'espera' && m.publica && m.iniciaEm) {
      const robo = this.horaDoRobo();
      m.proximo = m.cad.some(c => !c) && robo < m.iniciaEm ? robo : m.iniciaEm;
    }
    if (m.fase === 'jogo' && G && G.phase === 'handEnd' && !this.alguemOnline()) m.proximo = Date.now() + this.T.vazia;
    if (m.fase === 'jogo' && G && G.phase === 'play') {
      const p = G.turn, c = m.cad[p], tem = legalMoves(G, p).length > 0, agora = Date.now();
      let espera;
      if (c.bot) espera = tem ? this.T.jogada : this.T.passe;
      else if (!tem) espera = this.T.semPedra;
      else espera = Math.max(0, m.turnoDesde + Math.min(this.T.ausente, this.T.vez) - agora);   // 3.41: 20 s para todo mundo
      m.proximo = m.turnoEm = agora + espera + (extra || 0);
      // 28/10: quem ficou sem conexão: confere quando passar o tempo (o robô da turma entra no lugar). Só agenda se
      // ainda vai passar, ou se tem mais alguém conectado (senão não há troca e o alarme ficaria batendo à toa)
      const outro = k => m.cad.some((y, j) => j !== k && y && !y.bot && y.id && this.conectado(j));
      for (let k = 0; k < 4; k++) {
        const x = m.cad[k]; if (!x || x.bot || !x.id) continue;
        if (this.conectado(k)) { if (x.foraDesde) delete x.foraDesde; continue; }
        if (!x.foraDesde) x.foraDesde = agora;
        const t = x.foraDesde + this.T.largou;
        if (t > agora + 500 || outro(k)) m.proximo = Math.min(m.proximo, Math.max(agora + 1000, t));
      }
    }
    const quando = m.proximo ? Math.min(m.proximo, m.ultimo + VIDA) : m.ultimo + VIDA;
    this.ctx.storage.setAlarm(quando);
  }
  async alarm() {
    const m = this.m;
    if (!m) return;
    const agora = Date.now();
    if (m.ultimo + VIDA <= agora) { await this.apagar(); return; }
    if (m.fase === 'jogo' && m.G && m.G.phase === 'handEnd') {
      if (!this.alguemOnline() && m.proximo && agora >= m.proximo - 50) { await this.apagar(); return; }
      this.agendar(); await this.salvar(); return;
    }
    if (this.verificarAusentes()) {   // 28/10: um robô da turma entrou no lugar de quem ficou sem conexão
      const humanos = m.cad.filter(c => c && !c.bot);
      if (!humanos.some(c => c.id === m.dono) && humanos.length) m.dono = humanos[0].id;
      m.ultimo = agora; this.agendar(); await this.salvar(); this.espalhar();
      return;
    }
    if (m.fase === 'espera' && m.publica && m.iniciaEm && agora >= m.iniciaEm - 50) return this.comecarPublica();
    if (m.fase === 'espera' && m.publica && m.iniciaEm && m.cad.some(c => !c) && agora >= this.horaDoRobo() - 50) {
      this.sentarUmRobo(); m.ultimo = agora;
      if (Array.isArray(m.chegadas)) m.chegadas.shift();
      else m.proxRobo = agora + this.T.entreRobos * (0.75 + Math.random() * 0.5);
      this.agendar(); await this.salvar(); this.espalhar();
      return;
    }
    // 28/10: o alarme pode acordar antes da hora do lance (para conferir quem ficou sem conexão): o lance espera a hora dele
    if (!m.proximo || agora < (m.turnoEm != null ? m.turnoEm : m.proximo) - 50 || m.fase !== 'jogo') { this.agendar(); return; }
    const G = m.G, p = G.turn, c = m.cad[p], moves = legalMoves(G, p);
    if (c.bot) {
      this.marcarRobo(p);
      if (moves.length) applyMove(G, p, botChoose(G, p)); else applyPass(G, p);
      if (G.pedido) pedirPonto(G, p, true);   // robô sempre pede o ponto dele
      await this.depoisDaAcao(null);
      return this.reacaoDosRobos();
    }
    if (!moves.length) { applyPass(G, p); await this.depoisDaAcao(null); return this.reacaoDosRobos(); }
    // 3.41: passou dos 20 s (em qualquer mesa online, não só no modo torneio), o robô joga pela pessoa (e pede o ponto)
    const limite = Math.min(this.T.ausente, this.T.vez);
    if (agora - m.turnoDesde >= limite - 50) {
      this.marcarRobo(p);
      applyMove(G, p, botChoose(G, p));
      if (G.pedido) pedirPonto(G, p, true);
      await this.depoisDaAcao(p);
      return this.reacaoDosRobos();
    }
    this.agendar(); await this.salvar();
    this.espalhar();   // atualiza quem está conectado
  }
  // Reações dos robôs (3.23): coerentes com o lance (galo, batida, ponto grande, passe) e com moderação. Só os robôs
  // da turma do bairro; o robô que joga no lugar de quem saiu não fala por ninguém. O celular mostra no balão do robô.
  reacaoDosRobos() {
    const m = this.m, G = m && m.G;
    if (!G || m.fase !== 'jogo') return;
    const robos = m.cad.map((c, p) => c && c.bot && !c.saiu ? p : -1).filter(p => p >= 0);
    if (!robos.length) return;
    this.memRobos = this.memRobos || { ult: {}, global: 0 };
    let r = null; try { r = reacaoRobo(G, G.events, robos, this.memRobos, Date.now()); } catch (e) {}
    if (!r) return;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id || a.assiste) this.enviar(ws, { t: 'reacao', p: r.p, k: r.k });
    }
  }
  async depoisDaAcao(porRobo, extra) {
    const m = this.m;
    await this.contarDesafio();
    await this.contarVivo();
    await this.contarRanking();
    // 3.41: ritmo vai para o banco no fim da partida, ou ao fim da mão para quem já tem 15 jogadas medidas (menos escrita)
    if (m.G && m.G.phase === 'handEnd' && m.ritmo) { const fimPartida = !!(m.G.result && m.G.result.matchWinner != null); for (const id of Object.keys(m.ritmo)) { const x = m.ritmo[id]; if (fimPartida || x.n >= (Number(this.env.RITMO_LOTE) || 15)) { delete m.ritmo[id]; try { await anotarRitmo(this.env, id, x); } catch (e) {} } } }
    if (await this.encerrarSeVazia()) return;
    m.seq++; m.porRobo = porRobo; m.porTempo = porRobo != null && this.conectado(porRobo); m.ultimo = Date.now(); m.turnoDesde = m.ultimo + (extra || 0);   // 3.41: os 20 s contam depois de distribuir as pedras
    this.agendar(extra);
    await this.salvar(); this.espalhar();
  }

  // "Hoje no Dominó Manauara" (3.24): a mesa soma galos e batidas de carroça e, ao fim de cada mão, manda para o
  // contador do dia (com a partida, se ela acabou). Cada lance é visto uma vez só (a lista de eventos é a do lance).
  async contarVivo() {
    const m = this.m, G = m.G; if (!G) return;
    const evs = G.events || [];
    if (evs.length && m.vivoVisto !== m.seq) {
      m.vivoVisto = m.seq;
      const v = m.vivo || (m.vivo = { g: 0, c: 0 });
      for (const e of evs) { if (e.type === 'galo') v.g++; if (e.type === 'batida' && e.carroca) v.c++; }
    }
    const r = G.result;
    if (G.phase !== 'handEnd' || !r || r.vivo) return;
    r.vivo = true;
    const v = m.vivo || { g: 0, c: 0 };
    m.vivo = { g: 0, c: 0 };
    try { await somarVivo(this.env, r.matchWinner != null ? 1 : 0, Math.min(v.g, 6), Math.min(v.c, 2)); } catch (e) {}
  }

  // 3.25: mesa sem ninguém. Quando todos saíram ou estão sem conexão, os robôs só terminam a mão. No fim da partida a
  // mesa é encerrada na hora; no fim de uma mão qualquer, espera 3 min por alguém voltar e encerra. Assim quem abrir o
  // app depois não cai de volta numa mesa de robôs.
  alguemOnline() { return (this.m.cad || []).some((c, p) => c && !c.bot && c.id && this.conectado(p)); }
  async encerrarSeVazia() {
    const m = this.m, G = m && m.G, r = G && G.result;
    if (!m || m.fase !== 'jogo' || !G || G.phase !== 'handEnd' || !r || this.alguemOnline()) return false;
    if (r.matchWinner != null) { await this.apagar(); return true; }
    return false;   // fim de mão: o relógio confere de novo daqui a 3 min (agendar)
  }

  // 3.25: experiência só para quem jogou de verdade. Guarda, por cadeira, se o robô jogou por ela nesta mão e nesta
  // partida; cada celular recebe só a marca da própria cadeira (o app não dá experiência da mão ou da partida marcada).
  marcarRobo(p) {
    const m = this.m;
    if (!m.robo) m.robo = { mao: [false, false, false, false], partida: [false, false, false, false] };
    m.robo.mao[p] = true; m.robo.partida[p] = true;
  }
  // Ranking (3.29): quem estava em cada cadeira quando a partida começou (só conta quem jogou a partida inteira)
  inicioDePartida() { const m = this.m; m.naPartida = m.cad.map(c => c && !c.bot && c.id ? c.id : null); }
  async contarRanking() {
    const m = this.m, G = m.G, r = G && G.result;
    if (!G || G.phase !== 'handEnd' || !r || r.matchWinner == null || r.ranking) return;
    r.ranking = true;
    const quem = quemContaNoRanking(m, r.matchWinner);
    if (quem.length) { try { await somarRanking(this.env, quem); } catch (e) {} }
  }
  novaMaoRobo(novaPartida) {
    const m = this.m;
    if (novaPartida) this.inicioDePartida();
    if (!m.robo) return;
    m.robo.mao = [false, false, false, false];
    if (novaPartida) m.robo.partida = [false, false, false, false];
  }

  // Desafio das Confrarias: fim de partida online, quem ganhou leva ponto para a Turma (se perdeu alguém de outra Turma)
  async contarDesafio() {
    const m = this.m, G = m.G, r = G && G.result;
    if (!r || r.matchWinner == null || r.desafio) return;
    r.desafio = true;
    const lado = w => m.cad.map((c, p) => c && !c.bot && c.id && p % 2 === w ? p : -1).filter(p => p >= 0);
    const ganhou = lado(r.matchWinner), perdeu = lado(1 - r.matchWinner);
    if (!ganhou.length || !perdeu.length) return;
    let res = null;
    try { res = await pontuar(this.env, ganhou.map(p => m.cad[p].id), perdeu.map(p => m.cad[p].id)); } catch (e) {}
    if (res && res.turmas.length) m.desafio = { seq: m.seq + 1, turmas: res.turmas, cadeiras: ganhou.filter(p => res.ids.includes(m.cad[p].id)) };
  }

  // ---------- Conexões e envio ----------
  conectado(p) {
    const c = this.m.cad[p];
    if (!c || c.bot || !c.id) return false;
    const agora = Date.now();
    return this.ctx.getWebSockets().some(ws => {
      if (ws.readyState != null && ws.readyState !== 1) return false;   // fechando ou fechado
      const a = ws.deserializeAttachment() || {};
      if (a.id !== c.id) return false;
      let visto = a.visto || 0;
      try { const t = this.ctx.getWebSocketAutoResponseTimestamp(ws); if (t) visto = Math.max(visto, +t); } catch (e) {}
      return agora - visto < SILENCIO;
    });
  }
  // id vazio = quem só assiste (3.28): sem foto e sem bairro de ninguém (a foto é só para quem joga na mesa)
  vista(id) {
    const m = this.m, G = m.G;
    const minha = id ? m.cad.findIndex(c => c && c.id === id) : -1;
    const naFila = id ? (m.fila || []).findIndex(c => c.id === id) : -1;
    let jogo = null;
    if (G) {
      // só a própria mão vai para cada celular; no fim da mão todas aparecem (o resultado mostra)
      jogo = Object.assign({}, G, {
        hands: G.hands.map((h, p) => p === minha || G.phase === 'handEnd' ? h : h.map(() => [-1, -1]))
      });
    }
    return { t: 'mesa', codigo: m.codigo, fase: m.fase, seq: m.seq, minha, dono: !!id && m.dono === id, porRobo: m.porRobo,
      naFila, fila: (m.fila || []).map(c => ({ nome: c.nome, av: c.av, on: this.conectadoId(c.id) })), fica: m.fica || null, troca: m.troca || null,
      tema: m.tema || null, torneio: !!m.torneio, desafio: m.desafio || null, turnoDesde: m.turnoDesde || null, porTempo: !!m.porTempo, publica: !!m.publica, minGente: m.publica ? 1 : this.minAmigos(), iniciaEm: m.fase === 'espera' && m.iniciaEm ? m.iniciaEm : null,
      cad: m.cad.map((c, p) => c ? { nome: c.nome, av: c.av, bairro: c.bot || !id ? null : c.bairro || null, bot: !!c.bot, saiu: !!c.saiu, apoiador: !!c.apoiador && !c.saiu, rei: !!c.rei && !c.saiu && !c.bot, doador: c.saiu ? 0 : (c.doador || 0), foto: c.saiu || c.bot || !id ? null : (c.foto || null), turma: c.bot ? null : (c.turma || null), nv: c.nv || 1, on: c.bot ? true : this.conectado(p), sub: !!(c.bot && c.lugarDe) } : null),   // 28/10: sub = robô no lugar de quem saiu (etiqueta "robô")
      robo: minha >= 0 && m.robo ? { mao: !!m.robo.mao[minha], partida: !!m.robo.partida[minha] } : { mao: false, partida: false },
      jogo, agora: Date.now(), assistindo: this.quantosAssistem() };
  }
  enviar(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  espalhar(menos) {
    if (!this.m) return;
    let deFora = null;   // a vista de quem assiste é a mesma para todos
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === menos) continue;
      const a = ws.deserializeAttachment() || {};
      if (a.id) this.enviar(ws, this.vista(a.id));
      else if (a.assiste) this.enviar(ws, deFora || (deFora = this.vista(null)));
    }
  }
  async salvar() { if (this.m) { await this.ctx.storage.put('m', this.m); await this.contarAFila(); } }   // 28/10: e conta à fila, se mudou
  async apagar() {
    await this.contarAFila(true);   // 28/10: sai do quadro da fila
    for (const ws of this.ctx.getWebSockets()) { this.enviar(ws, { t: 'erro', cod: 'encerrada' }); try { ws.close(4001, 'encerrada'); } catch (e) {} }
    this.m = null;
    await this.ctx.storage.deleteAll();
    try { await this.ctx.storage.deleteAlarm(); } catch (e) {}
  }
}
