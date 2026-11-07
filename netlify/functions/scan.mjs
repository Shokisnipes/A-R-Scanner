import { CASHOUT, arPrompt } from './prompts.mjs';

// Env vars (Netlify > Site configuration > Environment variables):
//   GEMINI_API_KEY     free option (Google AI Studio). Used first if set.
//   GEMINI_MODEL       optional, defaults to gemini-3.6-flash
//   ANTHROPIC_API_KEY  paid option, used if no Gemini key is set
//   MODEL              optional Claude model, defaults to claude-sonnet-5-5
//   APP_CODE           optional shared access code; if set, requests must send it
export const config = { path: '/api/scan' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const appCode = process.env.APP_CODE;
  if (appCode && req.headers.get('x-app-code') !== appCode) return json({ error: 'code' }, 401);
  const gKey = process.env.GEMINI_API_KEY, aKey = process.env.ANTHROPIC_API_KEY;
  if (!gKey && !aKey) return json({ error: 'not configured' }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad body' }, 400); }
  const { kind, arNumber, image } = body || {};
  if (typeof image !== 'string' || !image || image.length > 5_500_000) return json({ error: 'image' }, 413);
  if (!/^[A-Za-z0-9+/=]+$/.test(image)) return json({ error: 'image' }, 400);

  let prompt;
  if (kind === 'cashout') prompt = CASHOUT;
  else if (kind === 'ar' && /^\d{1,12}$/.test(String(arNumber || ''))) prompt = arPrompt(arNumber);
  else return json({ error: 'kind' }, 400);

  let res, text;
  try {
    if (gKey) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': gKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
      });
    } else {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.MODEL || 'claude-sonnet-5-5',
          max_tokens: 700,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: prompt }
          ] }]
        })
      });
    }
  } catch { return json({ error: 'upstream' }, 502); }

  if (res.status === 429) return json({ error: 'rate' }, 429);
  if (!res.ok) return json({ error: 'upstream', status: res.status }, 502);

  const data = await res.json();
  if (gKey) text = ((data.candidates || [])[0]?.content?.parts || []).map((x) => x.text || '').join('');
  else text = (data.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return json({ error: 'unreadable' }, 502);
  try { return json(JSON.parse(text.slice(a, b + 1))); } catch { return json({ error: 'unreadable' }, 502); }
};
