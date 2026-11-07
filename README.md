# Tipout (PWA)

Cashout slip numbers from a photo, optional A/R, and expected vs received tips.
Static app + one serverless function (`/api/scan`) that reads the photo with Claude.
Everything a person saves lives on their own phone (localStorage), so there are no accounts and no database.

## Deploy (Netlify, about 5 minutes)

1. Push this folder to a GitHub repo.
2. Netlify > Add new site > Import from Git > pick the repo. No build command; publish directory `.` (netlify.toml already says so).
3. Site configuration > Environment variables:
   - Free: `GEMINI_API_KEY` = a key from aistudio.google.com > Get API key (no card needed). Optional `GEMINI_MODEL` (default `gemini-3.6-flash`; check ai.google.dev/gemini-api/docs/pricing for current free models). Google may use free-tier requests to improve its products, so photos of slips are seen by Google.
   - Paid alternative: `ANTHROPIC_API_KEY` = a key from console.anthropic.com (needs credits). Used only if no Gemini key is set.
   - `APP_CODE` = a shared code you give coworkers. Recommended: without it anyone with the URL can spend your credits.
   - `MODEL` = optional override (default `claude-sonnet-5-5`).
4. Deploy. If you use the paid Anthropic key, set a monthly spend limit in its console.

CLI alternative: `npm i -g netlify-cli && netlify deploy --prod` (set the env vars first with `netlify env:set`).

Local dev: `netlify dev` (needs the env vars in a `.env` file).

## Install on a phone

- iPhone: open the site in Safari > Share > Add to Home Screen.
- Android: Chrome menu > Install app.

First scan asks for the access code once, then remembers it.

## Files

- `index.html` the whole app (HTML, CSS, JS)
- `shim.js` resizes the photo and posts it to `/api/scan`
- `netlify/functions/scan.mjs` calls Claude; `prompts.mjs` holds the scan prompts (edit these to tune the A/R sheet reading)
- `sw.js`, `manifest.webmanifest`, `icons/` offline + installability

When you change `index.html` or `shim.js`, bump `CACHE` in `sw.js` (`tipout-v2`, ...) so installed copies pick it up.

## Notes

- Netlify's free tier times functions out at about 10 s. Photo reads usually take a few seconds.
- Data is per device. Clearing site data or switching phones starts a fresh ledger.
