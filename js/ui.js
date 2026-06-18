(function () {
  'use strict';

  const FIELD_LABELS = {
    id: 'ID',
    country: 'Страна',
    nominal: 'Номинал',
    title: 'Название',
    year: 'Год',
    mint: 'Монетный двор',
    strikeType: 'Тип чеканки',
    material: 'Материал',
    fineness: 'Проба',
    weight: 'Вес',
    diameter: 'Диаметр',
    thickness: 'Толщина',
    mintage: 'Тираж',
    catalogNumber: 'Каталожный номер',
    condition: 'Состояние',
    purchaseDate: 'Дата приобретения',
    purchasePrice: 'Цена покупки',
    source: 'Источник',
    currentValue: 'Текущая оценка',
    status: 'Статус',
    comment: 'Комментарий',
    obverse: 'Фото аверса',
    reverse: 'Фото реверса'
  };

  const FIELD_GROUPS = [
    {
      title: 'Фото',
      fields: ['photos.obverse', 'photos.reverse'],
      type: 'photos'
    },
    {
      title: 'Основное',
      fields: ['country', 'nominal', 'title', 'year', 'mint', 'strikeType', 'status']
    },
    {
      title: 'Характеристики',
      fields: ['material', 'fineness', 'weight', 'diameter', 'thickness', 'mintage', 'condition']
    },
    {
      title: 'Каталог',
      fields: ['catalogNumber']
    },
    {
      title: 'Покупка и оценка',
      fields: ['purchaseDate', 'purchasePrice', 'source', 'currentValue']
    },
    {
      title: 'Комментарий',
      fields: ['comment'],
      type: 'comment'
    }
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(node, value) {
    if (node) node.textContent = value || '';
  }

  function setStatus(message, type) {
    const node = byId('statusMessage');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'notice';
    if (type === 'success') node.classList.add('notice--success');
    if (type === 'danger') node.classList.add('notice--danger');
    node.classList.toggle('hidden', !message);
  }

  function placeholder(kind) {
    return kind === 'reverse' ? 'images/placeholder-reverse.svg' : 'images/placeholder-obverse.svg';
  }

  async function setCoinImage(image, path, kind) {
    if (!image) return;
    const fallback = placeholder(kind);
    image.onerror = function () {
      image.onerror = null;
      image.src = fallback;
    };

    if (!path) {
      image.src = fallback;
      return;
    }

    try {
      const objectUrl = await AppFileSystem.loadImageObjectUrl(path);
      image.src = objectUrl || path;
    } catch (error) {
      image.src = path || fallback;
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = text;
    return element;
  }

  function createChip(text, modifier) {
    const chip = createElement('span', 'chip' + (modifier ? ' chip--' + modifier : ''), text);
    return chip;
  }

  function displayValue(value) {
    const text = String(value || '').trim();
    return text || '—';
  }

  function appendDataItem(container, label, value) {
    const item = createElement('div', 'data-item');
    item.appendChild(createElement('span', 'data-label', label));
    item.appendChild(createElement('span', 'data-value', displayValue(value)));
    container.appendChild(item);
  }

  function fillSelect(select, values, placeholderText) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholderText || 'Все';
    select.appendChild(empty);

    values.forEach(function (value) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    if (values.includes(current)) {
      select.value = current;
    }
  }

  function updateMetaView() {
    const meta = CoinDB.getMeta();
    const fileNameNode = byId('fileName');
    const dirtyNode = byId('dirtyState');
    const updatedNode = byId('updatedAt');

    if (fileNameNode) fileNameNode.textContent = meta.fileName || 'coins.json';
    if (dirtyNode) dirtyNode.textContent = meta.dirty ? 'есть несохраненные изменения' : 'изменений нет';
    if (updatedNode) updatedNode.textContent = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('ru-RU') : '—';
  }

  async function loadBundledCatalogIfEmpty() {
    const current = CoinDB.loadCatalog();
    if (current.coins.length > 0) return current;

    try {
      const response = await fetch('data/coins.json', { cache: 'no-store' });
      if (!response.ok) return current;
      const catalog = await response.json();
      const normalized = CoinDB.setCatalogFromFile(catalog, 'data/coins.json');
      return normalized;
    } catch (error) {
      return current;
    }
  }

  async function persistCatalogOrDownload(catalog) {
    const result = await AppFileSystem.saveCatalog(catalog);
    if (result.saved) {
      CoinDB.markSaved(catalog);
      return result;
    }

    AppFileSystem.downloadCatalog(catalog, 'coins.json');
    CoinDB.markSaved(catalog);
    return { saved: true, mode: 'download' };
  }


  function formatSaveResultMessage(result, baseMessage, downloadMessage) {
    const settings = result || {};
    if (settings.mode === 'download') {
      return downloadMessage || 'Изменения сохранены через скачивание JSON.';
    }

    if (settings.mode === 'file') {
      return (baseMessage || 'Файл сохранен.') + ' Backup не создан: открыт отдельный файл, а не папка каталога.';
    }

    if (settings.backupCreated) {
      return (baseMessage || 'Файл сохранен.') + ' Backup создан автоматически.';
    }

    if (settings.backupError) {
      return (baseMessage || 'Файл сохранен.') + ' Backup создать не удалось.';
    }

    return baseMessage || 'Файл сохранен.';
  }

  function getFieldLabel(field) {
    const normalized = field.replace('photos.', '');
    return FIELD_LABELS[normalized] || field;
  }


  function confirmDialog(options) {
    const settings = Object.assign({
      title: 'Подтверждение',
      message: 'Продолжить?',
      confirmText: 'Подтвердить',
      cancelText: 'Отмена',
      danger: false
    }, options || {});

    return new Promise(function (resolve) {
      const backdrop = createElement('div', 'modal-backdrop');
      const dialog = createElement('div', 'modal');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      const title = createElement('h2', 'modal__title', settings.title);
      const message = createElement('p', 'modal__message', settings.message);
      const actions = createElement('div', 'modal__actions');
      const cancelButton = createElement('button', 'button', settings.cancelText);
      const confirmButton = createElement('button', 'button ' + (settings.danger ? 'button--danger' : 'button--accent'), settings.confirmText);

      cancelButton.type = 'button';
      confirmButton.type = 'button';

      actions.appendChild(cancelButton);
      actions.appendChild(confirmButton);
      dialog.appendChild(title);
      dialog.appendChild(message);
      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      function close(result) {
        document.removeEventListener('keydown', onKeyDown);
        backdrop.remove();
        resolve(result);
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') close(false);
      }

      cancelButton.addEventListener('click', function () { close(false); });
      confirmButton.addEventListener('click', function () { close(true); });
      backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) close(false);
      });
      document.addEventListener('keydown', onKeyDown);
      window.setTimeout(function () { confirmButton.focus(); }, 0);
    });
  }

  window.AppUI = {
    FIELD_LABELS: FIELD_LABELS,
    FIELD_GROUPS: FIELD_GROUPS,
    byId: byId,
    setText: setText,
    setStatus: setStatus,
    setCoinImage: setCoinImage,
    createElement: createElement,
    createChip: createChip,
    displayValue: displayValue,
    appendDataItem: appendDataItem,
    fillSelect: fillSelect,
    updateMetaView: updateMetaView,
    loadBundledCatalogIfEmpty: loadBundledCatalogIfEmpty,
    persistCatalogOrDownload: persistCatalogOrDownload,
    formatSaveResultMessage: formatSaveResultMessage,
    getFieldLabel: getFieldLabel,
    confirmDialog: confirmDialog
  };
})();
