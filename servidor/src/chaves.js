// 25/11: a chave de uma pessoa (a mesma do Hall da Fama, campeoes.js), para o app saber quem é quem sem o código do
// aparelho: o ranking manda a chave dos sócios e o Duelo entre sócios acha o desafiado por ela.
export async function chaveHall(ap) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hall|' + ap)));
  return [...b.slice(0, 6)].map(x => x.toString(16).padStart(2, '0')).join('');
}
