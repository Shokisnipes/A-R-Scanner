/* Bar tab: split the night's bar tips by hours, then text the result. Mirrors the paper "Bartender Hours" sheet:
   Total tips / Total hours = Hourly, then each bartender = hours x hourly. All money in integer cents. */
(function () {
  'use strict';
  var KEY = 'tipout.bar', MAX = 7;
  var BAR_PROMPT = "This is a photo of a filled-in \"BARTENDER HOURS\" sheet from a restaurant bar. Reply with JSON only: {\"bar\": \"day\"|\"night\"|null, \"bartenders\": [{\"name\": string, \"start\": \"HH:MM\"|null, \"end\": \"HH:MM\"|null, \"hours\": number|null}], \"totalTips\": number|null, \"totalHours\": number|null, \"hourly\": number|null}\n- bar: which of DAY BAR or NIGHT BAR is circled, ticked or underlined. null if neither is marked.\n- bartenders: one entry per filled-in numbered line (1 to 7), in order. Skip blank lines. name exactly as written.\n- start and end: the START and END columns as 24-hour HH:MM. If am/pm is not written, use the written hours to decide: pick the am/pm that makes end minus start (crossing midnight if needed) match them. With no written hours, for night bar treat 4 to 11 as PM and 12 to 3 as AM, and for day bar treat 9 to 11 as AM and 12 to 5 as PM. hours: the number in the HOURS column on that line, or null if empty.\n- totalTips: the dollar amount in the TOTAL TIPS box. totalHours: the number in the TOTAL HOURS box. hourly: the dollar amount in the big HOURLY box at the bottom, not the small HOURLY boxes on each line. null if blank.\n- Read the handwriting carefully. A handwritten 1 and 7 are easy to confuse, so check that end minus start matches the HOURS number and prefer the reading that does. Never guess. Use null when something is unreadable.";
  var root = document.getElementById('bar-root');
  if (!root) return;

  function ownName() { try { var d = JSON.parse(localStorage.getItem('tipout.v3')); return (d && d.name) || ''; } catch (e) { return ''; } }
  function blankRow(name) { return { name: name || '', start: '', end: '' }; }
  function fresh() { return { kind: 'night', rows: [blankRow(ownName()), blankRow()], tips: '', phones: ['', ''] }; }
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.rows) && d.rows.length) { d.phones = d.phones || ['', '']; return d; } } catch (e) {}
    return fresh();
  }
  var st = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(s) { return root.querySelector(s); }

  function toMin(t) { var m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  // hundredths of an hour; an end at or before the start means the shift crossed midnight
  function h100(r) {
    var a = toMin(r.start), b = toMin(r.end); if (a == null || b == null) return 0;
    var m = b - a; if (m <= 0) m += 1440; return Math.round(m / 60 * 100);
  }
  function hrs(h) { return (h / 100).toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''); }
  function money(c) { return (c / 100).toFixed(2); }
  function label(r, i) { return (r.name || '').trim() || ('Bartender ' + (i + 1)); }

  function compute() {
    var tipsC = Math.round((parseFloat(st.tips) || 0) * 100);
    var people = st.rows.map(function (r, i) { return { i: i, name: label(r, i), h: h100(r) }; }).filter(function (p) { return p.h > 0; });
    var totalH = people.reduce(function (a, p) { return a + p.h; }, 0);
    var out = { tipsC: tipsC, totalH: totalH, people: people, hourlyC: 0, ok: tipsC > 0 && totalH > 0, paid: 0 };
    if (!out.ok) return out;
    out.hourlyC = Math.floor((tipsC * 100 * 2 + totalH) / (2 * totalH));          // round half up
    people.forEach(function (p) { p.c = Math.floor((out.hourlyC * p.h * 2 + 100) / 200); out.paid += p.c; });
    return out;
  }

  function dateStr() { try { return new Date(Date.now() - 5 * 3600 * 1000).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', ''); } catch (e) { return ''; } }
  function message(c) {
    var lines = [(st.kind === 'day' ? 'Day bar' : 'Night bar') + (dateStr() ? ' · ' + dateStr() : ''),
      'Tips $' + money(c.tipsC) + ' · ' + hrs(c.totalH) + ' hrs · $' + money(c.hourlyC) + '/hr'];
    c.people.forEach(function (p) { lines.push(p.name + ' ' + hrs(p.h) + 'h $' + money(p.c)); });
    return lines.join('\n');
  }

  function toast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  var statusMsg = '', statusCls = '', busy = false, sample = undefined;
  var SCAN_MSG = { not_granted: 'Photo reading was not allowed.', sampling_disabled: 'Photo reading is not available.', rate_limited: 'Try again in a minute.', image_rejected: 'That photo could not be used.', session_expired: 'Wrong access code.', network: 'No connection.', server: 'Reading failed.' };
  function getSample() {
    if (window.TIPOUT_SCAN && !window.TIPOUT_SCAN.on()) return Promise.resolve(null);
    if (sample !== undefined) return Promise.resolve(sample);
    if (!(window.claude && window.claude.use)) { sample = null; return Promise.resolve(null); }
    return window.claude.use('sample').then(function (sm) {
      return sm && sm.limits ? sm.limits().then(function (l) { sample = l && l.images ? sm : null; return sample; }) : (sample = null);
    }).catch(function () { sample = null; return null; });
  }
  function setStatus(msg, cls) { statusMsg = msg || ''; statusCls = cls || ''; var el = $('#bar-status'); if (el) { el.textContent = statusMsg; el.className = 'status' + (statusCls ? ' ' + statusCls : ''); } }
  function setBusy(on) { busy = on; var bt = $('#bar-scan'); if (bt) { bt.disabled = on; bt.textContent = on ? 'Reading…' : 'Scan sheet'; } }
  function normTime(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t).trim()); if (!m) return '';
    var h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return '';
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }
  function addH(t, h) { var m = toMin(t); if (m == null) return ''; m = (m + h * 60) % 1440; if (m < 0) m += 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  // Use the hours written on the sheet to settle am/pm slips: try flipping start and/or end by 12 hours.
  function fmt12(t) { var m = toMin(t); if (m == null) return ''; var h = Math.floor(m / 60), mi = m % 60; return ((h % 12) || 12) + ':' + String(mi).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); }
  // Nobody works under 2 hours on this sheet. A handwritten 1 and 7 look alike, so if the end hour is a 7 or a 1 and the shift is
  // too short, try the other digit (with am or pm) and keep the one that gives a normal shift length.
  function fixShort(row) {
    if (!row.start || !row.end) return row;
    var h = h100(row);
    if (h > 1200) {   // over 12 hours is not a real shift: probably an am/pm slip, so try flipping am/pm
      var flips = [{ s: row.start, e: addH(row.end, 12) }, { s: addH(row.start, 12), e: row.end }];
      for (var j = 0; j < flips.length; j++) {
        var rr = { name: row.name, start: flips[j].s, end: flips[j].e }, dd = h100(rr);
        if (dd >= 200 && dd <= 1200 && (st.kind === 'day' || toMin(rr.start) >= 14 * 60)) { rr.fixedShort = true; return rr; }
      }
      return row;
    }
    if (h >= 200) return row;
    var m = toMin(row.end), h12 = (Math.floor(m / 60) % 12) || 12, mi = m % 60, swap = h12 === 7 ? 1 : (h12 === 1 ? 7 : 0);
    if (!swap) return row;
    var opts = [swap % 12, swap % 12 + 12].map(function (hh) { return String(hh).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); });
    for (var i = 0; i < opts.length; i++) {
      var r = { name: row.name, start: row.start, end: opts[i] }, d = h100(r);
      if (d >= 200 && d <= 1200) return { name: row.name, start: row.start, end: opts[i], fixedShort: true };
    }
    return row;
  }
  function reconcile(row, written) {
    if (written == null || !(written > 0)) return fixShort(row);
    if (row.start && !row.end) return { name: row.name, start: row.start, end: addH(row.start, written) };
    if (row.end && !row.start) return { name: row.name, start: addH(row.end, -written), end: row.end };
    if (!row.start || !row.end) return row;
    var ok = function (r) { return Math.abs(h100(r) / 100 - written) <= 0.06; };
    // a realistic start: night bar starts mid-afternoon or later, day bar starts in the morning to early afternoon
    var plausible = function (r) { var m = toMin(r.start); return st.kind === 'day' ? (m >= 8 * 60 && m < 15 * 60) : (m >= 14 * 60); };
    var cands = [row, { name: row.name, start: row.start, end: addH(row.end, 12) }, { name: row.name, start: addH(row.start, 12), end: row.end },
      { name: row.name, start: addH(row.start, 12), end: addH(row.end, 12) }].filter(ok);
    if (cands.length) return cands.filter(plausible)[0] || cands[0];
    // no am/pm reading explains it, so a digit was probably misread (a handwritten 1 looks like a 7): trust the written hours
    var start = plausible(row) ? row.start : addH(row.start, 12);
    return { name: row.name, start: start, end: addH(start, written), derived: true };
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function scan(file) {
    setBusy(true); setStatus('', '');
    getSample().then(function (sm) {
      if (!sm) throw { code: 'sampling_disabled' };
      return sm.json(window.BAR_PROMPT_KIND || BAR_PROMPT, { images: file });
    }).then(function (r) {
      r = r || {};
      var list = Array.isArray(r.bartenders) ? r.bartenders.filter(function (x) { return x && (String(x.name || '').trim() || x.start || x.end); }).slice(0, MAX) : [];
      if (!list.length) { setStatus('Could not read the sheet. Retake the photo.', 'err'); return; }
      if (r.bar === 'day' || r.bar === 'night') st.kind = r.bar;
      st.rows = list.map(function (x) { return reconcile({ name: String(x.name || '').trim().slice(0, 40), start: normTime(x.start), end: normTime(x.end) }, num(x.hours)); });
      var tips = num(r.totalTips); if (tips != null && tips > 0) st.tips = tips.toFixed(2);
      var derived = st.rows.filter(function (x) { return x.derived; }).map(function (x) { return x.name || 'a bartender'; });
      var fixed = st.rows.filter(function (x) { return x.fixedShort; }).map(function (x) { return (x.name || 'A bartender') + ' ends ' + fmt12(x.end); });
      st.rows.forEach(function (x) { delete x.derived; delete x.fixedShort; });
      save(); build();
      var warns = [];
      list.forEach(function (x, i) {
        var row = st.rows[i], w = num(x.hours), h = h100(row);
        if (!h) warns.push('times for ' + label(row, i));
        else if (w != null && Math.abs(h / 100 - w) > 0.06) warns.push('hours for ' + label(row, i) + ' (' + hrs(h) + ' vs ' + w + ' on sheet)');
      });
      if (tips == null || tips <= 0) warns.push('total tips');
      var c = compute(), sh = num(r.hourly);
      if (c.ok && sh != null && Math.abs(Math.round(sh * 100) - c.hourlyC) > 1) warns.push('hourly (' + money(c.hourlyC) + ' vs ' + sh.toFixed(2) + ' on sheet)');
      var tH = num(r.totalHours);
      if (c.ok && tH != null && Math.abs(c.totalH / 100 - tH) > 0.06) warns.push('total hours (' + hrs(c.totalH) + ' vs ' + tH + ' on sheet)');
      if (warns.length) setStatus('Check ' + warns.join(', ') + '.', 'err');
      else if (fixed.length) setStatus('That shift looked off, so I changed it: ' + fixed.join(', ') + '.', '');
      else if (derived.length) setStatus('End time set from the hours written for ' + derived.join(', ') + '.', '');
      else setStatus('', '');
    }).catch(function (e) {
      setStatus((SCAN_MSG[e && e.code] || 'Could not read the sheet.') + (e && e.detail ? ' (' + e.detail + ')' : '') + ' Retake the photo.', 'err');
    }).then(function () { setBusy(false); });
  }

  function build() {
    var rows = st.rows.map(function (r, i) {
      return '<div class="bar-row">' +
        '<div class="bar-top"><input type="text" data-i="' + i + '" data-k="name" placeholder="Bartender ' + (i + 1) + '" value="' + esc(r.name) + '" autocomplete="off" aria-label="Bartender ' + (i + 1) + ' name">' +
        (st.rows.length > 1 ? '<button class="bar-x" type="button" data-rm="' + i + '" aria-label="Remove bartender ' + (i + 1) + '">×</button>' : '') + '</div>' +
        '<div class="bar-times">' +
        '<div class="field"><label for="bs-' + i + '">Start</label><input type="time" id="bs-' + i + '" data-i="' + i + '" data-k="start" value="' + esc(r.start) + '"></div>' +
        '<div class="field"><label for="be-' + i + '">End</label><input type="time" id="be-' + i + '" data-i="' + i + '" data-k="end" value="' + esc(r.end) + '"></div>' +
        '<div class="bar-hrs"><span class="lbl">Hours</span><b data-h="' + i + '">0</b></div></div></div>';
    }).join('');
    root.innerHTML =
      '<button class="btn big" type="button" id="bar-scan">Scan sheet</button><input type="file" id="bar-photo" accept="image/*" hidden><div class="status" id="bar-status" role="status" aria-live="polite" style="text-align:center"></div>' +
      '<div class="block"><div class="bar-seg" role="group" aria-label="Which bar">' +
      '<button type="button" data-kind="day" aria-pressed="' + (st.kind === 'day') + '">Day bar</button>' +
      '<button type="button" data-kind="night" aria-pressed="' + (st.kind === 'night') + '">Night bar</button></div>' +
      '<div class="bar-rows">' + rows + '</div>' +
      (st.rows.length < MAX ? '<button class="btn ghost small" type="button" id="bar-add">Add bartender</button>' : '') + '</div>' +
      '<div class="block"><div class="field"><label for="bar-tips">Total tips</label>' +
      '<input type="number" id="bar-tips" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + esc(st.tips) + '"></div></div>' +
      '<div class="answer" id="bar-ans" hidden></div>' +
      '<div class="block bar-send"><div class="grid2">' +
      '<div class="field"><label for="bar-p0">Manager number</label><input type="tel" id="bar-p0" data-p="0" inputmode="tel" autocomplete="off" value="' + esc(st.phones[0] || '') + '"></div>' +
      '<div class="field"><label for="bar-p1">Bartender number</label><input type="tel" id="bar-p1" data-p="1" inputmode="tel" autocomplete="off" value="' + esc(st.phones[1] || '') + '"></div></div>' +
      '<button class="btn" type="button" id="bar-send" disabled>Send</button>' +
      '<div class="bar-actions"><button class="btn ghost small" type="button" id="bar-copy" disabled>Copy</button>' +
      '<button class="btn danger small" type="button" id="bar-new">New night</button></div></div>';
    setStatus(statusMsg, statusCls); setBusy(busy);
    getSample().then(function (sm) { var bt = $('#bar-scan'); if (bt && !sm) bt.hidden = true; });
    update();
  }

  function update() {
    var c = compute();
    st.rows.forEach(function (r, i) { var el = root.querySelector('[data-h="' + i + '"]'); if (el) el.textContent = hrs(h100(r)); });
    var ans = $('#bar-ans'), send = $('#bar-send'), copy = $('#bar-copy');
    ans.hidden = !c.ok; send.disabled = copy.disabled = !c.ok;
    if (!c.ok) return;
    var rows = '<div class="ans-cap">Bar tips</div>' +
      '<div class="ans-row"><span>Total tips</span><b>' + money(c.tipsC) + '</b></div>' +
      '<div class="ans-row"><span>Total hours</span><b>' + hrs(c.totalH) + '</b></div>' +
      '<div class="ans-row main"><span>Hourly</span><b>' + money(c.hourlyC) + '</b></div>' +
      '<div class="ans-cap">Split</div>';
    c.people.forEach(function (p) { rows += '<div class="ans-row"><span>' + esc(p.name) + '<small>' + hrs(p.h) + ' h</small></span><b>' + money(p.c) + '</b></div>'; });
    var diff = c.tipsC - c.paid;
    if (diff !== 0) rows += '<div class="bar-note">' + money(Math.abs(diff)) + (diff > 0 ? ' left over after rounding' : ' extra from rounding') + '</div>';
    ans.innerHTML = rows;
  }

  window.addEventListener('tipout:scan', function () { build(); });

  root.addEventListener('change', function (e) {
    if (e.target.id === 'bar-photo') { var f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) scan(f); }
  });

  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'bar-tips') st.tips = t.value;
    else if (t.dataset && t.dataset.p != null) st.phones[+t.dataset.p] = t.value;
    else if (t.dataset && t.dataset.k) st.rows[+t.dataset.i][t.dataset.k] = t.value;
    else return;
    save(); update();
  });

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'bar-scan') { var f = $('#bar-photo'); if (f) f.click(); return; }
    if (b.dataset.kind) { st.kind = b.dataset.kind; save(); root.querySelectorAll('.bar-seg button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.kind === st.kind); }); return; }
    if (b.dataset.rm != null) { st.rows.splice(+b.dataset.rm, 1); save(); build(); return; }
    if (b.id === 'bar-add') { if (st.rows.length < MAX) { st.rows.push(blankRow()); save(); build(); } return; }
    if (b.id === 'bar-new') { st.rows.forEach(function (r) { r.start = ''; r.end = ''; }); st.tips = ''; save(); build(); toast('Cleared. Names kept.'); return; }
    if (b.id === 'bar-copy') {
      var c = compute(); if (!c.ok) return; var m = message(c);
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(m) : Promise.reject()).then(function () { toast('Copied'); }, function () { window.prompt('Copy this', m); });
      return;
    }
    if (b.id === 'bar-send') {
      var c2 = compute(); if (!c2.ok) return;
      var nums = st.phones.map(function (p) { return String(p || '').replace(/[^\d+]/g, ''); }).filter(Boolean);
      var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      var url = 'sms:' + nums.join(',') + (ios ? '&' : '?') + 'body=' + encodeURIComponent(message(c2));
      root.dataset.lastSms = url;
      window.location.href = url;
    }
  });

  build();
})();
