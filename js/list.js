(function () {
  'use strict';

  let catalog = null;
  let filteredCoins = [];
  let viewMode = localStorage.getItem('coinsPwa.viewMode') || 'cards';

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindEvents();
    setupStatsPanel();
    catalog = await AppUI.loadBundledCatalogIfEmpty();
    await AppIssuers.init();
    setupFilters();
    await AppCurrency.init();
    render();
    AppUI.updateMetaView();

    if (!window.isSecureContext) {
      AppUI.setStatus('Прямая запись в файл работает только в HTTPS/localhost. В режиме file:// будет использоваться скачивание JSON.', '');
    }
  }

  function bindEvents() {
    AppUI.byId('openFolderButton').addEventListener('click', openFolder);
    AppUI.byId('openFileButton').addEventListener('click', openFile);
    AppUI.byId('plainFileInput').addEventListener('change', openPlainFileInput);
    AppUI.byId('saveButton').addEventListener('click', saveCatalog);
    AppUI.byId('exportButton').addEventListener('click', exportCatalog);
    AppUI.byId('clearButton').addEventListener('click', clearLocalData);

    ['searchInput', 'countryFilter', 'statusFilter', 'materialFilter', 'conditionFilter', 'seriesFilter'].forEach(function (id) {
      const node = AppUI.byId(id);
      if (node) node.addEventListener('input', render);
    });

    ['cardsViewButton', 'tableViewButton'].forEach(function (id) {
      const node = AppUI.byId(id);
      if (!node) return;
      node.addEventListener('click', function () {
        viewMode = node.dataset.view || 'cards';
        localStorage.setItem('coinsPwa.viewMode', viewMode);
        render();
      });
    });

    document.addEventListener('currency-change', render);
    document.addEventListener('currency-rates-loaded', render);
  }

  async function openFolder() {
    try {
      const result = await AppFileSystem.openCatalogFolder();
      catalog = CoinDB.setCatalogFromFile(result.catalog, result.fileName);
      setupFilters();
      render();
      AppUI.updateMetaView();
      AppUI.setStatus('Папка каталога открыта. Фото из images/ будут подгружаться из выбранной папки.', 'success');
    } catch (error) {
      AppUI.setStatus(error.message || 'Не удалось открыть папку.', 'danger');
    }
  }

  async function openFile() {
    if (!AppFileSystem.isSupported()) {
      AppUI.byId('plainFileInput').click();
      return;
    }

    try {
      const result = await AppFileSystem.openCatalogFile();
      catalog = CoinDB.setCatalogFromFile(result.catalog, result.fileName);
      setupFilters();
      render();
      AppUI.updateMetaView();
      AppUI.setStatus('JSON-файл открыт. Для локальных фото лучше открывать всю папку каталога.', 'success');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      AppUI.setStatus(error.message || 'Не удалось открыть JSON-файл.', 'danger');
    }
  }

  async function openPlainFileInput(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const result = await AppFileSystem.loadPlainFileInput(file);
      catalog = CoinDB.setCatalogFromFile(result.catalog, result.fileName);
      setupFilters();
      render();
      AppUI.updateMetaView();
      AppUI.setStatus('JSON-файл загружен через обычный input. Прямая перезапись файла в этом режиме может быть недоступна.', 'success');
    } catch (error) {
      AppUI.setStatus(error.message || 'Не удалось прочитать JSON-файл.', 'danger');
    } finally {
      event.target.value = '';
    }
  }

  async function saveCatalog() {
    try {
      catalog = CoinDB.loadCatalog();
      const result = await AppUI.persistCatalogOrDownload(catalog);
      AppUI.updateMetaView();
      AppUI.setStatus(AppUI.formatSaveResultMessage(result, 'coins.json перезаписан.', 'Файл сохранен через скачивание.'), 'success');
    } catch (error) {
      AppUI.setStatus(error.message || 'Не удалось сохранить файл.', 'danger');
    }
  }

  function exportCatalog() {
    AppFileSystem.downloadCatalog(CoinDB.loadCatalog(), 'coins.json');
    AppUI.setStatus('Экспортирован текущий coins.json.', 'success');
  }


  async function clearLocalData() {
    const confirmed = await AppUI.confirmDialog({
      title: 'Очистить локальные данные?',
      message: 'Будут удалены только данные приложения на этом устройстве. Файл coins.json не будет удален.',
      confirmText: 'Очистить',
      danger: true
    });
    if (!confirmed) return;

    CoinDB.clearLocalData();
    await AppFileSystem.clearStoredHandles();
    if (window.AppDrafts) await AppDrafts.clearAllDrafts();
    catalog = CoinDB.emptyCatalog();
    setupFilters();
    render();
    AppUI.updateMetaView();
    AppUI.setStatus('Локальные данные очищены.', 'success');
  }

  function setupFilters() {
    const current = CoinDB.loadCatalog();
    AppUI.fillSelect(AppUI.byId('countryFilter'), AppIssuers.getUsedIssuerOptions(current.coins), 'Все эмитенты');
    AppUI.fillSelect(AppUI.byId('materialFilter'), CoinDB.uniqueValues(current.coins, 'material'), 'Все материалы');
    AppUI.fillSelect(AppUI.byId('statusFilter'), CoinDB.uniqueValues(current.coins, 'status'), 'Все статусы');
    AppUI.fillSelect(AppUI.byId('conditionFilter'), CoinDB.uniqueValues(current.coins, 'condition'), 'Все состояния');
    AppUI.fillSelect(AppUI.byId('seriesFilter'), current.series.map(function (item) { return { value: item.id, label: item.name }; }), 'Все серии');
  }

  function render() {
    catalog = CoinDB.loadCatalog();
    filteredCoins = filterCoins(catalog.coins);
    renderStats(filteredCoins);
    updateViewButtons();
    renderCoins(filteredCoins);
    renderTotal(filteredCoins);
    AppUI.updateMetaView();
  }

  function filterCoins(coins) {
    const search = (AppUI.byId('searchInput').value || '').trim().toLowerCase();
    const country = AppUI.byId('countryFilter').value;
    const status = AppUI.byId('statusFilter').value;
    const material = AppUI.byId('materialFilter').value;
    const condition = AppUI.byId('conditionFilter').value;
    const seriesId = AppUI.byId('seriesFilter') ? AppUI.byId('seriesFilter').value : '';
    const seriesNameMap = CoinDB.getSeriesNameMap(catalog.series);

    return coins.filter(function (coin) {
      const haystack = [
        AppIssuers.getCoinIssuerName(coin),
        coin.country,
        coin.nominal,
        coin.title,
        coin.year,
        coin.mint,
        coin.material,
        coin.catalogNumber,
        coin.condition,
        coin.status,
        coin.comment,
        (coin.seriesIds || []).map(function (id) { return seriesNameMap.get(id) || ''; }).join(' ')
      ].join(' ').toLowerCase();

      if (search && !haystack.includes(search)) return false;
      if (country && !AppIssuers.matchesCoin(coin, country)) return false;
      if (status && coin.status !== status) return false;
      if (material && coin.material !== material) return false;
      if (condition && coin.condition !== condition) return false;
      if (seriesId && !(coin.seriesIds || []).includes(seriesId)) return false;
      return true;
    });
  }

  function setupStatsPanel() {
    const panel = AppUI.byId('statsPanel');
    if (!panel || !window.matchMedia) return;

    const media = window.matchMedia('(max-width: 540px)');

    function syncStatsPanelMode(event) {
      if (event.matches) {
        panel.removeAttribute('open');
      } else {
        panel.setAttribute('open', '');
      }
    }

    syncStatsPanelMode(media);

    if (media.addEventListener) {
      media.addEventListener('change', syncStatsPanelMode);
    } else if (media.addListener) {
      media.addListener(syncStatsPanelMode);
    }
  }

  function formatDate(value) {
    const text = String(value || '').trim();
    if (!text) return '—';

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;

    return date.toLocaleDateString('ru-RU');
  }

  function renderStats(currentCoins) {
    AppUI.setText(AppUI.byId('totalCoins'), String(currentCoins.length));
    AppUI.setText(AppUI.byId('countryCount'), String(AppIssuers.uniqueUsedCount(currentCoins)));
    AppUI.setText(AppUI.byId('materialCount'), String(CoinDB.uniqueValues(currentCoins, 'material').length));
  }

  function updateViewButtons() {
    const cardsButton = AppUI.byId('cardsViewButton');
    const tableButton = AppUI.byId('tableViewButton');
    if (cardsButton) cardsButton.classList.toggle('is-active', viewMode === 'cards');
    if (tableButton) tableButton.classList.toggle('is-active', viewMode === 'table');
  }

  function renderCoins(coins) {
    const container = AppUI.byId('coinList');
    container.innerHTML = '';
    container.className = viewMode === 'table' ? 'coin-table-container' : 'coin-grid';

    if (!coins.length) {
      const empty = AppUI.createElement('div', 'empty-state');
      empty.textContent = 'Монеты не найдены. Открой coins.json или измени фильтры.';
      container.appendChild(empty);
      return;
    }

    if (viewMode === 'table') {
      container.appendChild(createCoinTable(coins));
      return;
    }

    coins.forEach(function (coin) {
      container.appendChild(createCoinCard(coin));
    });
  }

  function createCoinCard(coin) {
    const link = AppUI.createElement('a', 'coin-card');
    link.href = 'coin.html?id=' + encodeURIComponent(coin.id);

    const image = document.createElement('img');
    image.className = 'coin-card__image';
    image.alt = 'Аверс: ' + CoinDB.getDisplayTitle(coin);
    AppUI.setCoinImage(image, coin.photos && coin.photos.obverse, 'obverse');

    const content = AppUI.createElement('div', 'coin-card__content');
    content.appendChild(AppUI.createElement('h2', 'coin-card__title', CoinDB.getDisplayTitle(coin)));
    content.appendChild(AppUI.createElement('p', 'coin-card__meta', CoinDB.compactText([AppIssuers.getCoinIssuerName(coin), coin.year, coin.mint])));
    content.appendChild(AppUI.createElement('p', 'coin-card__submeta', CoinDB.compactText([coin.material, coin.fineness, coin.catalogNumber])));

    const footer = AppUI.createElement('div', 'coin-card__footer');
    if (coin.condition) footer.appendChild(AppUI.createChip(coin.condition, 'accent'));
    if (coin.status) footer.appendChild(AppUI.createChip(coin.status, 'success'));
    if (coin.currentValue) footer.appendChild(AppUI.createChip('Оценка: ' + AppCurrency.formatPrice(coin.currentValue)));

    CoinDB.getSeriesByIds(catalog.series, coin.seriesIds).forEach(function (series) {
      footer.appendChild(AppUI.createChip(series.name));
    });

    content.appendChild(footer);

    link.appendChild(image);
    link.appendChild(content);
    return link;
  }

  function createCoinTable(coins) {
    const table = AppUI.createElement('table', 'coin-table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Монета', 'Страна', 'Год', 'Материал', 'Состояние', 'Дата приобретения', 'Стоимость'].forEach(function (title) {
      headRow.appendChild(AppUI.createElement('th', '', title));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    coins.forEach(function (coin) {
      const row = document.createElement('tr');
      row.addEventListener('click', function () {
        window.location.href = 'coin.html?id=' + encodeURIComponent(coin.id);
      });
      row.appendChild(AppUI.createElement('td', 'coin-table__title', CoinDB.getDisplayTitle(coin)));
      row.appendChild(AppUI.createElement('td', '', AppIssuers.getCoinIssuerName(coin) || '—'));
      row.appendChild(AppUI.createElement('td', '', coin.year || '—'));
      row.appendChild(AppUI.createElement('td', '', coin.material || '—'));
      row.appendChild(AppUI.createElement('td', '', coin.condition || '—'));
      row.appendChild(AppUI.createElement('td', '', formatDate(coin.purchaseDate)));
      row.appendChild(AppUI.createElement('td', 'coin-table__amount', coin.purchasePrice ? AppCurrency.formatPrice(coin.purchasePrice) : '—'));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderTotal(coins) {
    const totalNode = AppUI.byId('totalAmount');
    if (!totalNode) return;
    const totalEuro = AppCurrency.sumEuroPrices(coins, 'purchasePrice');
    const currency = AppCurrency.getSelectedCurrency();
    const converted = AppCurrency.convertFromEuro(totalEuro, currency);

    if (converted === null) {
      totalNode.textContent = AppCurrency.formatCurrency(totalEuro, 'EUR') + ' · курс недоступен';
      return;
    }

    totalNode.textContent = AppCurrency.formatCurrency(converted, currency);
  }
})();
