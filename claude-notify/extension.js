const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

// Hooks in ~/.claude/settings.json append the project directory to these files
// when a Claude Code request finishes (Stop) or when Claude is waiting for the
// user (Notification). All notification logic lives here in the extension.
const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');

const DONE = 'done';
const WAITING = 'waiting';

const TRIGGERS = {};
TRIGGERS[DONE] = '.ntfy-trigger';
TRIGGERS[WAITING] = '.ntfy-trigger-waiting';

// Any hook command mentioning this belongs to us and may be replaced on setup.
const HOOK_MARKER = '.ntfy-trigger';

const REQUEST_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 3000;

// A single request can fire the hook more than once - e.g. while Claude Code
// sessions started before a hook change still run the previous hook. Collect
// such a burst for a moment and send once.
const DEBOUNCE_MS = 1000;

// kind -> { timer, project } for a send that is scheduled but not yet sent.
const pending = {};

// ntfy's JSON "priority" field is an integer 1..5; expose friendly names.
const PRIORITY_MAP = { min: 1, low: 2, default: 3, high: 4, max: 5 };

function cfg() {
  return vscode.workspace.getConfiguration('claudeNotify');
}

function isEnabled() {
  return cfg().get('enabled', true);
}

function triggerPath(kind) {
  return path.join(claudeDir, TRIGGERS[kind]);
}

function render(item) {
  if (isEnabled()) {
    item.text = '$(bell) Claude';
    item.tooltip = 'Уведомления на телефон включены. Нажмите, чтобы выключить.';
    item.color = undefined;
  } else {
    item.text = '$(bell-slash) Claude';
    item.tooltip = 'Уведомления на телефон выключены. Нажмите, чтобы включить.';
    item.color = new vscode.ThemeColor('disabledForeground');
  }
}

