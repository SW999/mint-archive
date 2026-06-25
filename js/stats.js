(function () {
  'use strict';

  let catalog = null;

  document.addEventListener('DOMContentLoaded', function () {
    if (!AppUI.byId('catalogScreen') && AppUI.byId('statsTotalCoins')) {
      init();
    }
  });

  let initialized = false;

  async function init() {
    if (initialized) {
      render();
      return;
    }
    initialized = true;
    await AppCurrency.init();
    if (window.AppIssuers) await AppIssuers.init();

    catalog = await AppUI.loadBundledCatalogIfEmpty();
    render();
    AppUI.updateMetaView();

    document.addEventListener('currency-change', render);
    document.addEventListener('currency-rates-loaded', render);
    document.addEventListener('coin-catalog-updated', render);
  }

  function render() {
    catalog = CoinDB.loadCatalog();
    const coins = catalog.coins || [];
    renderSummary(coins);
    renderCharts(coins);
  }

  function renderSummary(coins) {
    const activeCoins = coins.filter(function (coin) { return !CoinDB.isSold(coin); });
    const purchaseCoins = activeCoins.filter(function (coin) { return parseMoney(coin.purchasePrice) > 0; });
    const totalEuro = AppCurrency.sumEuroPrices(activeCoins, 'purchasePrice');
    const medianEuro = medianPurchasePrice(purchaseCoins);
    const currency = AppCurrency.getSelectedCurrency();
    const totalConverted = AppCurrency.convertFromEuro(totalEuro, currency);
    const medianConverted = AppCurrency.convertFromEuro(medianEuro, currency);

    AppUI.setText(AppUI.byId('statsTotalCoins'), String(coins.length));
    AppUI.setText(AppUI.byId('statsPurchaseTotal'), formatConverted(totalConverted, totalEuro, currency));
    AppUI.setText(AppUI.byId('statsMedianPrice'), medianEuro > 0 ? formatConverted(medianConverted, medianEuro, currency) : '—');
    AppUI.setText(AppUI.byId('statsIssuerCount'), String(AppIssuers.uniqueUsedCount(coins)));
    AppUI.setText(AppUI.byId('statsSlabCount'), String(coins.filter(hasSlab).length));
    AppUI.setText(AppUI.byId('statsSubtitle'), coins.length ? 'Монет в каталоге: ' + coins.length : 'Открой coins.json, чтобы увидеть статистику.');
  }


  function medianPurchasePrice(coins) {
    const values = coins.map(function (coin) { return parseMoney(coin.purchasePrice); })
      .filter(function (value) { return value > 0; })
      .sort(function (a, b) { return a - b; });

    if (!values.length) return 0;

    const middle = Math.floor(values.length / 2);
    if (values.length % 2) return values[middle];
    return (values[middle - 1] + values[middle]) / 2;
  }

  function renderCharts(coins) {
    renderBarChart('monthlyPurchaseChart', monthlyPurchaseRows(coins.filter(function (coin) { return !CoinDB.isSold(coin); })), {
      valueFormatter: formatMoneyValue,
      emptyText: 'Нет покупок с заполненной датой и ценой.'
    });
    renderBarChart('issuerChart', topRows(countBy(coins, function (coin) { return AppIssuers.getCoinIssuerName(coin) || 'Не указан'; }), 12), {
      valueFormatter: formatCount,
      emptyText: 'Нет данных по эмитентам.'
    });
    renderBarChart('materialChart', topRows(countBy(coins, function (coin) { return coin.material || 'Не указан'; }), 12), {
      valueFormatter: formatCount,
      emptyText: 'Нет данных по материалам.'
    });
    renderBarChart('conditionChart', topRows(countBy(coins, function (coin) { return coin.condition || 'Не указано'; }), 12), {
      valueFormatter: formatCount,
      emptyText: 'Нет данных по состоянию.'
    });
    renderBarChart('centuryChart', countByCentury(coins), {
      valueFormatter: formatCount,
      emptyText: 'Нет годов для расчета веков.'
    });
    renderBarChart('periodChart', countByPeriod(coins), {
      valueFormatter: formatCount,
      emptyText: 'Нет годов для расчета периодов.'
    });
  }

  function renderBarChart(id, rows, options) {
    const container = AppUI.byId(id);
    if (!container) return;

    const settings = Object.assign({ valueFormatter: String, emptyText: 'Нет данных.' }, options || {});
    container.innerHTML = '';

    if (!rows.length) {
      container.appendChild(AppUI.createElement('p', 'small-note', settings.emptyText));
      return;
    }

    const max = Math.max.apply(null, rows.map(function (row) { return row.value; })) || 1;
    rows.forEach(function (row) {
      const item = AppUI.createElement('div', 'bar-chart__row');
      const header = AppUI.createElement('div', 'bar-chart__header');
      header.appendChild(AppUI.createElement('span', 'bar-chart__label', row.label));
      header.appendChild(AppUI.createElement('span', 'bar-chart__value', row.formattedValue || settings.valueFormatter(row.value)));

      const track = AppUI.createElement('div', 'bar-chart__track');
      const fill = AppUI.createElement('div', 'bar-chart__fill');
      fill.style.width = Math.max(3, Math.round(row.value / max * 100)) + '%';
      track.appendChild(fill);

      item.appendChild(header);
      item.appendChild(track);
      container.appendChild(item);
    });
  }

  function monthlyPurchaseRows(coins) {
    const map = new Map();
    coins.forEach(function (coin) {
      const monthKey = getMonthKey(coin.purchaseDate);
      const value = parseMoney(coin.purchasePrice);
      if (!monthKey || value <= 0) return;
      map.set(monthKey, (map.get(monthKey) || 0) + value);
    });

    const currency = AppCurrency.getSelectedCurrency();
    return Array.from(map.entries()).sort(function (a, b) {
      return a[0].localeCompare(b[0]);
    }).map(function (entry) {
      const converted = AppCurrency.convertFromEuro(entry[1], currency);
      const value = converted === null ? entry[1] : converted;
      return {
        label: formatMonth(entry[0]),
        value: value,
        rawEuro: entry[1],
        formattedValue: AppCurrency.formatCurrency(value, converted === null ? 'EUR' : currency)
      };
    });
  }

  function countBy(coins, getLabel) {
    const map = new Map();
    coins.forEach(function (coin) {
      const label = String(getLabel(coin) || '').trim();
      if (!label) return;
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map.entries()).map(function (entry) {
      return { label: entry[0], value: entry[1] };
    }).sort(function (a, b) {
      return b.value - a.value || a.label.localeCompare(b.label, 'ru');
    });
  }

  function topRows(rows, limit) {
    if (rows.length <= limit) return rows;
    const head = rows.slice(0, limit - 1);
    const restValue = rows.slice(limit - 1).reduce(function (sum, row) { return sum + row.value; }, 0);
    head.push({ label: 'Остальные', value: restValue });
    return head;
  }

  function countByCentury(coins) {
    return countBy(coins, function (coin) {
      const year = parseYear(coin.year);
      if (!year) return 'Без года';
      return toRomanCentury(Math.ceil(year / 100)) + ' век';
    }).sort(function (a, b) {
      if (a.label === 'Без года') return 1;
      if (b.label === 'Без года') return -1;
      return romanCenturyNumber(a.label) - romanCenturyNumber(b.label);
    });
  }

  function countByPeriod(coins) {
    const order = ['до XVI века', 'XVI–XVII вв.', 'XVIII век', 'XIX век', '1900–1945', '1946–1991', '1992–н.в.', 'Без года'];
    const rows = countBy(coins, function (coin) {
      const year = parseYear(coin.year);
      if (!year) return 'Без года';
      if (year <= 1500) return 'до XVI века';
      if (year <= 1699) return 'XVI–XVII вв.';
      if (year <= 1799) return 'XVIII век';
      if (year <= 1899) return 'XIX век';
      if (year <= 1945) return '1900–1945';
      if (year <= 1991) return '1946–1991';
      return '1992–н.в.';
    });
    return rows.sort(function (a, b) { return order.indexOf(a.label) - order.indexOf(b.label); });
  }

  function hasSlab(coin) {
    return Boolean(String(coin.slabCompany || coin.slabNumber || coin.slabUrl || '').trim());
  }

  function parseMoney(value) {
    const normalized = CoinDB.normalizeDecimalText(value);
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function getMonthKey(value) {
    const normalized = CoinDB.normalizeDateForInput(value);
    const match = String(normalized || '').match(/^(\d{4})-(\d{2})/);
    return match ? match[1] + '-' + match[2] : '';
  }

  function formatMonth(monthKey) {
    const parts = monthKey.split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return date.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });
  }

  function formatConverted(converted, fallbackEuro, currency) {
    if (converted === null) return AppCurrency.formatCurrency(fallbackEuro, 'EUR');
    return AppCurrency.formatCurrency(converted, currency);
  }

  function formatMoneyValue(value) {
    return AppCurrency.formatCurrency(value, AppCurrency.getSelectedCurrency());
  }

  function formatCount(value) {
    return String(value);
  }

  function parseYear(value) {
    const match = String(value || '').match(/\d{1,4}/);
    if (!match) return 0;
    const year = Number(match[0]);
    return Number.isFinite(year) && year > 0 ? year : 0;
  }

  function toRomanCentury(number) {
    const values = [
      [20, 'XX'], [19, 'XIX'], [18, 'XVIII'], [17, 'XVII'], [16, 'XVI'], [15, 'XV'],
      [14, 'XIV'], [13, 'XIII'], [12, 'XII'], [11, 'XI'], [10, 'X'], [9, 'IX'],
      [8, 'VIII'], [7, 'VII'], [6, 'VI'], [5, 'V'], [4, 'IV'], [3, 'III'], [2, 'II'], [1, 'I']
    ];
    const found = values.find(function (item) { return item[0] === number; });
    return found ? found[1] : String(number);
  }

  function romanCenturyNumber(label) {
    const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15, XVI: 16, XVII: 17, XVIII: 18, XIX: 19, XX: 20, XXI: 21 };
    const roman = String(label || '').split(' ')[0];
    return map[roman] || 999;
  }

  window.AppStats = {
    init: init,
    render: render
  };
})();
