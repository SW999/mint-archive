(function () {
  'use strict';

  let mode = 'create';
  let originalCoin = null;
  let draftKey = '';
  let draftTimer = null;
  let isSubmitting = false;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    await AppCurrency.init();

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    originalCoin = id ? CoinDB.getCoinById(id) : null;
    mode = originalCoin ? 'edit' : 'create';

    AppUI.setText(AppUI.byId('formTitle'), mode === 'edit' ? 'Редактировать монету' : 'Добавить монету');
    AppUI.setText(AppUI.byId('formSubtitle'), mode === 'edit' ? CoinDB.getDisplayTitle(originalCoin) : 'Заполни основные поля и сохрани JSON.');

    draftKey = getDraftKey(id);

    renderForm(originalCoin || CoinDB.normalizeCoin({ id: CoinDB.generateId(), status: 'В коллекции' }));
    bindEvents();
    await offerDraftRestore();
    AppUI.updateMetaView();
  }

  function bindEvents() {
    const form = AppUI.byId('coinForm');
    form.addEventListener('submit', submitForm);
    form.addEventListener('input', scheduleDraftSave);
    form.addEventListener('change', scheduleDraftSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveDraftNow();
    });
    window.addEventListener('pagehide', saveDraftNow);

    const deleteButton = AppUI.byId('deleteButton');
    if (mode === 'edit') {
      deleteButton.classList.remove('hidden');
      deleteButton.addEventListener('click', deleteCurrentCoin);
    }
  }

  function renderForm(coin) {
    const container = AppUI.byId('formSections');
    container.innerHTML = '';

    AppUI.FIELD_GROUPS.forEach(function (group) {
      container.appendChild(createFormSection(group, coin));
    });

    updatePreview('photos.obverse', 'obversePreview', 'obverse');
    updatePreview('photos.reverse', 'reversePreview', 'reverse');
  }

  function createFormSection(group, coin) {
    const section = AppUI.createElement('section', 'form-section');
    section.appendChild(AppUI.createElement('h2', 'form-section__title', group.title));

    const gridClass = group.type === 'photos' ? 'form-grid form-grid--photos' : 'form-grid';
    const grid = AppUI.createElement('div', gridClass);

    group.fields.forEach(function (field) {
      if (field === 'comment') {
        grid.appendChild(createTextareaField(field, getValue(coin, field)));
      } else if (field.indexOf('photos.') === 0) {
        grid.appendChild(createPhotoField(field, getValue(coin, field)));
      } else {
        grid.appendChild(createInputField(field, getValue(coin, field)));
      }
    });

    section.appendChild(grid);
    return section;
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

    if (field === 'country' || field === 'nominal' || field === 'title') {
      input.autocapitalize = 'sentences';
    }

    if (field === 'purchasePrice' || field === 'currentValue') {
      const inputShell = AppUI.createElement('div', 'field-with-suffix');
      inputShell.appendChild(input);
      inputShell.appendChild(AppUI.createElement('span', 'field-suffix', '€'));
      wrapper.appendChild(inputShell);
      wrapper.appendChild(AppUI.createElement('p', 'small-note', 'В JSON значение хранится как введено; пересчет валют выполняется только на экране.'));
      return wrapper;
    }

    wrapper.appendChild(input);
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
    input.value = value || '';
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

  function updatePreview(field, imageId, kind) {
    const input = document.querySelector('[name="' + field + '"]');
    const image = AppUI.byId(imageId);
    AppUI.setCoinImage(image, input && input.value, kind);
  }

  function getValue(coin, field) {
    if (field === 'photos.obverse') return coin.photos && coin.photos.obverse;
    if (field === 'photos.reverse') return coin.photos && coin.photos.reverse;
    return coin[field];
  }

  function readFormCoin() {
    const form = AppUI.byId('coinForm');
    const formData = new FormData(form);
    const coin = CoinDB.normalizeCoin(originalCoin || { id: formData.get('id') || CoinDB.generateId() });

    CoinDB.COIN_FIELDS.forEach(function (field) {
      if (field === 'id') return;
      if (!formData.has(field)) return;
      const value = formData.get(field);
      coin[field] = value === null ? '' : String(value).trim();
    });

    coin.id = originalCoin ? originalCoin.id : (coin.id || CoinDB.generateId());
    coin.photos = {
      obverse: String(formData.get('photos.obverse') || '').trim(),
      reverse: String(formData.get('photos.reverse') || '').trim()
    };

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
        coin: readFormCoin()
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
      const catalog = CoinDB.upsertCoin(coin);
      const result = await AppUI.persistCatalogOrDownload(catalog);
      await clearDraft();
      AppUI.updateMetaView();
      AppUI.setStatus(AppUI.formatSaveResultMessage(result, 'Монета сохранена в coins.json.', 'Монета сохранена. Обновленный JSON скачан.'), 'success');

      window.setTimeout(function () {
        window.location.href = 'coin.html?id=' + encodeURIComponent(coin.id);
      }, 450);
    } catch (error) {
      isSubmitting = false;
      AppUI.setStatus(error.message || 'Не удалось сохранить монету.', 'danger');
    }
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

      window.setTimeout(function () {
        window.location.href = 'index.html';
      }, 450);
    } catch (error) {
      isSubmitting = false;
      AppUI.setStatus(error.message || 'Не удалось удалить монету.', 'danger');
    }
  }
})();
