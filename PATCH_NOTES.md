# PATCH: SPA stabilization and fallback removal

## Изменено
- `service-worker.js` обновлен до `coins-pwa-v22`.
- Из `APP_SHELL` удалены отдельные fallback-страницы:
  - `coin.html`
  - `form.html`
  - `stats.html`
- Добавлен navigation fallback на `index.html` для SPA-режима.
- Добавлены redirect-правила в service worker для старых URL:
  - `coin.html?id=...` → `index.html#/coin/...`
  - `form.html?id=...` → `index.html#/edit/...`
  - `form.html` → `index.html#/new`
  - `stats.html` → `index.html#/stats`
- Из `js/detail.js` удалена standalone-логика старой страницы `coin.html`; оставлен только SPA-render `renderCoinInline()`.

## Удалить из проекта
Эти файлы больше не нужны и должны быть удалены из рабочей копии:
- `coin.html`
- `form.html`
- `stats.html`

Если вы применяете ZIP поверх существующей папки, удалите эти файлы вручную, так как распаковка ZIP не удаляет старые файлы автоматически.

## Проверки
- Проверены ссылки на `coin.html`, `form.html`, `stats.html`: прямых зависимостей в приложении не осталось, кроме redirect-совместимости в `service-worker.js`.
- Выполнен `node --check` для всех файлов `js/*.js` и `service-worker.js`.

## Не изменялось
- `images/logo.png` не трогался.
- Persistent image cache не менялся.
- Структура JSON не менялась.
