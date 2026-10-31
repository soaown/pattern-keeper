// PDF 원본은 이 기기의 브라우저 IndexedDB에만 보관됩니다.
const DB_NAME = 'pattern-keeper-local-pdfs';
const STORE = 'files';
function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}
async function operation(type, key, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, type === 'read' ? 'readonly' : 'readwrite');
      const store = tx.objectStore(STORE);
      const req = type === 'read' ? store.get(key) : type === 'delete' ? store.delete(key) : store.put(value, key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const pdfCache = {
  get: key => operation('read', key),
  put: (key, buffer, name) => operation('write', key, {buffer, name, savedAt: Date.now()}),
  remove: key => operation('delete', key)
};
