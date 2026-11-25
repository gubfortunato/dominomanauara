// 25/11 (pedido do dono): uma dica do jogo por semana, toda sexta de manhã (a partir das 9h em Manaus), no sino do app,
// na notificação (para quem ligou os avisos: só maiores de 18) e numa janela ao abrir o jogo (o app pega no sino). As dicas
// seguem esta lista na ordem, uma por semana, a partir de 27/11/2026, e recomeçam do início no fim. As que falam do Sócio da Calçada levam "apoio=" no link: no sino, o
// app não mostra para menor de 18 (como os outros avisos do plano). O app abre o lugar certo pelo "abrir=" do link.
const DIA = 86400000, SEMANA = 7 * DIA;
const INICIO = Date.UTC(2026, 10, 27, 12, 0, 0);   // sexta, 27/11/2026 (meio-dia UTC, para contar as semanas sem erro de fuso)
const socio = ver => `/?abrir=socio&ver=${ver}&apoio=dica`;
export const DICAS = [
  { t: 'Chame a turma pro dominó', x: 'Em "Jogar com os amigos", crie a mesa e mande o convite pelo WhatsApp. Cada um joga no seu celular, de onde estiver.', u: '/?abrir=amigos' },
  { t: 'Arrume a mão do seu jeito', x: 'Segure uma pedra e arraste pro lado: as outras abrem espaço. Dá pra arrumar até fora da sua vez, enquanto a turma joga.', u: '/' },
  { t: 'A carteira do Sócio da Calçada', x: 'Sócio tem carteira com número e foto, guardada no Perfil. Mostre pra turma no WhatsApp ou no Instagram!', u: socio('carteira') },
  { t: 'Missões do dia', x: 'Todo dia tem 3 missões novas e o Desafio do dia. Cada uma dá moral pra subir de nível, e quem completa 3, 7 e 15 dias ganha comida pro avatar.', u: '/' },
  { t: 'Papo de mesa', x: 'Na mesa com os amigos, toque em "Papo de mesa" e mande recado pra turma durante a partida. Sócio manda até áudio de 10 segundos.', u: socio('papo') },
  { t: 'Conquistas com gosto de Manaus', x: 'Cada conquista libera um prêmio pro seu avatar: tapioca com tucumã, cuia de tacacá, X-caboquinho... Veja a próxima no Perfil.', u: '/' },
  { t: 'Rei da Calçada', x: 'Cada vitória online contra pessoas vale 3 pontos no ranking. O sócio que mais pontua na semana vira o Rei da Calçada e joga de coroa.', u: '/?abrir=ranking&apoio=dica' },
  { t: 'Jogue sem arrastar', x: 'Toque na pedra e depois na ponta onde ela encaixa. Só ficam marcadas as pontas certas: sem erro e sem pressa.', u: '/' },
  { t: 'Monte a sua Turma', x: 'Junte até 40 amigos numa Turma, com nome e código pra chamar a galera. No Desafio das Confrarias, cada vitória de vocês conta ponto pra Turma.', u: '/?abrir=turma' },
  { t: 'Avatar do seu jeito', x: 'Sócio monta o avatar como quiser: pele, cabelo, rosto, roupa, o que leva na mão e o fundo. Fica no Perfil, em Personalizar.', u: socio('avatar') },
  { t: 'Cada mesa tem uma história', x: 'Ao trocar a mesa, toque em "Conheça a história das mesas": o Teatro, a Ponte, o boto, o tucumã... cada uma conta um pedaço de Manaus.', u: '/' },
  { t: 'Quarta dos Amigos', x: 'Toda quarta, das 20h às 23h, a sua mesa com os amigos fica liberada: quem você chamar joga sem limite. Já combina com a turma!', u: '/?abrir=amigos' },
  { t: 'Sua estante de troféus', x: 'No Perfil fica a sua estante: troféus de bronze, prata e ouro com 100, 500 e 1.000. Na mesa online, toque no avatar de alguém pra ver a dele.', u: '/' },
  { t: 'Sábado dos Torneios', x: 'Todo sábado, das 10h às 22h, tem torneio com tema: cada partida online conta ponto, e o sócio mais bem colocado vira Campeão do Sábado.', u: '/?abrir=ranking&apoio=dica' },
  { t: 'Trocou de celular?', x: 'O progresso do sócio fica guardado: no celular novo, use o código do plano em "Já sou sócio em outro celular" e leve nível, conquistas e avatar.', u: socio('nuvem') },
  { t: 'Hall da Fama', x: 'Em Mais › Hall da Fama ficam os campeões da Calçada: Rei da semana, Campeão do Mês, Copa e Sábado. E quem está na disputa agora.', u: '/?abrir=campeoes' },
  { t: 'Treine de cabeça', x: 'No jogo offline, ligue o Modo torneio: 20 segundos por jogada e sem o contador das pontas. Ótimo treino pra mesa online.', u: '/' }
];
// a dica da semana do dia (de Manaus) de `agora`, ou null antes da primeira
export function dicaDaSemana(agora) {
  const m = new Date((agora || Date.now()) - 4 * 3600000), dia = m.toISOString().slice(0, 10);
  const k = Math.floor((Date.parse(dia + 'T12:00:00Z') - INICIO) / SEMANA);   // a semana vai de sexta a quinta
  if (k < 0) return null;
  return Object.assign({ n: k % DICAS.length, semana: k }, DICAS[k % DICAS.length]);
}
// os avisos para a rotina (index.js, avisosDeEvento): só na sexta, das 9h ao meio-dia de Manaus (as rodadas da manhã)
export function avisosDicas(agora) {
  agora = agora || Date.now();
  const m = new Date(agora - 4 * 3600000), h = m.getUTCHours();
  if (m.getUTCDay() !== 5 || h < 9 || h >= 12) return [];
  const d = dicaDaSemana(agora); if (!d) return [];
  return [{ chave: 'dica:' + m.toISOString().slice(0, 10), para: 'todos', caixa: true, msg: { titulo: '💡 Dica da semana: ' + d.t, texto: d.x, url: d.u } }];
}
