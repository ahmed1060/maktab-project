/**
 * The tax portal's export button (CLIENT_PORTAL_PLAN.md §10, §12 step 4a,
 * PR 318): the code a bookmark runs on the Tax Authority portal's Payments
 * page, in the staff's own browser. It reads the claims table on the
 * screen, every page of it, and saves an Excel file on the computer, one
 * company to a file. It sends nothing to Nizmo or anywhere else. That file
 * is what a client's page takes (§4.1, lib/tax-file.ts).
 *
 * It's the owner's button, kept as text. It runs on another site's page,
 * where nothing of Nizmo's is, so it stands alone, is written as browsers
 * read it, and isn't built with the app. Its panel's words are the owner's.
 *
 * Changed on moving here (§12 step 4):
 * - a claim's number is always text. One with no zero at its start was
 *   written as a number, which the upload refuses as a number that may have
 *   lost its zeros (§15);
 * - what it gathers is kept in the browser under a new name, and what the
 *   copy before it kept is removed: that copy kept such numbers as numbers;
 * - the part that needs no page comes first, so it can be run by itself.
 *
 * Tried in a browser, which the tests here aren't:
 * `scripts/tax-export-browser-run.mjs` presses the bookmark on a page laid
 * out like the portal's and keeps the files it saves in
 * `lib/tax-export-fixtures`, with this code's fingerprint.
 * lib/tax-export-button.test.ts reads those files with Nizmo's reader, and
 * fails where the code is no longer what was tried: after any change here,
 * run it again.
 */

/** Its first lines. Pressed again on a page where it's already up, it shows its panel and gathers again. */
const OPENING = String.raw`/* تصدير مطالبات بوابة الممول (مصلحة الضرائب المصرية) إلى Excel
   يقرأ جدول المطالبات من الصفحة المفتوحة ويجمّع صفوفه عبر كل الصفحات، لشركة واحدة في كل ملف
   وينزّل ملف xlsx حقيقي. لا يرسل أي بيانات لأي مكان. */
(function () {
  'use strict';
  if (window.__etaX && document.getElementById('etax-panel')) {
    document.getElementById('etax-panel').style.display = 'block';
    window.__etaX.collect();
    if (window.__etaX.grabAll) window.__etaX.grabAll();
    return;
  }

`

/**
 * The part that needs no page: how a cell's words are read, the company in
 * a page's title, the file's name, and the Excel file itself, written by
 * hand with no library. The tests run it as it is.
 */