// Replace {project} in a title/message. When the project is unknown the
// placeholder collapses and any separator it left behind is tidied away, so
// "Claude Code · {project}" degrades to "Claude Code".
function applyPlaceholders(text, project) {
  const raw = String(text || '');
  const hadPlaceholder = /\{project\}/.test(raw);
  let out = raw.replace(/\{project\}/g, project || '');
  if (hadPlaceholder && !project) {
    out = out.replace(/\s*[-–—·:|,]+\s*$/, '').replace(/^\s*[-–—·:|,]+\s*/, '');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

// The hook appends the project directory; take the last one written.
function projectFromTrigger(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
  if (lines.length === 0) {
    return '';
  }
  return path.basename(lines[lines.length - 1].replace(/[\\/]+$/, ''));
}

// Publish via ntfy's JSON endpoint (POST to the server root with a JSON body).
// JSON body is UTF-8, so title and message keep Cyrillic intact - no
// HTTP-header encoding issues, no curl.
//
// Returns a Promise that resolves on a 2xx response and rejects otherwise
// (bad config, network error, timeout, or non-2xx status). Callers that only
// fire-and-forget can ignore the rejection with .catch(() => {}).
function sendNotification(kind, project) {
  return new Promise(function (resolve, reject) {
    const c = cfg();
    const topic = String(c.get('topic', '') || '').trim();
    if (!topic) {
      reject(new Error('no-topic'));
      return;
    }

    let server = String(c.get('server', 'https://ntfy.sh') || 'https://ntfy.sh').trim();
    if (!/\/$/.test(server)) {
      server += '/';
    }

    let url;
    try {
      url = new URL(server);
    } catch (e) {
      reject(new Error('bad-server'));
      return;
    }

    const rawMessage =
      kind === WAITING
        ? c.get('waitingMessage', 'Claude ждёт вашего разрешения')
        : c.get('message', 'Запрос в Claude Code завершён');

    const data = {
      topic: topic,
      title: applyPlaceholders(c.get('title', 'Claude Code · {project}'), project),
      message: applyPlaceholders(rawMessage, project),
    };

    const priorityName = String(c.get('priority', 'default') || 'default');
    if (PRIORITY_MAP[priorityName] && priorityName !== 'default') {
      data.priority = PRIORITY_MAP[priorityName];
    }

    const tags = String(c.get('tags', '') || '')
      .split(',')
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; });
    if (tags.length > 0) {
      data.tags = tags;
    }

    const click = String(c.get('click', '') || '').trim();
    if (click) {
      data.click = click;
    }

    const body = Buffer.from(JSON.stringify(data), 'utf8');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
    };

    const token = String(c.get('token', '') || '').trim();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const mod = url.protocol === 'http:' ? http : https;
    const options = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: url.pathname || '/',
      headers: headers,
    };

    const req = mod.request(options, function (res) {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      res.on('end', function () {
        if (ok) {
          resolve({ status: res.statusCode });
        } else {
          reject(new Error('http-' + res.statusCode));
        }
      });
    });
    req.on('error', function (err) { reject(err); });
    req.setTimeout(REQUEST_TIMEOUT_MS, function () {
      req.destroy(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

// Turn an error from sendNotification() into a short Russian explanation for
// the test command.
function describeError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (msg === 'no-topic') {
    return 'не задан топик (claudeNotify.topic).';
  }
  if (msg === 'bad-server') {
    return 'некорректный адрес сервера (claudeNotify.server).';
  }
  if (msg === 'timeout') {
    return 'сервер не ответил вовремя (таймаут).';
  }
  if (/^http-4\d\d$/.test(msg)) {
    return 'сервер отклонил запрос (' + msg.slice(5) + '). Проверьте топик и токен.';
  }
  if (/^http-5\d\d$/.test(msg)) {
    return 'ошибка на стороне сервера (' + msg.slice(5) + ').';
  }
  if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
    return 'не удалось найти сервер (нет сети или опечатка в адресе).';
  }
  if (err && err.code === 'ECONNREFUSED') {
    return 'сервер отказал в соединении.';
  }
  return 'сеть недоступна или сервер не отвечает.';
}

// Exactly-once across multiple VS Code windows: the first extension instance to
// atomically rename the trigger away "wins"; the others' rename fails. Returns
// the trigger's contents (the project dir the hook wrote), or null if another
// window claimed it first.
function claimTrigger(kind) {
  const tPath = triggerPath(kind);
  const claim =
    tPath + '.claim-' + process.pid + '-' + Math.random().toString(36).slice(2);
  try {
    fs.renameSync(tPath, claim);
  } catch (e) {
    return null; // already claimed by another window, or gone
  }
  let content = '';
  try {
    content = fs.readFileSync(claim, 'utf8');
  } catch (e) { /* unreadable - treat as unknown project */ }
  try {
    fs.unlinkSync(claim);
  } catch (e) { /* ignore */ }
  return content;
}

// Claiming the trigger only guarantees that a single *write* is handled once.
// Duplicate hooks (or several Claude Code sessions) can produce several writes,
// so the actual send is also gated by a marker file shared by all windows.
// Exclusive create is atomic across processes, so exactly one window wins.
function claimSendSlot(kind) {
  const seconds = Number(cfg().get('dedupeSeconds', 5));
  const windowMs = isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  if (windowMs === 0) {
    return true; // dedupe disabled
  }
  const marker = path.join(claudeDir, '.ntfy-dedupe-' + kind);
  try {
    const st = fs.statSync(marker);
    if (Date.now() - st.mtimeMs < windowMs) {
      return false; // another window just sent this kind
    }
    try { fs.unlinkSync(marker); } catch (e) { /* someone else recycled it */ }
  } catch (e) { /* no marker yet */ }
  try {
    fs.closeSync(fs.openSync(marker, 'wx'));
    return true;
  } catch (e) {
    return false; // lost the race to another window
  }
}

// Coalesce a burst of triggers into one notification. A project name learned
// from a later trigger wins over an earlier unknown one.
function scheduleSend(kind, project) {
  const existing = pending[kind];
  if (existing) {
    if (project && !existing.project) {
      existing.project = project;
    }
    return;
  }
  const entry = { project: project, timer: null };
  pending[kind] = entry;
  entry.timer = setTimeout(function () {
    delete pending[kind];
    if (!claimSendSlot(kind)) {
      return;
    }
    sendNotification(kind, entry.project).catch(function () {
      /* offline / bad config - stay silent */
    });
  }, DEBOUNCE_MS);
}

function handleTrigger(kind) {
  const content = claimTrigger(kind);
  if (content === null) {
    return;
  }
  if (!isEnabled()) {
    return;
  }
  if (kind === WAITING && !cfg().get('notifyOnWaiting', true)) {
    return;
  }
  scheduleSend(kind, projectFromTrigger(content));
}

// Watch ~/.claude for the trigger files. fs.watch is fast but can miss events
// or report a null filename on some platforms, and it throws if ~/.claude does
// not exist yet - so back it up with a low-frequency existence poll that also
// (re)establishes the watch once the directory appears.
function startWatching(context) {
  let watcher = null;
  const kinds = Object.keys(TRIGGERS);

  function tryWatch() {
    if (watcher) {
      return;
    }
    try {
      watcher = fs.watch(claudeDir, function (eventType, filename) {
        // filename can be null on some platforms - fall back to probing both.
        kinds.forEach(function (kind) {
          if (!filename || filename === TRIGGERS[kind]) {
            handleTrigger(kind);
          }
        });
      });
      watcher.on('error', function () {
        try { watcher.close(); } catch (e) { /* ignore */ }
        watcher = null;
      });
    } catch (e) {
      watcher = null; // directory missing - the poll will retry
    }
  }

  tryWatch();

  const poll = setInterval(function () {
    tryWatch();
    kinds.forEach(function (kind) {
      if (fs.existsSync(triggerPath(kind))) {
        handleTrigger(kind);
      }
    });
  }, POLL_INTERVAL_MS);

  context.subscriptions.push({
    dispose: function () {
      if (watcher) {
        try { watcher.close(); } catch (e) { /* ignore */ }
      }
      clearInterval(poll);
    },
  });
}

// --- Hook setup -------------------------------------------------------------

function hasBash() {
  const known = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (let i = 0; i < known.length; i++) {
    if (fs.existsSync(known[i])) {
      return true;
    }
  }
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .some(function (dir) {
      return dir && fs.existsSync(path.join(dir, 'bash.exe'));
    });
}

// Pick hook commands for this machine. Both variants append $CLAUDE_PROJECT_DIR
// so the extension can name the project in the push.
function hookCommands() {
  if (process.platform === 'win32' && !hasBash()) {
    return {
      shell: 'powershell',
      done:
        'Add-Content -Path "$env:USERPROFILE\\.claude\\' + TRIGGERS[DONE] +
        '" -Value $env:CLAUDE_PROJECT_DIR',
      waiting:
        'Add-Content -Path "$env:USERPROFILE\\.claude\\' + TRIGGERS[WAITING] +
        '" -Value $env:CLAUDE_PROJECT_DIR',
    };
  }
  return {
    shell: 'bash',
    done: 'echo "$CLAUDE_PROJECT_DIR" >> "$HOME/.claude/' + TRIGGERS[DONE] + '" || true',
    waiting:
      'echo "$CLAUDE_PROJECT_DIR" >> "$HOME/.claude/' + TRIGGERS[WAITING] + '" || true',
  };
}

// Drop our previous hooks for this event (keeping anyone else's, even inside a
// shared group) and append a fresh one.
function applyHook(hooks, event, shell, command) {
  const list = Array.isArray(hooks[event]) ? hooks[event] : [];
  const cleaned = [];
  list.forEach(function (group) {
    if (!group || !Array.isArray(group.hooks)) {
      cleaned.push(group);
      return;
    }
    const kept = group.hooks.filter(function (h) {
      return !(h && typeof h.command === 'string' && h.command.indexOf(HOOK_MARKER) !== -1);
    });
    if (kept.length > 0) {
      cleaned.push(Object.assign({}, group, { hooks: kept }));
    }
  });
  cleaned.push({
    hooks: [{ type: 'command', shell: shell, async: true, command: command }],
  });
  hooks[event] = cleaned;
}

function setupHooks() {
  let raw = '';
  let data = {};
  if (fs.existsSync(settingsPath)) {
    try {
      raw = fs.readFileSync(settingsPath, 'utf8');
    } catch (e) {
      vscode.window.showErrorMessage(
        'Claude Notify: не удалось прочитать ~/.claude/settings.json.'
      );
      return;
    }
    if (raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch (e) {
        vscode.window.showErrorMessage(
          'Claude Notify: в ~/.claude/settings.json невалидный JSON — исправьте его и повторите.'
        );
        return;
      }
    }
  } else {
    try {
      fs.mkdirSync(claudeDir, { recursive: true });
    } catch (e) { /* may already exist */ }
  }

  if (raw) {
    try {
      fs.writeFileSync(settingsPath + '.backup', raw, 'utf8');
    } catch (e) { /* backup is best-effort */ }
  }

  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    data.hooks = {};
  }
  const cmds = hookCommands();
  applyHook(data.hooks, 'Stop', cmds.shell, cmds.done);
  applyHook(data.hooks, 'Notification', cmds.shell, cmds.waiting);

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (e) {
    vscode.window.showErrorMessage(
      'Claude Notify: не удалось записать ~/.claude/settings.json.'
    );
    return;
  }

  vscode.window.showInformationMessage(
    'Claude Notify: хуки записаны в ~/.claude/settings.json (' + cmds.shell +
      '). Прежняя версия сохранена как settings.json.backup. ' +
      'Перезапустите сессию Claude Code, чтобы хуки применились.'
  );
}

// --- Activation -------------------------------------------------------------

function activate(context) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.name = 'Claude Notify';
  item.command = 'claudeNotify.toggle';
  render(item);
  item.show();
  context.subscriptions.push(item);

  // Drop any stale triggers left over from a session when no window was open.
  Object.keys(TRIGGERS).forEach(function (kind) {
    try {
      fs.unlinkSync(triggerPath(kind));
    } catch (e) { /* nothing to clean */ }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.toggle', async function () {
      const c = cfg();
      const now = c.get('enabled', true);
      await c.update('enabled', !now, vscode.ConfigurationTarget.Global);
      render(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.test', async function () {
      const topic = String(cfg().get('topic', '') || '').trim();
      if (!topic) {
        vscode.window.showWarningMessage(
          'Claude Notify: задайте топик в настройках (claudeNotify.topic), тогда уведомления заработают.'
        );
        return;
      }
      const folders = vscode.workspace.workspaceFolders;
      const project = folders && folders.length > 0 ? folders[0].name : '';
      try {
        await sendNotification(DONE, project);
        vscode.window.setStatusBarMessage(
          'Claude Notify: тестовое уведомление отправлено ✓',
          4000
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          'Claude Notify: не удалось отправить — ' + describeError(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.setupHook', function () {
      setupHooks();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function (e) {
      if (e.affectsConfiguration('claudeNotify')) {
        render(item);
      }
    })
  );

  context.subscriptions.push({
    dispose: function () {
      Object.keys(pending).forEach(function (kind) {
        clearTimeout(pending[kind].timer);
        delete pending[kind];
      });
    },
  });

  startWatching(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
