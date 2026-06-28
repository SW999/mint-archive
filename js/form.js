(function () {
  'use strict';

  let mode = 'create';
  let originalCoin = null;
  let draftKey = '';
  let draftTimer = null;
  let isSubmitting = false;
  let seriesList = [];
  let eventsBound = false;

  window.AppCoinForm = {
    openInline: openInlineForm,
    reset: resetFormState
  };

  async function openInlineForm(id) {
    await setupForm(id);
  }

  async function setupForm(id) {
    isSubmitting = false;
    await AppCurrency.init();
    if (window.AppIssuers) await AppIssuers.init();

    const currentCatalog = CoinDB.loadCatalog();
    seriesList = CoinDB.normalizeSeries(currentCatalog.series);
    originalCoin = id ? CoinDB.getCoinById(id) : null;
    mode = originalCoin ? 'edit' : 'create';

    AppUI.setText(AppUI.byId('formTitle'), mode === 'edit' ? 'Редактировать монету' : 'Добавить монету');
    AppUI.setText(AppUI.byId('formSubtitle'), mode === 'edit' ? CoinDB.getDisplayTitle(originalCoin) : 'Заполни основные поля и сохрани JSON.');

    draftKey = getDraftKey(id);

    renderForm(originalCoin || CoinDB.normalizeCoin({ id: CoinDB.generateId(), status: CoinDB.STATUS_IN_COLLECTION }));
    bindEvents();
    syncDeleteButton();
    await offerDraftRestore();
    AppUI.updateMetaView();
  }

  function resetFormState() {
    mode = 'create';
    originalCoin = null;
    draftKey = '';
    isSubmitting = false;
    window.clearTimeout(draftTimer);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const form = AppUI.byId('coinForm');
    if (form) {
      form.addEventListener('submit', submitForm);
      form.addEventListener('input', scheduleDraftSave);
      form.addEventListener('change', scheduleDraftSave);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveDraftNow();
    });
    window.addEventListener('pagehide', saveDraftNow);

    const deleteButton = AppUI.byId('deleteButton');
    if (deleteButton) deleteButton.addEventListener('click', deleteCurrentCoin);

    const cancelButton = AppUI.byId('inlineFormCancelButton');
    if (cancelButton) {
      cancelButton.addEventListener('click', function () {
        if (originalCoin) {
          window.location.hash = '/coin/' + encodeURIComponent(originalCoin.id);
        } else {
          window.location.hash = '';
        }
      });
    }

    const backButton = AppUI.byId('inlineFormBackButton');
    if (backButton) {
      backButton.addEventListener('click', function () {
        window.location.hash = '';
      });
    }
  }

  function syncDeleteButton() {
    const deleteButton = AppUI.byId('deleteButton');
    if (!deleteButton) return;
    deleteButton.classList.toggle('hidden', mode !== 'edit');
  }

  function renderForm(coin) {
    const container = AppUI.byId('formSections');
    container.innerHTML = '';

    AppUI.FIELD_GROUPS.forEach(function (group) {
      container.appendChild(createFormSection(group, coin));
    });

    updatePreview('photos.obverse', 'obversePreview', 'obverse');
    updatePreview('photos.reverse', 'reversePreview', 'reverse');
    updateSaleSectionVisibility();
  }

  function createFormSection(group, coin) {
    const section = AppUI.createElement('section', 'form-section');
    section.appendChild(AppUI.createElement('h2', 'form-section__title', group.title));

    const gridClass = group.type === 'photos' ? 'form-grid form-grid--photos' : 'form-grid';
    const grid = AppUI.createElement('div', gridClass);

    group.fields.forEach(function (field) {
      if (group.type === 'series') {
        grid.appendChild(createSeriesField(coin));
      } else if (field === 'comment') {
        grid.appendChild(createTextareaField(field, getValue(coin, field)));
      } else if (field.indexOf('photos.') === 0) {
        grid.appendChild(createPhotoField(field, getValue(coin, field)));
      } else if (field === 'issuerId') {
        grid.appendChild(createIssuerField(coin));
      } else if (field === 'status') {
        grid.appendChild(createStatusField(coin));
      } else if (group.type === 'sale') {
        grid.appendChild(createSaleField(field, coin));
      } else {
        grid.appendChild(createInputField(field, getValue(coin, field)));
      }
    });

    if (group.type === 'sale') {
      section.dataset.sectionType = 'sale';
      section.classList.toggle('hidden', CoinDB.normalizeStatus(coin.status) !== CoinDB.STATUS_SOLD);
    }

    section.appendChild(grid);
    return section;
  }

  function createStatusField(coin) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel('status')));

    const select = document.createElement('select');
    select.className = 'select-field';
    select.name = 'status';

    AppUI.STATUS_OPTIONS.forEach(function (item) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });

    select.value = CoinDB.normalizeStatus(coin.status);
    select.addEventListener('change', updateSaleSectionVisibility);
    wrapper.appendChild(select);
    return wrapper;
  }

  function createSaleField(field, coin) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel(field)));

    if (field === 'saleSpread') {
      const value = AppUI.createElement('div', 'readonly-field');
      value.id = 'saleSpreadValue';
      value.textContent = calculateSaleSpreadText(coin);
      wrapper.appendChild(value);
      wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Спрэд считается как сумма продажи минус цена покупки. Если цена покупки не указана, спрэд не считается.'));
      return wrapper;
    }

    const input = document.createElement('input');
    input.className = 'field';
    input.name = field;
    input.value = coin.salePrice || '';
    input.autocomplete = 'off';
    input.type = 'text';
    input.addEventListener('input', updateSaleSpreadValue);

    const inputShell = AppUI.createElement('div', 'field-with-suffix');
    inputShell.appendChild(input);
    inputShell.appendChild(AppUI.createElement('span', 'field-suffix', '€'));
    wrapper.appendChild(inputShell);
    wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Сумма продажи хранится без символа валюты.'));
    return wrapper;
  }

  function updateSaleSectionVisibility() {
    const section = document.querySelector('[data-section-type="sale"]');
    const status = document.querySelector('[name="status"]');
    if (!section || !status) return;

    const isSold = CoinDB.normalizeStatus(status.value) === CoinDB.STATUS_SOLD;
    section.classList.toggle('hidden', !isSold);
    if (!isSold) {
      const salePrice = document.querySelector('[name="salePrice"]');
      if (salePrice) salePrice.value = '';
    }
    updateSaleSpreadValue();
  }

  function updateSaleSpreadValue() {
    const node = AppUI.byId('saleSpreadValue');
    if (!node) return;
    node.textContent = calculateSaleSpreadText(readFormCoin({ validate: false }));
  }

  function calculateSaleSpreadText(coin) {
    if (CoinDB.normalizeStatus(coin.status) !== CoinDB.STATUS_SOLD) return '—';
    const sale = Number(CoinDB.normalizeDecimalText(coin.salePrice));
    const purchase = Number(CoinDB.normalizeDecimalText(coin.purchasePrice));
    if (!Number.isFinite(sale) || sale <= 0) return '—';
    if (!Number.isFinite(purchase) || purchase <= 0) return '—';
    const spread = sale - purchase;
    const sign = spread > 0 ? '+' : '';
    return sign + AppCurrency.formatPrice(String(spread));
  }

  function createInputField(field, value) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel(field)));

    const input = document.createElement('input');
    input.className = 'field';
    input.name = field;
    input.value = field === 'purchaseDate' ? CoinDB.normalizeDateForInput(value) : (value || '');
    input.autocomplete = 'off';

    if (field === 'purchaseDate') {
      input.type = 'date';
    } else {
      input.type = 'text';
    }

    if (field === 'slabUrl') {
      input.inputMode = 'url';
      input.placeholder = 'https://www.ngccoin.com/certlookup/...';
    }

    if (field === 'nominal' || field === 'title') {
      input.autocapitalize = 'sentences';
    }

    if (field === 'purchasePrice' || field === 'currentValue' || field === 'salePrice') {
      const inputShell = AppUI.createElement('div', 'field-with-suffix');
      inputShell.appendChild(input);
      inputShell.appendChild(AppUI.createElement('span', 'field-suffix', '€'));
      wrapper.appendChild(inputShell);
      wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Символы валюты при сохранении удаляются; пересчет валют выполняется только на экране.'));
      return wrapper;
    }

    wrapper.appendChild(input);

    if (field === 'slabUrl') {
      wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Можно вставить полный адрес или домен без https://. При сохранении ссылка будет нормализована.'));
    }

    return wrapper;
  }


  function createIssuerField(coin) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel('issuerId')));

    const select = document.createElement('select');
    select.className = 'select-field';
    select.name = 'issuerId';

    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Не выбрано';
    select.appendChild(empty);

    const legacyCountry = window.AppIssuers ? AppIssuers.getLegacyCountryForForm(coin) : '';
    if (legacyCountry) {
      const legacyOption = document.createElement('option');
      legacyOption.value = 'legacy:' + legacyCountry;
      legacyOption.textContent = legacyCountry + ' (старое значение)';
      select.appendChild(legacyOption);
    }

    const selectedIssuerId = window.AppIssuers ? AppIssuers.getCoinIssuerIdForForm(coin) : String(coin.issuerId || '');
    const options = window.AppIssuers ? AppIssuers.getIssuerOptions() : [];
    options.forEach(function (item) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });

    select.value = selectedIssuerId || (legacyCountry ? 'legacy:' + legacyCountry : '');
    wrapper.appendChild(select);
    wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Новые и отредактированные монеты сохраняют id эмитента. Старые строковые значения страны читаются для совместимости.'));
    return wrapper;
  }

  function createTextareaField(field, value) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel(field)));

    const textarea = document.createElement('textarea');
    textarea.className = 'field';
    textarea.name = field;
    textarea.value = value || '';
    wrapper.appendChild(textarea);
    return wrapper;
  }

  function createPhotoField(field, value) {
    const wrapper = AppUI.createElement('label', 'form-field');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', AppUI.getFieldLabel(field)));

    const previewRow = AppUI.createElement('div', 'preview-row');
    const image = document.createElement('img');
    image.className = 'preview-image';
    image.id = field === 'photos.obverse' ? 'obversePreview' : 'reversePreview';
    image.alt = AppUI.getFieldLabel(field);

    const input = document.createElement('input');
    input.className = 'field';
    input.name = field;
    input.value = value || 'images/';
    input.placeholder = field === 'photos.obverse' ? 'images/coin_001_obverse.jpg' : 'images/coin_001_reverse.jpg';
    input.autocomplete = 'off';
    input.addEventListener('input', function () {
      updatePreview(field, image.id, field === 'photos.obverse' ? 'obverse' : 'reverse');
    });

    const inputBox = AppUI.createElement('div');
    inputBox.appendChild(input);
    inputBox.appendChild(AppUI.createElement('p', 'small-note', 'В первой версии фото кладутся вручную в images/, здесь указывается относительный путь.'));

    previewRow.appendChild(image);
    previewRow.appendChild(inputBox);
    wrapper.appendChild(previewRow);
    return wrapper;
  }


  function createSeriesField(coin) {
    const wrapper = AppUI.createElement('div', 'form-field form-field--wide');
    wrapper.appendChild(AppUI.createElement('span', 'form-label', 'Серия'));

    const selectedIds = new Set(Array.isArray(coin.seriesIds) ? coin.seriesIds : []);
    const list = AppUI.createElement('div', 'checkbox-list');
    list.id = 'seriesCheckboxList';

    renderSeriesCheckboxes(list, selectedIds);

    const addRow = AppUI.createElement('div', 'inline-add');
    const input = document.createElement('input');
    input.className = 'field';
    input.id = 'newSeriesInput';
    input.type = 'text';
    input.placeholder = 'Новая серия';
    input.autocomplete = 'off';

    const button = AppUI.createElement('button', 'button', 'Добавить серию');
    button.type = 'button';
    button.addEventListener('click', function () {
      addSeriesFromInput(input, list);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addSeriesFromInput(input, list);
    });

    addRow.appendChild(input);
    addRow.appendChild(button);

    wrapper.appendChild(list);
    wrapper.appendChild(addRow);
    wrapper.appendChild(AppUI.createElement('p', 'small-note', 'Список серий хранится отдельно в JSON, у монеты сохраняются только id выбранных серий.'));
    return wrapper;
  }

  function renderSeriesCheckboxes(container, selectedIds) {
    container.innerHTML = '';

    if (!seriesList.length) {
      container.appendChild(AppUI.createElement('p', 'small-note', 'Серии пока не добавлены.'));
      return;
    }

    seriesList.forEach(function (series) {
      const label = AppUI.createElement('label', 'checkbox-row');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'seriesIds';
      input.value = series.id;
      input.checked = selectedIds.has(series.id);
      label.appendChild(input);
      label.appendChild(AppUI.createElement('span', '', series.name));
      container.appendChild(label);
    });
  }

  function addSeriesFromInput(input, list) {
    const name = String(input.value || '').trim();
    if (!name) return;

    const existing = seriesList.find(function (series) {
      return series.name.toLowerCase() === name.toLowerCase();
    });

    const id = existing ? existing.id : CoinDB.generateSeriesId(name);
    if (!existing) {
      seriesList.push({ id: id, name: name });
      seriesList = CoinDB.normalizeSeries(seriesList);
    }

    input.value = '';
    const selectedIds = new Set(Array.from(document.querySelectorAll('[name="seriesIds"]:checked')).map(function (node) {
      return node.value;
    }));
    selectedIds.add(id);
    renderSeriesCheckboxes(list, selectedIds);
    scheduleDraftSave();
  }

  function updatePreview(field, imageId, kind) {
    const input = document.querySelector('[name="' + field + '"]');
    const image = AppUI.byId(imageId);
    const value = input && String(input.value || '').trim();
    AppUI.setCoinImage(image, value === 'images/' ? '' : value, kind, { lazy: false });
  }

  function getValue(coin, field) {
    if (field === 'photos.obverse') return coin.photos && coin.photos.obverse;
    if (field === 'photos.reverse') return coin.photos && coin.photos.reverse;
    if (field === 'issuerId') return window.AppIssuers ? AppIssuers.getCoinIssuerIdForForm(coin) : coin.issuerId;
    return coin[field];
  }

  function normalizeFormValue(field, value) {
    const text = String(value || '').trim();
    if (field.indexOf('photos.') === 0 && text === 'images/') return '';
    return CoinDB.normalizeCoinField(field, value);
  }

  function validateCoinForm(coin) {
    const errors = [];

    ['purchasePrice', 'currentValue', 'salePrice'].forEach(function (field) {
      const value = String(coin[field] || '').trim();
      if (!value) return;
      if (!/^\d+(\.\d+)?$/.test(value)) {
        errors.push(AppUI.getFieldLabel(field) + ': укажи число без символа валюты. Можно использовать запятую или точку.');
      }
    });

    const year = String(coin.year || '').trim();
    if (year && !/^\d{1,4}([\-–—]\d{1,4})?$/.test(year)) {
      errors.push('Год: укажи год числом или диапазоном, например 1553 или 1553-1555.');
    }

    if (coin.slabUrl && !CoinDB.isValidHttpUrl(coin.slabUrl)) {
      errors.push('Ссылка на страницу грейдера: укажи корректную ссылку http:// или https://.');
    }

    const invalidPhotoPath = [coin.photos && coin.photos.obverse, coin.photos && coin.photos.reverse].find(function (path) {
      return String(path || '').split(/[\\/]+/).includes('..');
    });
    if (invalidPhotoPath) {
      errors.push('Фото: путь не должен содержать "..". Используй относительный путь внутри папки каталога.');
    }

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
  }

  function readFormCoin(options) {
    const form = AppUI.byId('coinForm');
    const formData = new FormData(form);
    const coin = CoinDB.normalizeCoin(originalCoin || { id: formData.get('id') || CoinDB.generateId() });

    CoinDB.COIN_FIELDS.forEach(function (field) {
      if (field === 'id' || field === 'issuerId' || field === 'country' || field === 'saleSpread') return;
      if (!formData.has(field)) return;
      const value = formData.get(field);
      coin[field] = normalizeFormValue(field, value);
    });

    const issuerValue = String(formData.get('issuerId') || '').trim();
    if (issuerValue.indexOf('legacy:') === 0) {
      coin.issuerId = '';
      coin.country = normalizeFormValue('country', issuerValue.slice(7));
    } else {
      coin.issuerId = normalizeFormValue('issuerId', issuerValue);
      coin.country = '';
    }

    coin.id = originalCoin ? originalCoin.id : (coin.id || CoinDB.generateId());
    coin.photos = {
      obverse: normalizeFormValue('photos.obverse', formData.get('photos.obverse')),
      reverse: normalizeFormValue('photos.reverse', formData.get('photos.reverse'))
    };
    coin.seriesIds = Array.from(form.querySelectorAll('[name="seriesIds"]:checked')).map(function (input) {
      return input.value;
    });

    if (CoinDB.normalizeStatus(coin.status) !== CoinDB.STATUS_SOLD) {
      coin.salePrice = '';
    }

    if (!options || options.validate !== false) validateCoinForm(coin);
    return coin;
  }


  function getDraftKey(id) {
    return mode === 'edit' && id ? 'coin-form:edit:' + id : 'coin-form:create';
  }

  async function offerDraftRestore() {
    if (!window.AppDrafts || !AppDrafts.isSupported() || !draftKey) return;

    const draft = await AppDrafts.getDraft(draftKey);
    if (!draft || !draft.coin) return;

    const date = draft.updatedAt ? new Date(draft.updatedAt).toLocaleString('ru-RU') : '';
    const confirmed = await AppUI.confirmDialog({
      title: 'Восстановить черновик?',
      message: 'Найден несохраненный черновик формы' + (date ? ' от ' + date : '') + '. Восстановить его?',
      confirmText: 'Восстановить'
    });

    if (confirmed) {
      if (Array.isArray(draft.series)) seriesList = CoinDB.normalizeSeries(draft.series);
      renderForm(CoinDB.normalizeCoin(draft.coin));
      AppUI.setStatus('Черновик восстановлен из IndexedDB.', 'success');
    } else {
      await clearDraft();
    }
  }

  function scheduleDraftSave() {
    if (isSubmitting || !draftKey || !window.AppDrafts || !AppDrafts.isSupported()) return;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(saveDraftNow, 350);
  }

  async function saveDraftNow() {
    if (isSubmitting || !draftKey || !window.AppDrafts || !AppDrafts.isSupported()) return;

    try {
      await AppDrafts.saveDraft(draftKey, {
        mode: mode,
        coinId: originalCoin && originalCoin.id,
        coin: readFormCoin({ validate: false }),
        series: seriesList
      });
    } catch (error) {
      console.warn('Cannot save form draft', error);
    }
  }

  async function clearDraft() {
    if (!draftKey || !window.AppDrafts || !AppDrafts.isSupported()) return;
    window.clearTimeout(draftTimer);
    await AppDrafts.clearDraft(draftKey);
  }


  async function submitForm(event) {
    event.preventDefault();
    AppUI.setStatus('', '');

    try {
      const coin = readFormCoin();
      isSubmitting = true;
      const catalog = CoinDB.upsertCoin(coin, seriesList);
      const result = await AppUI.persistCatalogOrDownload(catalog);
      await clearDraft();
      AppUI.updateMetaView();
      AppUI.setStatus(AppUI.formatSaveResultMessage(result, 'Монета сохранена в coins.json.', 'Монета сохранена. Обновленный JSON скачан.'), 'success');

      notifyCatalogUpdated({ coinId: coin.id, action: 'save' });
      window.setTimeout(function () {
        window.location.hash = '/coin/' + encodeURIComponent(coin.id);
      }, 450);
    } catch (error) {
      isSubmitting = false;
      AppUI.setStatus(error.message || 'Не удалось сохранить монету.', 'danger');
    }
  }

  function notifyCatalogUpdated(detail) {
    document.dispatchEvent(new CustomEvent('coin-catalog-updated', { detail: detail || {} }));
  }

  async function deleteCurrentCoin() {
    if (!originalCoin) return;
    const confirmed = await AppUI.confirmDialog({
      title: 'Удалить монету?',
      message: 'Монета будет удалена из каталога. При сохранении будет автоматически создан backup, если открыт каталог как папка.',
      confirmText: 'Удалить',
      danger: true
    });
    if (!confirmed) return;

    try {
      isSubmitting = true;
      const catalog = CoinDB.deleteCoin(originalCoin.id);
      const result = await AppUI.persistCatalogOrDownload(catalog);
      await clearDraft();
      AppUI.setStatus(AppUI.formatSaveResultMessage(result, 'Монета удалена из coins.json.', 'Монета удалена. Обновленный JSON скачан.'), 'success');

      notifyCatalogUpdated({ coinId: originalCoin.id, action: 'delete' });
      window.setTimeout(function () {
        window.location.hash = '';
      }, 450);
    } catch (error) {
      isSubmitting = false;
      AppUI.setStatus(error.message || 'Не удалось удалить монету.', 'danger');
    }
  }
})();