export const TAX_EXPORT_CORE = String.raw`  var NUMBER_HEADER = 'رقم المطالبة';
  var clean = function (s) { return (s || '').replace(/[\s\u00a0]+/g, ' ').trim(); };
  var toLatin = function (s) { return s.replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }); };

  function companyOf(title) {
    // "المدفوعات - اسم الشركة | مساحة عمل الممول"
    var t = clean(title).split(/[|_]/)[0];
    var parts = t.split(' - ');
    return clean(parts.length > 1 ? parts.slice(1).join(' - ') : t);
  }

  function parseNumber(txt) {
    var t = toLatin(clean(txt)).replace(/[٬,]/g, '').replace('٫', '.');
    if (/^0\d+$/.test(t)) return null;          // رقم مطالبة بأصفار على الشمال => نص
    if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    return null;
  }

  function textCell(header, txt) {
    if (txt === '-' || txt === '—') return { t: 's', v: '' };
    // رقم المطالبة نص دايماً، بأصفار على شماله أو من غير: كرقم، Excel بيشيل الأصفار
    var n = header === NUMBER_HEADER ? null : parseNumber(txt);
    if (n !== null) return { t: 'n', v: n };
    return { t: 's', v: txt };
  }

  var cairoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

  function fileName(company, day) {
    return ('مطالبات - ' + company + ' - ' + day).replace(/[\\/:*?"<>|]/g, '-') + '.xlsx';
  }

  /* ---------- بناء الأعمدة النهائية ---------- */
  function buildTable(state) {
    var split = {};
    state.rows.forEach(function (r) {
      for (var h in r.cells) if (r.cells[h].orig !== undefined) split[h] = true;
    });
    var cols = [{ title: 'الشركة', get: function (r) { return { t: 's', v: r.company }; }, w: 30 }];
    state.headers.forEach(function (h) {
      if (split[h]) {
        cols.push({ title: h + ' الأصلية', w: 16, get: function (r) { var c = r.cells[h]; if (!c) return { t: 's', v: '' }; return { t: 'n', v: c.orig !== undefined ? c.orig : c.v }; } });
        cols.push({ title: 'المسدد', w: 14, get: function (r) { var c = r.cells[h]; if (!c) return { t: 's', v: '' }; return { t: 'n', v: c.orig !== undefined ? Math.round((c.orig - c.v) * 100) / 100 : 0 }; } });
        cols.push({ title: 'المتبقي', w: 14, get: function (r) { return r.cells[h] || { t: 's', v: '' }; } });
      } else {
        cols.push({ title: h, w: Math.max(14, Math.min(40, h.length + 4)), get: function (r) { return r.cells[h] || { t: 's', v: '' }; } });
      }
    });
    return cols;
  }

  /* ---------- كاتب XLSX بسيط (بدون مكتبات) ---------- */
  var enc = new TextEncoder();
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var parts = [], central = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    var csize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
  function colName(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function dateSerial(iso) { var p = iso.split('-').map(Number); return (Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(1899, 11, 30)) / 86400000; }

  function buildXlsx(state) {
    var cols = buildTable(state);
    var rowsXml = [];
    var hdr = cols.map(function (c, i) { return '<c r="' + colName(i) + '1" t="inlineStr" s="1"><is><t>' + esc(c.title) + '</t></is></c>'; }).join('');
    rowsXml.push('<row r="1">' + hdr + '</row>');
    state.rows.forEach(function (r, ri) {
      var rn = ri + 2;
      var cs = cols.map(function (c, i) {
        var v = c.get(r), ref = colName(i) + rn;
        if (v.t === 'n' && v.v !== '' && isFinite(v.v)) return '<c r="' + ref + '" s="3"><v>' + v.v + '</v></c>';
        if (v.t === 'd') return '<c r="' + ref + '" s="2"><v>' + dateSerial(v.v) + '</v></c>';
        if (v.v === '' || v.v == null) return '';
        return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(v.v) + '</t></is></c>';
      }).join('');
      rowsXml.push('<row r="' + rn + '">' + cs + '</row>');
    });
    var last = colName(cols.length - 1) + (state.rows.length + 1);
    var sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + cols.map(function (c, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c.w + '" customWidth="1"/>'; }).join('') + '</cols>' +
      '<sheetData>' + rowsXml.join('') + '</sheetData>' +
      '<autoFilter ref="A1:' + last + '"/></worksheet>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills>' +
      '<borders count="1"><border/></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="المطالبات" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'المطالبات\'!$A$1:$' + last.replace(/(\d+)$/, '$$$1') + '</definedName></definedNames></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
      { name: 'xl/styles.xml', data: styles }
    ]);
  }

`

