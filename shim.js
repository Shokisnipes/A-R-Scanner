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
        if (!res.ok) throw err('server');
        return res.json();
      });
  }

  var sample = {
    limits: function () { return Promise.resolve({ images: true }); },
    json: function (kind, opts) {
      var file = opts && opts.images;
      if (!file) return Promise.reject(err('image_rejected'));
      var m = /^ar:(\d+)$/.exec(String(kind));
      var body = { kind: m ? 'ar' : 'cashout' }; if (m) body.arNumber = m[1];
      return prepare(file).then(function (data) { body.image = data; return post(body, false); });
    }
  };

  window.claude = { use: function (name) { return Promise.resolve(name === 'sample' ? sample : null); } };
})();
