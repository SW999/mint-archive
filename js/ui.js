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
    series: 'Серия',
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
      title: 'Серии',
      fields: ['series'],
      type: 'series'
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

  const IMAGE_LOAD_CONCURRENCY = 3;
  let imageObserver = null;
  let imageQueue = [];
  let activeImageLoads = 0;
  let imageLoadSeq = 0;

  function getImageObserver() {
    if (!('IntersectionObserver' in window)) return null;
    if (imageObserver) return imageObserver;

    imageObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        imageObserver.unobserve(entry.target);
        enqueueImageLoad(entry.target);
      });
    }, {
      root: null,
      rootMargin: '220px 0px',
      threshold: 0.01
    });

    return imageObserver;
  }

  function setImageFallback(image, fallback) {
    image.onerror = function () {
      image.onerror = null;
      image.src = fallback;
      image.classList.remove('is-loading');
      image.classList.add('is-placeholder');
    };
  }

  function processImageQueue() {
    while (activeImageLoads < IMAGE_LOAD_CONCURRENCY && imageQueue.length) {
      const image = imageQueue.shift();
      if (!image || !image.isConnected) continue;
      activeImageLoads += 1;
      loadQueuedImage(image).finally(function () {
        activeImageLoads -= 1;
        processImageQueue();
      });
    }
  }

  function enqueueImageLoad(image) {
    if (!image || image.dataset.imageQueued === 'true') return;
    image.dataset.imageQueued = 'true';
    imageQueue.push(image);
    processImageQueue();
  }

  async function loadQueuedImage(image) {
    const path = image.dataset.photoPath || '';
    const kind = image.dataset.photoKind || 'obverse';
    const token = image.dataset.imageToken || '';
    const fallback = placeholder(kind);

    if (!path || !image.isConnected) return;

    try {
      const objectUrl = await AppFileSystem.loadImageObjectUrl(path);
      if (!image.isConnected || image.dataset.imageToken !== token) return;
      image.src = objectUrl || path;
      image.classList.remove('is-placeholder');
    } catch (error) {
      if (!image.isConnected || image.dataset.imageToken !== token) return;
      image.src = path || fallback;
    } finally {
      if (image.isConnected && image.dataset.imageToken === token) {
        image.classList.remove('is-loading');
        image.dataset.imageQueued = 'false';
      }
    }
  }

  function setCoinImage(image, path, kind, options) {
    if (!image) return;

    const settings = Object.assign({ lazy: true }, options || {});
    const fallback = placeholder(kind);
    const normalizedPath = String(path || '').trim();
    const token = String(++imageLoadSeq);

    image.loading = settings.lazy ? 'lazy' : 'eager';
    image.decoding = 'async';
    image.dataset.imageToken = token;
    image.dataset.photoPath = normalizedPath;
    image.dataset.photoKind = kind || 'obverse';
    image.dataset.imageQueued = 'false';
    image.classList.add('is-loading');
    image.classList.add('is-placeholder');
    setImageFallback(image, fallback);
    image.src = fallback;

    if (!normalizedPath) {
      image.classList.remove('is-loading');
      return;
    }

    const observer = settings.lazy ? getImageObserver() : null;
    if (observer) {
      observer.observe(image);
    } else {
      enqueueImageLoad(image);
    }
  }

  function cleanupImageObjectUrls() {
    if (window.AppFileSystem && AppFileSystem.revokeImageObjectUrls) {
      AppFileSystem.revokeImageObjectUrls();
    }
  }

  window.addEventListener('pagehide', cleanupImageObjectUrls);


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

    const optionValues = [];
    values.forEach(function (item) {
      const option = document.createElement('option');
      const value = item && typeof item === 'object' ? item.value : item;
      const label = item && typeof item === 'object' ? item.label : item;
      option.value = value;
      option.textContent = label;
      optionValues.push(String(value));
      select.appendChild(option);
    });

    if (optionValues.includes(String(current))) {
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
      const removedCount = Array.isArray(settings.removedBackups) ? settings.removedBackups.length : 0;
      const limitText = settings.backupLimit ? ' Хранится до ' + settings.backupLimit + ' последних backup.' : '';
      const cleanupText = removedCount ? ' Удалено старых backup: ' + removedCount + '.' : '';
      return (baseMessage || 'Файл сохранен.') + ' Backup создан автоматически.' + limitText + cleanupText;
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
    cleanupImageObjectUrls: cleanupImageObjectUrls,
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
