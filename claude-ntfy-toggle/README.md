# Claude ntfy toggle

Уведомление на телефон, когда **запрос в Claude Code завершился**. В статус-баре VS Code — кнопка-переключатель, пуш приходит через бесплатный сервис [ntfy.sh](https://ntfy.sh) в приложение на Android/iOS.

Работает молча: клик по кнопке включает/выключает, ничего не всплывает. Кнопка показывает состояние иконкой: 🔔 - включено, 🔕 - выключено.

---

## Что понадобится

- **VS Code** (стабильный) и **Claude Code** (расширение/CLI) в нём.
- **Телефон** с приложением **ntfy** (Android: Google Play / F-Droid; iOS: App Store).
- Для хука на Windows проще всего **Git Bash** (ставится вместе с Git). Если Git Bash нет — ниже есть вариант хука на PowerShell. На macOS/Linux ничего доставлять не нужно.

---

## Установка - 5 шагов

### 1. Поставить расширение

**Способ А (VSIX, рекомендую):**
- Скачать готовый `claude-ntfy-toggle-<версия>.vsix` со страницы [Releases](https://github.com/abdurakhmanov777/claude-ping/releases).
- В VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → выбрать скачанный файл.
- Или из терминала: `code --install-extension claude-ntfy-toggle-<версия>.vsix`

**Способ Б (собрать самому):** в папке `claude-ntfy-toggle` выполнить `npm install && npm run package` — получится `.vsix`, который ставится как в способе А.

**Способ В (без VSIX):** распаковать/скопировать папку `claude-ntfy-toggle` в каталог расширений VS Code и перезапустить окно:
- Windows: `%USERPROFILE%\.vscode\extensions\`
- macOS/Linux: `~/.vscode/extensions/`

### 2. Задать свой топик и настройки

`Ctrl+,` → в поиске **Claude ntfy**. Заполнить **Claude Ntfy: Topic** - это ваше личное имя канала. Топики ntfy **публичные**, поэтому имя должно быть непредсказуемым. Сгенерировать можно так:

```bash
node -e "console.log('claude-'+require('crypto').randomBytes(8).toString('hex'))"
```

(или `openssl rand -hex 8`). Пример: `claude-9f2a7c14bb03de55`. Пока топик пустой, уведомления не отправляются.

Остальное по желанию: **Title** (заголовок), **Message** (текст), **Enabled** (вкл/выкл), **Server**, **Priority**, **Tags**, **Click**, **Token** — см. таблицу ниже.

### 3. Подписаться на телефоне

Открыть приложение **ntfy** → **+** (Subscribe to topic) → ввести **ровно тот же** топик, что и в настройках → Subscribe.

### 4. Добавить триггер в Claude Code

Расширение узнаёт о завершении запроса через хук Claude Code. Открыть файл настроек Claude Code `~/.claude/settings.json` (Windows: `C:\Users\<вы>\.claude\settings.json`) и добавить блок `hooks` (если блок уже есть - дописать объект в массив `Stop`).

**macOS / Linux / Windows с Git Bash:**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "async": true,
            "command": "echo >> \"$HOME/.claude/.ntfy-trigger\" || true"
          }
        ]
      }
    ]
  }
}
```

**Windows без Git Bash (PowerShell):**

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "async": true,
            "command": "Add-Content -Path \"$env:USERPROFILE\\.claude\\.ntfy-trigger\" -Value x"
          }
        ]
      }
    ]
  }
}
```

Хук просто «трогает» файл `~/.claude/.ntfy-trigger` - никаких данных об уведомлении в нём нет, всё остальное делает расширение.

### 5. Перезагрузить и проверить

- `Ctrl+Shift+P` → **Developer: Reload Window**.
- `Ctrl+Shift+P` → **Claude: отправить тестовое уведомление** - на телефон должен прийти пуш. Если что-то не так (неверный топик/токен, нет сети), расширение покажет причину.
- Дальше пуш будет приходить сам после каждого завершённого запроса Claude Code.

---

## Настройки

| Параметр | По умолчанию | Что это |
|---|---|---|
| `claudeNtfy.enabled` | `true` | Слать пуши или нет (то же, что кнопка в статус-баре). |
| `claudeNtfy.topic` | *(пусто)* | Ваш личный топик ntfy. Обязательно задать. |
| `claudeNtfy.title` | `Claude Code` | Заголовок уведомления. |
| `claudeNtfy.message` | `Запрос в Claude Code завершён` | Текст уведомления. |
| `claudeNtfy.server` | `https://ntfy.sh` | Сервер ntfy (можно свой self-hosted). |
| `claudeNtfy.token` | *(пусто)* | Bearer-токен для защищённых топиков на своём сервере. Для ntfy.sh не нужен. |
| `claudeNtfy.priority` | `default` | Приоритет пуша: `min`, `low`, `default`, `high`, `max`. |
| `claudeNtfy.tags` | *(пусто)* | Теги/эмодзи ntfy через запятую, напр. `white_check_mark,robot`. [Список эмодзи](https://docs.ntfy.sh/emojis/). |
| `claudeNtfy.click` | *(пусто)* | URL, открывающийся при тапе по уведомлению. |

Команды (палитра `Ctrl+Shift+P`): **Claude: переключить уведомления на телефон**, **Claude: отправить тестовое уведомление**.

---

## Как это устроено

- **Хук Claude Code** (`Stop`) при завершении запроса дописывает файл `~/.claude/.ntfy-trigger`. Только Claude Code знает момент завершения, поэтому этот однострочный триггер обязателен.
- **Расширение** следит за `~/.claude` (плюс резервный опрос на случай пропущенного события) и при появлении триггера шлёт пуш на ntfy (Node `https`, JSON-публикация - корректный UTF-8 в заголовке и тексте). При нескольких открытых окнах VS Code триггер «захватывается» атомарно, так что пуш уходит ровно один раз.
- Кнопка в статус-баре переключает настройку `claudeNtfy.enabled`.

## Приватность и ограничения

- Пуш уходит, только когда открыт VS Code с расширением (для работы в Claude Code это всегда так).
- Топик ntfy **публичный**: кто знает имя - может читать и слать в него. Держите имя случайным. Для приватности поднимите свой ntfy-сервер, укажите его в `claudeNtfy.server` и задайте `claudeNtfy.token`.
- Расширение работает на Windows/macOS/Linux. Хуку на Windows нужен Git Bash **или** вариант на PowerShell (см. шаг 4).

## Сборка из исходников

```bash
cd claude-ntfy-toggle
npm install
npm run lint      # проверка кода (необязательно)
npm run package   # -> claude-ntfy-toggle-<версия>.vsix
```

## Удаление

- Расширение: `Ctrl+Shift+X` → найти «Claude ntfy» → Uninstall (или `code --uninstall-extension local.claude-ntfy-toggle`).
- Убрать блок `hooks` из `~/.claude/settings.json`.
