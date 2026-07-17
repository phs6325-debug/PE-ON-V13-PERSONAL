const DB_NAME = "peon_file_store_v9";
const DB_VERSION = 1;
const STORE_NAME = "files";

const openDb = () => new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error("IndexedDB를 사용할 수 없습니다."));
    return;
  }
  const request = window.indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("파일 저장소를 열지 못했습니다."));
});

const txStore = async (mode = "readonly") => {
  const db = await openDb();
  return { db, tx: db.transaction(STORE_NAME, mode), store: db.transaction ? null : null };
};

export const saveStoredFile = async (key, fileOrBlob, meta = {}) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const blob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob]);
    const record = {
      key,
      blob,
      name: meta.name || fileOrBlob?.name || key,
      type: meta.type || fileOrBlob?.type || blob.type || "application/octet-stream",
      size: meta.size || fileOrBlob?.size || blob.size || 0,
      savedAt: new Date().toISOString(),
    };
    store.put(record, key);
    tx.oncomplete = () => {
      db.close();
      resolve(record);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("파일 저장에 실패했습니다."));
    };
  });
};

export const getStoredFile = async (key) => {
  if (!key) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("저장 파일을 불러오지 못했습니다."));
    };
  });
};

export const deleteStoredFile = async (key) => {
  if (!key) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("저장 파일 삭제에 실패했습니다."));
    };
  });
};

export const storedFileToObjectUrl = async (key) => {
  const record = await getStoredFile(key);
  if (!record?.blob) return "";
  return URL.createObjectURL(record.blob);
};
