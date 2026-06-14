(function () {
  'use strict';

  const STORAGE_KEY = 'coinsPwa.selectedCurrency';
  const RATES_KEY = 'coinsPwa.currencyRates';
  const SUPPORTED = ['EUR', 'USD', 'BYN'];
  const API_BASE = 'https://api.nbrb.by/exrates/rates/';

  let selectedCurrency = localStorage.getItem(STORAGE_KEY) || 'EUR';
  let rates = {
    EUR: null,
    USD: null,
    BYN: { code: 'BYN', rate: 1, scale: 1, ratePerUnit: 1, date: '' }
  };

  try {
    const cached = JSON.parse(localStorage.getItem(RATES_KEY) || 'null');
    if (cached && cached.EUR && cached.USD) {
      rates = Object.assign(rates, cached);
    }
  } catch (error) {
    localStorage.removeItem(RATES_KEY);
  }

  if (!SUPPORTED.includes(selectedCurrency)) {
    selectedCurrency = 'EUR';
  }

  function getSelectedCurrency() {
    return selectedCurrency;
  }

  function setSelectedCurrency(currency) {
    if (!SUPPORTED.includes(currency)) return;
    selectedCurrency = currency;
    localStorage.setItem(STORAGE_KEY, selectedCurrency);
    updateHeaderView();
    document.dispatchEvent(new CustomEvent('currency-change', {
      detail: { currency: selectedCurrency, rates: getRates() }
    }));
  }

  function getRates() {
    return JSON.parse(JSON.stringify(rates));
  }

  async function fetchRate(code) {
    const response = await fetch(API_BASE + encodeURIComponent(code) + '?parammode=2', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Не удалось получить курс ' + code + ': HTTP ' + response.status);
    }

    const data = await response.json();
    const scale = Number(data.Cur_Scale || 1);
    const officialRate = Number(data.Cur_OfficialRate);

    if (!officialRate || !scale) {
      throw new Error('Некорректный ответ НБРБ для ' + code);
    }

    return {
      code: code,
      rate: officialRate,
      scale: scale,
      ratePerUnit: officialRate / scale,
      date: data.Date || ''
    };
  }

  async function loadRates() {
    try {
      const loaded = await Promise.all([fetchRate('EUR'), fetchRate('USD')]);
      rates.EUR = loaded[0];
      rates.USD = loaded[1];
      rates.BYN = { code: 'BYN', rate: 1, scale: 1, ratePerUnit: 1, date: new Date().toISOString() };
      localStorage.setItem(RATES_KEY, JSON.stringify(rates));
      updateHeaderView();
      document.dispatchEvent(new CustomEvent('currency-rates-loaded', { detail: { rates: getRates() } }));
      return rates;
    } catch (error) {
      updateHeaderView('курсы недоступны');
      document.dispatchEvent(new CustomEvent('currency-rates-error', { detail: { error: error } }));
      return rates;
    }
  }

  function init() {
    bindSelector();
    updateHeaderView();
    return loadRates();
  }

  function bindSelector() {
    const select = document.getElementById('currencySelect');
    if (!select) return;
    select.value = selectedCurrency;
    select.addEventListener('change', function () {
      setSelectedCurrency(select.value);
    });
  }

  function updateHeaderView(statusText) {
    const select = document.getElementById('currencySelect');
    if (select && select.value !== selectedCurrency) {
      select.value = selectedCurrency;
    }

    const eurNode = document.getElementById('eurRate');
    const usdNode = document.getElementById('usdRate');

    if (eurNode) eurNode.textContent = statusText || formatRateLabel(rates.EUR);
    if (usdNode) usdNode.textContent = statusText || formatRateLabel(rates.USD);
  }

  function formatRateLabel(rate) {
    if (!rate || !rate.ratePerUnit) return '—';
    return formatNumber(rate.ratePerUnit, 4) + ' Br';
  }

  function parseEuroPrice(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    const normalized = text
      .replace(/\u00a0/g, ' ')
      .replace(/[^0-9,.-]/g, '')
      .replace(/\s+/g, '')
      .replace(',', '.');

    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
  }

  function convertFromEuro(value, targetCurrency) {
    const amount = typeof value === 'number' ? value : parseEuroPrice(value);
    const target = targetCurrency || selectedCurrency;

    if (amount === null || amount === undefined || !Number.isFinite(amount)) {
      return null;
    }

    if (target === 'EUR') return amount;

    const eur = rates.EUR && rates.EUR.ratePerUnit;
    if (!eur) return null;

    if (target === 'BYN') return amount * eur;

    if (target === 'USD') {
      const usd = rates.USD && rates.USD.ratePerUnit;
      if (!usd) return null;
      return amount * eur / usd;
    }

    return amount;
  }

  function formatPrice(value, options) {
    const source = parseEuroPrice(value);
    if (source === null) return '—';

    const currency = (options && options.currency) || selectedCurrency;
    const converted = convertFromEuro(source, currency);
    if (converted === null) {
      return formatCurrency(source, 'EUR') + ' · курс недоступен';
    }

    return formatCurrency(converted, currency);
  }

  function formatCurrency(value, currency) {
    const decimals = currency === 'BYN' ? 2 : 2;
    return formatNumber(value, decimals) + ' ' + currencySymbol(currency);
  }

  function formatNumber(value, decimals) {
    return Number(value).toLocaleString('ru-RU', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function currencySymbol(currency) {
    if (currency === 'USD') return '$';
    if (currency === 'BYN') return 'Br';
    return '€';
  }

  function sumEuroPrices(coins, field) {
    return coins.reduce(function (sum, coin) {
      const value = parseEuroPrice(coin && coin[field || 'currentValue']);
      return sum + (value || 0);
    }, 0);
  }

  window.AppCurrency = {
    init: init,
    loadRates: loadRates,
    getSelectedCurrency: getSelectedCurrency,
    setSelectedCurrency: setSelectedCurrency,
    getRates: getRates,
    parseEuroPrice: parseEuroPrice,
    convertFromEuro: convertFromEuro,
    formatPrice: formatPrice,
    formatCurrency: formatCurrency,
    currencySymbol: currencySymbol,
    sumEuroPrices: sumEuroPrices
  };
})();
