// 推し遍歴(仮称): 画面。外部通信なし。文字はすべて textContent 経由で表示する(HTMLとして解釈しない)
(function () {
  'use strict';
  const C = window.Core, DB = window.DB;
  const view = document.getElementById('view'), tabsEl = document.getElementById('tabs'), overlays = document.getElementById('overlays'), toastEl = document.getElementById('toast');
  const S = { oshi: [], friends: [], nick: '', tab: 'tl', order: 'old', filter: 'all', q: '', fields: ['period', 'note'], shareIds: null, urls: {}, vgame: null, lastBackup: '', vmission: null, vcard: null };
  const FIELD_JA = { genre: 'ジャンル', period: '期間', note: 'ひとこと', trigger: 'きっかけ', points: '好きな所' };

  // ---------- 小道具 ----------
  function h(tag, a) {
    const e = document.createElement(tag);
    if (a) for (const k of Object.keys(a)) {
      const v = a[k];
      if (typeof v === 'boolean' && k.slice(0, 5) === 'aria-') { e.setAttribute(k, String(v)); continue; }
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'for') e.htmlFor = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') String(v).split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) e.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); });
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'readOnly' || k === 'maxLength') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => add(e, x));
    else e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  let toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 2600); }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('コピーしました'); return true; } catch (e) { /* 下へ */ }
    const ta = h('textarea', { value: t, readOnly: true }); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); toast(ok ? 'コピーしました' : 'コピーできませんでした。文字を長押ししてコピーしてください'); return ok;
  }
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  async function saveFile(name, blob) {
    const file = new File([blob], name, { type: blob.type });
    if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
    toast('「' + name + '」を保存しました');
  }
  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  function dataURLToBlob(u) { const m = /^data:([^;,]+);base64,(.*)$/.exec(u); if (!m) return null; const s = atob(m[2]), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new Blob([b], { type: m[1] }); }
  async function shrink(file, max) {
    const bmp = await createImageBitmap(file), sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  }

  // ---------- シート ----------
  function sheet(title, build, right) {
    const page = h('div', { class: 'page' });
    const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-label': title });
    const close = () => { ov.remove(); };
    const bar = h('div', { class: 'bar' }, h('button', { onclick: close, 'aria-label': '戻る' }, '‹ 戻る'), h('div', { class: 'ttl' }, title), right ? h('button', { onclick: () => right.fn(close) }, right.label) : h('span', { style: 'width:64px' }));
    ov.append(bar, page); overlays.append(ov);
    const r = build(page, close); if (r && r.catch) r.catch((e) => toast('エラー: ' + e.message));
    ov.scrollTop = 0; return close;
  }
  function modal(build) {
    const sh = h('div', { class: 'sheet' }); const ov = h('div', { class: 'overlay modal', role: 'dialog' }, sh);
    const close = () => ov.remove(); ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    build(sh, close); overlays.append(ov); return close;
  }
  function confirmBox(msg, label, danger) {
    return new Promise((res) => modal((sh, close) => {
      sh.append(h('p', { text: msg }), h('div', { class: 'btns two' },
        h('button', { class: 'btn quiet', onclick: () => { close(); res(false); } }, 'やめる'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { close(); res(true); } }, label || 'OK')));
    }));
  }

  // ---------- データ ----------
  async function load() {
    S.oshi = (await DB.all('oshi')).map((o) => Object.assign({}, o));
    S.friends = (await DB.all('friends')).sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
    S.nick = await DB.kvGet('nick', '');
    S.lastBackup = await DB.kvGet('lastBackup', '');
    S.vgame = await DB.kvGet('vgame', null);
    S.vmission = await DB.kvGet('vmission', null);
    S.vcard = await DB.kvGet('vcard', null);
    const th = await DB.kvGet('theme', 'auto'); applyTheme(th);
    S.theme = th;
    for (const k of Object.keys(S.urls)) { URL.revokeObjectURL(S.urls[k]); }
    S.urls = {};
    for (const o of S.oshi) if (o.hasPhoto) { const r = await DB.get('photos', o.id); if (r && r.blob) S.urls[o.id] = URL.createObjectURL(r.blob); }
  }
  function applyTheme(t) { if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  async function refresh() { await load(); renderTabs(); render(); }
  const nowIdx = () => C.nowIdx(new Date());

  // ---------- タブ ----------
  const TABS = [['tl', '年', '年表'], ['list', '推', '推し'], ['share', '合', '見せ合い'], ['vb', '遊', 'VEBANT'], ['more', '他', 'もっと']];
  function renderTabs() {
    tabsEl.textContent = '';
    for (const [id, ic, label] of TABS) tabsEl.append(h('button', { class: 'tab', 'data-tab': id, 'aria-current': S.tab === id ? 'page' : null, onclick: () => { S.tab = id; renderTabs(); render(); window.scrollTo(0, 0); } }, h('span', { class: 'ic' }, ic), label));
  }
  function render() {
    view.textContent = '';
    ({ tl: renderTimeline, list: renderList, share: renderShare, vb: renderVB, more: renderMore })[S.tab]();
  }
  const fab = () => h('button', { class: 'fab', onclick: () => editOshi(null) }, '＋ 推しを足す');

  // ---------- 年表 ----------
  function renderTimeline() {
    view.append(h('h1', null, window.APP_NAME || '推し遍歴'), h('p', { class: 'sub' }, 'これまでの推しを、年表にして残します。データはこの端末の中だけです。'));
    if (!S.oshi.length) {
      view.append(h('div', { class: 'empty' }, h('p', null, 'まだ誰も登録されていません。'), h('p', { class: 'sub' }, '好きになった順でなくても大丈夫です。思い出した人から足せます。'),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary block', onclick: () => editOshi(null) }, '最初の推しを足す'), h('button', { class: 'btn quiet block', onclick: addSamples }, '見本(架空の4人)を入れて見てみる'))),
        installNote());
      return;
    }
    const sm = C.summary(S.oshi, nowIdx());
    view.append(h('div', { class: 'stats' }, h('div', null, h('b', null, sm.total), h('span', null, '人・作品')), h('div', null, h('b', null, sm.ongoing), h('span', null, 'いま推し')), h('div', null, h('b', null, sm.graduated), h('span', null, '卒業')), h('div', null, h('b', null, sm.firstYear == null ? '–' : sm.firstYear), h('span', null, '最初の年'))));
    const hasSample = S.oshi.some((o) => o.id.startsWith('sample-'));
    if (hasSample) view.append(h('div', { class: 'note' }, '見本(架空)が入っています。 ', h('button', { class: 'btn sm quiet', onclick: removeSamples }, '見本を消す')));
    view.append(h('div', { class: 'seg', style: 'margin:10px 0' }, ...[['old', '古い順'], ['new', '新しい順']].map(([k, t]) => h('button', { 'aria-pressed': S.order === k, onclick: () => { S.order = k; render(); } }, t))));
    const groups = C.groupByYear(C.sortTimeline(S.oshi, S.order === 'new'));
    const tl = h('div', { class: 'tl', 'data-test': 'timeline' });
    for (const g of groups) {
      tl.append(h('div', { class: 'yr' }, g.label));
      for (const o of g.items) tl.append(itemCard(o));
    }
    view.append(tl, fab());
  }
  function itemCard(o) {
    const pd = C.periodLabel(o);
    return h('button', { class: 'item' + (o.ongoing ? '' : ' ended'), 'data-id': o.id, onclick: () => showOshi(o.id) },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'nm' }, o.name, o.ongoing ? h('span', { class: 'tag now' }, 'いま') : null, o.genre ? h('span', { class: 'tag' }, o.genre) : null),
          pd ? h('div', { class: 'pd' }, pd) : null,
          o.note ? h('div', { class: 'qt' }, o.note) : null),
        S.urls[o.id] ? h('img', { class: 'thumb', src: S.urls[o.id], alt: '' }) : null));
  }
  function installNote() {
    return h('div', { class: 'panel' }, h('b', null, 'iPhoneで使うとき'), h('p', { class: 'small' }, 'Safariで開き、共有ボタン →「ホーム画面に追加」で、アプリのように使えます。記録はこの端末の中にだけ残ります。'));
  }
  async function addSamples() {
    const t = Date.now(); for (const o of C.sampleOshi(t)) await DB.put('oshi', o);
    toast('見本を入れました'); await refresh();
  }
  async function removeSamples() {
    for (const o of S.oshi.filter((x) => x.id.startsWith('sample-'))) await DB.del('oshi', o.id);
    toast('見本を消しました'); await refresh();
  }

  // ---------- 一覧 ----------
  function renderList() {
    view.append(h('h1', null, '推しの一覧'));
    if (!S.oshi.length) { view.append(h('div', { class: 'empty' }, '登録するとここに並びます。'), fab()); return; }
    const inp = h('input', { type: 'search', placeholder: '名前・ひとことで探す', value: S.q, 'aria-label': '検索', oninput: (e) => { S.q = e.target.value; fill(); } });
    const seg = h('div', { class: 'seg', style: 'margin:10px 0' }, ...[['all', 'ぜんぶ'], ['now', 'いま'], ['past', '卒業']].map(([k, t]) => h('button', { 'aria-pressed': S.filter === k, onclick: () => { S.filter = k; render(); } }, t)));
    const box = h('div', { 'data-test': 'oshi-list' });
    view.append(inp, seg, box, fab());
    function fill() {
      box.textContent = '';
      const q = C.normName(S.q);
      const rows = C.sortTimeline(S.oshi, true).filter((o) => (S.filter === 'all' || (S.filter === 'now' ? o.ongoing : !o.ongoing)) && (!q || C.normName([o.name, o.note, o.genre, o.trigger, o.points].join(' ')).includes(q)));
      if (!rows.length) box.append(h('p', { class: 'sub' }, '見つかりません。'));
      for (const o of rows) box.append(h('button', { class: 'list-row', 'data-id': o.id, onclick: () => showOshi(o.id) },
        S.urls[o.id] ? h('img', { class: 'thumb', src: S.urls[o.id], alt: '' }) : null,
        h('div', { class: 'grow' }, h('div', { style: 'font-weight:700;font-size:18px' }, o.name, o.ongoing ? h('span', { class: 'tag now' }, 'いま') : null), h('div', { class: 'sub' }, [C.periodLabel(o), o.genre].filter(Boolean).join(' / ')))));
    }
    fill();
  }

  // ---------- 推しの詳細・編集 ----------
  function showOshi(id) {
    const o = S.oshi.find((x) => x.id === id); if (!o) return;
    sheet(o.name, (page, close) => {
      if (S.urls[id]) page.append(h('img', { class: 'photo', src: S.urls[id], alt: o.name + 'の写真' }));
      const kv = (t, v) => v ? [h('dt', null, t), h('dd', null, v)] : null;
      page.append(h('dl', { class: 'kv' }, kv('期間', C.periodLabel(o) + (o.ongoing ? '' : (o.to ? '' : ''))), kv('ジャンル', o.genre), kv('ひとこと', o.note), kv('きっかけ', o.trigger), kv('好きな所', o.points)),
        h('div', { class: 'btns two' }, h('button', { class: 'btn primary', onclick: () => { close(); editOshi(id); } }, '編集する'),
          h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('「' + o.name + '」を削除します。元に戻せません。', '削除する', true)) { await DB.del('oshi', id); await DB.del('photos', id); close(); toast('削除しました'); await refresh(); } } }, '削除')));
    });
  }
  function editOshi(id) {
    const cur = id ? S.oshi.find((x) => x.id === id) : null;
    const o = cur ? Object.assign({}, cur) : { name: '', genre: '', from: '', to: '', ongoing: true, note: '', trigger: '', points: '' };
    let newPhoto = null, dropPhoto = false;
    sheet(cur ? '編集' : '推しを足す', (page, close) => {
      const msg = h('div', { class: 'note', hidden: true, role: 'alert' });
      const name = h('input', { type: 'text', value: o.name, maxLength: C.LIM.name, id: 'f-name', autocomplete: 'off' });
      const genre = h('input', { type: 'text', value: o.genre, maxLength: C.LIM.genre, id: 'f-genre', placeholder: '例: 音楽 / アニメ / アイドル', autocomplete: 'off' });
      const from = h('input', { type: 'month', value: o.from.length === 7 ? o.from : '', id: 'f-from' });
      const to = h('input', { type: 'month', value: o.to.length === 7 ? o.to : '', id: 'f-to' });
      const toWrap = h('div', { hidden: o.ongoing }, h('label', { class: 'f', for: 'f-to' }, 'やめた・卒業した時期'), to);
      const segOn = h('div', { class: 'seg' });
      const setOn = (v) => { o.ongoing = v; toWrap.hidden = v; segOn.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === v))); };
      [['いま推し', true], ['卒業・おやすみ', false]].forEach(([t, v]) => segOn.append(h('button', { type: 'button', 'aria-pressed': o.ongoing === v, onclick: () => setOn(v) }, t)));
      const note = h('textarea', { id: 'f-note', maxLength: C.LIM.text, placeholder: 'この推しを一言でいうと' }); note.value = o.note;
      const trig = h('textarea', { id: 'f-trigger', maxLength: C.LIM.text, placeholder: 'どうやって知った?' }); trig.value = o.trigger;
      const pts = h('textarea', { id: 'f-points', maxLength: C.LIM.text, placeholder: '好きな所' }); pts.value = o.points;
      const prev = h('div'); const showPrev = () => { prev.textContent = ''; const u = newPhoto ? URL.createObjectURL(newPhoto) : (!dropPhoto && cur && S.urls[cur.id]); if (u) prev.append(h('img', { class: 'photo', src: u, alt: '選んだ写真' }), h('button', { type: 'button', class: 'btn sm quiet', onclick: () => { newPhoto = null; dropPhoto = true; showPrev(); } }, '写真を外す')); };
      showPrev();
      const file = h('input', { type: 'file', accept: 'image/*', id: 'f-photo', 'aria-label': '写真を選ぶ', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { newPhoto = await shrink(f, 960); dropPhoto = false; showPrev(); } catch (er) { toast('この写真は読み込めませんでした'); } } });
      page.append(msg,
        h('label', { class: 'f', for: 'f-name' }, '名前 (必須)'), name,
        h('label', { class: 'f', for: 'f-genre' }, 'ジャンル (任意)'), genre,
        h('label', { class: 'f', for: 'f-from' }, '好きになった時期 (わからなければ空でOK)'), from,
        h('div', { class: 'gap' }), segOn, toWrap,
        h('label', { class: 'f', for: 'f-note' }, 'ひとこと'), note,
        h('label', { class: 'f', for: 'f-trigger' }, 'きっかけ'), trig,
        h('label', { class: 'f', for: 'f-points' }, '好きな所'), pts,
        h('label', { class: 'f', for: 'f-photo' }, '写真 (任意・この端末の中だけに残ります)'), file, prev,
        h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'f-save', onclick: async () => {
          const rec = C.cleanOshi({ id: cur ? cur.id : uid(), name: name.value, genre: genre.value, from: from.value, to: o.ongoing ? '' : to.value, ongoing: o.ongoing, note: note.value, trigger: trig.value, points: pts.value, hasPhoto: newPhoto ? true : (dropPhoto ? false : !!(cur && cur.hasPhoto)), createdAt: cur ? cur.createdAt : Date.now(), updatedAt: Date.now() });
          const er = C.validateOshi(rec); if (er) { msg.textContent = er; msg.hidden = false; msg.scrollIntoView({ block: 'center' }); return; }
          await DB.put('oshi', rec);
          if (newPhoto) await DB.put('photos', { id: rec.id, blob: newPhoto }); else if (dropPhoto) await DB.del('photos', rec.id);
          close(); toast('保存しました'); await refresh();
        } }, '保存する')));
    });
  }

  // ---------- 見せ合い ----------
  function selectedIds() { return S.shareIds || S.oshi.map((o) => o.id); }
  function currentPayload() { return C.buildShare(S.nick, C.sortTimeline(S.oshi), S.fields, selectedIds(), today()); }
  function renderShare() {
    view.append(h('h1', null, '見せ合い'), h('p', { class: 'sub' }, 'サーバーは使いません。見せたい項目だけを入れた「共有コード」を、LINEなどで友達に送ります。写真は入りません。'));
    // 1 名前
    const nick = h('input', { type: 'text', id: 'nick', value: S.nick, maxLength: C.LIM.nick, placeholder: '友達に見える名前(ニックネーム)', autocomplete: 'off', oninput: (e) => { S.nick = e.target.value; DB.kvSet('nick', S.nick); } });
    view.append(h('label', { class: 'f', for: 'nick' }, '1. あなたの名前 (本名でなくてOK)'), nick);
    // 2 項目
    const fieldBox = h('div', { class: 'chips' });
    const preview = h('div', { class: 'panel', 'data-test': 'share-preview' });
    const upd = () => { fieldBox.textContent = ''; fieldBox.append(h('button', { class: 'chip', 'aria-pressed': 'true', disabled: true }, '名前 (必ず入る)')); C.SHARE_FIELDS.forEach(([k, t]) => fieldBox.append(h('button', { class: 'chip', 'data-field': k, 'aria-pressed': S.fields.includes(k), onclick: () => { S.fields = S.fields.includes(k) ? S.fields.filter((x) => x !== k) : S.fields.concat(k); upd(); } }, t))); fillPreview(); };
    function fillPreview() {
      preview.textContent = '';
      const ids = selectedIds(), p = currentPayload();
      preview.append(h('b', null, '友達に渡る内容 (' + p.o.length + '件)'));
      if (!p.o.length) preview.append(h('p', { class: 'sub' }, '推しが選ばれていません。'));
      p.o.slice(0, 5).forEach((e) => preview.append(h('div', { class: 'small', style: 'margin-top:6px' }, [e.n, e.f ? C.periodLabel({ from: e.f, to: e.e, ongoing: !!e.c }) : '', e.g, e.m, e.r, e.p].filter(Boolean).join(' / '))));
      if (p.o.length > 5) preview.append(h('div', { class: 'sub' }, '…ほか' + (p.o.length - 5) + '件'));
      preview.append(h('div', { class: 'sub', style: 'margin-top:6px' }, '入らないもの: ' + (['genre', 'period', 'note', 'trigger', 'points'].filter((k) => !S.fields.includes(k)).map((k) => FIELD_JA[k]).concat('写真').join('・'))));
      void ids;
    }
    view.append(h('label', { class: 'f' }, '2. 見せる項目を選ぶ'), fieldBox,
      h('div', { class: 'row wrap', style: 'margin-top:8px' }, ...[['名前だけ', []], ['名前+期間', ['period']], ['ぜんぶ', ['genre', 'period', 'note', 'trigger', 'points']]].map(([t, f]) => h('button', { class: 'btn sm quiet', onclick: () => { S.fields = f; upd(); } }, t))));
    // 3 推し
    const listBox = h('div');
    const fillList = () => { listBox.textContent = ''; const sel = new Set(selectedIds()); C.sortTimeline(S.oshi).forEach((o) => { const id = 'sh-' + o.id; listBox.append(h('div', { class: 'chk' }, h('input', { type: 'checkbox', id, checked: sel.has(o.id), onchange: (e) => { const s = new Set(selectedIds()); e.target.checked ? s.add(o.id) : s.delete(o.id); S.shareIds = [...s]; fillPreview(); } }), h('label', { for: id }, o.name))); }); };
    view.append(h('label', { class: 'f' }, '3. 見せる推しを選ぶ'));
    if (!S.oshi.length) view.append(h('p', { class: 'sub' }, '先に「年表」で推しを足してください。'));
    else view.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn sm quiet', onclick: () => { S.shareIds = S.oshi.map((o) => o.id); fillList(); fillPreview(); } }, 'ぜんぶ選ぶ'), h('button', { class: 'btn sm quiet', onclick: () => { S.shareIds = []; fillList(); fillPreview(); } }, 'ぜんぶ外す')), listBox);
    view.append(h('div', { class: 'gap' }), preview,
      h('button', { class: 'btn primary block', id: 'make-share', onclick: makeShare }, '共有コードをつくる'));
    // 受け取り
    const box = h('textarea', { id: 'in-code', class: 'code', placeholder: '友達から届いた共有コード、またはリンクをここに貼る' });
    const fin = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', 'aria-label': '共有ファイルを選ぶ', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) incoming(await f.text()); } });
    view.append(h('h2', null, '友達の遍歴を読み込む'), box,
      h('div', { class: 'btns two' }, h('button', { class: 'btn primary', id: 'do-import', onclick: () => incoming(box.value) }, '読み込む'), h('button', { class: 'btn quiet', onclick: async () => { try { box.value = await navigator.clipboard.readText(); } catch (e) { toast('貼り付けできませんでした。入力欄を長押しして貼り付けてください'); } } }, '貼り付け')),
      h('label', { class: 'f' }, 'または共有ファイル(.json)から'), fin);
    view.append(h('h2', null, '読み込んだ友達 (' + S.friends.length + ')'));
    if (!S.friends.length) view.append(h('p', { class: 'sub' }, 'まだいません。'));
    S.friends.forEach((f) => view.append(h('button', { class: 'list-row', 'data-friend': f.id, onclick: () => compareSheet(f.id) }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:700;font-size:18px' }, f.nick), h('div', { class: 'sub' }, f.items.length + '件 / ' + (f.date || '日付なし') + ' / 見せてもらった項目: ' + (['名前'].concat(f.fields.map((k) => FIELD_JA[k])).join('・')))), h('span', { 'aria-hidden': 'true' }, '›'))));
    upd(); fillList();
  }
  async function makeShare() {
    if (!S.nick.trim()) { toast('先に「あなたの名前」を入れてください'); document.getElementById('nick').focus(); return; }
    const p = currentPayload(); if (!p.o.length) { toast('見せる推しを選んでください'); return; }
    const code = await C.encodeCode('OH1', p);
    const url = location.href.split('#')[0] + '#share=' + code;
    sheet('共有コード', (page) => {
      page.append(h('p', null, '「' + p.n + '」の遍歴 ' + p.o.length + '件 (' + (['名前'].concat(p.k.slice(1).map((k) => FIELD_JA[k])).join('・')) + ')'),
        h('textarea', { class: 'code', readOnly: true, id: 'out-code', 'aria-label': '共有コード' }), h('p', { class: 'sub' }, code.length + '文字。そのままLINEなどに貼れます。'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary block', id: 'copy-code', onclick: () => copyText(code) }, 'コードをコピー'),
          navigator.share ? h('button', { class: 'btn block', onclick: () => navigator.share({ text: code }).catch(() => {}) }, '共有シートで送る') : null,
          h('button', { class: 'btn block', onclick: () => copyText(url) }, 'リンクをコピー (開くと自動で読み込み)'),
          h('button', { class: 'btn block', id: 'save-json', onclick: () => saveFile('oshi-henreki-share-' + today() + '.json', new Blob([JSON.stringify(p)], { type: 'application/json' })) }, 'ファイル(.json)で保存'),
          h('button', { class: 'btn block', id: 'save-png', onclick: async () => saveFile('oshi-henreki-card-' + today() + '.png', await drawCard(C.parseShare(p))) }, 'カード画像(.png)で保存')),
        h('p', { class: 'sub' }, 'リンクを使うには、このアプリを置いた場所のURLが必要です(今のURL: 端末内で開いている場合は、友達の端末では開けません)。コードかファイルなら、どこでも使えます。'));
      page.querySelector('#out-code').value = code;
    });
  }
  // 画像カード
  async function drawCard(sh) {
    const W = 1080, pad = 64, c = document.createElement('canvas'), x = c.getContext('2d');
    const font = (s, w) => (w || '400') + ' ' + s + 'px -apple-system,"Hiragino Sans",sans-serif';
    const wrap = (t, mw, fs) => { x.font = font(fs); const out = []; let line = ''; for (const ch of String(t)) { if (x.measureText(line + ch).width > mw && line) { out.push(line); line = ch; } else line += ch; } if (line) out.push(line); return out; };
    const blocks = sh.items.map((it) => { const meta = [C.periodLabel(it), it.genre].filter(Boolean).join('  ·  '); const body = [it.note, it.trigger && 'きっかけ: ' + it.trigger, it.points && '好きな所: ' + it.points].filter(Boolean).flatMap((t) => wrap(t, W - pad * 2 - 40, 28)); return { it, meta, body, hh: 52 + (meta ? 40 : 0) + body.length * 40 + 24 }; });
    const H = 220 + blocks.reduce((a, b) => a + b.hh, 0) + 90; c.width = W; c.height = H;
    x.fillStyle = '#f2ede3'; x.fillRect(0, 0, W, H); x.fillStyle = '#b23a28'; x.fillRect(0, 0, W, 16);
    x.fillStyle = '#25221e'; x.font = font(54, '700'); x.fillText(sh.nick + 'の推し遍歴', pad, 112);
    x.font = font(26); x.fillStyle = '#5d574d'; x.fillText(sh.items.length + '件 ・ ' + (sh.date || ''), pad, 164);
    let y = 210;
    for (const b of blocks) {
      x.fillStyle = '#b23a28'; x.fillRect(pad, y + 10, 8, b.hh - 30);
      x.fillStyle = '#25221e'; x.font = font(40, '700'); x.fillText(b.it.name.slice(0, 22), pad + 30, y + 46); let yy = y + 46;
      if (b.meta) { yy += 40; x.fillStyle = '#5d574d'; x.font = font(26); x.fillText(b.meta, pad + 30, yy); }
      x.fillStyle = '#25221e'; x.font = font(28); for (const l of b.body) { yy += 40; x.fillText(l, pad + 30, yy); }
      y += b.hh;
    }
    x.fillStyle = '#5d574d'; x.font = font(22); x.fillText((window.APP_NAME || '推し遍歴') + ' で作成', pad, H - 40);
    return new Promise((r) => c.toBlob(r, 'image/png'));
  }
  // 受け取り口(貼り付け・リンク・ファイル共通)
  async function incoming(text) {
    text = String(text || '').trim(); if (!text) { toast('コードを貼ってください'); return; }
    try {
      let dec;
      if (text[0] === '{') { const j = JSON.parse(text); dec = { prefix: 'OH1', data: j.app === 'oshi-henreki' ? null : j }; if (!dec.data) { toast('これはバックアップファイルです。「もっと」から取り込んでください'); return; } }
      else dec = await C.decodeCode(text);
      if (dec.prefix === 'OH1') return friendPreview(C.parseShare(dec.data));
      if (dec.prefix === 'VB1') { S.tab = 'vb'; renderTabs(); render(); return addPlayerFromCard(dec.data); }
      if (dec.prefix === 'VD1') { S.tab = 'vb'; renderTabs(); render(); return openMissionFromDelivery(C.parseDelivery(dec.data)); }
    } catch (e) { toast('読み込めませんでした: ' + (e.message || e)); }
  }
  function friendPreview(sh) {
    const dup = S.friends.find((f) => f.id === fid(sh));
    modal((m, close) => {
      m.append(h('h2', { style: 'margin-top:0' }, sh.nick + 'さんの遍歴'), h('p', null, sh.items.length + '件 / 見せてもらった項目: ' + (['名前'].concat(sh.fields.map((k) => FIELD_JA[k])).join('・'))),
        h('div', { class: 'small', style: 'max-height:30vh;overflow:auto' }, sh.items.slice(0, 8).map((i) => h('div', null, '・' + i.name + (C.periodLabel(i) ? ' (' + C.periodLabel(i) + ')' : '')))),
        dup ? h('p', { class: 'sub' }, '同じ内容がすでに保存されています(上書きします)。') : null,
        h('div', { class: 'btns two' }, h('button', { class: 'btn quiet', onclick: close }, 'やめる'), h('button', { class: 'btn primary', id: 'save-friend', onclick: async () => { const rec = { id: fid(sh), nick: sh.nick, date: sh.date, fields: sh.fields, items: sh.items, importedAt: Date.now() }; await DB.put('friends', rec); close(); S.tab = 'share'; await refresh(); compareSheet(rec.id); } }, '保存して比べる')));
    });
  }
  function fid(sh) { let s = sh.nick + '|' + JSON.stringify(sh.items), hsh = 5381; for (let i = 0; i < s.length; i++) hsh = ((hsh << 5) + hsh + s.charCodeAt(i)) | 0; return 'f-' + (hsh >>> 0).toString(36); }
  function compareSheet(id) {
    const f = S.friends.find((x) => x.id === id); if (!f) return;
    sheet(f.nick + 'さんと比べる', (page, close) => {
      const mine = C.sortTimeline(S.oshi), r = C.compare(mine, f.items, nowIdx());
      const pl = (o) => C.periodLabel(o) || '期間なし';
      if (!mine.length) page.append(h('div', { class: 'note' }, '自分の推しがまだ登録されていないので、比べられません。先に「年表」で足してください。'));
      page.append(h('h2', { style: 'margin-top:4px' }, '同じ推し (' + r.same.length + ')'));
      if (!r.same.length) page.append(h('p', { class: 'sub', 'data-test': 'no-same' }, '同じ推しは見つかりませんでした。'));
      r.same.forEach((p) => page.append(h('div', { class: 'pair', 'data-test': 'same' }, h('b', null, p.mine.name), p.together ? h('span', { class: 'tag ok' }, '同じ頃に好き') : null, p.known ? null : h('span', { class: 'tag' }, '期間は比べられません'),
        h('div', { class: 'who' }, 'あなた: ' + pl(p.mine)), h('div', { class: 'who' }, f.nick + ': ' + pl(p.friend) + (p.friend.name !== p.mine.name ? ' (「' + p.friend.name + '」)' : '')),
        p.friend.note ? h('div', { class: 'small', style: 'margin-top:4px' }, f.nick + 'のひとこと: ' + p.friend.note) : null)));
      page.append(h('h2', null, '近い時期の別の推し (' + r.near.length + ')'));
      if (!r.near.length) page.append(h('p', { class: 'sub', 'data-test': 'no-near' }, f.fields.includes('period') ? '近い時期に好きだった別の推しは見つかりませんでした。' : '相手が「期間」を見せていないため、時期は比べられません。'));
      r.near.slice(0, 30).forEach((p) => page.append(h('div', { class: 'pair', 'data-test': 'near' }, h('span', { class: 'tag ' + (p.kind === 'overlap' ? 'ok' : '') }, p.kind === 'overlap' ? '期間が重なる' : '前後半年以内'),
        h('div', { class: 'who' }, 'あなた: ' + p.mine.name + ' (' + pl(p.mine) + ')'), h('div', { class: 'who' }, f.nick + ': ' + p.friend.name + ' (' + pl(p.friend) + ')'))));
      page.append(h('h2', null, f.nick + 'さんの遍歴 (' + f.items.length + ')'));
      C.sortTimeline(f.items).forEach((i) => page.append(h('div', { class: 'pair' }, h('b', null, i.name), i.genre ? h('span', { class: 'tag' }, i.genre) : null, C.periodLabel(i) ? h('div', { class: 'who' }, C.periodLabel(i)) : null, i.note ? h('div', { class: 'small' }, i.note) : null, i.trigger ? h('div', { class: 'small' }, 'きっかけ: ' + i.trigger) : null, i.points ? h('div', { class: 'small' }, '好きな所: ' + i.points) : null)));
      page.append(h('div', { class: 'btns' }, h('button', { class: 'btn danger block', onclick: async () => { if (await confirmBox(f.nick + 'さんの遍歴をこの端末から消します。', '消す', true)) { await DB.del('friends', id); close(); await refresh(); } } }, 'この友達のデータを消す')));
    });
  }

  // ---------- VEBANT単独版 ----------
  const vsave = async () => { await DB.kvSet('vgame', S.vgame); };
  function renderVB() {
    view.append(h('h1', null, 'VEBANT 単独版'), h('p', { class: 'sub' }, '参加者の推し遍歴を集めてシャッフルし、配られた他人の経歴書の持ち主を探して、4桁の接触コードで答え合わせをする遊びです。サーバーなし。主催者の端末1台と、紙またはコードで回せます。'),
      h('div', { class: 'note' }, '本名・連絡先・顔写真は書かないでください。主催者の端末には、全員の経歴と接触コードが入ります。'));
    // 参加者として
    view.append(h('h2', null, '参加者として'),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'vb-mycard', onclick: myCardSheet }, '参加カードをつくる'), h('button', { class: 'btn block', id: 'vb-opendv', onclick: openDeliverySheet }, '配布コードを開く')));
    if (S.vmission) view.append(h('button', { class: 'list-row', id: 'vb-resume', onclick: () => missionSheet(S.vmission) }, h('div', { class: 'grow' }, h('b', null, 'つづきから: ' + (S.vmission.title || 'ミッション')), h('div', { class: 'sub' }, S.vmission.solved ? '接触成功ずみ' : '探している途中')), '›'));
    // 主催者として
    view.append(h('h2', null, '主催者として'));
    const g = S.vgame;
    if (!g) {
      const t = h('input', { type: 'text', id: 'vb-title', placeholder: '会の名前 (例: 冬の交流会)', maxLength: 30 });
      view.append(t, h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'vb-new', onclick: async () => { S.vgame = { id: uid(), title: t.value.trim() || '交流会', status: 'collecting', players: [], ring: null, solved: {}, createdAt: Date.now() }; await vsave(); render(); } }, '新しいゲームをつくる')));
      return;
    }
    view.append(h('div', { class: 'panel' }, h('b', { 'data-test': 'vb-title' }, g.title), h('span', { class: 'tag ' + (g.status === 'dealt' ? 'now' : '') }, g.status === 'dealt' ? '配布ずみ' : '参加者あつめ'), h('div', { class: 'sub' }, '参加者 ' + g.players.length + '人' + (g.status === 'dealt' ? ' / 接触成功 ' + Object.keys(g.solved).length + '人' : ''))));
    if (g.status === 'collecting') {
      view.append(h('div', { class: 'btns' },
        h('button', { class: 'btn block', id: 'vb-add-card', onclick: () => addPlayerFromCard(null) }, '参加コードを読み込む'),
        h('button', { class: 'btn block', id: 'vb-add-hand', onclick: addPlayerByHand }, '手で入力する (アプリを使わない人)'),
        h('button', { class: 'btn block', id: 'vb-add-me', onclick: addPlayerFromMe }, '自分の遍歴から入れる')));
      playersList(true);
      view.append(h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'vb-deal', disabled: g.players.length < 2, onclick: dealGame }, 'シャッフルして配る' + (g.players.length < 2 ? ' (2人以上で)' : ''))));
    } else {
      view.append(h('h2', null, '配り方を選ぶ'), h('div', { class: 'btns' },
        h('button', { class: 'btn block', id: 'vb-pass', onclick: passSheet }, '1台で回す (順番に画面を見せる)'),
        h('button', { class: 'btn block', id: 'vb-paper', onclick: paperSheet }, '紙・文字で回す (印刷・コピー)'),
        h('button', { class: 'btn block', id: 'vb-codes', onclick: codesSheet }, '各自のスマホへコードを送る'),
        h('button', { class: 'btn primary block', id: 'vb-check', onclick: checkSheet }, '答え合わせ (主催者の端末で)')));
      playersList(false);
      view.append(h('div', { class: 'btns two' }, h('button', { class: 'btn quiet', id: 'vb-redeal', onclick: async () => { if (await confirmBox('もう一度シャッフルします。接触成功の記録は消えます。', 'やり直す')) { g.ring = C.makeRing(g.players.map((p) => p.id)); g.solved = {}; await vsave(); toast('シャッフルし直しました'); render(); } } }, '配り直す'), h('button', { class: 'btn danger', id: 'vb-end', onclick: endGame }, 'ゲームを終える')));
    }
    if (g.status === 'collecting') view.append(h('div', { class: 'btns' }, h('button', { class: 'btn danger block', id: 'vb-end', onclick: endGame }, 'このゲームを消す')));
  }
  function playersList(canDel) {
    const g = S.vgame; if (!g.players.length) return;
    const box = h('div', { 'data-test': 'players' });
    g.players.forEach((p) => box.append(h('div', { class: 'list-row', 'data-pid': p.id }, h('div', { class: 'grow' }, h('b', null, p.nick), h('div', { class: 'sub' }, '推し ' + p.episodes.length + '件' + (g.status === 'dealt' && g.solved[p.id] ? ' / 接触成功' : ''))), canDel ? h('button', { class: 'btn sm danger', 'aria-label': p.nick + 'を外す', onclick: async () => { g.players = g.players.filter((x) => x.id !== p.id); await vsave(); render(); } }, '外す') : null)));
    view.append(box);
  }
  async function endGame() { if (await confirmBox('ゲームのデータ(参加者の経歴・接触コード)をこの端末から消します。', '消す', true)) { S.vgame = null; await DB.kvDel('vgame'); toast('消しました'); render(); } }
  async function dealGame() {
    const g = S.vgame; if (g.players.length < 2) return;
    g.ring = C.makeRing(g.players.map((p) => p.id)); g.status = 'dealt'; g.solved = {}; await vsave(); toast('配りました'); render();
  }
  async function addPlayer(p) {
    const er = C.validatePlayer(p); if (er) { toast(er); return false; }
    const g = S.vgame; if (g.players.length >= C.VB.maxPlayers) { toast('参加者が多すぎます'); return false; }
    g.players.push(C.cleanPlayer(Object.assign({}, p, { id: uid() }))); await vsave(); toast(p.nick + 'さんを入れました'); render(); return true;
  }
  function addPlayerFromCard(preData) {
    if (!S.vgame) { toast('先に「新しいゲームをつくる」を押してください'); return; }
    if (S.vgame.status !== 'collecting') { toast('配布のあとは参加者を足せません'); return; }
    const tryAdd = async (data) => { try { const p = C.cardToPlayer(data); return await addPlayer(p); } catch (e) { toast(e.message); return false; } };
    if (preData) { tryAdd(preData); return; }
    sheet('参加コードを読み込む', (page, close) => {
      const ta = h('textarea', { class: 'code', id: 'vb-card-in', placeholder: '参加者から届いた「参加カード」のコードを貼る (複数は1つずつ)' });
      page.append(ta, h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'vb-card-go', onclick: async () => {
        const txt = ta.value; if (!C.findCode(txt)) { toast('コードが見つかりません'); return; }
        try { const d = await C.decodeCode(txt); if (d.prefix !== 'VB1') { toast('参加カードではありません (VB1で始まるコード)'); return; } if (await tryAdd(d.data)) { ta.value = ''; } } catch (e) { toast('読み込めませんでした: ' + e.message); }
      } }, '入れる')));
    });
  }
  function episodeRows(page, max, initial) {
    const rows = []; const box = h('div');
    const addRow = (e) => {
      const nm = h('input', { type: 'text', maxLength: 30, placeholder: '推しの名前', value: (e && e.name) || '', 'aria-label': '推しの名前' }), pd = h('input', { type: 'text', maxLength: 24, placeholder: '時期 (例: 小学生の頃)', value: (e && e.period) || '', 'aria-label': '時期' }), nt = h('input', { type: 'text', maxLength: C.LIM.vtext, placeholder: 'ひとこと', value: (e && e.note) || '', 'aria-label': 'ひとこと' });
      const row = h('div', { class: 'panel', 'data-row': '1' }, nm, h('div', { class: 'gap' }), pd, h('div', { class: 'gap' }), nt); rows.push({ nm, pd, nt, row }); box.append(row);
    };
    (initial && initial.length ? initial : [null]).forEach(addRow);
    page.append(box, h('button', { class: 'btn quiet block', id: 'ep-add', onclick: () => { if (rows.length < max) addRow(null); else toast('推しは' + max + '件までです'); } }, '＋ 推しを足す'));
    return () => rows.map((r) => ({ name: r.nm.value, period: r.pd.value, note: r.nt.value })).filter((e) => e.name.trim());
  }
  function addPlayerByHand() {
    if (!S.vgame || S.vgame.status !== 'collecting') return;
    sheet('手で入力する', (page, close) => {
      const nick = h('input', { type: 'text', id: 'hand-nick', maxLength: C.LIM.nick, placeholder: 'ニックネーム', 'aria-label': 'ニックネーム' });
      const code = h('input', { type: 'text', id: 'hand-code', inputmode: 'numeric', maxLength: 4, value: C.randomCode(), 'aria-label': '接触コード(4桁)' });
      page.append(h('label', { class: 'f' }, 'ニックネーム'), nick, h('label', { class: 'f' }, '接触コード (4桁。本人に伝えてください)'), code, h('label', { class: 'f' }, '推し遍歴 (最大' + C.VB.maxEpisodes + '件)'));
      const get = episodeRows(page, C.VB.maxEpisodes);
      page.append(h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'hand-save', onclick: async () => { if (await addPlayer({ nick: nick.value, code: code.value, episodes: get() })) close(); } }, '参加者に入れる')));
    });
  }
  function pickFromMine(page, max) {
    const picked = new Set(C.sortTimeline(S.oshi, true).slice(0, max).map((o) => o.id));
    const box = h('div');
    C.sortTimeline(S.oshi).forEach((o) => { const id = 'pk-' + o.id; box.append(h('div', { class: 'chk' }, h('input', { type: 'checkbox', id, checked: picked.has(o.id), onchange: (e) => { if (e.target.checked) { if (picked.size >= max) { e.target.checked = false; toast('推しは' + max + '件までです'); return; } picked.add(o.id); } else picked.delete(o.id); } }), h('label', { for: id }, o.name, h('span', { class: 'sub' }, ' ' + C.periodLabel(o))))); });
    page.append(box);
    return () => C.sortTimeline(S.oshi).filter((o) => picked.has(o.id)).map(C.vbEpisodeFromOshi);
  }
  function addPlayerFromMe() {
    if (!S.vgame || S.vgame.status !== 'collecting') return;
    if (!S.oshi.length) { toast('先に「年表」で推しを足してください'); return; }
    sheet('自分の遍歴から', (page, close) => {
      const nick = h('input', { type: 'text', id: 'me-nick', maxLength: C.LIM.nick, value: S.nick, placeholder: 'ニックネーム', 'aria-label': 'ニックネーム' });
      page.append(h('label', { class: 'f' }, 'ニックネーム'), nick, h('label', { class: 'f' }, '入れる推し (最大' + C.VB.maxEpisodes + '件)'));
      const get = pickFromMine(page, C.VB.maxEpisodes);
      page.append(h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'me-save', onclick: async () => { if (await addPlayer({ nick: nick.value, code: C.randomCode(), episodes: get() })) close(); } }, '参加者に入れる')));
    });
  }
  function myCardSheet() {
    sheet('参加カードをつくる', (page) => {
      const code = S.vcard ? S.vcard.code : C.randomCode();
      const nick = h('input', { type: 'text', id: 'mc-nick', maxLength: C.LIM.nick, value: S.nick, placeholder: 'ニックネーム', 'aria-label': 'ニックネーム' });
      const codeIn = h('input', { type: 'text', id: 'mc-code', inputmode: 'numeric', maxLength: 4, value: code, 'aria-label': '接触コード' });
      page.append(h('p', { class: 'sub' }, '作ったコードを主催者に送ってください。あなたの接触コードは、探しに来た人に伝える4桁です。'), h('label', { class: 'f' }, 'ニックネーム'), nick, h('label', { class: 'f' }, '接触コード (4桁)'), codeIn, h('label', { class: 'f' }, '推し遍歴 (最大' + C.VB.maxEpisodes + '件)'));
      const get = S.oshi.length ? pickFromMine(page, C.VB.maxEpisodes) : episodeRows(page, C.VB.maxEpisodes);
      const out = h('div');
      page.append(h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'mc-make', onclick: async () => {
        const p = { nick: nick.value, code: codeIn.value, episodes: get() }; const er = C.validatePlayer(p); if (er) { toast(er); return; }
        const cp = C.cleanPlayer(p); S.vcard = { code: cp.code, nick: cp.nick }; await DB.kvSet('vcard', S.vcard);
        const txt = await C.encodeCode('VB1', C.playerToCard(cp)); out.textContent = '';
        out.append(h('div', { class: 'panel' }, h('div', { class: 'sub' }, 'あなたの接触コード'), h('div', { class: 'big-code', 'data-test': 'my-code' }, cp.code), h('textarea', { class: 'code', readOnly: true, id: 'mc-out', 'aria-label': '参加カードのコード' }), h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'mc-copy', onclick: () => copyText(txt) }, '参加カードをコピー'), navigator.share ? h('button', { class: 'btn block', onclick: () => navigator.share({ text: txt }).catch(() => {}) }, '共有シートで送る') : null)));
        out.querySelector('#mc-out').value = txt; out.scrollIntoView({ block: 'start' });
      } }, '参加カードをつくる')), out);
    });
  }
  // ミッション画面(持ち主を探す)
  function missionBody(page, m, check) {
    page.append(h('div', { class: 'sub', style: 'text-align:center' }, m.title || ''), h('div', { class: 'sub', style: 'text-align:center' }, 'あなた(' + m.hunter.nick + ')の接触コード'), h('div', { class: 'big-code', 'data-test': 'own-code' }, m.hunter.code),
      h('p', { class: 'small', style: 'text-align:center' }, '探しに来た人に、この4桁を伝えてください。'), h('h2', null, '探す人の経歴書 (名前は伏せてあります)'));
    const cr = h('div', { class: 'career', 'data-test': 'career' });
    m.episodes.forEach((e) => cr.append(h('div', { class: 'e' }, h('div', { class: 'p' }, e.period || '時期不明'), h('div', null, h('div', { class: 't' }, e.name), e.note ? h('div', { class: 'small' }, e.note) : null))));
    page.append(cr);
    if (!check) return;
    const res = h('div', { 'data-test': 'mission-result' }), inp = h('input', { type: 'text', id: 'mission-digits', class: 'digits', inputmode: 'numeric', maxLength: 4, placeholder: '0000', 'aria-label': '相手の接触コード4桁', autocomplete: 'off' });
    let wrong = 0, lockUntil = 0;
    const go = h('button', { class: 'btn primary block', id: 'mission-go', onclick: async () => {
      if (Date.now() < lockUntil) { toast('5回まちがえました。少し待ってください'); return; }
      const r = await check(inp.value);
      if (!r) { wrong++; if (wrong >= 5) { lockUntil = Date.now() + 30000; wrong = 0; res.textContent = '5回まちがえました。30秒待ってからもう一度。'; } else res.textContent = 'ちがうみたい。もう一度、相手に聞いてみてください。(' + wrong + '回目)'; return; }
      wrongReset(); res.textContent = ''; res.append(h('div', { style: 'text-align:center' }, h('div', { class: 'stamp', 'data-test': 'stamp' }, '接触成功')), h('h2', null, 'この経歴の主は「' + r.nick + '」さんでした'));
      const cr2 = h('div', { class: 'career' }); r.episodes.forEach((e) => cr2.append(h('div', { class: 'e' }, h('div', { class: 'p' }, e.period || ''), h('div', null, h('div', { class: 't' }, e.name), e.note ? h('div', { class: 'small' }, e.note) : null)))); res.append(cr2);
      go.disabled = true; inp.disabled = true; if (m.onSolved) m.onSolved(r);
    } }, '接触コードを送る');
    const wrongReset = () => { wrong = 0; };
    page.append(h('label', { class: 'f' }, '見つけた相手の接触コード (4桁)'), inp, h('div', { class: 'gap' }), go, res);
    if (m.solved) { inp.value = ''; res.append(h('div', { style: 'text-align:center' }, h('div', { class: 'stamp' }, '接触成功')), h('h2', null, 'この経歴の主は「' + m.solved.nick + '」さんでした')); const cr3 = h('div', { class: 'career' }); m.solved.episodes.forEach((e) => cr3.append(h('div', { class: 'e' }, h('div', { class: 'p' }, e.period || ''), h('div', null, h('div', { class: 't' }, e.name), e.note ? h('div', { class: 'small' }, e.note) : null)))); res.append(cr3); go.disabled = true; inp.disabled = true; }
  }
  function openDeliverySheet() {
    sheet('配布コードを開く', (page, close) => {
      const ta = h('textarea', { class: 'code', id: 'dv-in', placeholder: '主催者から届いた配布コード(VD1…)かリンクを貼る' });
      page.append(ta, h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'dv-go', onclick: async () => { try { const d = await C.decodeCode(ta.value); if (d.prefix !== 'VD1') { toast('配布コードではありません (VD1で始まるコード)'); return; } close(); openMissionFromDelivery(C.parseDelivery(d.data)); } catch (e) { toast('読み込めませんでした: ' + e.message); } } }, '開く')));
    });
  }
  async function openMissionFromDelivery(dv) {
    S.vmission = { title: dv.title, hunter: dv.hunter, episodes: dv.episodes, seal: dv.seal, solved: null }; await DB.kvSet('vmission', S.vmission); if (S.tab === 'vb') render(); missionSheet(S.vmission);
  }
  function missionSheet(m) {
    sheet(m.title || 'ミッション', (page) => {
      missionBody(page, Object.assign({}, m, { onSolved: async (r) => { S.vmission.solved = r; await DB.kvSet('vmission', S.vmission); } }), (input) => C.openDelivery(m, input));
    }, { label: '消す', fn: async (close) => { if (await confirmBox('このミッションの記録を端末から消します。', '消す', true)) { S.vmission = null; await DB.kvDel('vmission'); close(); render(); } } });
  }
  // 主催者: 1台で回す
  function targetOf(pid) { const g = S.vgame; return g.players.find((p) => p.id === g.ring[pid]); }
  function passSheet() {
    sheet('1台で回す', (page) => {
      page.append(h('p', { class: 'sub' }, '名前を選び、その人に端末をわたしてください。「見る」を押すと、その人が探す相手の経歴書が出ます。見終わったら「とじる」を押してから次の人へ。'));
      S.vgame.players.forEach((p) => page.append(h('button', { class: 'list-row', 'data-pid': p.id, onclick: () => {
        modal((m, close) => { m.append(h('h2', { style: 'margin-top:0' }, p.nick + 'さんの番'), h('p', null, p.nick + 'さんに端末をわたしてください。他の人に見えないように。'), h('div', { class: 'btns two' }, h('button', { class: 'btn quiet', onclick: close }, 'やめる'), h('button', { class: 'btn primary', id: 'pass-view', onclick: () => { close(); sheet(p.nick + 'さんのミッション', (pg) => missionBody(pg, { title: S.vgame.title, hunter: { nick: p.nick, code: p.code }, episodes: targetOf(p.id).episodes }, null)); } }, '見る'))); });
      } }, h('div', { class: 'grow' }, h('b', null, p.nick + 'さんの番')), '›')));
    });
  }
  // 主催者: 答え合わせ
  function checkSheet() {
    sheet('答え合わせ', (page) => {
      const g = S.vgame; const sel = h('select', { id: 'chk-hunter', 'aria-label': '探した人' }, g.players.map((p) => h('option', { value: p.id }, p.nick)));
      const inp = h('input', { type: 'text', id: 'chk-digits', class: 'digits', inputmode: 'numeric', maxLength: 4, placeholder: '0000', 'aria-label': '見つけた相手の接触コード', autocomplete: 'off' });
      const res = h('div', { 'data-test': 'chk-result' }); const wrongs = {};
      page.append(h('p', { class: 'sub' }, '探した人と、その人が見つけた相手から聞いた4桁を入れます。'), h('label', { class: 'f' }, '探した人'), sel, h('label', { class: 'f' }, '相手の接触コード (4桁)'), inp, h('div', { class: 'gap' }),
        h('button', { class: 'btn primary block', id: 'chk-go', onclick: async () => {
          const hid = sel.value, tgt = targetOf(hid), hunter = g.players.find((p) => p.id === hid);
          if ((wrongs[hid] || {}).until > Date.now()) { res.textContent = '5回まちがえました。30秒待ってください。'; return; }
          if (!C.checkCode(tgt, inp.value)) { const w = wrongs[hid] = wrongs[hid] || { n: 0, until: 0 }; w.n++; if (w.n >= 5) { w.n = 0; w.until = Date.now() + 30000; res.textContent = '5回まちがえました。30秒待ってください。'; } else res.textContent = 'ちがうみたい (' + w.n + '回目)'; return; }
          g.solved[hid] = true; await vsave(); render(); res.textContent = '';
          res.append(h('div', { style: 'text-align:center;margin-top:12px' }, h('div', { class: 'stamp', 'data-test': 'stamp' }, '接触成功')), h('h2', null, hunter.nick + 'さんが見つけたのは「' + tgt.nick + '」さん'));
          const cr = h('div', { class: 'career' }); tgt.episodes.forEach((e) => cr.append(h('div', { class: 'e' }, h('div', { class: 'p' }, e.period || ''), h('div', null, h('div', { class: 't' }, e.name), e.note ? h('div', { class: 'small' }, e.note) : null)))); res.append(cr); inp.value = '';
        } }, '照合する'), res);
    });
    // 閉じたあとに一覧へ反映
  }
  // 主催者: 紙・文字
  function cardText(p) { const t = targetOf(p.id); return S.vgame.title + '\n' + p.nick + 'さんのミッション\nあなたの接触コード: ' + p.code + '\n\n探す人の経歴書(名前は伏せてあります)\n' + t.episodes.map((e, i) => (i + 1) + '. ' + e.name + (e.period ? ' (' + e.period + ')' : '') + (e.note ? ' ' + e.note : '')).join('\n') + '\n\n見つけたら、相手に4桁の接触コードを聞いて、主催者に伝えてください。'; }
  function paperSheet() {
    sheet('紙・文字で回す', (page) => {
      const g = S.vgame;
      page.append(h('div', { class: 'noprint' }, h('p', { class: 'sub' }, '参加者ごとに1枚のカードです。「印刷」で紙に、またはカードごとの文字をコピーして送れます。答え合わせ表は主催者だけが持ってください。'),
        h('div', { class: 'btns two' }, h('button', { class: 'btn primary', id: 'paper-print', onclick: () => window.print() }, '印刷する'), h('button', { class: 'btn', id: 'paper-copyall', onclick: () => copyText(g.players.map(cardText).join('\n\n----------\n\n')) }, '全員分をコピー'))));
      g.players.forEach((p) => {
        const t = targetOf(p.id);
        page.append(h('div', { class: 'card-sheet', 'data-test': 'paper-card' }, h('b', null, g.title + ' / ' + p.nick + 'さん'), h('div', null, 'あなたの接触コード: ', h('b', null, p.code)), h('div', { class: 'sub', style: 'margin-top:6px' }, '探す人の経歴書 (名前は伏せてあります)'),
          ...t.episodes.map((e, i) => h('div', null, (i + 1) + '. ' + e.name + (e.period ? ' (' + e.period + ')' : '') + (e.note ? '  ' + e.note : ''))), h('button', { class: 'btn sm quiet noprint', style: 'margin-top:8px', onclick: () => copyText(cardText(p)) }, 'このカードをコピー')));
      });
      page.append(h('h2', null, '答え合わせ表 (主催者用)'), h('div', { class: 'card-sheet', 'data-test': 'answer-key' }, ...g.players.map((p) => h('div', null, p.nick + ' → ' + targetOf(p.id).nick + ' (コード ' + targetOf(p.id).code + ')'))));
    });
  }
  // 主催者: 各自のスマホへコード
  function codesSheet() {
    sheet('各自のスマホへ', (page) => {
      const g = S.vgame, box = h('div'), base = location.href.split('#')[0];
      if (!window.isSecureContext) page.append(h('div', { class: 'note' }, 'この開き方では暗号が使えません。https のアドレスか localhost で開いてください。'));
      page.append(h('p', { class: 'sub' }, '参加者それぞれに、その人宛ての「配布コード」を送ります。コードの中の相手の名前は、相手の4桁を入れたときだけ開く封筒に入っています。'),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary block', id: 'codes-make', onclick: async () => {
          box.textContent = ''; const all = [];
          for (const p of g.players) {
            const code = await C.encodeCode('VD1', await C.makeDelivery(g.title, p, targetOf(p.id))); all.push(p.nick + 'さん宛て:\n' + code);
            box.append(h('div', { class: 'pair', 'data-test': 'dv-row', 'data-pid': p.id }, h('b', null, p.nick + 'さん宛て'), h('div', { class: 'sub' }, code.length + '文字'), h('div', { class: 'row wrap', style: 'margin-top:6px' }, h('button', { class: 'btn sm', onclick: () => copyText(code) }, 'コードをコピー'), h('button', { class: 'btn sm', onclick: () => copyText(base + '#vb=' + code) }, 'リンクをコピー'))));
          }
          box.prepend(h('button', { class: 'btn block', id: 'codes-copyall', style: 'margin-bottom:10px', onclick: () => copyText(all.join('\n\n')) }, '全員分をまとめてコピー'));
        } }, 'コードをつくる')), box);
    });
  }

  // ---------- もっと ----------
  function renderMore() {
    view.append(h('h1', null, 'もっと'));
    view.append(h('h2', null, '見た目'), h('div', { class: 'seg' }, ...[['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']].map(([k, t]) => h('button', { 'aria-pressed': S.theme === k, 'data-theme-btn': k, onclick: async () => { S.theme = k; applyTheme(k); await DB.kvSet('theme', k); render(); } }, t))));
    view.append(h('h2', null, 'バックアップ'), h('p', { class: 'sub', id: 'last-backup' }, S.lastBackup ? '最後に書き出した日: ' + S.lastBackup : 'まだ書き出していません。端末を変えたり、ブラウザのデータを消したりすると、記録は消えます。時々書き出しておくと安心です。'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary block', id: 'ex-json', onclick: () => exportJSON(true) }, 'JSONで書き出す (写真つき・取り込み用)'),
        h('button', { class: 'btn block', id: 'ex-json-np', onclick: () => exportJSON(false) }, 'JSONで書き出す (写真なし)'),
        h('button', { class: 'btn block', id: 'ex-csv', onclick: exportCSV }, 'CSVで書き出す (表計算用)')),
      h('label', { class: 'f' }, '取り込む (JSON または CSV)'), h('input', { type: 'file', id: 'im-file', accept: '.json,.csv,text/csv,application/json', 'aria-label': 'バックアップファイルを選ぶ', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(await f.text(), f.name); } }));
    view.append(h('h2', null, 'データ'), h('div', { class: 'btns' },
      h('button', { class: 'btn block', onclick: addSamples }, '見本(架空の4人)を入れる'),
      h('button', { class: 'btn danger block', id: 'wipe', onclick: wipeAll }, 'この端末の記録をぜんぶ消す')));
    view.append(h('h2', null, 'このアプリについて'),
      h('div', { class: 'panel small' }, h('p', null, '推し遍歴(仮称)。記録・写真・読み込んだ友達のデータは、この端末のブラウザの中にだけ保存されます。サーバーへの送信、ログイン、広告、解析はありません。'), h('p', null, '友達に渡るのは、「見せ合い」で選んだ項目の共有コードだけです。'), h('p', { class: 'sub', style: 'margin:0' }, 'iPhoneでは、Safariの共有ボタン →「ホーム画面に追加」で、アプリのように使えます。')));
  }
  async function exportJSON(withPhotos) {
    const oshi = [];
    for (const o of S.oshi) { const x = Object.assign({}, o); if (withPhotos && o.hasPhoto) { const r = await DB.get('photos', o.id); x.photo = r ? await blobToDataURL(r.blob) : null; } else if (!withPhotos) { x.hasPhoto = false; } oshi.push(x); }
    const data = { app: 'oshi-henreki', version: 1, exportedAt: new Date().toISOString(), nick: S.nick, oshi, friends: S.friends };
    await saveFile('oshi-henreki-backup-' + today() + '.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    S.lastBackup = today(); await DB.kvSet('lastBackup', S.lastBackup); render();
  }
  async function exportCSV() { await saveFile('oshi-henreki-' + today() + '.csv', new Blob([C.toCSV(S.oshi)], { type: 'text/csv;charset=utf-8' })); S.lastBackup = today(); await DB.kvSet('lastBackup', S.lastBackup); render(); }
  async function importFile(text, name) {
    try {
      let add = [], photos = {}, friends = [], skipped = 0, dup = 0, nick = '';
      const exist = new Set(S.oshi.map((o) => o.id)), existKey = new Set(S.oshi.map((o) => C.normName(o.name) + '|' + o.from));
      if (/\.json$/i.test(name) || text.trim()[0] === '{') {
        const j = JSON.parse(text); if (j.app !== 'oshi-henreki' || !Array.isArray(j.oshi)) throw new Error('このアプリのバックアップではありません');
        nick = typeof j.nick === 'string' ? j.nick : '';
        for (const o of j.oshi.slice(0, 5000)) { const c = C.cleanOshi(Object.assign({}, o, { id: typeof o.id === 'string' && o.id.length < 80 ? o.id : uid() })); if (!c.name) { skipped++; continue; } if (exist.has(c.id)) { dup++; continue; } c.hasPhoto = false; if (typeof o.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(o.photo)) { const b = dataURLToBlob(o.photo); if (b) { photos[c.id] = b; c.hasPhoto = true; } } add.push(c); }
        for (const f of Array.isArray(j.friends) ? j.friends.slice(0, 500) : []) { try { const sh = C.parseShare({ v: 1, n: f.nick, t: f.date, k: f.fields, o: (f.items || []).map((i) => ({ n: i.name, g: i.genre, f: i.from, e: i.to, c: i.ongoing ? 1 : 0, m: i.note, r: i.trigger, p: i.points })) }); friends.push({ id: fid(sh), nick: sh.nick, date: sh.date, fields: sh.fields, items: sh.items, importedAt: Date.now() }); } catch (e) { skipped++; } }
      } else {
        const r = C.fromCSV(text); skipped = r.skipped;
        for (const o of r.items) { const k = C.normName(o.name) + '|' + o.from; if (existKey.has(k)) { dup++; continue; } existKey.add(k); o.id = uid(); o.createdAt = Date.now(); o.updatedAt = Date.now(); add.push(o); }
      }
      const msg = add.length + '件を追加します' + (friends.length ? '(友達 ' + friends.length + '人も)' : '') + '。すでにある ' + dup + '件はそのまま、読めなかった ' + skipped + '行は飛ばします。';
      modal((m, close) => m.append(h('p', { 'data-test': 'import-msg' }, msg), h('div', { class: 'btns two' }, h('button', { class: 'btn quiet', onclick: close }, 'やめる'), h('button', { class: 'btn primary', id: 'import-ok', onclick: async () => {
        for (const o of add) { const t = Date.now(); o.createdAt = o.createdAt || t; await DB.put('oshi', o); if (photos[o.id]) await DB.put('photos', { id: o.id, blob: photos[o.id] }); }
        for (const f of friends) await DB.put('friends', f);
        if (nick && !S.nick) { S.nick = nick; await DB.kvSet('nick', nick); }
        close(); toast('取り込みました'); await refresh();
      } }, '取り込む'))));
    } catch (e) { toast('取り込めませんでした: ' + e.message); }
  }
  async function wipeAll() {
    if (!(await confirmBox('推し・写真・友達・VEBANTのデータを、この端末からぜんぶ消します。元に戻せません。先に書き出しておくと安心です。', 'ぜんぶ消す', true))) return;
    for (const s of ['oshi', 'photos', 'friends', 'kv']) await DB.clear(s);
    S.tab = 'tl'; toast('消しました'); await refresh();
  }

  // ---------- 起動 ----------
  async function hashIn() {
    const m = /^#(share|vb)=(.+)$/.exec(location.hash); if (!m) return;
    const t = decodeURIComponent(m[2]); history.replaceState(null, '', location.pathname + location.search); await incoming(t);
  }
  async function boot() {
    try { await load(); } catch (e) { view.append(h('div', { class: 'note' }, 'この環境では記録を保存できません (' + e.message + ')。プライベートブラウズを使っていないか確認してください。')); return; }
    renderTabs(); render();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('hashchange', hashIn); hashIn();
    window.__ready = true;
  }
  boot();
})();
