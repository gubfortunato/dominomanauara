// Confere a mesa online publicada: cria uma mesa, entra pelo WebSocket, lê a resposta e sai (a mesa some).
const url = process.argv[2];
const id = 'teste-publicacao-0001';
const r = await fetch(url + '/mesa/nova', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dominomanauara.com.br' },
  body: JSON.stringify({ id, nome: 'Teste', av: 'a1' }) });
const j = await r.json().catch(() => ({}));
if (r.status !== 201) { console.log('criar mesa: código ' + r.status + ' ' + JSON.stringify(j)); process.exit(0); }
const resumo = await new Promise(res => {
  const ws = new WebSocket(url.replace(/^http/, 'ws') + '/mesa/' + j.codigo + '/ws');
  const t = setTimeout(() => res('sem resposta em 10 s'), 10000);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'entrar', id, nome: 'Teste', av: 'a1' }));
  ws.onmessage = e => {
    clearTimeout(t);
    try { const m = JSON.parse(e.data); res(`fase ${m.fase}, cadeira ${m.minha}, ${m.cad.filter(Boolean).length} sentado`); ws.send(JSON.stringify({ t: 'sair' })); }
    catch (x) { res('resposta estranha: ' + String(e.data).slice(0, 80)); }
    setTimeout(() => { try { ws.close(); } catch (x) {} }, 400);
  };
  ws.onerror = () => { clearTimeout(t); res('erro no WebSocket'); };
});
console.log(`mesa ${j.codigo}: ${resumo}`);
setTimeout(() => process.exit(0), 600);
