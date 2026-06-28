# Patch: stage 8 cleanup + stage 7 documentation

## Что изменено

### Этап 8 — техническая чистка

- Удалена standalone-инициализация из `js/form.js`, так как отдельная `form.html` удалена и форма теперь работает только как SPA-экран.
- Удалены fallback-переходы из `js/form.js` на `index.html#/...`: после SPA-finalize они больше не нужны.
- Удалена standalone-инициализация из `js/stats.js`, так как отдельная `stats.html` удалена и статистика теперь открывается через `#/stats`.
- Проверены ссылки на старые HTML-страницы:
  - `coin.html`
  - `form.html`
  - `stats.html`
- Оставлены только compatibility-redirects в `service-worker.js`, чтобы старые ссылки перекидывались на SPA-маршруты.
- В app shell service worker добавлены файлы, которые реально используются PWA/offline:
  - `images/logo.png`
  - `images/icon-192.png`
  - `images/icon-512.png`
  - `images/icon-maskable-512.png`
- `service-worker.js` обновлен до `coins-pwa-v25`.

### Этап 7 — документация

Добавлены файлы:

- `PROJECT_STATE.md` — текущее состояние проекта, архитектура, маршруты, хранение, Android/photo cache, правила разработки.
- `DATA_SCHEMA.md` — структура `coins.json`, поля монеты, серии, эмитенты, статусы, продажа, грейдинг, фото, правила компактного сохранения.

## Проверки

- Выполнен `node --check` для всех JS-файлов и `service-worker.js`.
- Гарантированно неиспользуемая standalone-логика удалена только там, где fallback HTML-страницы уже исключены из актуальной структуры.
- CSS проверен на явные кандидаты для удаления; безопасных удалений без риска визуальных регрессий не найдено.

## Измененные/новые файлы

```text
coins-pwa/
  js/form.js
  js/stats.js
  service-worker.js
  PROJECT_STATE.md
  DATA_SCHEMA.md
  PATCH_NOTES.md
```
