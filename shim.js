/* Stand-in for the Claude artifact runtime. The app only needs one thing from it:
   sample.json(kind, {images: file}) -> parsed JSON. Here that posts a resized photo to /api/scan.
   Saving uses localStorage (the app falls back to it when there is no db/user). */
(function () {
  'use strict';
  var CODE_KEY = 'tipout.code';

  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  function toBlobUrlImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(err('image_rejected')); };
      img.src = url;
    });
  }

  // Resize to max 1800px and re-encode as JPEG so uploads stay small and iPhone photos (HEIC) become JPEG.
  function prepare(file) {
    var MAX = 1800;
    function draw(src, w, h) {
      var s = Math.min(1, MAX / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) {
          if (!b) return reject(err('image_rejected'));
          var r = new FileReader();
          r.onload = function () { resolve(String(r.result).split(',')[1]); };
          r.onerror = function () { reject(err('image_rejected')); };
          r.readAsDataURL(b);
        }, 'image/jpeg', 0.85);
      });
    }
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bm) {
        return draw(bm, bm.width, bm.height);
      }).catch(function () { return viaImg(); });
    }
    return viaImg();
    function viaImg() {
      return toBlobUrlImage(file).then(function (o) {
        return draw(o.img, o.img.naturalWidth, o.img.naturalHeight).then(function (d) { URL.revokeObjectURL(o.url); return d; });
      });
    }
  }

  function post(body, retried) {
    var code = ''; try { code = localStorage.getItem(CODE_KEY) || ''; } catch (e) {}
    return fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', 'x-app-code': code }, body: JSON.stringify(body) })
      .catch(function () { throw err('network', 'No connection.'); })
      .then(function (res) {
        if (res.status === 401 && !retried) {
          var c = window.prompt('Access code'); if (!c) throw err('session_expired');
          try { localStorage.setItem(CODE_KEY, c.trim()); } catch (e) {}
          return post(body, true);
        }
        if (res.status === 401) { try { localStorage.removeItem(CODE_KEY); } catch (e) {} throw err('session_expired'); }
        if (res.status === 429) throw err('rate_limited');
        if (res.status === 400 || res.status === 413 || res.status === 415) throw err('image_rejected');
        if (!res.ok) return res.json().catch(function () { return {}; }).then(function (d) { var e = err('server'); e.detail = d && d.detail ? String(d.detail) : ('http ' + res.status); throw e; });
        return res.json();
      });
  }

  // Photo scanning switch (per device). Off = no photo is ever read or sent anywhere.
  var SCAN_KEY = 'tipout.scan';
  function scanOn() { try { return localStorage.getItem(SCAN_KEY) !== 'off'; } catch (e) { return true; } }
  function setScanOn(v) {
    try { localStorage.setItem(SCAN_KEY, v ? 'on' : 'off'); } catch (e) {}
    try { window.dispatchEvent(new Event('tipout:scan')); } catch (e) {}
  }
  window.TIPOUT_SCAN = { on: scanOn, set: setScanOn };

  // Tip-out rates come from the server (/api/rates), never from the app's code.
  // Cached on this phone so the app still works offline; refreshed whenever it opens online.
  var RATES_KEY = 'tipout.rates';
  function cachedRates() { try { var a = JSON.parse(localStorage.getItem(RATES_KEY) || 'null'); return Array.isArray(a) && a.length ? a : null; } catch (e) { return null; } }
  function getRates(retried) {
    var code = ''; try { code = localStorage.getItem(CODE_KEY) || ''; } catch (e) {}
    return fetch('/api/rates', { headers: { 'x-app-code': code }, cache: 'no-store' })
      .catch(function () { return { offline: true }; })
      .then(function (res) {
        if (res.offline) return { areas: cachedRates(), why: 'offline' };
        if (res.status === 401 && !retried) {
          var c = window.prompt('Access code'); if (!c) return { areas: cachedRates(), why: 'code' };
          try { localStorage.setItem(CODE_KEY, c.trim()); } catch (e) {}
          return getRates(true);
        }
        if (res.status === 401) { try { localStorage.removeItem(CODE_KEY); } catch (e) {} return { areas: cachedRates(), why: 'code' }; }
        if (!res.ok) return { areas: cachedRates(), why: 'server' };
        return res.json().then(function (d) {
          if (d && Array.isArray(d.areas) && d.areas.length) { try { localStorage.setItem(RATES_KEY, JSON.stringify(d.areas)); } catch (e) {} return { areas: d.areas, why: '' }; }
          return { areas: cachedRates(), why: 'server' };
        }).catch(function () { return { areas: cachedRates(), why: 'server' }; });
      });
  }
  window.TIPOUT_RATES = { get: function () { return getRates(false); }, cached: cachedRates };

  var sample = {
    limits: function () { return Promise.resolve({ images: scanOn() }); },
    json: function (kind, opts) {
      if (!scanOn()) return Promise.reject(err('sampling_disabled'));
      var file = opts && opts.images;
      if (!file) return Promise.reject(err('image_rejected'));
      var m = /^ar:(\d+)$/.exec(String(kind));
      var body = { kind: m ? 'ar' : (kind === 'bar' ? 'bar' : 'cashout') }; if (m) body.arNumber = m[1];
      return prepare(file).then(function (data) { body.image = data; return post(body, false); });
    }
  };

  window.claude = { use: function (name) { return Promise.resolve(name === 'sample' ? sample : null); } };
})();
