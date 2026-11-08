// Tip-out rates live here (server side), not in the app's code.
// Netlify > Site configuration > Environment variables:
//   RATES     JSON, e.g. [{"name":"Upstairs","house":5,"bar":1.5},{"name":"Downstairs","house":4.5,"bar":2}]
//   APP_CODE  required. Without it this endpoint refuses to answer, so rates are never public.
// Change RATES in Netlify, then redeploy. Phones pick up the new rates the next time the app opens online.
export const config = { path: '/api/rates' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  const appCode = process.env.APP_CODE;
  if (!appCode) return json({ error: 'not configured', detail: 'APP_CODE is not set' }, 503);
  if (req.headers.get('x-app-code') !== appCode) return json({ error: 'code' }, 401);

  let raw;
  try { raw = JSON.parse(process.env.RATES || ''); } catch { return json({ error: 'not configured', detail: 'RATES is missing or not valid JSON' }, 503); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 8) return json({ error: 'not configured', detail: 'RATES must be a list of 1 to 8 areas' }, 503);

  const areas = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || {};
    const name = String(a.name || '').trim().slice(0, 30);
    const house = Number(a.house), bar = Number(a.bar);
    if (!name || !(house >= 0 && house <= 100) || !(bar >= 0 && bar <= 100)) return json({ error: 'not configured', detail: 'RATES entry ' + (i + 1) + ' is invalid' }, 503);
    areas.push({ id: 'a' + (i + 1), name, house, bar });
  }
  return json({ areas });
};
