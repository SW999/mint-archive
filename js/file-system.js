(function () {
  'use strict';

  const DB_NAME = 'coinsPwaFileHandles';
  const STORE_NAME = 'handles';
  const IMAGE_STORE_NAME = 'imageCache';
  const FILE_HANDLE_KEY = 'catalogFile';
  const DIRECTORY_HANDLE_KEY = 'catalogDirectory';
  const IMAGE_OBJECT_URL_CACHE_LIMIT = 120;
  const PERSISTENT_IMAGE_CACHE_LIMIT = 80;
  const imageObjectUrlCache = new Map();
  const imageObjectUrlPromises = new Map();
  const BACKUP_LIMIT = 5;
  const BACKUP_PREFIX = 'coins_backup_';
  const BACKUP_SUFFIX = '.json';


  function isSupported() {
    return Boolean(window.showOpenFilePicker && window.showSaveFilePicker && window.indexedDB && window.isSecureContext);
  }

  function isDirectoryPickerSupported() {
    return Boolean(window.showDirectoryPicker && window.indexedDB && window.isSecureContext);
  }

  function openHandleDB() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 2);

      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_STORE_NAME);
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

  async function setStoredHandle(key, handle) {
    if (!window.indexedDB) return;
    const db = await openHandleDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, key);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    db.close();
  }

  async function getStoredHandle(key) {
    if (!window.indexedDB) return null;
    const db = await openHandleDB();
    const handle = await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
    db.close();
    return handle;
  }

  async function clearStoredHandles() {
    if (!window.indexedDB) return;
    const db = await openHandleDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction([STORE_NAME, IMAGE_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(IMAGE_STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    db.close();
    revokeImageObjectUrls();
  }

  async function hasPermission(handle, mode) {
    if (!handle || !handle.queryPermission) return false;
    return (await handle.queryPermission({ mode: mode || 'read' })) === 'granted';
  }

  async function verifyPermission(handle, mode) {
    if (!handle || !handle.queryPermission || !handle.requestPermission) return false;
    const options = { mode: mode || 'readwrite' };

    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  }

  async function parseJsonFile(file) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('Файл не похож на корректный JSON: ' + error.message);
    }
  }

  async function openCatalogFile() {
    if (!isSupported()) {
      throw new Error('Прямое открытие файла недоступно. Используй обычный выбор файла или запусти приложение в Chrome/Edge через HTTPS/localhost.');
    }

    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: 'Coins JSON',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });

    const fileHandle = handles[0];
    const file = await fileHandle.getFile();
    const catalog = await parseJsonFile(file);

    await setStoredHandle(FILE_HANDLE_KEY, fileHandle);

    return {
      catalog: catalog,
      fileName: file.name || 'coins.json',
      mode: 'file'
    };
  }

  async function openCatalogFolder() {
    if (!isDirectoryPickerSupported()) {
      throw new Error('Выбор папки недоступен в этом браузере. Открой только JSON-файл.');
    }

    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await verifyPermission(directoryHandle, 'readwrite');

    const fileHandle = await directoryHandle.getFileHandle('coins.json');
    const file = await fileHandle.getFile();
    const catalog = await parseJsonFile(file);

    await setStoredHandle(DIRECTORY_HANDLE_KEY, directoryHandle);
    await setStoredHandle(FILE_HANDLE_KEY, fileHandle);

    return {
      catalog: catalog,
      fileName: 'coins.json',
      mode: 'directory'
    };
  }

  async function writeTextToFileHandle(fileHandle, text) {
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  function timestamp() {
    const now = new Date();
    const pad = function (value) { return String(value).padStart(2, '0'); };
    return now.getFullYear() + '-' +
      pad(now.getMonth() + 1) + '-' +
      pad(now.getDate()) + '_' +
      pad(now.getHours()) + '-' +
      pad(now.getMinutes()) + '-' +
      pad(now.getSeconds());
  }

  function isCatalogBackupName(name) {
    return String(name || '').startsWith(BACKUP_PREFIX) && String(name || '').endsWith(BACKUP_SUFFIX);
  }

  async function pruneOldBackups(backupsHandle, keepLimit) {
    const backups = [];

    for await (const entry of backupsHandle.entries()) {
      const name = entry[0];
      const handle = entry[1];
      if (handle && handle.kind === 'file' && isCatalogBackupName(name)) {
        backups.push(name);
      }
    }

    backups.sort(function (a, b) { return b.localeCompare(a); });
    const toRemove = backups.slice(keepLimit);
    const removed = [];

    for (const name of toRemove) {
      try {
        await backupsHandle.removeEntry(name);
        removed.push(name);
      } catch (error) {
        console.warn('Cannot remove old backup', name, error);
      }
    }

    return removed;
  }

  async function saveBackupToDirectory(directoryHandle, previousText) {
    if (!previousText) return null;
    const backupsHandle = await directoryHandle.getDirectoryHandle('backups', { create: true });
    const backupName = BACKUP_PREFIX + timestamp() + BACKUP_SUFFIX;
    const backupFileHandle = await backupsHandle.getFileHandle(backupName, { create: true });
    await writeTextToFileHandle(backupFileHandle, previousText);
    const removedBackups = await pruneOldBackups(backupsHandle, BACKUP_LIMIT);
    return {
      name: backupName,
      removedBackups: removedBackups
    };
  }

  async function saveCatalog(catalog) {
    const text = CoinDB.stringifyCatalog(catalog);
    const previousText = CoinDB.getLastSavedText();

    const directoryHandle = await getStoredHandle(DIRECTORY_HANDLE_KEY);
    if (directoryHandle && await verifyPermission(directoryHandle, 'readwrite')) {
      const fileHandle = await directoryHandle.getFileHandle('coins.json', { create: true });
      let backupInfo = null;
      let backupError = null;

      try {
        backupInfo = await saveBackupToDirectory(directoryHandle, previousText);
      } catch (error) {
        backupError = error;
      }

      await writeTextToFileHandle(fileHandle, text);
      return {
        saved: true,
        mode: 'directory',
        backupCreated: Boolean(backupInfo && backupInfo.name),
        backupName: backupInfo && backupInfo.name,
        removedBackups: backupInfo && backupInfo.removedBackups || [],
        backupLimit: BACKUP_LIMIT,
    persistentImageCacheLimit: PERSISTENT_IMAGE_CACHE_LIMIT,
        backupError: backupError
      };
    }

    const fileHandle = await getStoredHandle(FILE_HANDLE_KEY);
    if (fileHandle && await verifyPermission(fileHandle, 'readwrite')) {
      await writeTextToFileHandle(fileHandle, text);
      return {
        saved: true,
        mode: 'file',
        backupCreated: false,
        backupName: null,
        backupError: null
      };
    }

    return { saved: false, mode: 'download', backupCreated: false };
  }

  function downloadText(text, fileName, mimeType) {
    const blob = new Blob([text], { type: mimeType || 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function downloadCatalog(catalog, fileName) {
    downloadText(CoinDB.stringifyCatalog(catalog), fileName || 'coins.json');
  }


  async function getFileFromDirectoryPath(directoryHandle, path) {
    const safePath = String(path || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const parts = safePath.split('/').filter(function (part) {
      return part && part !== '.' && part !== '..';
    });

    if (!parts.length) return null;

    let current = directoryHandle;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isLast = index === parts.length - 1;
      if (isLast) {
        const fileHandle = await current.getFileHandle(part);
        return fileHandle.getFile();
      }
      current = await current.getDirectoryHandle(part);
    }

    return null;
  }

  function normalizeImagePath(path) {
    return String(path || '').trim().replace(/^\/+/, '').replace(/\\/g, '/');
  }

  function makeImageLoadError(code, message, path, sourceError) {
    const error = new Error(message || 'Ошибка загрузки изображения.');
    error.code = code || 'load-error';
    error.path = path || '';
    error.sourceError = sourceError || null;
    return error;
  }

  function getCachedImageObjectUrl(cacheKey) {
    const cached = imageObjectUrlCache.get(cacheKey);
    if (!cached) return null;

    imageObjectUrlCache.delete(cacheKey);
    imageObjectUrlCache.set(cacheKey, cached);

    return cached.url || null;
  }

  function trimImageObjectUrlCache() {
    while (imageObjectUrlCache.size > IMAGE_OBJECT_URL_CACHE_LIMIT) {
      const oldestKey = imageObjectUrlCache.keys().next().value;
      if (!oldestKey) return;

      const oldest = imageObjectUrlCache.get(oldestKey);
      if (oldest && oldest.url) URL.revokeObjectURL(oldest.url);
      imageObjectUrlCache.delete(oldestKey);
    }
  }

  function getImageErrorCode(error) {
    if (!error) return 'load-error';
    if (error.name === 'NotFoundError') return 'not-found';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'no-permission';
    return 'read-error';
  }

  async function getStoredImageRecord(path) {
    if (!window.indexedDB) return null;
    const normalizedPath = normalizeImagePath(path);
    if (!normalizedPath) return null;

    const db = await openHandleDB();
    const record = await new Promise(function (resolve, reject) {
      const tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
      const request = tx.objectStore(IMAGE_STORE_NAME).get(normalizedPath);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
    db.close();
    return record;
  }

  async function setStoredImageRecord(path, file) {
    if (!window.indexedDB || !file) return;
    const normalizedPath = normalizeImagePath(path);
    if (!normalizedPath) return;

    const record = {
      path: normalizedPath,
      blob: file,
      type: file.type || 'image/*',
      size: file.size || 0,
      lastModified: file.lastModified || 0,
      updatedAt: Date.now()
    };

    const db = await openHandleDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
      tx.objectStore(IMAGE_STORE_NAME).put(record, normalizedPath);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    db.close();
    pruneStoredImageCache(PERSISTENT_IMAGE_CACHE_LIMIT).catch(function (error) {
      console.warn('Cannot prune image cache', error);
    });
  }

  async function pruneStoredImageCache(keepLimit) {
    if (!window.indexedDB) return [];
    const db = await openHandleDB();
    const records = await new Promise(function (resolve, reject) {
      const tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
      const request = tx.objectStore(IMAGE_STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    });

    records.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    const toRemove = records.slice(keepLimit).map(function (record) { return record.path; }).filter(Boolean);

    if (toRemove.length) {
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IMAGE_STORE_NAME);
        toRemove.forEach(function (path) { store.delete(path); });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    }

    db.close();
    return toRemove;
  }

  async function makeObjectUrlFromStoredImage(path) {
    const record = await getStoredImageRecord(path);
    if (!record || !record.blob) return null;

    const normalizedPath = normalizeImagePath(path);
    const cacheKey = 'stored::' + normalizedPath + '::' + (record.size || 0) + '::' + (record.updatedAt || 0);
    const cachedUrl = getCachedImageObjectUrl(cacheKey);
    if (cachedUrl) {
      return {
        url: cachedUrl,
        cached: true,
        persistent: true,
        path: normalizedPath
      };
    }

    const url = URL.createObjectURL(record.blob);
    imageObjectUrlCache.set(cacheKey, { url: url, path: normalizedPath });
    trimImageObjectUrlCache();

    return {
      url: url,
      cached: true,
      persistent: true,
      path: normalizedPath
    };
  }

  async function loadImageObjectUrlDetailed(path) {
    const normalizedPath = normalizeImagePath(path);
    if (!normalizedPath) {
      throw makeImageLoadError('empty-path', 'Путь к фото не указан.', normalizedPath);
    }

    const storedFirst = await makeObjectUrlFromStoredImage(normalizedPath);
    if (storedFirst) return storedFirst;

    const directoryHandle = await getStoredHandle(DIRECTORY_HANDLE_KEY);
    if (!directoryHandle) {
      throw makeImageLoadError('missing-directory', 'Папка каталога не открыта.', normalizedPath);
    }

    if (!(await hasPermission(directoryHandle, 'read'))) {
      const storedFallback = await makeObjectUrlFromStoredImage(normalizedPath);
      if (storedFallback) return storedFallback;
      throw makeImageLoadError('no-permission', 'Нет доступа к папке каталога.', normalizedPath);
    }

    let file;
    try {
      file = await getFileFromDirectoryPath(directoryHandle, normalizedPath);
    } catch (error) {
      const storedFallback = await makeObjectUrlFromStoredImage(normalizedPath);
      if (storedFallback) return storedFallback;
      throw makeImageLoadError(getImageErrorCode(error), error.message, normalizedPath, error);
    }

    if (!file) {
      const storedFallback = await makeObjectUrlFromStoredImage(normalizedPath);
      if (storedFallback) return storedFallback;
      throw makeImageLoadError('not-found', 'Файл не найден.', normalizedPath);
    }

    setStoredImageRecord(normalizedPath, file).catch(function (error) {
      console.warn('Cannot persist image cache', normalizedPath, error);
    });

    const cacheKey = normalizedPath + '::' + file.size + '::' + file.lastModified;
    const cachedUrl = getCachedImageObjectUrl(cacheKey);
    if (cachedUrl) {
      return {
        url: cachedUrl,
        cached: true,
        persistent: false,
        path: normalizedPath
      };
    }

    if (imageObjectUrlPromises.has(cacheKey)) {
      const sharedUrl = await imageObjectUrlPromises.get(cacheKey);
      return {
        url: sharedUrl,
        cached: true,
        persistent: false,
        path: normalizedPath
      };
    }

    const promise = Promise.resolve().then(function () {
      const url = URL.createObjectURL(file);
      imageObjectUrlCache.set(cacheKey, { url: url, path: normalizedPath });
      trimImageObjectUrlCache();
      return url;
    }).finally(function () {
      imageObjectUrlPromises.delete(cacheKey);
    });

    imageObjectUrlPromises.set(cacheKey, promise);

    return {
      url: await promise,
      cached: false,
      persistent: false,
      path: normalizedPath
    };
  }

  async function loadImageObjectUrl(path) {
    try {
      const result = await loadImageObjectUrlDetailed(path);
      return result.url;
    } catch (error) {
      return null;
    }
  }

  function revokeImageObjectUrls() {
    imageObjectUrlCache.forEach(function (entry) {
      if (entry && entry.url) URL.revokeObjectURL(entry.url);
    });
    imageObjectUrlCache.clear();
    imageObjectUrlPromises.clear();
  }


  async function loadPlainFileInput(file) {
    const catalog = await parseJsonFile(file);
    return {
      catalog: catalog,
      fileName: file.name || 'coins.json',
      mode: 'input'
    };
  }

  window.AppFileSystem = {
    isSupported: isSupported,
    isDirectoryPickerSupported: isDirectoryPickerSupported,
    openCatalogFile: openCatalogFile,
    openCatalogFolder: openCatalogFolder,
    saveCatalog: saveCatalog,
    downloadCatalog: downloadCatalog,
    loadImageObjectUrl: loadImageObjectUrl,
    loadImageObjectUrlDetailed: loadImageObjectUrlDetailed,
    revokeImageObjectUrls: revokeImageObjectUrls,
    loadPlainFileInput: loadPlainFileInput,
    clearStoredHandles: clearStoredHandles,
    timestamp: timestamp,
    backupLimit: BACKUP_LIMIT,
    persistentImageCacheLimit: PERSISTENT_IMAGE_CACHE_LIMIT
  };
})();
