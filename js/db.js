(function () {
  'use strict';

  const STORAGE_KEY = 'coinsPwa.catalog';
  const LAST_SAVED_KEY = 'coinsPwa.lastSavedCatalog';
  const META_KEY = 'coinsPwa.meta';

  const COIN_FIELDS = [
    'id',
    'country',
    'nominal',
    'title',
    'year',
    'mint',
    'strikeType',
    'material',
    'fineness',
    'weight',
    'diameter',
    'thickness',
    'mintage',
    'catalogNumber',
    'condition',
    'purchaseDate',
    'purchasePrice',
    'source',
    'currentValue',
    'status',
    'comment',
    'storageLocation'
  ];

  function emptyCatalog() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      coins: []
    };
  }

  function normalizeValue(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function normalizeCoin(input) {
    const source = input && typeof input === 'object' ? input : {};
    const coin = {};

    COIN_FIELDS.forEach(function (field) {
      coin[field] = normalizeValue(source[field]);
    });

    if (!coin.id) {
      coin.id = generateId();
    }

    coin.photos = {
      obverse: normalizeValue(source.photos && source.photos.obverse),
      reverse: normalizeValue(source.photos && source.photos.reverse)
    };

    return coin;
  }

  function normalizeCatalog(input) {
    const catalog = input && typeof input === 'object' ? input : emptyCatalog();
    const coins = Array.isArray(catalog.coins) ? catalog.coins : [];

    return {
      version: Number(catalog.version || 1),
      updatedAt: normalizeValue(catalog.updatedAt || new Date().toISOString()),
      coins: coins.map(normalizeCoin)
    };
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn('Cannot parse stored JSON', error);
      return null;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadCatalog() {
    return normalizeCatalog(readJson(STORAGE_KEY) || emptyCatalog());
  }

  function saveCatalog(catalog, options) {
    const normalized = normalizeCatalog(catalog);
    writeJson(STORAGE_KEY, normalized);

    const meta = getMeta();
    meta.dirty = options && typeof options.dirty === 'boolean' ? options.dirty : true;
    meta.updatedAt = normalized.updatedAt;
    setMeta(meta);

    return normalized;
  }

  function setCatalogFromFile(catalog, fileName) {
    const normalized = normalizeCatalog(catalog);
    writeJson(STORAGE_KEY, normalized);
    localStorage.setItem(LAST_SAVED_KEY, JSON.stringify(normalized, null, 2));

    const meta = getMeta();
    meta.fileName = fileName || 'coins.json';
    meta.dirty = false;
    meta.updatedAt = normalized.updatedAt;
    setMeta(meta);

    return normalized;
  }

  function markSaved(catalog) {
    const normalized = normalizeCatalog(catalog);
    localStorage.setItem(LAST_SAVED_KEY, JSON.stringify(normalized, null, 2));

    const meta = getMeta();
    meta.dirty = false;
    meta.updatedAt = normalized.updatedAt;
    setMeta(meta);
  }

  function getLastSavedText() {
    return localStorage.getItem(LAST_SAVED_KEY) || JSON.stringify(loadCatalog(), null, 2);
  }

  function getMeta() {
    return readJson(META_KEY) || {
      fileName: 'coins.json',
      dirty: false,
      updatedAt: ''
    };
  }

  function setMeta(meta) {
    writeJson(META_KEY, Object.assign({ fileName: 'coins.json', dirty: false, updatedAt: '' }, meta || {}));
  }

  function clearLocalData() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_SAVED_KEY);
    localStorage.removeItem(META_KEY);
  }

  function getCoinById(id) {
    const catalog = loadCatalog();
    const idString = normalizeValue(id);
    return catalog.coins.find(function (coin) {
      return normalizeValue(coin.id) === idString;
    }) || null;
  }

  function upsertCoin(coin) {
    const catalog = loadCatalog();
    const normalizedCoin = normalizeCoin(coin);
    const index = catalog.coins.findIndex(function (item) {
      return normalizeValue(item.id) === normalizeValue(normalizedCoin.id);
    });

    if (index >= 0) {
      catalog.coins[index] = normalizedCoin;
    } else {
      catalog.coins.unshift(normalizedCoin);
    }

    catalog.updatedAt = new Date().toISOString();
    return saveCatalog(catalog, { dirty: true });
  }

  function deleteCoin(id) {
    const catalog = loadCatalog();
    catalog.coins = catalog.coins.filter(function (coin) {
      return normalizeValue(coin.id) !== normalizeValue(id);
    });
    catalog.updatedAt = new Date().toISOString();
    return saveCatalog(catalog, { dirty: true });
  }

  function generateId() {
    const random = Math.random().toString(36).slice(2, 8);
    return 'coin_' + Date.now().toString(36) + '_' + random;
  }

  function getDisplayTitle(coin) {
    if (!coin) return 'Монета';
    const title = [coin.nominal, coin.title].filter(Boolean).join(' · ');
    if (title) return title;
    return [coin.country, coin.year].filter(Boolean).join(' · ') || 'Монета без названия';
  }

  function normalizeDateForInput(value) {
    const raw = normalizeValue(value).trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) return match[3] + '-' + match[2] + '-' + match[1];
    return raw;
  }

  function formatDate(value) {
    const raw = normalizeValue(value).trim();
    if (!raw) return '—';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return match[3] + '.' + match[2] + '.' + match[1];
    return raw;
  }

  function compactText(parts, fallback) {
    const text = parts.filter(Boolean).join(' · ');
    return text || fallback || '—';
  }

  function uniqueValues(coins, field) {
    return Array.from(new Set(coins.map(function (coin) {
      return normalizeValue(coin[field]).trim();
    }).filter(Boolean))).sort(function (a, b) {
      return a.localeCompare(b, 'ru');
    });
  }

  window.CoinDB = {
    COIN_FIELDS: COIN_FIELDS,
    emptyCatalog: emptyCatalog,
    normalizeCoin: normalizeCoin,
    normalizeCatalog: normalizeCatalog,
    loadCatalog: loadCatalog,
    saveCatalog: saveCatalog,
    setCatalogFromFile: setCatalogFromFile,
    markSaved: markSaved,
    getLastSavedText: getLastSavedText,
    getMeta: getMeta,
    setMeta: setMeta,
    clearLocalData: clearLocalData,
    getCoinById: getCoinById,
    upsertCoin: upsertCoin,
    deleteCoin: deleteCoin,
    generateId: generateId,
    getDisplayTitle: getDisplayTitle,
    normalizeDateForInput: normalizeDateForInput,
    formatDate: formatDate,
    compactText: compactText,
    uniqueValues: uniqueValues
  };
})();
