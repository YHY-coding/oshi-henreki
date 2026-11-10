// 推し遍歴: 画面に依存しない関数(年表・比較・共有コード・CSV・VEBANT単独版)。node でもブラウザでも動く。
(function (root) {
  'use strict';
  const C = {};

  // ---------- 文字・期間 ----------
  // 名前の比較用: 全角半角・大小・ひらがなカタカナ・空白や記号の違いを無視する
  C.normName = function (s) {
    s = String(s == null ? '' : s).normalize('NFKC').toLowerCase();
    s = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return s.replace(/[\s・\-_.,，、。!！?？'"「」『』()（）\[\]【】~〜]/g, '');
  };
  C.parseYM = function (s) {
    const m = /^(\d{4})(?:-(\d{1,2}))?$/.exec(String(s || '').trim());
    if (!m) return null;
    const mo = m[2] ? +m[2] : null;
    if (mo !== null && (mo < 1 || mo > 12)) return null;
    return { y: +m[1], m: mo };
  };
  C.fmtYM = function (s) {
    const p = C.parseYM(s);
    if (!p) return '';
    return p.m ? p.y + '.' + String(p.m).padStart(2, '0') : p.y + '年';
  };
  C.nowIdx = function (d) { d = d || new Date(); return d.getFullYear() * 12 + d.getMonth(); };
  // 期間を月の通し番号の範囲にする。始まりが無ければ null
  C.range = function (o, nowIdx) {
    const a = C.parseYM(o.from);
    if (!a) return null;
    const start = a.y * 12 + (a.m ? a.m - 1 : 0);
    let end;
    if (o.ongoing) end = nowIdx;
    else {
      const b = C.parseYM(o.to);
      end = b ? b.y * 12 + (b.m ? b.m - 1 : 11) : start;
    }
    if (end < start) end = start;
    return { start, end };
  };
  C.periodLabel = function (o) {
    const a = C.fmtYM(o.from), b = C.fmtYM(o.to);
    if (!a && !b && !o.ongoing) return '';
    const left = a || '';
    const right = o.ongoing ? '現在' : b;
    if (!left && !right) return '';
    if (!right) return left + '〜';
    if (!left) return '〜' + right;
    return left + ' 〜 ' + right;
  };
  C.overlaps = function (r1, r2, gap) {
    if (!r1 || !r2) return false;
    gap = gap || 0;
    return r1.start <= r2.end + gap && r2.start <= r1.end + gap;
  };

  // ---------- 年表 ----------
  C.sortTimeline = function (list, newestFirst) {
    const key = (o) => { const p = C.parseYM(o.from); return p ? p.y * 12 + (p.m ? p.m - 1 : 0) : null; };
    const a = list.slice().sort((x, y) => {
      const kx = key(x), ky = key(y);
      if (kx === null && ky === null) return (x.createdAt || 0) - (y.createdAt || 0);
      if (kx === null) return 1;
      if (ky === null) return -1;
      return kx - ky || (x.createdAt || 0) - (y.createdAt || 0);
    });
    if (!newestFirst) return a;
    const known = a.filter((o) => key(o) !== null).reverse();
    return known.concat(a.filter((o) => key(o) === null));
  };
  C.groupByYear = function (sorted) {
    const out = [];
    for (const o of sorted) {
      const p = C.parseYM(o.from);
      const label = p ? p.y + '年' : '時期はわからない';
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(o);
    }
    return out;
  };
  C.summary = function (list, nowIdx) {
    const known = C.sortTimeline(list.filter((o) => C.parseYM(o.from)));
    return {
      total: list.length,
      ongoing: list.filter((o) => o.ongoing).length,
      graduated: list.filter((o) => !o.ongoing).length,
      firstYear: known.length ? C.parseYM(known[0].from).y : null,
    };
  };

  // ---------- 入力の整え・検査 ----------
  const LIM = { name: 40, genre: 30, text: 200, nick: 12, vtext: 80 };
  C.LIM = LIM;
  const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
  C.cleanOshi = function (o) {
    const from = C.parseYM(o.from) ? String(o.from).trim() : '';
    const to = C.parseYM(o.to) ? String(o.to).trim() : '';
    const ongoing = !!o.ongoing;
    return {
      id: o.id, name: clip(o.name, LIM.name), genre: clip(o.genre, LIM.genre),
      from, to: ongoing ? '' : to, ongoing,
      note: clip(o.note, LIM.text), trigger: clip(o.trigger, LIM.text), points: clip(o.points, LIM.text),
      hasPhoto: !!o.hasPhoto, createdAt: o.createdAt || 0, updatedAt: o.updatedAt || 0,
    };
  };
  C.validateOshi = function (o) {
    if (!String(o.name || '').trim()) return '名前を入れてください';
    const f = C.parseYM(o.from), t = C.parseYM(o.to);
    if (o.from && !f) return '好きになった時期の形式が正しくありません';
    if (o.to && !t) return 'やめた時期の形式が正しくありません';
    if (f && t && !o.ongoing && t.y * 12 + (t.m || 12) < f.y * 12 + (f.m || 1)) return 'やめた時期が、好きになった時期より前になっています';
    return '';
  };
  // 連絡先・リンクらしい文字列(VEBANTで他人に見せる文に使う)
  const CONTACT = /(https?:|www\.|@|＠|\.(com|jp|net|me)\b|\d[\d\-\s－ー]{8,}\d)/i;
  C.looksLikeContact = (s) => CONTACT.test(String(s || ''));

  // ---------- バイト列・コード ----------
  function b64u(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const s = atob(str), b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  C.b64u = b64u; C.unb64u = unb64u;
  const CODE_RE = /(OH1|VB1|VD1)([zp])\.([A-Za-z0-9_-]+)/;
  // prefix: OH1=遍歴の共有 / VB1=VEBANT参加カード / VD1=VEBANT配布コード
  C.encodeCode = async function (prefix, obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== 'undefined') {
      const z = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return prefix + 'z.' + b64u(new Uint8Array(await new Response(z).arrayBuffer()));
    }
    return prefix + 'p.' + b64u(bytes);
  };
  C.findCode = function (text) {
    text = String(text || '');
    let m = CODE_RE.exec(text);
    if (!m) m = CODE_RE.exec(text.replace(/\s+/g, ''));
    return m ? { prefix: m[1], mode: m[2], body: m[3], text: m[0] } : null;
  };
  // 戻り値: { prefix, data } 。読めなければ例外
  C.decodeCode = async function (text) {
    text = String(text || '');
    const cands = [];
    const m1 = CODE_RE.exec(text); if (m1) cands.push(m1);
    const m2 = CODE_RE.exec(text.replace(/\s+/g, '')); if (m2 && (!m1 || m2[0] !== m1[0])) cands.push(m2);
    if (!cands.length) throw new Error('共有コードが見つかりません');
    let last = null;
    for (const f of cands) {
      try { return await decodeOne(f[1], f[2], f[3]); } catch (e) { last = e; }
    }
    throw new Error(last && last.message && !/Invalid character|atob/.test(last.message) ? last.message : 'コードが壊れています(途中で切れていないか確認してください)');
  };
  async function decodeOne(prefix, mode, body) {
    let bytes = unb64u(body);
    if (mode === 'z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('この端末では読み込めません');
      const z = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(z).arrayBuffer());
    }
    if (bytes.length > 400000) throw new Error('大きすぎます');
    let data;
    try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error('コードが壊れています'); }
    return { prefix, data };
  }

  // ---------- 見せ合い(共有) ----------
  C.SHARE_FIELDS = [['genre', 'ジャンル'], ['period', '期間'], ['note', 'ひとこと'], ['trigger', 'きっかけ'], ['points', '好きな所']];
  // 選んだ項目だけを入れる。写真は入れない。
  C.buildShare = function (nick, list, fields, ids, whenISO) {
    const on = new Set(fields);
    const o = [];
    for (const x of list) {
      if (ids && !ids.includes(x.id)) continue;
      const e = { n: x.name };
      if (on.has('genre') && x.genre) e.g = x.genre;
      if (on.has('period')) { if (x.from) e.f = x.from; if (x.ongoing) e.c = 1; else if (x.to) e.e = x.to; }
      if (on.has('note') && x.note) e.m = x.note;
      if (on.has('trigger') && x.trigger) e.r = x.trigger;
      if (on.has('points') && x.points) e.p = x.points;
      o.push(e);
    }
    return { v: 1, n: clip(nick, LIM.nick), t: (whenISO || '').slice(0, 10), k: ['name'].concat(fields), o };
  };
  // 受け取ったものは信用しない。型・長さ・形式を整えて、画面で使う形にする
  C.parseShare = function (d) {
    if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.o)) throw new Error('この形式は読めません');
    const items = [];
    for (const e of d.o.slice(0, 200)) {
      if (!e || typeof e !== 'object') continue;
      const name = clip(e.n, LIM.name);
      if (!name) continue;
      const from = C.parseYM(e.f) ? String(e.f) : '', to = C.parseYM(e.e) ? String(e.e) : '';
      items.push({ name, genre: clip(e.g, LIM.genre), from, to: e.c ? '' : to, ongoing: !!e.c, note: clip(e.m, LIM.text), trigger: clip(e.r, LIM.text), points: clip(e.p, LIM.text) });
    }
    const known = ['genre', 'period', 'note', 'trigger', 'points'];
    const fields = Array.isArray(d.k) ? d.k.filter((k) => known.includes(k)) : [];
    return { nick: clip(d.n, LIM.nick) || '(名前なし)', date: /^\d{4}-\d{2}-\d{2}$/.test(d.t) ? d.t : '', fields, items };
  };
  // 自分の遍歴と、友達の遍歴を比べる
  C.compare = function (mine, friendItems, nowIdx) {
    const same = [], near = [];
    const sameMine = new Set(), sameFriend = new Set();
    friendItems.forEach((f, fi) => {
      const k = C.normName(f.name);
      if (!k) return;
      mine.forEach((m, mi) => {
        if (C.normName(m.name) !== k) return;
        const rm = C.range(m, nowIdx), rf = C.range(f, nowIdx);
        same.push({ mine: m, friend: f, together: C.overlaps(rm, rf, 0), known: !!(rm && rf) });
        sameMine.add(mi); sameFriend.add(fi);
      });
    });
    mine.forEach((m, mi) => {
      if (sameMine.has(mi)) return;
      const rm = C.range(m, nowIdx);
      if (!rm) return;
      friendItems.forEach((f, fi) => {
        if (sameFriend.has(fi)) return;
        const rf = C.range(f, nowIdx);
        if (!rf) return;
        if (C.overlaps(rm, rf, 0)) near.push({ mine: m, friend: f, kind: 'overlap', score: Math.min(rm.end, rf.end) - Math.max(rm.start, rf.start) + 1 });
        else if (C.overlaps(rm, rf, 6)) near.push({ mine: m, friend: f, kind: 'close', score: 0 });
      });
    });
    near.sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === 'overlap' ? -1 : 1));
    same.sort((a, b) => (b.together ? 1 : 0) - (a.together ? 1 : 0));
    return { same, near };
  };

  // ---------- CSV ----------
  const CSV_HEAD = ['名前', 'ジャンル', '好きになった時期', 'やめた時期', '今も好き', 'ひとこと', 'きっかけ', '好きな所'];
  C.CSV_HEAD = CSV_HEAD;
  const guard = (s) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);
  const q = (s) => { s = guard(String(s == null ? '' : s)); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  C.toCSV = function (list) {
    const rows = [CSV_HEAD.join(',')];
    for (const o of C.sortTimeline(list)) rows.push([o.name, o.genre, o.from, o.to, o.ongoing ? '1' : '0', o.note, o.trigger, o.points].map(q).join(','));
    return '﻿' + rows.join('\r\n') + '\r\n';
  };
  C.parseCSVRows = function (text) {
    text = String(text).replace(/^﻿/, '');
    const rows = []; let row = [], cell = '', inq = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inq) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += ch;
      } else if (ch === '"') inq = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c !== ''));
  };
  const unguard = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
  // 戻り値: { items, skipped }
  C.fromCSV = function (text) {
    const rows = C.parseCSVRows(text);
    if (!rows.length) return { items: [], skipped: 0 };
    const head = rows[0].map((s) => s.trim());
    const idx = {}; CSV_HEAD.forEach((h) => { idx[h] = head.indexOf(h); });
    if (idx['名前'] < 0) throw new Error('「名前」の列がありません(このアプリで書き出したCSVを選んでください)');
    const items = []; let skipped = 0;
    for (const r of rows.slice(1)) {
      const g = (h) => (idx[h] >= 0 ? unguard(r[idx[h]] || '') : '');
      const o = C.cleanOshi({ name: g('名前'), genre: g('ジャンル'), from: g('好きになった時期').trim(), to: g('やめた時期').trim(), ongoing: /^(1|true|現在|はい)$/i.test(g('今も好き').trim()), note: g('ひとこと'), trigger: g('きっかけ'), points: g('好きな所') });
      if (!o.name) { skipped++; continue; }
      items.push(o);
    }
    return { items, skipped };
  };

  // ---------- VEBANT単独版 ----------
  C.VB = { maxEpisodes: 8, maxPlayers: 200 };
  C.randomCode = (rng) => String(Math.floor((rng || Math.random)() * 10000)).padStart(4, '0');
  C.makeRing = function (ids, rng) {
    rng = rng || Math.random;
    if (ids.length < 2) return null;
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const m = {};
    a.forEach((id, i) => { m[id] = a[(i + 1) % a.length]; });
    return m;
  };
  C.vbEpisodeFromOshi = (o) => ({ name: clip(o.name, 30), period: C.periodLabel(o), note: clip(o.note, LIM.vtext) });
  // 人の入力(参加カード・手入力)を検査する。エラー文(なければ'')
  C.validatePlayer = function (p) {
    const nick = String(p.nick || '').trim();
    if (!nick) return 'ニックネームを入れてください';
    if (nick.length > LIM.nick) return 'ニックネームは' + LIM.nick + '字までです';
    if (C.looksLikeContact(nick)) return '本名・連絡先・リンクは書かないでください';
    if (!/^\d{4}$/.test(String(p.code || ''))) return '接触コードは4桁の数字です';
    const e = p.episodes || [];
    if (e.length < 1) return '推しを1つ以上入れてください';
    if (e.length > C.VB.maxEpisodes) return '推しは' + C.VB.maxEpisodes + '件までです';
    for (const x of e) {
      if (!String(x.name || '').trim()) return '推しの名前が空です';
      if (C.looksLikeContact(x.name) || C.looksLikeContact(x.note) || C.looksLikeContact(x.period)) return '本名・連絡先・リンクは書かないでください';
    }
    return '';
  };
  C.cleanPlayer = (p) => ({
    id: p.id, nick: clip(p.nick, LIM.nick), code: String(p.code),
    episodes: (p.episodes || []).slice(0, C.VB.maxEpisodes).map((x) => ({ name: clip(x.name, 30), period: clip(x.period, 24), note: clip(x.note, LIM.vtext) })),
  });
  // 参加カード(VB1)
  C.playerToCard = (p) => ({ v: 1, n: p.nick, c: p.code, e: p.episodes.map((x) => ({ n: x.name, p: x.period, m: x.note })) });
  C.cardToPlayer = function (d) {
    if (!d || d.v !== 1 || !Array.isArray(d.e)) throw new Error('参加カードの形式が読めません');
    return C.cleanPlayer({ nick: d.n, code: d.c, episodes: d.e.slice(0, C.VB.maxEpisodes).map((x) => ({ name: x && x.n, period: x && x.p, note: x && x.m })) });
  };
  // 照合
  C.checkCode = (target, input) => !!target && String(input).trim() === target.code;

  // 配布コード(VD1): 自分の接触コード+相手の経歴(名前なし)+「接触コードでだけ開く封筒」。サーバー不要。
  const subtle = () => (root.crypto && root.crypto.subtle) || null;
  async function key(code, salt, usage) {
    const s = subtle();
    if (!s) throw new Error('この環境では暗号化が使えません(https か localhost で開いてください)');
    const km = await s.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    return s.deriveKey({ name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, usage);
  }
  C.seal = async function (code, obj) {
    const salt = root.crypto.getRandomValues(new Uint8Array(16)), iv = root.crypto.getRandomValues(new Uint8Array(12));
    const k = await key(code, salt, ['encrypt']);
    const c = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(obj))));
    return { s: b64u(salt), i: b64u(iv), c: b64u(c) };
  };
  C.unseal = async function (code, sealed) {
    try {
      const k = await key(code, unb64u(sealed.s), ['decrypt']);
      const p = await subtle().decrypt({ name: 'AES-GCM', iv: unb64u(sealed.i) }, k, unb64u(sealed.c));
      return JSON.parse(new TextDecoder().decode(p));
    } catch (e) { return null; }
  };
  C.makeDelivery = async function (title, hunter, target) {
    return {
      v: 1, t: clip(title, 30), h: { n: hunter.nick, c: hunter.code },
      e: target.episodes.map((x) => ({ n: x.name, p: x.period, m: x.note })),
      s: await C.seal(target.code, { n: target.nick, e: target.episodes.map((x) => ({ n: x.name, p: x.period, m: x.note })) }),
    };
  };
  C.parseDelivery = function (d) {
    if (!d || d.v !== 1 || !Array.isArray(d.e) || !d.s || !d.h) throw new Error('配布コードの形式が読めません');
    const ep = (a) => a.slice(0, 8).map((x) => ({ name: clip(x && x.n, 30), period: clip(x && x.p, 24), note: clip(x && x.m, LIM.vtext) }));
    return { title: clip(d.t, 30), hunter: { nick: clip(d.h.n, LIM.nick), code: /^\d{4}$/.test(String(d.h.c)) ? String(d.h.c) : '----' }, episodes: ep(d.e), seal: { s: String(d.s.s), i: String(d.s.i), c: String(d.s.c) } };
  };
  C.openDelivery = async function (dv, input) {
    if (!/^\d{4}$/.test(String(input).trim())) return null;
    const r = await C.unseal(String(input).trim(), dv.seal);
    if (!r || !Array.isArray(r.e)) return null;
    return { nick: clip(r.n, LIM.nick), episodes: r.e.slice(0, 8).map((x) => ({ name: clip(x && x.n, 30), period: clip(x && x.p, 24), note: clip(x && x.m, LIM.vtext) })) };
  };

  // ---------- 見本(架空) ----------
  C.sampleOshi = function (now) {
    const t = now || 1;
    const mk = (i, o) => Object.assign({ id: 'sample-' + i, genre: '', from: '', to: '', ongoing: false, note: '', trigger: '', points: '', hasPhoto: false, createdAt: t + i, updatedAt: t + i }, o);
    return [
      mk(1, { name: 'ハルカゼ', genre: '音楽(架空)', from: '2013-04', to: '2016-03', note: '初めてCDを買った', trigger: '友達が貸してくれたアルバム', points: 'サビで声が伸びる所' }),
      mk(2, { name: '星野ルカ', genre: 'アイドル(架空)', from: '2016-07', to: '2020-12', note: '初ライブで泣いた', trigger: '深夜の音楽番組', points: '笑うと目が細くなる所' }),
      mk(3, { name: 'ミナトの海', genre: 'アニメ(架空)', from: '2019-10', ongoing: true, note: '毎週の楽しみ', trigger: '配信で一気見した', points: '脇役の台詞が良い' }),
      mk(4, { name: '夜更かしラジオ', genre: 'ラジオ(架空)', from: '2022-01', ongoing: true, note: '寝る前に聴く', trigger: '友達のすすめ', points: '最後の5分' }),
    ];
  };
  C.sampleFriend = function () {
    return { v: 1, n: 'みどり(架空)', t: '2026-11-01', k: ['name', 'genre', 'period', 'note'], o: [
      { n: 'ハルカゼ', g: '音楽', f: '2014-01', e: '2017-06', m: 'ベースが好きだった' },
      { n: 'みなとの海', g: 'アニメ', f: '2020-04', c: 1, m: '二期から見た' },
      { n: '宇宙ねこ', g: 'キャラ(架空)', f: '2016-09', e: '2018-03', m: 'グッズを集めた' },
    ] };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.Core = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
