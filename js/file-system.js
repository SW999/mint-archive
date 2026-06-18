(function () {
  'use strict';

  const DB_NAME = 'coinsPwaFileHandles';
  const STORE_NAME = 'handles';
  const FILE_HANDLE_KEY = 'catalogFile';
  const DIRECTORY_HANDLE_KEY = 'catalogDirectory';
  const LAST_OPEN_MODE_KEY = 'coinsPwa.lastOpenMode';

  function isSupported() {
    return Boolean(window.showOpenFilePicker && window.showSaveFilePicker && window.indexedDB && window.isSecureContext);
  }

  function isDirectoryPickerSupported() {
    return Boolean(window.showDirectoryPicker && window.indexedDB && window.isSecureContext);
  }

  function openHandleDB() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE_NAME);
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
    localStorage.removeItem(LAST_OPEN_MODE_KEY);
    if (!window.indexedDB) return;
    const db = await openHandleDB();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
    db.close();
  }

  async function getPermissionState(handle, mode) {
    if (!handle || !handle.queryPermission) return 'unsupported';

    try {
      return await handle.queryPermission({ mode: mode || 'readwrite' });
    } catch (error) {
      return 'unsupported';
    }
  }

  async function hasPermission(handle, mode) {
    return (await getPermissionState(handle, mode)) === 'granted';
  }

  async function requestHandlePermission(handle, mode) {
    if (!handle || !handle.requestPermission) return false;

    if (await hasPermission(handle, mode)) return true;

    try {
      return (await handle.requestPermission({ mode: mode || 'readwrite' })) === 'granted';
    } catch (error) {
      return false;
    }
  }

  async function parseJsonFile(file) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('Файл не похож на корректный JSON: ' + error.message);
    }
  }

  async function readCatalogFromFileHandle(fileHandle) {
    const file = await fileHandle.getFile();
    return {
      catalog: await parseJsonFile(file),
      fileName: file.name || 'coins.json',
      mode: 'file'
    };
  }

  async function readCatalogFromDirectoryHandle(directoryHandle) {
    const fileHandle = await directoryHandle.getFileHandle('coins.json');
    const result = await readCatalogFromFileHandle(fileHandle);
    result.fileName = 'coins.json';
    result.mode = 'directory';
    return result;
  }

  async function restoreStoredCatalog(options) {
    const settings = Object.assign({ requestPermission: false }, options || {});
    const lastMode = localStorage.getItem(LAST_OPEN_MODE_KEY) || 'directory';
    const modes = lastMode === 'file' ? ['file', 'directory'] : ['directory', 'file'];
    let needsPermission = false;

    for (const mode of modes) {
      const handle = await getStoredHandle(mode === 'directory' ? DIRECTORY_HANDLE_KEY : FILE_HANDLE_KEY);
      if (!handle) continue;

      const permissionMode = mode === 'directory' ? 'readwrite' : 'read';
      const granted = settings.requestPermission
        ? await requestHandlePermission(handle, permissionMode)
        : await hasPermission(handle, permissionMode);

      if (!granted) {
        needsPermission = true;
        continue;
      }

      try {
        const result = mode === 'directory'
          ? await readCatalogFromDirectoryHandle(handle)
          : await readCatalogFromFileHandle(handle);
        result.restored = true;
        localStorage.setItem(LAST_OPEN_MODE_KEY, mode);
        return result;
      } catch (error) {
        console.warn('Cannot restore catalog handle', error);
      }
    }

    return { catalog: null, restored: false, needsPermission: needsPermission };
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
    const result = await readCatalogFromFileHandle(fileHandle);

    await setStoredHandle(FILE_HANDLE_KEY, fileHandle);
    localStorage.setItem(LAST_OPEN_MODE_KEY, 'file');

    return result;
  }

  async function openCatalogFolder() {
    if (!isDirectoryPickerSupported()) {
      throw new Error('Выбор папки недоступен в этом браузере. Открой только JSON-файл.');
    }

    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const allowed = await requestHandlePermission(directoryHandle, 'readwrite');
    if (!allowed) throw new Error('Нет разрешения на чтение и запись выбранной папки.');

    const fileHandle = await directoryHandle.getFileHandle('coins.json');
    const result = await readCatalogFromDirectoryHandle(directoryHandle);

    await setStoredHandle(DIRECTORY_HANDLE_KEY, directoryHandle);
    await setStoredHandle(FILE_HANDLE_KEY, fileHandle);
    localStorage.setItem(LAST_OPEN_MODE_KEY, 'directory');

    return result;
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

  async function saveBackupToDirectory(directoryHandle, previousText) {
    if (!previousText) return null;
    const backupsHandle = await directoryHandle.getDirectoryHandle('backups', { create: true });
    const backupName = 'coins_backup_' + timestamp() + '.json';
    const backupFileHandle = await backupsHandle.getFileHandle(backupName, { create: true });
    await writeTextToFileHandle(backupFileHandle, previousText);
    return backupName;
  }

  async function saveCatalog(catalog) {
    const text = JSON.stringify(CoinDB.normalizeCatalog(catalog), null, 2);
    const previousText = CoinDB.getLastSavedText();

    const directoryHandle = await getStoredHandle(DIRECTORY_HANDLE_KEY);
    if (directoryHandle && await requestHandlePermission(directoryHandle, 'readwrite')) {
      const fileHandle = await directoryHandle.getFileHandle('coins.json', { create: true });
      await saveBackupToDirectory(directoryHandle, previousText);
      await writeTextToFileHandle(fileHandle, text);
      return { saved: true, mode: 'directory' };
    }

    const fileHandle = await getStoredHandle(FILE_HANDLE_KEY);
    if (fileHandle && await requestHandlePermission(fileHandle, 'readwrite')) {
      await writeTextToFileHandle(fileHandle, text);
      return { saved: true, mode: 'file' };
    }

    return { saved: false, mode: 'download' };
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
    downloadText(JSON.stringify(CoinDB.normalizeCatalog(catalog), null, 2), fileName || 'coins.json');
  }

  function downloadBackup() {
    downloadText(CoinDB.getLastSavedText(), 'coins_backup_' + timestamp() + '.json');
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

  async function loadImageObjectUrl(path) {
    if (!path) return null;
    const directoryHandle = await getStoredHandle(DIRECTORY_HANDLE_KEY);
    if (!directoryHandle || !(await hasPermission(directoryHandle, 'read'))) return null;

    try {
      const file = await getFileFromDirectoryPath(directoryHandle, path);
      if (!file) return null;
      return URL.createObjectURL(file);
    } catch (error) {
      return null;
    }
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
    restoreStoredCatalog: restoreStoredCatalog,
    saveCatalog: saveCatalog,
    downloadCatalog: downloadCatalog,
    downloadBackup: downloadBackup,
    loadImageObjectUrl: loadImageObjectUrl,
    loadPlainFileInput: loadPlainFileInput,
    clearStoredHandles: clearStoredHandles,
    getPermissionState: getPermissionState,
    hasPermission: hasPermission,
    requestHandlePermission: requestHandlePermission,
    timestamp: timestamp
  };
})();
