# claude-ping

Пуш на телефон, когда **запрос в Claude Code завершился**. В статус-баре VS Code — кнопка-переключатель, уведомление приходит через бесплатный сервис [ntfy.sh](https://ntfy.sh) в приложение на Android/iOS.

Репозиторий содержит VS Code-расширение **Claude ntfy toggle**.

## 📦 Расширение

Код и полная документация — в папке [`claude-ntfy-toggle/`](claude-ntfy-toggle/):

- **[Установка и настройка →](claude-ntfy-toggle/README.md)**
- **[История изменений →](claude-ntfy-toggle/CHANGELOG.md)**

## ⚡ Коротко

1. Поставить `.vsix` из [Releases](https://github.com/abdurakhmanov777/claude-ping/releases) (или собрать: `cd claude-ntfy-toggle && npm install && npm run package`).
2. Задать свой топик ntfy в настройках VS Code (`Ctrl+,` → «Claude ntfy») и подписаться на него в приложении ntfy на телефоне.
3. Добавить `Stop`-хук в `~/.claude/settings.json` (см. [README расширения](claude-ntfy-toggle/README.md#4-добавить-триггер-в-claude-code)).

## Лицензия

[MIT](claude-ntfy-toggle/LICENSE)