/** The part on the page: the portal's table read, every page of it, what's kept in the browser, and its panel. */
const ON_THE_PAGE = String.raw`  var STORE = 'etaClaimsExport_v2';
  // النسخة القديمة كانت بتحفظ رقم المطالبة كرقم، فاللي حفظته بيتمسح
  try { localStorage.removeItem('etaClaimsExport_v1'); } catch (e) {}
  var SKIP_HEADERS = /الإجراء/;
  var state = load();
  function load() {
    try { var s = JSON.parse(localStorage.getItem(STORE)); if (s && s.rows) return s; } catch (e) {}
    return { headers: [], rows: [] };
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} }

  function companyFromTitle() { return companyOf(document.title); }

  function findTable() {
    var ts = Array.prototype.slice.call(document.querySelectorAll('table'));
    var byLabel = ts.filter(function (t) { return /payment/i.test(t.getAttribute('aria-label') || ''); });
    if (byLabel.length) return byLabel[0];
    ts.sort(function (a, b) { return b.rows.length - a.rows.length; });
    return ts[0] || null;
  }

  function leafTexts(cell) {
    var out = [];
    var els = cell.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (/^(SVG|PATH|BUTTON)$/i.test(e.tagName) || e.closest('svg,button')) continue;
      var hasElChild = false;
      for (var c = e.firstElementChild; c; c = c.nextElementSibling) {
        if (!/^(svg)$/i.test(c.tagName)) { hasElChild = true; break; }
      }
      if (!hasElChild) { var t = clean(e.textContent); if (t) out.push(t); }
    }
    return out;
  }

  function readCell(cell, header) {
    var time = cell.querySelector('time[datetime]');
    if (time) {
      var ms = Number(time.getAttribute('datetime'));
      var d = isNaN(ms) ? new Date(time.getAttribute('datetime')) : new Date(ms);
      if (!isNaN(d)) return { t: 'd', v: cairoFmt.format(d) };
    }
    // قيمة مشطوبة (مسدد جزئياً): رقمين في نفس الخلية => الأول الأصلي والأخير الحالي
    var leaves = leafTexts(cell);
    var nums = header === NUMBER_HEADER ? [] : leaves.map(parseNumber).filter(function (n) { return n !== null; });
    if (nums.length >= 2) return { t: 'n', v: nums[nums.length - 1], orig: nums[0] };
    return textCell(header, clean(cell.textContent));
  }

  function collect() {
    var table = findTable();
    if (!table) { render('مش لاقي جدول في الصفحة دي'); return; }
    var ths = table.querySelectorAll('thead th');
    var headers = [], keep = [];
    for (var i = 0; i < ths.length; i++) {
      var h = clean(ths[i].textContent);
      if (!SKIP_HEADERS.test(h)) { headers.push(h); keep.push(i); }
    }

    if (typeof syncCompanyFromTitle === 'function' && coInput) syncCompanyFromTitle();
    var company = getCompany();
    // ملف لكل شركة: لو الصفوف المتجمعة لشركة تانية، الأداة بتبدأ من جديد لوحدها من غير "مسح"
    if (state.rows.some(function (r) { return r.company !== company; })) state = { headers: [], rows: [] };
    // ملف لكل فلتر: لو "إجمالي النتائج" اتغير لنفس الشركة (فلتر تاني)، الأداة بتبدأ من جديد لوحدها
    var siteNow = siteTotal();
    if (siteNow !== null && state.rows.length && state.total != null && state.total !== siteNow) state = { headers: [], rows: [] };
    if (siteNow !== null) state.total = siteNow;
    headers.forEach(function (h) { if (state.headers.indexOf(h) < 0) state.headers.push(h); });
    var keyCol = headers.indexOf(NUMBER_HEADER);
    var existing = {};
    state.rows.forEach(function (r) { existing[r.key] = true; });
    var added = 0;
    var trs = table.querySelectorAll('tbody tr');
    for (var r = 0; r < trs.length; r++) {
      var tds = trs[r].children;
      if (tds.length < keep.length) continue;
      var cells = {};
      var raw = [];
      keep.forEach(function (ci, k) {
        var v = readCell(tds[ci], headers[k]);
        cells[headers[k]] = v;
        raw.push(v.v);
      });
      var key = company + '|' + (keyCol >= 0 && cells[NUMBER_HEADER].v ? cells[NUMBER_HEADER].v : raw.join('|'));
      if (existing[key]) continue;
      existing[key] = true;
      state.rows.push({ key: key, company: company, cells: cells });
      added++;
    }
    save();
    render(added ? ('اتضاف ' + added + ' صف') : '');
  }

  function download() {
    collect();
    if (!state.rows.length) { alert('مفيش صفوف متجمعة'); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(buildXlsx(state));
    a.download = fileName(getCompany(), cairoFmt.format(new Date())); // تاريخ القاهرة، مش UTC
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  /* ---------- اللوحة ---------- */
  var panel = document.createElement('div');
  panel.id = 'etax-panel';
  panel.dir = 'rtl';
  panel.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#fff;border:2px solid #438fce;border-radius:10px;padding:12px 14px;width:290px;font:14px Cairo,Tahoma,sans-serif;color:#171725;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="color:#00258c">تصدير المطالبات إلى Excel</b><span id="etax-x" style="cursor:pointer;font-size:18px;padding:0 4px" title="إخفاء">×</span></div>' +
    '<label style="font-size:12px;color:#555">اسم الشركة</label>' +
    '<input id="etax-co" style="width:100%;box-sizing:border-box;margin:2px 0 8px;padding:5px;border:1px solid #c6cdda;border-radius:6px;font:inherit">' +
    '<div id="etax-info" style="font-size:13px;margin-bottom:8px;line-height:1.7"></div>' +
    '<button id="etax-all" style="width:100%;background:#00258c;color:#fff;border:0;border-radius:6px;padding:8px;font:inherit;font-weight:bold;cursor:pointer;margin-bottom:6px">⟳ سحب كل الصفحات</button>' +
    '<div style="display:flex;gap:6px">' +
    '<button id="etax-dl" style="flex:2;background:#438fce;color:#fff;border:0;border-radius:6px;padding:8px;font:inherit;font-weight:bold;cursor:pointer">⬇ تنزيل Excel</button>' +
    '<button id="etax-clr" style="flex:1;background:#eee;border:0;border-radius:6px;padding:8px;font:inherit;cursor:pointer">مسح</button></div>' +
    '<div style="font-size:11px;color:#777;margin-top:8px;line-height:1.6">لو الجدول أكتر من صفحة، الأداة بتلف على كل الصفحات لوحدها (أو دوس "سحب كل الصفحات"). كل ملف لشركة واحدة: لما تفتح شركة تانية، الأداة بتبدأ من جديد لوحدها.</div>';
  document.body.appendChild(panel);
  var coInput = panel.querySelector('#etax-co');
  coInput.value = companyFromTitle();
  function getCompany() { return clean(coInput.value) || companyFromTitle() || 'غير محدد'; }
  var lastCompany = getCompany();
  var lastTitleCo = companyFromTitle();
  coInput.addEventListener('change', function () {
    // تعديل الاسم يدوياً => يتطبق على صفوف الشركة الحالية اللي اتجمعت
    var oldName = lastCompany, newName = getCompany();
    state.rows.forEach(function (r) {
      if (r.company === oldName) { r.company = newName; r.key = newName + r.key.slice(oldName.length); }
    });
    lastCompany = newName; save(); render('');
  });
  function syncCompanyFromTitle() {
    // لو اتنقلت لشركة تانية من غير ما الصفحة تعمل reload
    var tc = companyFromTitle();
    if (tc !== lastTitleCo) { lastTitleCo = tc; coInput.value = tc; lastCompany = getCompany(); }
  }

  function render(msg) {
    var cur = state.rows.length;
    var total = siteTotal(), pg = pageInfo();
    var check = '';
    if (total !== null) {
      check = cur === total
        ? '<br><span style="color:#2e7d32">✓ اتجمعت كل النتائج (' + total + ')</span>'
        : cur > total
          ? '<br><span style="color:#c62828">⚠ الصفوف (' + cur + ') أكتر من إجمالي النتائج (' + total + '). دوس "مسح" وابدأ تاني.</span>'
          : '<br><span style="color:#c62828">ناقص ' + (total - cur) + ' من ' + total + ' نتيجة' + (pg.pages > 1 ? ' — دوس "سحب كل الصفحات"' : '') + '</span>';
    }
    panel.querySelector('#etax-info').innerHTML =
      'صفوف الشركة دي: <b>' + cur + '</b>' + (pg.pages > 1 ? '، الجدول ' + pg.pages + ' صفحات' : '') + check +
      (msg ? '<br><span style="color:' + (/^⚠/.test(msg) ? '#c62828' : '#2e7d32') + '">' + msg + '</span>' : '');
  }

  panel.querySelector('#etax-x').onclick = function () { panel.style.display = 'none'; };
  panel.querySelector('#etax-dl').onclick = download;
  panel.querySelector('#etax-clr').onclick = function () {
    if (!confirm('مسح كل الصفوف المتجمعة؟')) return;
    state = { headers: [], rows: [] }; save(); collect();
  };

  /* ---------- الصفحات ---------- */
  function siteTotal() {
    // أعمق عنصر فيه "إجمالي النتائج" (علشان مايلزقش أرقام الصفحات جنبه)
    var els = document.querySelectorAll('h6, p, span, div, label'), found = null;
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (panel.contains(e)) continue;
      var t = clean(e.textContent);
      if (t.length > 40 || t.indexOf('إجمالي النتائج') < 0) continue;
      var m = /إجمالي النتائج\s*:?\s*([\d٠-٩,٬]+)/.exec(t);
      if (m) found = parseInt(toLatin(m[1]).replace(/[,٬]/g, ''), 10);
    }
    return found;
  }
  function pagerBtn(label) {
    return document.querySelector('nav[aria-label*="pagination"] button[aria-label="' + label + '"]') ||
           document.querySelector('button[aria-label="' + label + '"]');
  }
  function pageInfo() {
    var btns = document.querySelectorAll('nav[aria-label*="pagination"] button[aria-label^="page "], nav[aria-label*="pagination"] button[aria-label^="Go to page "]');
    var max = 1;
    for (var i = 0; i < btns.length; i++) { var n = parseInt(clean(btns[i].textContent), 10); if (n > max) max = n; }
    return { pages: max };
  }
  function isDisabled(b) { return !b || b.disabled || b.classList.contains('Mui-disabled') || b.getAttribute('aria-disabled') === 'true'; }
  function tableSig() {
    var t = findTable(); if (!t) return '';
    var trs = t.querySelectorAll('tbody tr');
    return trs.length + '|' + (trs[0] ? clean(trs[0].textContent) : '') + '|' + (trs.length ? clean(trs[trs.length - 1].textContent) : '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitChange(sig, ms) {
    var end = Date.now() + ms;
    while (Date.now() < end) { await sleep(150); var s = tableSig(); if (s && s !== sig) { await sleep(400); return true; } }
    return false;
  }
  var grabbing = false;
  async function grabAll() {
    if (grabbing) return;
    grabbing = true;
    var btn = panel.querySelector('#etax-all');
    btn.disabled = true; btn.style.opacity = .6;
    try {
      var first = pagerBtn('page 1') || pagerBtn('Go to page 1');
      if (first && first.getAttribute('aria-current') !== 'true') {
        var s0 = tableSig(); first.click(); await waitChange(s0, 20000);
      }
      var page = 1, total = pageInfo().pages;
      for (var guard = 0; guard < 500; guard++) {
        btn.textContent = 'جاري سحب صفحة ' + page + (total > 1 ? ' من ' + total : '') + '...';
        collect();
        var next = pagerBtn('Go to next page');
        if (isDisabled(next)) break;
        var sig = tableSig();
        next.click();
        if (!(await waitChange(sig, 20000))) { render('⚠ الصفحة ' + (page + 1) + ' ماحمّلتش. جرّب تاني.'); return; }
        page++; total = Math.max(total, pageInfo().pages);
      }
      collect();
      var t = siteTotal();
      render(page > 1 ? ('خلص: اتسحبت ' + page + ' صفحات') : 'الجدول صفحة واحدة واتسحب');
    } finally {
      grabbing = false; btn.disabled = false; btn.style.opacity = 1; btn.textContent = '⟳ سحب كل الصفحات';
    }
  }
  panel.querySelector('#etax-all').onclick = grabAll;

  var timer = null;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) if (!panel.contains(muts[i].target)) {
      clearTimeout(timer); timer = setTimeout(collect, 600); return;
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  window.__etaX = { collect: collect, grabAll: grabAll, buildXlsx: function () { return buildXlsx(state); }, state: function () { return state; } };
  collect();
  // لو الجدول أكتر من صفحة، اسحب الكل تلقائي أول ما الأداة تفتح
  if (pageInfo().pages > 1 || !isDisabled(pagerBtn('Go to next page')) || !isDisabled(pagerBtn('Go to previous page'))) grabAll();
`

/** The button's code, as its bookmark runs it. */
export const TAX_EXPORT_CODE = OPENING + TAX_EXPORT_CORE + ON_THE_PAGE + "})();\n"

/**
 * The bookmark's address (§10): `javascript:` and the code, so pressing it
 * on the portal's page runs it there. A bookmark keeps the copy it was made
 * with: after a change, each of the staff drags the new one once.
 */
export function taxExportBookmark(): string {
    return "javascript:" + encodeURIComponent(TAX_EXPORT_CODE)
}
