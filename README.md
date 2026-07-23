# claude-ping

Пуш на телефон, когда **запрос в Claude Code завершился**. В статус-баре VS Code — кнопка-переключатель, уведомление приходит через бесплатный сервис [ntfy.sh](https://ntfy.sh) в приложение на Android/iOS.

Репозиторий содержит VS Code-расширение **Claude Notify**.

## 📦 Расширение

Код и полная документация — в папке [`claude-notify/`](claude-notify/):

- **[Установка и настройка →](claude-notify/README.md)**
- **[История изменений →](claude-notify/CHANGELOG.md)**

## ⚡ Коротко

1. Поставить `.vsix` из [Releases](https://github.com/abdurakhmanov777/claude-ping/releases) (или собрать: `cd claude-notify && npm install && npm run package`).
2. Задать свой топик ntfy в настройках VS Code (`Ctrl+,` → «Claude Notify») и подписаться на него в приложении ntfy на телефоне.
3. Добавить `Stop`-хук в `~/.claude/settings.json` (см. [README расширения](claude-notify/README.md#4-добавить-триггер-в-claude-code)).

## Лицензия

[MIT](claude-notify/LICENSE)
