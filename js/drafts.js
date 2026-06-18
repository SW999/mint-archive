(function () {
  'use strict';

  const DB_NAME = 'coinsPwaDrafts';
  const DB_VERSION = 1;
  const STORE_NAME = 'drafts';

  function isSupported() {
    return Boolean(window.indexedDB);
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!isSupported()) {
        reject(new Error('IndexedDB недоступен.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function withStore(mode, callback) {
    const db = await openDB();
    try {
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let result;

        try {
          result = callback(store);
        } catch (error) {
          reject(error);
          return;
        }

        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    } finally {
      db.close();
    }
  }

  async function getDraft(key) {
    if (!isSupported() || !key) return null;

    const db = await openDB();
    try {
      return await new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    } catch (error) {
      console.warn('Cannot read draft', error);
      return null;
    } finally {
      db.close();
    }
  }

  async function saveDraft(key, payload) {
    if (!isSupported() || !key || !payload) return false;

    try {
      await withStore('readwrite', function (store) {
        store.put(Object.assign({}, payload, {
          key: key,
          updatedAt: new Date().toISOString()
        }));
      });
      return true;
    } catch (error) {
      console.warn('Cannot save draft', error);
      return false;
    }
  }

  async function clearDraft(key) {
    if (!isSupported() || !key) return false;

    try {
      await withStore('readwrite', function (store) {
        store.delete(key);
      });
      return true;
    } catch (error) {
      console.warn('Cannot clear draft', error);
      return false;
    }
  }

  async function clearAllDrafts() {
    if (!isSupported()) return false;

    try {
      await withStore('readwrite', function (store) {
        store.clear();
      });
      return true;
    } catch (error) {
      console.warn('Cannot clear drafts', error);
      return false;
    }
  }

  window.AppDrafts = {
    isSupported: isSupported,
    getDraft: getDraft,
    saveDraft: saveDraft,
    clearDraft: clearDraft,
    clearAllDrafts: clearAllDrafts
  };
})();
