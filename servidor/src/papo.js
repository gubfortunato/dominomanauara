// Papo da mesa (3.42): conversa por escrito nas mesas com os amigos (a mesa rápida continua só com as frases prontas).
// - Frase pronta (o número da frase) vale sempre; texto livre só quando não há menor de 18 na mesa (sentado ou na fila).
// - Quem assiste só lê; quem assiste e é menor de 18 não recebe o texto livre.
// - Até 80 letras; no máximo 1 a cada 3 s e 10 por minuto por pessoa.
// - Barra palavrão (o filtro dos apelidos, palavra por palavra), link, telefone, e-mail, @ e convite para outro app.
// - As últimas 30 ficam na própria mesa enquanto ela existe (para quem chega ou volta) e somem quando a mesa fecha.
// - Só a mensagem denunciada (com as 10 de antes) é guardada, para o administrador ver, por até 30 dias.
import { nomeOfensivo } from './motor.js';

export const PAPO = { max: 80, intervalo: 3000, porMinuto: 10, guarda: 30, contexto: 10, denunciasPorHora: 5, dias: 30, repetida: 30000 };
const DIA = 86400000;

// Texto limpo: sem caracteres de controle nem invisíveis, um espaço entre as palavras
export function limparPapo(v) {
  return String(v == null ? '' : v).normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
export const tamanho = s => [...String(s || '')].length;

const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Ditos comuns que contêm palavra da lista dos apelidos e no papo são inocentes ("tá pau a pau", "deu pau", "rola um tacacá?")
const LIBERADOS = [/\bpau a pau\b/g, /\bdeu pau\b/g, /\brola\b/g];
// Palavrões que num apelido quase não aparecem, mas no papo sim
const PALAVRA_PAPO = ['krl', 'vtnc', 'vtmnc', 'tmnc', 'pnc', 'fuder', 'fudeu', 'fodeu', 'fodeo', 'fudeo', 'fudendo', 'fodendo', 'bct', 'prr', 'crl', 'cuzudo'];
const FRASE_PAPO = [/\bsenta (no meu|na minha|em mim|nele|no colo)\b/, /\bmama (no meu|na minha|aqui|nele)\b/, /\b(vai|va) (tomar|toma) no\b/];
// Convite para conversar fora do jogo (golpe, propaganda, "me chama no zap")
const APPS = ['zap', 'zapzap', 'zapp', 'zapi', 'whats', 'whatsapp', 'whatsap', 'watsap', 'watts', 'wats', 'uats', 'uatsap', 'wpp', 'wpps', 'whatz',
  'insta', 'instagram', 'telegram', 'telegran', 'tiktok', 'kwai', 'discord', 'facebook', 'face', 'snap', 'snapchat', 'pix', 'onlyfans', 'privacy'];
const APPS_PARTE = ['whatsap', 'watsap', 'instagram', 'telegra', 'tiktok', 'facebook', 'snapchat', 'discord', 'onlyfans'];

// Palavras do texto: separadas por espaço; a pontuação do começo e do fim sai ("puta!" -> "puta"), a de dentro fica
// (o filtro dos apelidos troca número e símbolo por letra: "p0rra", "p!ca"). Número sozinho ("120") não é palavra.
function palavras(t) {
  return t.split(' ').map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(w => /\p{L}/u.test(w));
}
// "p u t a", "f d p": letras soltas seguidas viram uma palavra
function soletradas(ws) {
  const out = []; let run = [];
  const fecha = () => { if (run.length >= 2) out.push(run.join('')); run = []; };
  for (const w of ws) { if (w.length <= 2) run.push(w); else fecha(); }
  fecha();
  return out;
}
const soLetras = w => semAcento(w).replace(/[^a-z]/g, '');

// null = pode; 'palavra' = palavrão; 'contato' = link, telefone, e-mail, @ ou outro app
export function papoRuim(txt) {
  const t = limparPapo(txt);
  // contato
  if (/[@＠]/.test(t)) return 'contato';
  if (/https?:|www\.|\b[a-z0-9-]{2,}\.(com|net|org|br|io|me|ly|gg|app|link|xyz|site|online|info|co|tv|shop|store|bet|vip)\b/i.test(semAcento(t))) return 'contato';
  if (/(\d[\s.\-()\/]*){8,}/.test(t)) return 'contato';   // telefone (8 números ou mais, com ou sem espaço e traço)
  const norm = semAcento(t).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const ws = palavras(t), letras = ws.map(soLetras), juntas = soletradas(ws).map(soLetras);
  if (letras.concat(juntas).some(w => APPS.includes(w) || APPS_PARTE.some(a => w.includes(a)))) return 'contato';
  // palavrão: frase feita; depois, sem os ditos liberados, o filtro dos apelidos palavra por palavra
  if (FRASE_PAPO.some(r => r.test(norm))) return 'palavra';
  let t2 = t; for (const r of LIBERADOS) t2 = t2.replace(new RegExp(r.source, 'gi'), ' ');
  const ws2 = palavras(t2);
  const testa = w => { const l = soLetras(w); return nomeOfensivo(w) || PALAVRA_PAPO.includes(l) || PALAVRA_PAPO.includes(l.replace(/(.)\1+/g, '$1')); };
  if (ws2.some(testa) || soletradas(ws2).some(testa)) return 'palavra';
  return null;
}

// ---------- Painel do administrador ----------
// GET /dono/papo -> mensagens denunciadas (30 dias), uma linha por mensagem, com quantas vezes e o que veio antes
export async function donoPapo(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  const agora = Date.now();
  try { await env.DB.prepare('DELETE FROM papo_denuncias WHERE em < ?').bind(agora - PAPO.dias * DIA).run(); } catch (e) {}
  const { results } = await env.DB.prepare(`SELECT mesa, msg_em, autor, MAX(autor_nome) AS autor_nome, MAX(texto) AS texto, MAX(contexto) AS contexto,
      COUNT(*) AS vezes, MIN(em) AS primeira, MAX(em) AS ultima, (SELECT 1 FROM bloqueios b WHERE b.aparelho = d.autor) AS bloq
    FROM papo_denuncias d GROUP BY mesa, msg_em, autor ORDER BY ultima DESC LIMIT 100`).all();
  const lista = (results || []).map(r => { let c = []; try { c = JSON.parse(r.contexto || '[]'); } catch (e) {} return Object.assign({}, r, { contexto: c, bloq: !!r.bloq }); });
  return h.json({ lista }, 200, origin);
}
// POST /dono/papo/apagar {mesa, msg_em, autor} -> já olhei: tira da lista
export async function donoPapoApagar(req, env, origin, h) {
  if (!(await h.ehDono(req, env))) return h.json({ erro: 'nao-autorizado' }, 401, origin);
  let b; try { b = await req.json(); } catch (e) { return h.json({ erro: 'formato' }, 400, origin); }
  if (!/^\d{5}$/.test(String(b.mesa || '')) || !Number.isInteger(b.msg_em) || !b.autor) return h.json({ erro: 'dados' }, 400, origin);
  await env.DB.prepare('DELETE FROM papo_denuncias WHERE mesa = ? AND msg_em = ? AND autor = ?').bind(String(b.mesa), b.msg_em, String(b.autor)).run();
  return h.json({ ok: true }, 200, origin);
}
