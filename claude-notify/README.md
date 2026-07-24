# Claude Notify

Уведомление на телефон, когда **запрос в Claude Code завершился** — и когда **Claude ждёт вашего разрешения**. В статус-баре VS Code — кнопка-переключатель, пуш приходит через бесплатный сервис [ntfy.sh](https://ntfy.sh) в приложение на Android/iOS.

В уведомлении видно, **какой проект** доработал — удобно, когда открыто несколько окон.

Работает молча: клик по кнопке включает/выключает, ничего не всплывает. Кнопка показывает состояние иконкой: 🔔 - включено, 🔕 - выключено.

---

## Что понадобится

- **VS Code** (стабильный) и **Claude Code** (расширение/CLI) в нём.
- **Телефон** с приложением **ntfy** (Android: Google Play / F-Droid; iOS: App Store).
- Для хуков на Windows проще всего **Git Bash** (ставится вместе с Git). Если его нет, расширение само подставит вариант на PowerShell. На macOS/Linux ничего доставлять не нужно.

---

## Установка - 5 шагов

### 1. Поставить расширение

**Способ А (VSIX, рекомендую):**
- Скачать готовый `claude-notify-<версия>.vsix` со страницы [Releases](https://github.com/abdurakhmanov777/claude-notify/releases).
- В VS Code: `Ctrl+Shift+P` → **Extensions: Install from VSIX...** → выбрать скачанный файл.
- Или из терминала: `code --install-extension claude-notify-<версия>.vsix`

**Способ Б (собрать самому):** в папке `claude-notify` выполнить `npm install && npm run package` — получится `.vsix`, который ставится как в способе А.

**Способ В (без VSIX):** распаковать/скопировать папку `claude-notify` в каталог расширений VS Code и перезапустить окно:
- Windows: `%USERPROFILE%\.vscode\extensions\`
- macOS/Linux: `~/.vscode/extensions/`

### 2. Задать свой топик и настройки

`Ctrl+,` → в поиске **Claude Notify**. Заполнить **Claude Notify: Topic** - это ваше личное имя канала. Топики ntfy **публичные**, поэтому имя должно быть непредсказуемым. Сгенерировать можно так:

```bash
node -e "console.log('claude-'+require('crypto').randomBytes(8).toString('hex'))"
```

(или `openssl rand -hex 8`). Пример: `claude-9f2a7c14bb03de55`. Пока топик пустой, уведомления не отправляются.

Остальное по желанию — см. таблицу настроек ниже.

### 3. Подписаться на телефоне

Открыть приложение **ntfy** → **+** (Subscribe to topic) → ввести **ровно тот же** топик, что и в настройках → Subscribe.

### 4. Настроить хуки Claude Code

Расширение узнаёт о событиях через хуки Claude Code. Проще всего — **одной командой**:

`Ctrl+Shift+P` → **Claude Notify: настроить хуки Claude Code**

Команда сама впишет оба хука в `~/.claude/settings.json`, сохранит прежнюю версию файла как `settings.json.backup`, не тронет ваши другие хуки и выберет `bash` или `powershell` под вашу систему. После неё **перезапустите сессию Claude Code**, чтобы хуки применились.

<details>
<summary>Вручную (если хочется контролировать самому)</summary>

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
            "command": "echo \"$CLAUDE_PROJECT_DIR\" >> \"$HOME/.claude/.ntfy-trigger\" || true"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "async": true,
            "command": "echo \"$CLAUDE_PROJECT_DIR\" >> \"$HOME/.claude/.ntfy-trigger-waiting\" || true"
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
            "command": "Add-Content -Path \"$env:USERPROFILE\\.claude\\.ntfy-trigger\" -Value $env:CLAUDE_PROJECT_DIR"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "powershell",
            "async": true,
            "command": "Add-Content -Path \"$env:USERPROFILE\\.claude\\.ntfy-trigger-waiting\" -Value $env:CLAUDE_PROJECT_DIR"
          }
        ]
      }
    ]
  }
}
```

Хук дописывает в файл-триггер только путь проекта (`$CLAUDE_PROJECT_DIR`) — по нему расширение подставляет имя проекта в уведомление. Хук `Notification` нужен только для пушей «Claude ждёт разрешения»; без него всё остальное работает.

</details>

### 5. Перезагрузить и проверить

- `Ctrl+Shift+P` → **Developer: Reload Window**.
- `Ctrl+Shift+P` → **Claude Notify: отправить тестовое уведомление** - на телефон должен прийти пуш. Если что-то не так (неверный топик/токен, нет сети), расширение покажет причину.
- Дальше пуш будет приходить сам после каждого завершённого запроса Claude Code.

---

## Настройки

| Параметр | По умолчанию | Что это |
|---|---|---|
| `claudeNotify.enabled` | `true` | Слать пуши или нет (то же, что кнопка в статус-баре). |
| `claudeNotify.topic` | *(пусто)* | Ваш личный топик ntfy. Обязательно задать. |
| `claudeNotify.title` | `Claude Code · {project}` | Заголовок уведомления. `{project}` - имя папки проекта. |
| `claudeNotify.message` | `Запрос в Claude Code завершён` | Текст уведомления о завершении. Поддерживает `{project}`. |
| `claudeNotify.notifyOnWaiting` | `true` | Слать отдельный пуш, когда Claude ждёт ответа/разрешения (нужен хук `Notification`). |
| `claudeNotify.waitingMessage` | `Claude ждёт вашего разрешения` | Текст такого уведомления. Поддерживает `{project}`. |
| `claudeNotify.dedupeSeconds` | `5` | Защита от дублей: в это окно (сек.) одинаковый пуш уходит один раз, даже если хук сработал несколько раз или открыто несколько окон. `0` - выключить. |
| `claudeNotify.server` | `https://ntfy.sh` | Сервер ntfy (можно свой self-hosted). |
| `claudeNotify.token` | *(пусто)* | Bearer-токен для защищённых топиков на своём сервере. Для ntfy.sh не нужен. |
| `claudeNotify.priority` | `default` | Приоритет пуша: `min`, `low`, `default`, `high`, `max`. |
| `claudeNotify.tags` | *(пусто)* | Теги/эмодзи ntfy через запятую, напр. `white_check_mark,robot`. [Список эмодзи](https://docs.ntfy.sh/emojis/). |
| `claudeNotify.click` | *(пусто)* | URL, открывающийся при тапе по уведомлению. |

### Подстановка `{project}`

`{project}` в заголовке и тексте заменяется на имя папки проекта, в котором работал Claude Code. Если проект неизвестен (например, хук ещё старой версии), подстановка убирается вместе с повисшим разделителем: `Claude Code · {project}` → `Claude Code`.

### Команды

Палитра `Ctrl+Shift+P`:
- **Claude Notify: переключить уведомления на телефон**
- **Claude Notify: отправить тестовое уведомление**
- **Claude Notify: настроить хуки Claude Code**

---

## Как это устроено

- **Хуки Claude Code** дописывают путь проекта в файлы-триггеры: `Stop` → `~/.claude/.ntfy-trigger` (запрос завершён), `Notification` → `~/.claude/.ntfy-trigger-waiting` (Claude ждёт ответа). Только Claude Code знает эти моменты, поэтому хуки обязательны.
- **Расширение** следит за `~/.claude` (плюс резервный опрос на случай пропущенного события) и при появлении триггера читает из него проект и шлёт пуш на ntfy (Node `https`, JSON-публикация - корректный UTF-8 в заголовке и тексте). При нескольких открытых окнах VS Code триггер «захватывается» атомарно, так что пуш уходит ровно один раз.
- Кнопка в статус-баре переключает настройку `claudeNotify.enabled`.

## Приватность и ограничения

- Пуш уходит, только когда открыт VS Code с расширением (для работы в Claude Code это всегда так).
- Топик ntfy **публичный**: кто знает имя - может читать и слать в него. Держите имя случайным. Для приватности поднимите свой ntfy-сервер, укажите его в `claudeNotify.server` и задайте `claudeNotify.token`.
- В триггер попадает только путь проекта — ни кода, ни текста переписки с Claude.
- Расширение работает на Windows/macOS/Linux.

## Сборка из исходников

```bash
cd claude-notify
npm install
npm run lint      # проверка кода (необязательно)
npm run package   # -> claude-notify-<версия>.vsix
```

## Удаление

- Расширение: `Ctrl+Shift+X` → найти «Claude Notify» → Uninstall (или `code --uninstall-extension local.claude-notify`).
- Убрать блок `hooks` из `~/.claude/settings.json`.
