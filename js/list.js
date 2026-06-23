(function () {
  'use strict';

  let catalog = null;
  let filteredCoins = [];
  let viewMode = localStorage.getItem('coinsPwa.viewMode') || 'cards';
  const CARD_BATCH_SIZE = 10;
  let renderedCardCount = 0;
  let cardRenderToken = 0;
  let sentinelObserver = null;
  let photoDiagnostics = createEmptyPhotoDiagnostics();

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
    AppUI.fillSelect(AppUI.byId('statusFilter'), AppUI.STATUS_OPTIONS, 'Все статусы');
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
        AppUI.getStatusLabel(coin.status),
        coin.comment,
        (coin.seriesIds || []).map(function (id) { return seriesNameMap.get(id) || ''; }).join(' ')
      ].join(' ').toLowerCase();

      if (search && !haystack.includes(search)) return false;
      if (country && !AppIssuers.matchesCoin(coin, country)) return false;
      if (status && CoinDB.normalizeStatus(coin.status) !== status) return false;
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
    cardRenderToken += 1;
    renderedCardCount = 0;
    photoDiagnostics = createEmptyPhotoDiagnostics();
    updatePhotoDiagnostics();

    if (sentinelObserver) {
      sentinelObserver.disconnect();
      sentinelObserver = null;
    }

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

    renderNextCardBatch(coins, cardRenderToken);
  }

  function renderNextCardBatch(coins, token) {
    if (token !== cardRenderToken) return;

    const container = AppUI.byId('coinList');
    const existingSentinel = AppUI.byId('coinListSentinel');
    if (existingSentinel) existingSentinel.remove();

    const start = renderedCardCount;
    const nextCoins = coins.slice(start, start + CARD_BATCH_SIZE);
    const imageFrames = [];
    const fragment = document.createDocumentFragment();

    nextCoins.forEach(function (coin) {
      const card = createCoinCard(coin);
      const frame = card.querySelector('[data-role="coin-card-image"]');
      if (frame) imageFrames.push(frame);
      fragment.appendChild(card);
    });

    renderedCardCount += nextCoins.length;
    container.appendChild(fragment);

    loadCardImageBatch(imageFrames, token);

    if (renderedCardCount < coins.length) {
      const sentinel = AppUI.createElement('div', 'list-sentinel');
      sentinel.id = 'coinListSentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      container.appendChild(sentinel);
      observeListSentinel(sentinel, coins, token);
    }
  }

  function observeListSentinel(sentinel, coins, token) {
    if (!('IntersectionObserver' in window)) {
      renderNextCardBatch(coins, token);
      return;
    }

    sentinelObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        if (sentinelObserver) sentinelObserver.unobserve(entry.target);
        renderNextCardBatch(coins, token);
      });
    }, {
      root: null,
      rootMargin: '180px 0px',
      threshold: 0.01
    });

    sentinelObserver.observe(sentinel);
  }

  async function loadCardImageBatch(frames, token) {
    if (!frames.length) return;

    frames.forEach(function (frame) {
      const path = frame.dataset.photoPath || '';
      if (path) photoDiagnostics.requested += 1;
      else photoDiagnostics.empty += 1;
    });
    updatePhotoDiagnostics();

    const results = await AppUI.loadCoinImageFramesBatch(frames, { concurrency: 2 });
    if (token !== cardRenderToken) return;

    results.forEach(function (result) {
      if (!result || result.code === 'detached') return;
      if (result.ok) {
        photoDiagnostics.loaded += 1;
        if (result.cached) photoDiagnostics.cached += 1;
        return;
      }

      if (result.code === 'empty-path') return;
      photoDiagnostics.failed += 1;
      photoDiagnostics.byCode[result.code] = (photoDiagnostics.byCode[result.code] || 0) + 1;
      if (photoDiagnostics.samples.length < 10) {
        photoDiagnostics.samples.push({ path: result.path || '', message: result.message || 'Ошибка загрузки' });
      }
    });

    updatePhotoDiagnostics();
  }

  function createEmptyPhotoDiagnostics() {
    return {
      requested: 0,
      loaded: 0,
      failed: 0,
      empty: 0,
      cached: 0,
      byCode: {},
      samples: []
    };
  }

  function updatePhotoDiagnostics() {
    const panel = AppUI.byId('photoDiagnostics');
    const summary = AppUI.byId('photoDiagnosticsSummary');
    const details = AppUI.byId('photoDiagnosticsDetails');
    if (!panel || !summary || !details) return;

    const total = photoDiagnostics.requested;
    const failed = photoDiagnostics.failed;
    const loaded = photoDiagnostics.loaded;

    panel.classList.toggle('hidden', total === 0 && photoDiagnostics.empty === 0);
    summary.textContent = 'Фото: загружено ' + loaded + ' из ' + total + (failed ? ', ошибок: ' + failed : '');

    const codeLabels = {
      'missing-directory': 'папка не открыта',
      'no-permission': 'нет доступа',
      'not-found': 'файл не найден',
      'read-error': 'ошибка чтения',
      'decode-error': 'ошибка изображения',
      'load-error': 'ошибка загрузки'
    };

    const parts = [];
    Object.keys(photoDiagnostics.byCode).forEach(function (code) {
      parts.push((codeLabels[code] || code) + ': ' + photoDiagnostics.byCode[code]);
    });

    if (photoDiagnostics.empty) parts.push('без пути к фото: ' + photoDiagnostics.empty);
    if (photoDiagnostics.cached) parts.push('из session cache: ' + photoDiagnostics.cached);

    details.innerHTML = '';
    details.appendChild(AppUI.createElement('p', 'small-note', parts.length ? parts.join(' · ') : 'Ошибок загрузки пока нет.'));

    if (photoDiagnostics.samples.length) {
      const list = AppUI.createElement('ul', 'photo-diagnostics__list');
      photoDiagnostics.samples.forEach(function (item) {
        list.appendChild(AppUI.createElement('li', '', item.message + ': ' + item.path));
      });
      details.appendChild(list);
    }
  }

  function createCoinCard(coin) {
    const link = AppUI.createElement('a', 'coin-card');
    link.href = 'coin.html?id=' + encodeURIComponent(coin.id);

    const image = AppUI.createElement('div', 'coin-card__image-frame');
    image.dataset.role = 'coin-card-image';
    image.dataset.photoPath = coin.photos && coin.photos.obverse ? coin.photos.obverse : '';
    image.dataset.photoKind = 'obverse';
    image.dataset.photoAlt = 'Аверс: ' + CoinDB.getDisplayTitle(coin);
    image.dataset.imageToken = String(cardRenderToken);
    image.style.backgroundImage = 'url("images/placeholder-obverse.svg")';

    const content = AppUI.createElement('div', 'coin-card__content');
    content.appendChild(AppUI.createElement('h2', 'coin-card__title', CoinDB.getDisplayTitle(coin)));
    content.appendChild(AppUI.createElement('p', 'coin-card__meta', CoinDB.compactText([AppIssuers.getCoinIssuerName(coin), coin.year, coin.mint])));
    content.appendChild(AppUI.createElement('p', 'coin-card__submeta', CoinDB.compactText([coin.material, coin.fineness, coin.catalogNumber])));

    const footer = AppUI.createElement('div', 'coin-card__footer');
    if (coin.condition) footer.appendChild(AppUI.createChip(coin.condition, 'accent'));
    if (CoinDB.isSold(coin)) {
      footer.appendChild(AppUI.createChip(AppUI.getStatusLabel(coin.status), 'danger'));
    } else {
      footer.appendChild(AppUI.createChip(AppUI.getStatusLabel(coin.status), 'success'));
    }
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
    const activeCoins = coins.filter(function (coin) { return !CoinDB.isSold(coin); });
    const totalEuro = AppCurrency.sumEuroPrices(activeCoins, 'purchasePrice');
    const currency = AppCurrency.getSelectedCurrency();
    const converted = AppCurrency.convertFromEuro(totalEuro, currency);

    if (converted === null) {
      totalNode.textContent = AppCurrency.formatCurrency(totalEuro, 'EUR') + ' · курс недоступен';
      return;
    }

    totalNode.textContent = AppCurrency.formatCurrency(converted, currency);
  }
})();
