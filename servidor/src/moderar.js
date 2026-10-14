// Moderação automática das fotos da mesa online (Workers AI, modelo que enxerga imagem).
// A IA aprova a foto comum na hora e recusa nudez, violência, ofensa, preconceito, política, droga e propaganda.
// Quando ela fica em dúvida (ou a IA não responde), a foto espera o administrador, como antes.
const MODELOS = [
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', jeito: 'partes' },
  { id: '@cf/meta/llama-3.2-11b-vision-instruct', jeito: 'image', licenca: true }
];
const REGRAS = `You moderate profile photos for an online dominoes game for adults in Brazil. The photo is shown small next to the player's name, to the other players at the table.
REJECT the photo if it contains any of:
- nudity, underwear or lingerie, sexual or sexually suggestive poses or content (category "sexual");
- violence, blood, gore, injuries, weapons or people pointing weapons (category "violence");
- obscene or offensive gestures (like the middle finger), insults, mockery or degrading content (category "offensive");
- hate symbols, racism, prejudice, homophobia, transphobia, or mocking any group of people (category "hate");
- political content: politicians, candidates, political parties, election numbers, campaign material, political symbols, flags used as political propaganda, political slogans or protests (category "political");
- drugs, drug use or promotion of crime (category "drugs");
- advertising as the main subject: a banner, flyer, business card, price list, phone number, web address or QR code (category "advertising").
APPROVE ordinary photos: a person, a selfie, friends or family, a pet, a landscape, food, a football club shirt or badge, an ordinary drawing or meme without the problems above.
If you cannot tell, answer UNSURE.
Answer only with JSON, nothing else: {"verdict":"APPROVE"|"REJECT"|"UNSURE","category":"sexual"|"violence"|"offensive"|"hate"|"political"|"drugs"|"advertising"|"none"}`;
// Motivo que o jogador lê quando a foto é recusada
export const MOTIVOS = { sexual: 'nudez ou conteúdo sexual', violence: 'violência ou arma', offensive: 'gesto ou conteúdo ofensivo', hate: 'preconceito', political: 'conteúdo político', drugs: 'droga', advertising: 'propaganda ou texto', outra: 'não segue as regras' };
const CATS = Object.keys(MOTIVOS).filter(k => k !== 'outra');

function lerResposta(r) {
  let t = r && (r.response ?? (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) ?? r.result ?? r);
  if (t && typeof t === 'object' && (t.verdict || t.veredito)) return t;
  t = String(t || '');
  const j = t.match(/\{[\s\S]*?\}/);
  if (j) { try { return JSON.parse(j[0]); } catch (e) {} }
  const v = /REJECT/i.test(t) ? 'REJECT' : /UNSURE/i.test(t) ? 'UNSURE' : /APPROVE/i.test(t) ? 'APPROVE' : '';
  const c = CATS.find(k => new RegExp(k, 'i').test(t)) || 'none';
  return v ? { verdict: v, category: c } : null;
}
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error('prazo')), ms))]);
async function perguntar(env, mod, url) {
  const base = { max_tokens: 60, temperature: 0 };
  const msgs = [{ role: 'system', content: REGRAS }];
  if (mod.jeito === 'partes') return env.AI.run(mod.id, { ...base, messages: [...msgs, { role: 'user', content: [{ type: 'text', text: 'Classify this profile photo.' }, { type: 'image_url', image_url: { url } }] }] });
  return env.AI.run(mod.id, { ...base, messages: [...msgs, { role: 'user', content: 'Classify this profile photo.' }], image: url });
}
// -> { veredito: 'aprovar' | 'recusar' | 'duvida', categoria, modelo } ou null (sem IA, ou nenhum modelo respondeu)
export async function moderar(env, mime, dados) {
  if (!env.AI) return null;
  const url = `data:${mime};base64,${dados}`;
  for (const mod of MODELOS) {
    try {
      let r;
      try { r = await comPrazo(perguntar(env, mod, url), 25000); }
      catch (e) {
        // o modelo da Meta pede, uma vez, o aceite da licença
        if (!mod.licenca || !/agree|licen/i.test(String(e && e.message))) throw e;
        await comPrazo(env.AI.run(mod.id, { prompt: 'agree' }), 15000).catch(() => {});
        r = await comPrazo(perguntar(env, mod, url), 25000);
      }
      const v = lerResposta(r);
      if (!v) continue;
      const ver = String(v.verdict || v.veredito || '').toUpperCase(), cat = String(v.category || v.categoria || 'none').toLowerCase();
      const veredito = ver === 'APPROVE' ? 'aprovar' : ver === 'REJECT' ? 'recusar' : 'duvida';
      return { veredito, categoria: CATS.includes(cat) ? cat : (veredito === 'recusar' ? 'outra' : 'none'), modelo: mod.id };
    } catch (e) { /* tenta o próximo modelo */ }
  }
  return null;
}
// Imagem de teste (paisagem desenhada, 96×96) para conferir, depois de publicar, se a IA está respondendo
export const TESTE = { mime: 'image/jpeg', dados: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCABgAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDo6KKK9o8UKKKKACiiigAoop8UbTSrGg+ZjgUm1FXY0m3ZDKK2oNJgRB5wMjnryQB9KbcaRG65t/kb0JJBrylnGFc+TX16f5/gdrwNbl5vwMeilIKkgggjgg9qSvWOIKKKKBBRRRQAUUUUAFaeiqC8z4+YAAH65/wrMqzY3RtbgE/cbhv8a48fSnVw04Q3OjDTjCrGUtjoKKbHIkqB0YMrdCKSWaOBN8rBV6Zr4ZQk5cqWvY+j5la99DH1dQt4CByyAn9R/SqNS3Nw1zO0rcZ6DPQVFX3uFpyp0IQlukfNVpKdSUo7MKKKK6DEKKhuryCziMkzheOF7t9BXM6hrM95IRGzRQggqo4PHQk1zV8TCjvq+xSVzrKKw9N18NiG9OGJwJcAD8fSttWV1DKQykZBB4IrSlWhVV4sTVhaKKK1EPSWSLPlyMmeu04zSPI8hy7s56ZY5ptFTyxvzW1K5na1woooqiQrO1PWYdPDRj55sZA7L9f8Kzr7W7qZPLtonhHO5sZJ+nHFYNyrIFDKRn1FeVXx6ty0vvLURbq/nu5TJK5ZsYyfSohM475/Co6K8ttt3ZZZSQOPQ+laem6vNYsqMS9vnlO4z3H+FYsefMXAyScVc8qT/nm35U4TlTlzRdhM7W1uoryBZoWyp6juD6Gpa4q3kurWXzYN6PjGQvat2HXmdQJLUq4HPOAfpxXr0swpuP7zRkNGxRWX/bX/AE7/APj/AP8AWo/tr/p3/wDH/wD61a/XsP8Azfg/8hGpRWX/AG1/07/+P/8A1qP7a/6d/wDx/wD+tR9ew/8AN+D/AMgMuobqD7RDszgg5H1qaivnAMF43jba6lT702tHU/8All+P9KqW/wDx8R/74/nV8x6NLCOpSVS5asLR1cTSArj7qnrWhRRUN3PPbuFFFFIQUUUUAFFFFABRRRQA1o0fG9FbHTIzSCGIEERICOh2in0UFKckrJhRRRQSFFFFABRRRQAUUUUAf//Z' };
