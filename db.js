// IndexedDB(端末内だけに保存。外部へは送らない)
(function (root) {
  'use strict';
  const NAME = 'oshi-henreki', VERSION = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(NAME, VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        db.createObjectStore('oshi', { keyPath: 'id' });
        db.createObjectStore('photos', { keyPath: 'id' });
        db.createObjectStore('friends', { keyPath: 'id' });
        db.createObjectStore('kv', { keyPath: 'key' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      rq.onblocked = () => reject(new Error('blocked'));
    });
    return dbp;
  }
  const req = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const store = async (s, mode) => (await open()).transaction(s, mode || 'readonly').objectStore(s);
  root.DB = {
    all: async (s) => req((await store(s)).getAll()),
    get: async (s, k) => req((await store(s)).get(k)),
    put: async (s, v) => req((await store(s, 'readwrite')).put(v)),
    del: async (s, k) => req((await store(s, 'readwrite')).delete(k)),
    clear: async (s) => req((await store(s, 'readwrite')).clear()),
    kvGet: async (k, d) => { const r = await req((await store('kv')).get(k)); return r ? r.value : d; },
    kvSet: async (k, v) => req((await store('kv', 'readwrite')).put({ key: k, value: v })),
    kvDel: async (k) => req((await store('kv', 'readwrite')).delete(k)),
  };
})(window);
