(function () {
  'use strict';

  const STORAGE_KEY = 'coinsPwa.catalog';
  const LAST_SAVED_KEY = 'coinsPwa.lastSavedCatalog';
  const META_KEY = 'coinsPwa.meta';

  const COIN_REQUIRED_FIELDS = ['id'];
  const COIN_OPTIONAL_FIELDS = [
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
  const COIN_FIELDS = COIN_REQUIRED_FIELDS.concat(COIN_OPTIONAL_FIELDS);

  const CATALOG_SCHEMA = {
    version: 'number',
    updatedAt: 'ISO date string',
    series: '[{ id: string, name: string }]',
    coins: '[coin]'
  };

  function emptyCatalog() {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      series: [],
      coins: []
    };
  }

  function normalizeValue(value) {
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function normalizeStringArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map(function (item) {
      return normalizeValue(item).trim();
    }).filter(Boolean);
  }

  function normalizeSeriesItem(input) {
    const source = input && typeof input === 'object' ? input : {};
    const id = normalizeValue(source.id).trim() || generateSeriesId(source.name);
    const name = normalizeValue(source.name).trim();
    return { id: id, name: name };
  }

  function normalizeSeries(series) {
    const seen = new Set();
    return (Array.isArray(series) ? series : []).map(normalizeSeriesItem).filter(function (item) {
      if (!item.id || !item.name || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
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
    coin.seriesIds = normalizeStringArray(source.seriesIds);

    return coin;
  }

  function compactCoin(input) {
    const source = normalizeCoin(input);
    const coin = { id: source.id };

    COIN_OPTIONAL_FIELDS.forEach(function (field) {
      const value = normalizeValue(source[field]).trim();
      if (value) coin[field] = value;
    });

    const obverse = normalizeValue(source.photos && source.photos.obverse).trim();
    const reverse = normalizeValue(source.photos && source.photos.reverse).trim();
    if (obverse || reverse) {
      coin.photos = {};
      if (obverse) coin.photos.obverse = obverse;
      if (reverse) coin.photos.reverse = reverse;
    }

    const seriesIds = normalizeStringArray(source.seriesIds);
    if (seriesIds.length) coin.seriesIds = seriesIds;

    return coin;
  }

  function normalizeCatalog(input) {
    const catalog = input && typeof input === 'object' ? input : emptyCatalog();
    const coins = Array.isArray(catalog.coins) ? catalog.coins : [];

    return {
      version: Number(catalog.version || 2),
      updatedAt: normalizeValue(catalog.updatedAt || new Date().toISOString()),
      series: normalizeSeries(catalog.series),
      coins: coins.map(normalizeCoin)
    };
  }

  function compactCatalog(input) {
    const normalized = normalizeCatalog(input);
    return {
      version: Math.max(Number(normalized.version || 2), 2),
      updatedAt: normalized.updatedAt || new Date().toISOString(),
      series: normalizeSeries(normalized.series),
      coins: normalized.coins.map(compactCoin)
    };
  }

  function stringifyCatalog(catalog) {
    return JSON.stringify(compactCatalog(catalog), null, 2);
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
    localStorage.setItem(key, stringifyCatalog(value));
  }

  function loadCatalog() {
    return normalizeCatalog(readJson(STORAGE_KEY) || emptyCatalog());
  }

  function saveCatalog(catalog, options) {
    const compact = compactCatalog(catalog);
    writeJson(STORAGE_KEY, compact);

    const meta = getMeta();
    meta.dirty = options && typeof options.dirty === 'boolean' ? options.dirty : true;
    meta.updatedAt = compact.updatedAt;
    setMeta(meta);

    return normalizeCatalog(compact);
  }

  function setCatalogFromFile(catalog, fileName) {
    const compact = compactCatalog(catalog);
    writeJson(STORAGE_KEY, compact);
    localStorage.setItem(LAST_SAVED_KEY, stringifyCatalog(compact));

    const meta = getMeta();
    meta.fileName = fileName || 'coins.json';
    meta.dirty = false;
    meta.updatedAt = compact.updatedAt;
    setMeta(meta);

    return normalizeCatalog(compact);
  }

  function markSaved(catalog) {
    const compact = compactCatalog(catalog);
    localStorage.setItem(LAST_SAVED_KEY, stringifyCatalog(compact));

    const meta = getMeta();
    meta.dirty = false;
    meta.updatedAt = compact.updatedAt;
    setMeta(meta);
  }

  function getLastSavedText() {
    return localStorage.getItem(LAST_SAVED_KEY) || stringifyCatalog(loadCatalog());
  }

  function getMeta() {
    return readJson(META_KEY) || {
      fileName: 'coins.json',
      dirty: false,
      updatedAt: ''
    };
  }

  function setMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(Object.assign({ fileName: 'coins.json', dirty: false, updatedAt: '' }, meta || {})));
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

  function upsertCoin(coin, series) {
    const catalog = loadCatalog();
    if (Array.isArray(series)) catalog.series = normalizeSeries(series);

    const normalizedCoin = normalizeCoin(coin);
    const validSeriesIds = new Set(catalog.series.map(function (item) { return item.id; }));
    normalizedCoin.seriesIds = normalizeStringArray(normalizedCoin.seriesIds).filter(function (id) {
      return validSeriesIds.has(id);
    });

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

  function generateSeriesId(name) {
    const slug = normalizeValue(name).trim().toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32);
    const random = Math.random().toString(36).slice(2, 6);
    return 'series_' + (slug || Date.now().toString(36)) + '_' + random;
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

  function getSeriesByIds(series, ids) {
    const idSet = new Set(normalizeStringArray(ids));
    return normalizeSeries(series).filter(function (item) {
      return idSet.has(item.id);
    });
  }

  function getSeriesNameMap(series) {
    const map = new Map();
    normalizeSeries(series).forEach(function (item) {
      map.set(item.id, item.name);
    });
    return map;
  }

  window.CoinDB = {
    CATALOG_SCHEMA: CATALOG_SCHEMA,
    COIN_REQUIRED_FIELDS: COIN_REQUIRED_FIELDS,
    COIN_OPTIONAL_FIELDS: COIN_OPTIONAL_FIELDS,
    COIN_FIELDS: COIN_FIELDS,
    emptyCatalog: emptyCatalog,
    normalizeCoin: normalizeCoin,
    compactCoin: compactCoin,
    normalizeCatalog: normalizeCatalog,
    compactCatalog: compactCatalog,
    stringifyCatalog: stringifyCatalog,
    normalizeSeries: normalizeSeries,
    generateSeriesId: generateSeriesId,
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
    uniqueValues: uniqueValues,
    getSeriesByIds: getSeriesByIds,
    getSeriesNameMap: getSeriesNameMap
  };
})();
