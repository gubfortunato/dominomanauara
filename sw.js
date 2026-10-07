// Dominó Manauara: guarda o jogo no celular para abrir rápido e funcionar sem internet.
// Ao publicar uma versão nova, troque o número abaixo para os celulares baixarem tudo de novo.
const CACHE = 'dominomanauara-1.8.2-063c0f99';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacidade.html',
  './termos.html',
  './fonts/alfa-slab-one.woff',
  './fonts/figtree.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
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
  e.waitUntil(self.registration.showNotification(d.titulo || 'Dominó Manauara', {
    body: d.texto || 'A mesa tá montada. Bora uma partida?',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'dominomanauara',
    data: { url: d.url || './' }
  }));
});
// Tocou na notificação: abre o jogo (ou traz para a frente se já estiver aberto).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  alvo.searchParams.set('origem', 'lembrete');
  e.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertas) { if ('focus' in c) { await c.focus(); return; } }
    await self.clients.openWindow(alvo.href);
  })());
});
