// 10/11 (revisão de segurança): o número da mesa com os amigos tem 5 algarismos (90 mil possibilidades) e, até aqui,
// dava para testar número por número sem limite: quem acertasse uma mesa aberta podia assistir e ler o papo. Agora cada
// rede pode errar até COD_ERRADOS_HORA números diferentes por hora (o mesmo número errado de novo não conta outra vez);
// passou disso, a busca e a entrada por número ficam travadas para essa rede até completar a hora.
// A rede vira um resumo (hash): o endereço nunca é guardado. No IPv6 vale o bloco do aparelho (/64), porque quem testa
// em massa troca o final do endereço à vontade. Os registros saem do banco em 2 horas (rotina da tarde).
import { sha, salRede, diaBR } from './planos.js';

export const COD_ERRADOS_HORA = 30;
const HORA = 3600000;

// IPv4 inteiro; IPv6 só os 4 primeiros blocos (expande o "::")
export function prefixoRede(ip) {
  ip = String(ip || '').trim().toLowerCase();
  if (!ip) return '';
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);   // IPv4 (também no formato ::ffff:1.2.3.4)
  const [a, b] = ip.split('::');
  const ini = a ? a.split(':') : [], fim = b != null && b ? b.split(':') : [];
  const meio = b != null ? Array(Math.max(0, 8 - ini.length - fim.length)).fill('0') : [];
  return ini.concat(meio, fim).slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':');
}
export async function marcaCodigo(ip, env) {
  const p = prefixoRede(ip);
  return p ? (await sha('cod|' + p + '|' + salRede(env, diaBR()))).slice(0, 24) : null;
}
// -> { marca, travado }. Falha do banco não trava ninguém.
export async function travaCodigo(env, ip) {
  const marca = await marcaCodigo(ip, env);
  if (!marca) return { marca: null, travado: false };
  try {
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM codigos_errados WHERE marca = ? AND em > ?').bind(marca, Date.now() - HORA).first();
    return { marca, travado: !!r && r.n >= COD_ERRADOS_HORA };
  } catch (e) { return { marca, travado: false }; }
}
export async function anotarCodigoErrado(env, marca, codigo) {
  if (!/^[0-9a-f]{24}$/.test(String(marca || '')) || !/^\d{5}$/.test(String(codigo || ''))) return;
  try {
    await env.DB.prepare('INSERT INTO codigos_errados (marca, codigo, em) VALUES (?, ?, ?) ON CONFLICT (marca, codigo) DO UPDATE SET em = excluded.em')
      .bind(marca, String(codigo), Date.now()).run();
  } catch (e) {}
}
export async function limparCodigos(env) {
  try { await env.DB.prepare('DELETE FROM codigos_errados WHERE em < ?').bind(Date.now() - 2 * HORA).run(); } catch (e) {}
}
