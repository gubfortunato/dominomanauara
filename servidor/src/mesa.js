// Mesa online do Dominó Manauara: um Durable Object por mesa (código de 5 números).
// O servidor guarda as pedras e aplica as regras; cada celular só recebe a própria mão.
// Cadeiras vazias viram robôs da turma do bairro; quem cai da internet tem o lugar guardado
// e, se demorar na vez dele, um robô joga por ele até voltar.
// Mesa rápida: um objeto à parte (nome "fila") junta quem quer jogar com qualquer um. As mesas públicas
// começam sozinhas depois de uma espera curta (robôs nas cadeiras vazias) e quem chega depois entra no lugar de um robô.
import { newGame, startHand, legalMoves, applyMove, applyPass, nextHand, botChoose, tkey, nomeOfensivo, BOT_NAMES } from './motor.js';
import { nivelDoador } from './pagamentos.js';
import { fotoPublica } from './fotos.js';

const TEMPO = {
  jogada: 4500,      // robô: espera antes de jogar (igual ao jogo offline)
  passe: 3000,       // robô: espera antes de passar
  semPedra: 2600,    // pessoa sem pedra que encaixe: passa sozinha
  distribuir: 4300,  // tempo da animação de embaralhar e distribuir no celular
  ausente: 25000,    // pessoa sem conexão: o robô joga por ela depois disso
  conferir: 60000,   // vez de uma pessoa conectada: confere de novo se ela continua lá
  espera: 20000,     // mesa rápida: espera por mais gente antes de começar com robôs
  cheia: 2500        // mesa rápida completa: começa logo (dá tempo de ver quem sentou)
};
const FILA = { mesas: 20, idade: 60 * 60 * 1000 };   // mesas rápidas lembradas pela fila e por quanto tempo
const SILENCIO = 50000;
const REACAO = { intervalo: 2000, porMinuto: 8, maior: 23 };   // reações: só o número de uma frase pronta, nunca texto              // sem sinal do celular há 50 s: conta como desconectado
const VIDA = 24 * 60 * 60 * 1000;    // a mesa some 24 h depois da última ação

