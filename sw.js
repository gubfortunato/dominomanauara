// Dominó Manauara: guarda o jogo no celular para abrir rápido e funcionar sem internet.
// Ao publicar uma versão nova, troque o número abaixo para os celulares baixarem tudo de novo.
const CACHE = 'dominomanauara-3.41.3-7cbdcc56';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacidade.html',
  './termos.html',
  './fonts/alfa-slab-one.woff',
  './fonts/figtree.woff',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/apple-touch-icon-v2.png',
  './icons/badge-96.png'
];

self.addEventListener('install', e => {
  // cache: 'reload' busca direto no servidor, sem pegar cópia velha guardada pelo navegador
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // versao.txt: sempre direto do servidor, nunca guardado (é como o app descobre que tem versão nova)
  if (new URL(req.url).pathname.endsWith('/versao.txt')) return;

  if (req.mode === 'navigate') {
    // Página: tenta a internet primeiro (pega a versão nova); com internet ruim ou sem internet, usa a guardada.
    e.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true }) || await caches.match('./index.html');
      // 'no-cache': sempre confere com o servidor se a página mudou (rápido quando não mudou)
      const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => putInCache(req, res));
      if (!cached) return net;
      net.catch(() => {});
      const slow = new Promise(r => setTimeout(() => r(cached), 3500));
      try { return await Promise.race([net, slow]); } catch (err) { return cached; }
    })());
    return;
  }

  // Fontes, ícones e o resto: o que já está guardado abre na hora.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => putInCache(req, res))));
});

// Lembretes para jogar: mostra a notificação que o servidor mandou.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { texto: e.data ? e.data.text() : '' }; }
  // 3.41: no Android, uma notificação com a mesma etiqueta trocava a anterior sem tocar nem vibrar (parecia que não chegou):
  // agora cada uma toca de novo (renotify), vibra e usa o ícone branco da barra de status. E fica guardada no celular para a
  // área de notificações do app (caixa), com o número para não repetir a mesma mensagem.
  const titulo = d.titulo || 'Dominó Manauara', texto = d.texto || 'A mesa tá montada. Bora uma partida?';
  const guardar = caches.open('dmz-caixa').then(c => c.put('./__caixa/' + (d.id || Date.now()), new Response(JSON.stringify({ id: d.id || null, titulo, texto, url: d.url || './', em: Date.now() }), { headers: { 'content-type': 'application/json' } }))).catch(() => {});
  e.waitUntil(Promise.all([guardar, self.registration.showNotification(titulo, {
    body: texto,
    icon: './icons/icon-192-v2.png',
    badge: './icons/badge-96.png',
    tag: d.tag || 'dominomanauara',
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: d.url || './' }
  }), self.clients.matchAll({ type: 'window' }).then(l => l.forEach(c => { try { c.postMessage({ tipo: 'caixa' }); } catch (err) {} }))]));
});
// Tocou na notificação: abre o jogo (ou traz para a frente se já estiver aberto).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  alvo.searchParams.set('origem', 'lembrete');
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 3.37.2: com o app aberto, traz para a frente e manda ir ao lugar do aviso (Rei da Calçada, Turma, renovar o apoio)
    for (const c of abertas) { if ('focus' in c) { await c.focus(); try { c.postMessage({ tipo: 'abrir', url: alvo.href }); } catch (err) {} return; } }
    await self.clients.openWindow(alvo.href);
  })());
});
