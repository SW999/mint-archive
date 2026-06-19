(function () {
  'use strict';

  let currentCoin = null;
  let catalog = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await AppCurrency.init();
    if (window.AppIssuers) await AppIssuers.init();

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    catalog = CoinDB.loadCatalog();
    currentCoin = catalog.coins.find(function (coin) { return String(coin.id) === String(id); }) || null;

    if (!currentCoin) {
      renderMissingCoin();
      return;
    }

    renderCoin(currentCoin);
    bindEvents(currentCoin);
    AppUI.updateMetaView();
    document.addEventListener('currency-change', function () {
      renderCoin(currentCoin);
    });
    document.addEventListener('currency-rates-loaded', function () {
      renderCoin(currentCoin);
    });
  }

  function bindEvents(coin) {
    const editButton = AppUI.byId('editButton');
    if (editButton) editButton.href = 'form.html?id=' + encodeURIComponent(coin.id);

    const deleteButton = AppUI.byId('deleteButton');
    if (deleteButton) {
      deleteButton.addEventListener('click', async function () {
        const confirmed = await AppUI.confirmDialog({
          title: 'Удалить монету?',
          message: 'Монета будет удалена из каталога. При сохранении будет автоматически создан backup, если открыт каталог как папка.',
          confirmText: 'Удалить',
          danger: true
        });
        if (!confirmed) return;

        try {
          const catalog = CoinDB.deleteCoin(coin.id);
          const result = await AppUI.persistCatalogOrDownload(catalog);
          AppUI.setStatus(AppUI.formatSaveResultMessage(result, 'Монета удалена и файл сохранен.', 'Монета удалена. Обновленный JSON скачан.'), 'success');
          window.setTimeout(function () {
            window.location.href = 'index.html';
          }, 500);
        } catch (error) {
          AppUI.setStatus(error.message || 'Не удалось удалить монету.', 'danger');
        }
      });
    }
  }

  function renderMissingCoin() {
    AppUI.setText(AppUI.byId('detailTitle'), 'Монета не найдена');
    AppUI.setText(AppUI.byId('detailSubtitle'), 'Проверь id в адресной строке или вернись в каталог.');
    const content = AppUI.byId('detailContent');
    if (content) {
      content.innerHTML = '<div class="empty-state">Нет данных для отображения.</div>';
    }
  }

  function renderCoin(coin) {
    document.title = CoinDB.getDisplayTitle(coin) + ' · Каталог монет';
    AppUI.setText(AppUI.byId('detailTitle'), CoinDB.getDisplayTitle(coin));
    AppUI.setText(AppUI.byId('detailSubtitle'), CoinDB.compactText([AppIssuers.getCoinIssuerName(coin), coin.year, coin.mint]));

    AppUI.setCoinImage(AppUI.byId('obverseImage'), coin.photos && coin.photos.obverse, 'obverse', { lazy: false });
    AppUI.setCoinImage(AppUI.byId('reverseImage'), coin.photos && coin.photos.reverse, 'reverse', { lazy: false });

    const chips = AppUI.byId('detailChips');
    chips.innerHTML = '';
    if (coin.status) chips.appendChild(AppUI.createChip(coin.status, 'success'));
    if (coin.condition) chips.appendChild(AppUI.createChip(coin.condition, 'accent'));
    if (coin.material) chips.appendChild(AppUI.createChip(coin.material));
    if (coin.currentValue) chips.appendChild(AppUI.createChip('Оценка: ' + AppCurrency.formatPrice(coin.currentValue)));
    CoinDB.getSeriesByIds(catalog.series, coin.seriesIds).forEach(function (series) {
      chips.appendChild(AppUI.createChip(series.name));
    });

    renderSections(coin);
  }

  function renderSections(coin) {
    const content = AppUI.byId('detailContent');
    content.innerHTML = '';

    appendSection(content, 'Основное', compactRows([
      ['Страна/эмитент', AppIssuers.getCoinIssuerName(coin)],
      ['Номинал', coin.nominal],
      ['Название', coin.title],
      ['Год', coin.year],
      ['Монетный двор', coin.mint],
      ['Тип чеканки', coin.strikeType],
      ['Статус', coin.status]
    ]));

    appendSeriesSection(content, coin);

    appendSection(content, 'Характеристики', compactRows([
      ['Материал', coin.material],
      ['Проба', coin.fineness],
      ['Вес', coin.weight],
      ['Диаметр', coin.diameter],
      ['Толщина', coin.thickness],
      ['Тираж', coin.mintage],
      ['Состояние', coin.condition]
    ]));

    appendSection(content, 'Покупка и оценка', compactRows([
      ['Дата приобретения', coin.purchaseDate ? CoinDB.formatDate(coin.purchaseDate) : ''],
      ['Цена покупки', coin.purchasePrice ? formatPriceValue(coin.purchasePrice) : ''],
      ['Источник', coin.source],
      ['Текущая оценка', coin.currentValue ? formatPriceValue(coin.currentValue) : '']
    ]));

    appendSection(content, 'Каталог', compactRows([
      ['Каталожный номер', coin.catalogNumber],
      ['Фото аверса', coin.photos && coin.photos.obverse],
      ['Фото реверса', coin.photos && coin.photos.reverse]
    ]));

    if (hasValue(coin.comment)) {
      const commentSection = AppUI.createElement('section', 'section');
      commentSection.appendChild(AppUI.createElement('h2', 'section__title', 'Комментарий'));
      const comment = AppUI.createElement('p', '', coin.comment);
      comment.style.margin = '0';
      comment.style.whiteSpace = 'pre-wrap';
      commentSection.appendChild(comment);
      content.appendChild(commentSection);
    }
  }

  function appendSeriesSection(content, coin) {
    const series = CoinDB.getSeriesByIds(catalog.series, coin.seriesIds);
    if (!series.length) return;

    const section = AppUI.createElement('section', 'section');
    section.appendChild(AppUI.createElement('h2', 'section__title', 'Серии'));
    const badges = AppUI.createElement('div', 'badge-list');
    series.forEach(function (item) {
      badges.appendChild(AppUI.createChip(item.name));
    });
    section.appendChild(badges);
    content.appendChild(section);
  }

  function hasValue(value) {
    return String(value || '').trim() !== '' && String(value || '').trim() !== '—';
  }

  function compactRows(rows) {
    return rows.filter(function (row) {
      return hasValue(row[1]);
    });
  }

  function appendSection(content, title, rows) {
    if (!rows.length) return;
    content.appendChild(createSection(title, rows));
  }

  function formatPriceValue(value) {
    return value ? AppCurrency.formatPrice(value) : '—';
  }

  function createSection(title, rows) {
    const section = AppUI.createElement('section', 'section');
    section.appendChild(AppUI.createElement('h2', 'section__title', title));
    const grid = AppUI.createElement('div', 'data-grid');

    rows.forEach(function (row) {
      AppUI.appendDataItem(grid, row[0], row[1]);
    });

    section.appendChild(grid);
    return section;
  }
})();