// Mesa (tema) escolhida por quem criou: todo mundo joga nela. Só o nome curto (madeira, ponte, teatro...).
const temaOk = v => typeof v === 'string' && /^[a-z]{3,16}$/.test(v) ? v : null;
const limpa = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export class Mesa {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.m = null; this.reacoes = {};
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
    if (url.pathname === '/reservar' && req.method === 'POST') return this.reservar(await req.json());
    if (url.pathname === '/fila' && req.method === 'POST') return this.naFila(await req.json());
    if (url.pathname === '/fila/status') return Response.json(await this.statusFila());
    if (url.pathname === '/info') {
      const m = this.viva();
      return Response.json(m ? { existe: true, fase: m.fase, publica: !!m.publica, humanos: m.cad.filter(c => c && !c.bot).length, livres: m.cad.filter(c => !c).length + (m.fase === 'jogo' ? m.cad.filter(c => c && c.bot && !c.saiu).length : 0) } : { existe: false });
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
    for (const so of ['espera', 'jogo']) {
      for (const x of l.slice()) {
        const r = await mesa(x.codigo).fetch('https://mesa/reservar', { method: 'POST', body: JSON.stringify(Object.assign({}, b, { so })) });
        if (r.status === 200) return fim(x.codigo, false);
        if (r.status === 410) l = l.filter(y => y.codigo !== x.codigo);   // acabou ou não serve mais
      }
    }
    for (let k = 0; k < 8; k++) {
      const codigo = String(10000 + Math.floor(Math.random() * 90000));
      const r = await mesa(codigo).fetch('https://mesa/criar', { method: 'POST', body: JSON.stringify({ id: b.id, nome: b.nome, av: b.av, bairro: b.bairro, codigo, publica: true }) });
      if (r.status === 201) { l.unshift({ codigo, criada: agora }); return fim(codigo, true); }
      if (r.status === 400) return Response.json({ erro: 'dados' }, { status: 400 });
    }
    return Response.json({ erro: 'tente-de-novo' }, { status: 503 });
  }
  // Quantas pessoas estão numa mesa rápida com lugar sobrando (esperando gente ou jogando com robô).
  // Só números, sem nome de ninguém; guardado por alguns segundos para não acordar as mesas a cada pergunta.
  async statusFila() {
    const agora = Date.now();
    if (this.resumo && agora - this.resumo.t < 8000) return this.resumo.v;
    const l = ((await this.ctx.storage.get('abertas')) || []).filter(x => agora - x.criada < FILA.idade);
    let pessoas = 0, mesas = 0, esperando = 0;
    for (const x of l) {
      try {
        const j = await (await this.env.MESA.get(this.env.MESA.idFromName(x.codigo)).fetch('https://mesa/info')).json();
        if (!j.existe || !j.publica || !(j.livres > 0) || !(j.humanos > 0)) continue;
        pessoas += j.humanos; mesas++; if (j.fase === 'espera') esperando += j.humanos;
      } catch (e) {}
    }
    this.resumo = { t: agora, v: { pessoas, mesas, esperando } };
    return this.resumo.v;
  }
  // Senta alguém da fila numa mesa pública (200), ou diz que não deu agora (409) ou que a mesa não serve mais (410)
  async reservar(b) {
    const m = this.viva();
    if (!m || !m.publica) return Response.json({ erro: 'nao' }, { status: 410 });
    const quem = this.pessoa(b);
    if (!quem) return Response.json({ erro: 'dados' }, { status: 400 });
    let p = m.cad.findIndex(c => c && c.id === quem.id);
    if (p >= 0) {
      const c = m.cad[p];
      if (c.saiu) { c.saiu = false; c.bot = false; }
    } else if (m.fase === 'espera') {
      if (b.so !== 'espera') return Response.json({ erro: 'cheia' }, { status: 409 });
      // o segundo senta de adversário, o terceiro de parceiro do primeiro, o quarto completa
      p = [1, 2, 3, 0].find(k => !m.cad[k]);
      if (p == null) return Response.json({ erro: 'cheia' }, { status: 409 });
      quem.nome = this.nomeUnico(quem.nome, -1);
      m.cad[p] = quem;
      if (m.cad.every(c => c && !c.bot)) m.iniciaEm = Math.min(m.iniciaEm || Infinity, Date.now() + this.T.cheia);
    } else {
      if (b.so !== 'jogo') return Response.json({ erro: 'cheia' }, { status: 409 });
      // na mesa rápida, quem saiu de vez libera a cadeira (o robô que estava no lugar dá a vez)
      p = m.cad.findIndex(c => c && c.bot);
      if (p < 0) return Response.json({ erro: 'cheia' }, { status: 409 });
      quem.nome = this.nomeUnico(quem.nome, p);
      m.cad[p] = quem; m.G.names[p] = quem.nome;
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
    if (nome.length < 2 || nomeOfensivo(nome)) nome = 'Jogador';
    const av = /^[a-z0-9_-]{1,16}$/i.test(String(b.av || '')) ? String(b.av) : null;
    let bairro = limpa(b.bairro, 28);
    if (bairro.length < 2 || nomeOfensivo(bairro)) bairro = null;
    return { id, nome, av, bairro, bot: false, saiu: false };
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
      case 'comecar': if (p >= 0) return m.publica ? this.comecarPublica() : this.comecar(); return;
      case 'jogar': if (p >= 0) return this.jogar(ws, p, msg); return;
      case 'proxima': if (p >= 0) return this.proxima(msg); return;
      case 'sair': if (p >= 0) return this.sair(ws, p); return;
      case 'reacao': if (p >= 0) return this.reagir(p, msg.k); return;
      case 'mesa': if (p >= 0 && m.cad[p].id === m.dono) return this.trocarTema(msg.id); return;
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
      const d = await this.env.DB.prepare("SELECT COALESCE(SUM(valor), 0) AS t FROM pedidos WHERE aparelho = ? AND status = 'pago' AND produto LIKE 'doacao%'").bind(id).first();
      let foto = null; try { foto = await fotoPublica(this.env, id); } catch (e) {}
      return { apoiador: !!(p && p.ate > Date.now()), doador: nivelDoador((d && d.t) || 0), foto };
    } catch (e) { return { apoiador: false, doador: 0, foto: null }; }
  }
  async entrar(ws, att, msg) {
    const m = this.m;
    const quem = this.pessoa(msg);
    if (!quem) return this.enviar(ws, { t: 'erro', cod: 'dados' });
    Object.assign(quem, await this.apoiador(quem.id));
    let p = m.cad.findIndex(c => c && c.id === quem.id);
    if (p >= 0) {
      // voltou (ou abriu em outro aparelho): retoma a cadeira; se tinha saído, volta a jogar
      const c = m.cad[p];
      if (m.fase === 'espera') { c.nome = quem.nome; c.av = quem.av; c.bairro = quem.bairro; }
      c.apoiador = quem.apoiador; c.doador = quem.doador; c.foto = quem.foto;
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
    // a mesa de quem criou vale para todos (até ele trocar)
    if (!m.tema && m.dono === quem.id && temaOk(msg.mesa)) m.tema = msg.mesa;
    m.ultimo = Date.now();
    if (m.fase === 'jogo') this.agendar();
    await this.salvar();
    this.espalhar();
  }
  async trocarTema(id) {
    const m = this.m, t = temaOk(id);
    if (!t || t === m.tema) return;
    m.tema = t; m.ultimo = Date.now();
    await this.salvar(); this.espalhar();
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
    m.fase = 'jogo'; m.seq++; m.porRobo = null; m.iniciaEm = null;
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

  // Reação rápida: frase pronta (o celular sabe o texto pelo número). Sem gravar nada; com limite por pessoa.
  reagir(p, k) {
    if (this.m.fase !== 'jogo' || !Number.isInteger(k) || k < 0 || k > REACAO.maior) return;
    const agora = Date.now();
    const h = (this.reacoes[p] || []).filter(t => agora - t < 60000);
    if ((h.length && agora - h[h.length - 1] < REACAO.intervalo) || h.length >= REACAO.porMinuto) return;
    h.push(agora); this.reacoes[p] = h;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.id) this.enviar(ws, { t: 'reacao', p, k });
    }
  }

  // ---------- Relógio: robôs, passe automático e quem caiu ----------
  agendar(extra) {
    const m = this.m, G = m.G;
    m.proximo = null;
    if (m.fase === 'espera' && m.publica && m.iniciaEm) m.proximo = m.iniciaEm;
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
    if (m.fase === 'espera' && m.publica && m.iniciaEm && agora >= m.iniciaEm - 50) return this.comecarPublica();
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
      tema: m.tema || null, publica: !!m.publica, iniciaEm: m.fase === 'espera' && m.iniciaEm ? m.iniciaEm : null,
      cad: m.cad.map((c, p) => c ? { nome: c.nome, av: c.av, bairro: c.bot ? null : c.bairro || null, bot: !!c.bot, saiu: !!c.saiu, apoiador: !!c.apoiador && !c.saiu, doador: c.saiu ? 0 : (c.doador || 0), foto: c.saiu || c.bot ? null : (c.foto || null), on: c.bot ? true : this.conectado(p) } : null),
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
