const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');

// The Stop hook in ~/.claude/settings.json just touches this file when a
// Claude Code request finishes. All ntfy logic lives here in the extension.
const claudeDir = path.join(os.homedir(), '.claude');
const triggerName = '.ntfy-trigger';
const triggerPath = path.join(claudeDir, triggerName);

const REQUEST_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 3000;

// ntfy's JSON "priority" field is an integer 1..5; expose friendly names.
const PRIORITY_MAP = { min: 1, low: 2, default: 3, high: 4, max: 5 };

function cfg() {
  return vscode.workspace.getConfiguration('claudeNtfy');
}

function isEnabled() {
  return cfg().get('enabled', true);
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

// Publish via ntfy's JSON endpoint (POST to the server root with a JSON body).
// JSON body is UTF-8, so title and message keep Cyrillic intact - no
// HTTP-header encoding issues, no curl.
//
// Returns a Promise that resolves on a 2xx response and rejects otherwise
// (bad config, network error, timeout, or non-2xx status). Callers that only
// fire-and-forget can ignore the rejection with .catch(() => {}).
function sendNotification() {
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

    const data = {
      topic: topic,
      title: String(c.get('title', 'Claude Code') || ''),
      message: String(c.get('message', 'Запрос в Claude Code завершён') || ''),
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
    return 'не задан топик (claudeNtfy.topic).';
  }
  if (msg === 'bad-server') {
    return 'некорректный адрес сервера (claudeNtfy.server).';
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
// atomically rename the trigger away "wins" and sends; the others' rename fails.
function handleTrigger() {
  const claim =
    triggerPath + '.claim-' + process.pid + '-' + Math.random().toString(36).slice(2);
  try {
    fs.renameSync(triggerPath, claim);
  } catch (e) {
    return; // already claimed by another window, or gone
  }
  try {
    fs.unlinkSync(claim);
  } catch (e) { /* ignore */ }
  if (isEnabled()) {
    sendNotification().catch(function () { /* offline / bad config - stay silent */ });
  }
}

// Watch ~/.claude for the trigger file. fs.watch is fast but can miss events or
// report a null filename on some platforms, and it throws if ~/.claude does not
// exist yet - so back it up with a low-frequency existence poll that also
// (re)establishes the watch once the directory appears.
function startWatching(context) {
  let watcher = null;

  function tryWatch() {
    if (watcher) {
      return;
    }
    try {
      watcher = fs.watch(claudeDir, function (eventType, filename) {
        // filename can be null on some platforms - fall back to a probe.
        if (!filename || filename === triggerName) {
          handleTrigger();
        }
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
    if (fs.existsSync(triggerPath)) {
      handleTrigger();
    }
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

function activate(context) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  item.name = 'Claude ntfy';
  item.command = 'claudeNtfy.toggle';
  render(item);
  item.show();
  context.subscriptions.push(item);

  // Drop any stale trigger left over from a session when no window was open.
  try {
    fs.unlinkSync(triggerPath);
  } catch (e) { /* nothing to clean */ }

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNtfy.toggle', async function () {
      const c = cfg();
      const now = c.get('enabled', true);
      await c.update('enabled', !now, vscode.ConfigurationTarget.Global);
      render(item);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNtfy.test', async function () {
      const topic = String(cfg().get('topic', '') || '').trim();
      if (!topic) {
        vscode.window.showWarningMessage(
          'Claude ntfy: задайте топик в настройках (claudeNtfy.topic), тогда уведомления заработают.'
        );
        return;
      }
      try {
        await sendNotification();
        vscode.window.setStatusBarMessage(
          'Claude ntfy: тестовое уведомление отправлено ✓',
          4000
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          'Claude ntfy: не удалось отправить — ' + describeError(err)
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(function (e) {
      if (e.affectsConfiguration('claudeNtfy')) {
        render(item);
      }
    })
  );

  startWatching(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
