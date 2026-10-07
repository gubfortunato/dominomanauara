// Mesa online do Dominó Manauara: um Durable Object por mesa (código de 5 números).
// O servidor guarda as pedras e aplica as regras; cada celular só recebe a própria mão.
// Cadeiras vazias viram robôs da turma do bairro; quem cai da internet tem o lugar guardado
// e, se demorar na vez dele, um robô joga por ele até voltar.
import { newGame, startHand, legalMoves, applyMove, applyPass, nextHand, botChoose, tkey, nomeOfensivo, BOT_NAMES } from './motor.js';

const TEMPO = {
  jogada: 4500,      // robô: espera antes de jogar (igual ao jogo offline)
  passe: 3000,       // robô: espera antes de passar
  semPedra: 2600,    // pessoa sem pedra que encaixe: passa sozinha
  distribuir: 4300,  // tempo da animação de embaralhar e distribuir no celular
  ausente: 25000,    // pessoa sem conexão: o robô joga por ela depois disso
  conferir: 60000    // vez de uma pessoa conectada: confere de novo se ela continua lá
};
const SILENCIO = 50000;              // sem sinal do celular há 50 s: conta como desconectado
const VIDA = 24 * 60 * 60 * 1000;    // a mesa some 24 h depois da última ação

const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export class Mesa {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.m = null;
    // TEMPO_FATOR só existe no teste local (acelera os robôs); no Cloudflare vale 1
    const f = Number(env && env.TEMPO_FATOR) || 1;
    this.T = Object.fromEntries(Object.entries(TEMPO).map(([k, v]) => [k, v * f]));
    // "ping" responde sozinho, sem acordar a mesa (economiza)
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) {}
    ctx.blockConcurrencyWhile(async () => { this.m = (await ctx.storage.get('m')) || null; });
  }

  // ---------- Entrada HTTP (chamada pelo Worker) ----------
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/criar' && req.method === 'POST') return this.criar(await req.json());
    if (url.pathname === '/info') {
      const m = this.viva();
      return Response.json(m ? { existe: true, fase: m.fase, livres: m.cad.filter(c => !c).length + (m.fase === 'jogo' ? m.cad.filter(c => c && c.bot && !c.saiu).length : 0) } : { existe: false });
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
      cad: [quem, null, null, null], G: null, proximo: null, turnoDesde: agora, porRobo: null };
    await this.salvar();
    return Response.json({ ok: true }, { status: 201 });
  }
  // Valida quem chega: código do aparelho, apelido (filtrado) e avatar.
  pessoa(b) {
    const id = String((b && b.id) || '');
    if (!/^[a-z0-9-]{8,40}$/i.test(id)) return null;
    let nome = limpa(b.nome, 16);
    if (nome.length < 2 || nomeOfensivo(nome)) nome = 'Jogador';
    const av = /^[a-z0-9_-]{1,16}$/i.test(String(b.av || '')) ? String(b.av) : null;
    return { id, nome, av, bot: false, saiu: false };
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
      case 'sentar': if (p >= 0) return this.sentar(p, msg.cadeira); return;
      case 'comecar': if (p >= 0) return this.comecar(); return;
      case 'jogar': if (p >= 0) return this.jogar(ws, p, msg); return;
      case 'proxima': if (p >= 0) return this.proxima(msg); return;
      case 'sair': if (p >= 0) return this.sair(ws, p); return;
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

  async entrar(ws, att, msg) {
    const m = this.m;
    const quem = this.pessoa(msg);
    if (!quem) return this.enviar(ws, { t: 'erro', cod: 'dados' });
    let p = m.cad.findIndex(c => c && c.id === quem.id);
    if (p >= 0) {
      // voltou (ou abriu em outro aparelho): retoma a cadeira; se tinha saído, volta a jogar
      const c = m.cad[p];
      if (m.fase === 'espera') { c.nome = quem.nome; c.av = quem.av; }
      if (c.saiu) { c.saiu = false; c.bot = false; }
    } else if (m.fase === 'espera') {
      p = [1, 2, 3, 0].find(k => !m.cad[k]);
      if (p == null) return this.recusar(ws, 'cheia');
      quem.nome = this.nomeUnico(quem.nome, -1);
      m.cad[p] = quem;
    } else {
      // jogo já começou: entra no lugar de um robô da turma, se houver
      p = m.cad.findIndex(c => c && c.bot && !c.saiu);
      if (p < 0) return this.recusar(ws, 'cheia');
      quem.nome = this.nomeUnico(quem.nome, p);
      m.cad[p] = quem; m.G.names[p] = quem.nome;
    }
    att.id = quem.id; ws.serializeAttachment(att);
    if (!m.dono || !m.cad.some(c => c && c.id === m.dono && !c.bot)) m.dono = quem.id;
    m.ultimo = Date.now();
    if (m.fase === 'jogo') this.agendar();
    await this.salvar();
    this.espalhar();
  }
  recusar(ws, cod) { this.enviar(ws, { t: 'erro', cod }); try { ws.close(4000, cod); } catch (e) {} }
  nomeUnico(nome, p) {
    const usados = this.m.cad.filter((c, k) => c && k !== p).map(c => c.nome.toLowerCase());
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

  async comecar() {
    const m = this.m;
    if (m.fase !== 'espera') return;
    const humanos = m.cad.filter(Boolean).map(c => c.nome.toLowerCase());
    const livres = BOT_NAMES.filter(n => !humanos.includes(n.toLowerCase()));
    for (let i = livres.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [livres[i], livres[j]] = [livres[j], livres[i]]; }
    m.cad = m.cad.map(c => c || { id: null, nome: livres.pop(), av: null, bot: true, saiu: false });
    m.G = newGame(m.cad.map(c => c.nome)); startHand(m.G);
    m.fase = 'jogo'; m.seq++; m.porRobo = null;
    m.ultimo = m.turnoDesde = Date.now();
    this.agendar(this.T.distribuir);
    await this.salvar(); this.espalhar();
  }

  async jogar(ws, p, msg) {
    const m = this.m, G = m.G;
    if (m.fase !== 'jogo' || !G || G.phase !== 'play' || G.turn !== p) return this.enviar(ws, { t: 'erro', cod: 'vez' });
    if (msg.seq !== m.seq) return this.enviar(ws, { t: 'erro', cod: 'mudou' });
    const t = Array.isArray(msg.pedra) ? msg.pedra : [];
    const i = G.hands[p].findIndex(x => tkey(x) === tkey(t));
    const mv = legalMoves(G, p).find(x => x.i === i && x.side === msg.lado);
    if (!mv) return this.enviar(ws, { t: 'erro', cod: 'jogada' });
    applyMove(G, p, mv);
    await this.depoisDaAcao(null);
  }

  async proxima(msg) {
    const m = this.m, G = m.G;
    if (m.fase !== 'jogo' || !G || G.phase !== 'handEnd' || msg.seq !== m.seq) return;
    nextHand(G);
    await this.depoisDaAcao(null, this.T.distribuir);
  }

  async sair(ws, p) {
    const m = this.m;
    if (m.fase === 'espera') {
      m.cad[p] = null;
    } else {
      // no meio do jogo: um robô assume a cadeira até a pessoa voltar
      m.cad[p].saiu = true; m.cad[p].bot = true;
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

  // ---------- Relógio: robôs, passe automático e quem caiu ----------
  agendar(extra) {
    const m = this.m, G = m.G;
    m.proximo = null;
    if (m.fase === 'jogo' && G && G.phase === 'play') {
      const p = G.turn, c = m.cad[p], tem = legalMoves(G, p).length > 0, agora = Date.now();
      let espera;
      if (c.bot) espera = tem ? this.T.jogada : this.T.passe;
      else if (!tem) espera = this.T.semPedra;
      else if (!this.conectado(p)) espera = Math.max(0, m.turnoDesde + this.T.ausente - agora);
      else espera = this.T.conferir;
      m.proximo = agora + espera + (extra || 0);
    }
    const quando = m.proximo ? Math.min(m.proximo, m.ultimo + VIDA) : m.ultimo + VIDA;
    this.ctx.storage.setAlarm(quando);
  }
  async alarm() {
    const m = this.m;
    if (!m) return;
    const agora = Date.now();
    if (m.ultimo + VIDA <= agora) { await this.apagar(); return; }
    if (!m.proximo || agora < m.proximo - 50 || m.fase !== 'jogo') { this.agendar(); return; }
    const G = m.G, p = G.turn, c = m.cad[p], moves = legalMoves(G, p);
    if (c.bot) {
      if (moves.length) applyMove(G, p, botChoose(G, p)); else applyPass(G, p);
      return this.depoisDaAcao(null);
    }
    if (!moves.length) { applyPass(G, p); return this.depoisDaAcao(null); }
    if (!this.conectado(p) && agora - m.turnoDesde >= this.T.ausente - 50) {
      applyMove(G, p, botChoose(G, p));
      return this.depoisDaAcao(p);
    }
    this.agendar(); await this.salvar();
    this.espalhar();   // atualiza quem está conectado
  }
  async depoisDaAcao(porRobo, extra) {
    const m = this.m;
    m.seq++; m.porRobo = porRobo; m.ultimo = m.turnoDesde = Date.now();
    this.agendar(extra);
    await this.salvar(); this.espalhar();
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
  vista(id) {
    const m = this.m, G = m.G;
    const minha = id ? m.cad.findIndex(c => c && c.id === id) : -1;
    let jogo = null;
    if (G) {
      // só a própria mão vai para cada celular; no fim da mão todas aparecem (o resultado mostra)
      jogo = Object.assign({}, G, {
        hands: G.hands.map((h, p) => p === minha || G.phase === 'handEnd' ? h : h.map(() => [-1, -1]))
      });
    }
    return { t: 'mesa', codigo: m.codigo, fase: m.fase, seq: m.seq, minha, dono: !!id && m.dono === id, porRobo: m.porRobo,
      cad: m.cad.map((c, p) => c ? { nome: c.nome, av: c.av, bot: !!c.bot, saiu: !!c.saiu, on: c.bot ? true : this.conectado(p) } : null),
      jogo, agora: Date.now() };
  }
  enviar(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  espalhar(menos) {
    if (!this.m) return;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === menos) continue;
      const a = ws.deserializeAttachment() || {};
      if (!a.id) continue;
      this.enviar(ws, this.vista(a.id));
    }
  }
  async salvar() { if (this.m) await this.ctx.storage.put('m', this.m); }
  async apagar() {
    for (const ws of this.ctx.getWebSockets()) { this.enviar(ws, { t: 'erro', cod: 'encerrada' }); try { ws.close(4001, 'encerrada'); } catch (e) {} }
    this.m = null;
    await this.ctx.storage.deleteAll();
    try { await this.ctx.storage.deleteAlarm(); } catch (e) {}
  }
}
