(function () {
  'use strict';

  const ISSUERS_URL = 'data/issuers.json';
  const DEFAULT_ISSUERS = [
    { id: 5, name: 'Беларусь', aliases: ['Belarus'], type: 'modern', region: 'Europe' },
    { id: 29, name: 'Великое Княжество Литовское', aliases: ['ВКЛ', 'Grand Duchy of Lithuania', 'Lithuania, Grand Duchy of'], type: 'historical', region: 'Europe' },
    { id: 36, name: 'СССР', aliases: ['USSR', 'Soviet Union'], type: 'historical', region: 'Europe/Asia' },
    { id: 33, name: 'Россия', aliases: ['Russia'], type: 'modern', region: 'Europe/Asia' },
    { id: 27, name: 'Польша', aliases: ['Poland'], type: 'modern', region: 'Europe' },
    { id: 30, name: 'Литва', aliases: ['Lithuania'], type: 'modern', region: 'Europe' },
    { id: 56, name: 'Нидерланды', aliases: ['Netherlands'], type: 'modern', region: 'Europe' },
    { id: 1, name: 'Австралия', aliases: ['Australia'], type: 'modern', region: 'Oceania' },
    { id: 14, name: 'США', aliases: ['USA', 'United States'], type: 'modern', region: 'North America' }
  ];

  let issuers = [];
  let byId = new Map();
  let byName = new Map();
  let initPromise = null;

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizeId(value) {
    const text = String(value === null || value === undefined ? '' : value).trim();
    return text || '';
  }

  function isNumericLike(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  function normalizeIssuer(input) {
    const source = input && typeof input === 'object' ? input : {};
    const id = Number(source.id);
    const name = String(source.name || '').trim();
    if (!Number.isFinite(id) || !name) return null;

    return {
      id: id,
      name: name,
      aliases: Array.isArray(source.aliases) ? source.aliases.map(String).map(function (item) { return item.trim(); }).filter(Boolean) : [],
      type: String(source.type || '').trim(),
      region: String(source.region || '').trim()
    };
  }

  function setIssuers(list) {
    const seen = new Set();
    issuers = (Array.isArray(list) ? list : [])
      .map(normalizeIssuer)
      .filter(function (issuer) {
        if (!issuer || seen.has(String(issuer.id))) return false;
        seen.add(String(issuer.id));
        return true;
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });

    byId = new Map();
    byName = new Map();

    issuers.forEach(function (issuer) {
      byId.set(String(issuer.id), issuer);
      [issuer.name].concat(issuer.aliases || []).forEach(function (name) {
        const key = normalizeText(name);
        if (key && !byName.has(key)) byName.set(key, issuer);
      });
    });
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = fetch(ISSUERS_URL, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('Cannot load issuers');
        return response.json();
      })
      .then(function (list) {
        setIssuers(list);
        return issuers;
      })
      .catch(function (error) {
        console.warn('Cannot load issuers.json, fallback list will be used', error);
        setIssuers(DEFAULT_ISSUERS);
        return issuers;
      });

    return initPromise;
  }

  function getAll() {
    return issuers.slice();
  }

  function findById(value) {
    const id = normalizeId(value);
    if (!id) return null;
    return byId.get(id) || null;
  }

  function findByName(value) {
    const key = normalizeText(value);
    if (!key) return null;
    return byName.get(key) || null;
  }

  function findForCoin(coin) {
    if (!coin) return null;

    const directId = coin.issuerId !== undefined && coin.issuerId !== null && String(coin.issuerId).trim() !== ''
      ? coin.issuerId
      : coin.countryId;
    const byDirectId = findById(directId);
    if (byDirectId) return byDirectId;

    if (isNumericLike(coin.country)) {
      const byCountryId = findById(coin.country);
      if (byCountryId) return byCountryId;
    }

    return findByName(coin.country);
  }

  function getCoinIssuerName(coin) {
    const issuer = findForCoin(coin);
    if (issuer) return issuer.name;
    return String((coin && coin.country) || '').trim();
  }

  function getCoinIssuerFilterValue(coin) {
    const issuer = findForCoin(coin);
    if (issuer) return 'issuer:' + issuer.id;

    const fallback = String((coin && coin.country) || '').trim();
    return fallback ? 'legacy:' + fallback : '';
  }

  function getCoinIssuerIdForForm(coin) {
    const issuer = findForCoin(coin);
    return issuer ? String(issuer.id) : '';
  }

  function getLegacyCountryForForm(coin) {
    if (!coin) return '';
    if (getCoinIssuerIdForForm(coin)) return '';
    return String(coin.country || '').trim();
  }

  function getIssuerOptions() {
    return issuers.map(function (issuer) {
      return { value: String(issuer.id), label: issuer.name };
    });
  }

  function getUsedIssuerOptions(coins) {
    const map = new Map();
    (Array.isArray(coins) ? coins : []).forEach(function (coin) {
      const value = getCoinIssuerFilterValue(coin);
      if (!value || map.has(value)) return;
      map.set(value, getCoinIssuerName(coin));
    });

    return Array.from(map.entries()).map(function (entry) {
      return { value: entry[0], label: entry[1] };
    }).sort(function (a, b) {
      return a.label.localeCompare(b.label, 'ru');
    });
  }

  function matchesCoin(coin, filterValue) {
    if (!filterValue) return true;
    return getCoinIssuerFilterValue(coin) === filterValue;
  }

  function uniqueUsedCount(coins) {
    const values = new Set();
    (Array.isArray(coins) ? coins : []).forEach(function (coin) {
      const value = getCoinIssuerFilterValue(coin);
      if (value) values.add(value);
    });
    return values.size;
  }

  window.AppIssuers = {
    init: init,
    getAll: getAll,
    findById: findById,
    findByName: findByName,
    findForCoin: findForCoin,
    getCoinIssuerName: getCoinIssuerName,
    getCoinIssuerFilterValue: getCoinIssuerFilterValue,
    getCoinIssuerIdForForm: getCoinIssuerIdForForm,
    getLegacyCountryForForm: getLegacyCountryForForm,
    getIssuerOptions: getIssuerOptions,
    getUsedIssuerOptions: getUsedIssuerOptions,
    matchesCoin: matchesCoin,
    uniqueUsedCount: uniqueUsedCount
  };
})();
