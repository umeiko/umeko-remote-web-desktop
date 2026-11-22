'use strict';
const $ = (id) => document.getElementById(id);
const base = location.pathname.replace(/\/+$/, '');
let identity = null, expires = 0, client = null, keyboard = null, noticeTimer;
let pointerCleanup = [], desktop = null, attempt = null, keySelection = 0;
const show = (id, visible = true) => { $(id).hidden = !visible; };
function notice(message) { $('notice').textContent = message; show('notice'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => show('notice', false), 6500); }
async function api(path, data) {
  const response = await fetch(`${base}/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  if (response.status === 401 && path !== 'verify') signedOut();
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || '连接失败，请稍后再试'), { status: response.status });
  return value;
}
function signedOut() {
  expires = 0; disconnectDesktop(); window.UmekoWorkspace?.reset();
  show('loading', false); show('workspace', false); show('login');
  $('desktop-login').close(); $('clipboard-dialog').close();
}
function elapsed(seconds) {
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? `${days} 天 ` : ''}${hours} 小时 ${minutes} 分钟`;
}
async function refresh() {
  try {
    const value = await api('status');
    expires = value.expires;
    show('loading', false); show('login', false); show('workspace');
    const { device } = value;
    $('device-name').textContent = device.name;
    $('device-host').textContent = device.online ? `${device.status?.hostname || '已建立安全连接'} · ${device.status?.platform || '正在获取系统信息'}` : '连接器离线';
    $('online-badge').textContent = device.online ? '● 在线' : '○ 离线';
    $('online-badge').classList.toggle('online', device.online);
    $('uptime').textContent = device.status ? elapsed(device.status.uptime) : '—';
    $('ssh-state').textContent = device.online ? (device.status?.ssh ? '可连接' : '等待服务') : '—';
    $('rdp-state').textContent = device.online ? (device.status?.rdp ? '可连接' : '等待服务') : '—';
    $('last-seen').textContent = device.online ? '刚刚' : device.lastSeen ? new Date(device.lastSeen).toLocaleString('zh-CN', { hour12: false }) : '尚未连接';
    $('offline-note').textContent = device.online ? '仅在本机连接器运行时允许远程访问。关闭连接器将断开桌面与 SSH 隧道。' : '离线可能是电脑关机、断网或连接器未启动。请提前在本机启动 Umeko 远程连接器。';
    $('connect-desktop').disabled = !device.online || !device.status?.rdp;
    UmekoWorkspace.setAvailable(value.webTools && device.online && device.status?.ssh);
    $('session-time').textContent = `登录有效至 ${new Date(expires).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    if (!expires) signedOut();
    else { $('online-badge').textContent = '状态暂不可用'; $('online-badge').classList.remove('online'); $('connect-desktop').disabled = true; UmekoWorkspace.setAvailable(false); }
  }
}
$('identity').addEventListener('change', async (event) => {
  const selection = ++keySelection;
  identity = null; $('login-button').disabled = true;
  $('file-name').textContent = '选择 .umeko-key 密钥文件';
  $('login-button').textContent = '选择密钥后安全登录';
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 8192) throw new Error('密钥文件过大');
    const value = JSON.parse(await file.text());
    if (value.version !== 1 || typeof value.keyId !== 'string' || typeof value.privateKey !== 'string') throw new Error('请选择有效的 .umeko-key 密钥文件');
    const bytes = Uint8Array.from(atob(value.privateKey), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'Ed25519' }, false, ['sign']);
    bytes.fill(0);
    if (selection !== keySelection) return;
    identity = { keyId: value.keyId, key };
    $('file-name').textContent = file.name;
    $('login-button').textContent = '安全登录 ↗'; $('login-button').disabled = false;
  } catch (error) { if (selection === keySelection) notice(error.message || '无法读取密钥，请使用新版浏览器'); }
});
$('login-button').addEventListener('click', async () => {
  if (!identity) return;
  $('login-button').disabled = true; $('login-button').textContent = '正在验证签名…';
  try {
    const { id, challenge } = await api('challenge', { role: 'admin', keyId: identity.keyId });
    const bytes = new Uint8Array(await crypto.subtle.sign('Ed25519', identity.key, new TextEncoder().encode(challenge)));
    const signature = btoa(String.fromCharCode(...bytes));
    await api('verify', { id, signature });
    identity = null; $('file-name').textContent = '选择 .umeko-key 密钥文件';
    await refresh();
  } catch (error) { notice(error.message); }
  finally { $('login-button').disabled = !identity; $('login-button').textContent = identity ? '重新验证密钥 ↗' : '选择密钥后安全登录'; }
});
$('logout').addEventListener('click', async () => { try { await api('logout', {}); signedOut(); } catch (error) { notice(error.message); } });
$('show-ssh').addEventListener('click', () => { show('ssh-panel'); $('ssh-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
$('close-ssh').addEventListener('click', () => show('ssh-panel', false));
$('ssh-command').textContent = `node umeko-remote.mjs --identity ./admin.umeko-key --url ${location.origin}${base}`;
$('copy-command').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('ssh-command').textContent); notice('连接命令已复制'); } catch { notice('请手动选中并复制命令'); } });
$('connect-desktop').addEventListener('click', () => $('desktop-login').showModal());
$('cancel-desktop').addEventListener('click', () => { $('desktop-password').value = ''; $('desktop-login').close(); });
$('desktop-login').addEventListener('close', () => { $('desktop-password').value = ''; });

const retryDelays = [1000, 2400, 5000, 9500, 15000];
const desktopUrl = `${location.origin.replace(/^http/, 'ws')}${base}/ws/desktop`;
const desktopState = (message) => { $('desktop-state').textContent = message; };

function releaseConnection() {
  if (attempt) attempt.password = '';
  attempt = null;
  for (const dispose of pointerCleanup) dispose();
  pointerCleanup = [];
  keyboard?.reset();
  if (client) {
    client.onstatechange = null;
    client.onerror = null;
    client.disconnect();
    client = null;
  }
}

function disconnectDesktop() {
  if (desktop) {
    clearTimeout(desktop.timer);
    desktop.password = '';
    desktop = null;
  }
  releaseConnection();
  $('display').replaceChildren();
  $('desktop-latency').textContent = '—';
  $('desktop-bitrate').textContent = '—';
  $('desktop-resolution').textContent = '—';
  show('desktop-retry', false);
  show('desktop-view', false);
  document.body.classList.remove('remote-open');
  $('workspace').inert = false;
  $('mobile-input').classList.remove('open'); show('send-mobile', false);
  if (document.fullscreenElement === $('desktop-view')) document.exitFullscreen().catch(() => {});
}

function scaleDesktop() {
  if (!client) return;
  const display = client.getDisplay(), region = $('display');
  const width = display.getWidth(), height = display.getHeight();
  if (!width || !height) return;
  $('desktop-resolution').textContent = `${width} × ${height}`;
  display.scale(Math.min(region.clientWidth / width, region.clientHeight / height));
}

function requestDesktopSize(context) {
  const { width, height } = UmekoRemoteDesktop.dimensions(context.viewport, context.mode, context.tier);
  client?.sendSize(width, height);
}

function endAttempt(current, message, retryable = true) {
  if (attempt !== current) return;
  const context = current.context;
  releaseConnection();
  $('desktop-latency').textContent = '—';
  $('desktop-bitrate').textContent = '—';
  if (desktop !== context) return;
  if (current.connectedAt && performance.now() - current.connectedAt > 30000) context.retries = 0;
  if (context.auto && retryable && context.retries < retryDelays.length && Date.now() < expires) {
    const delay = retryDelays[context.retries++];
    if (context.mode === 'auto') context.tier = Math.min(3, context.tier + 1);
    desktopState(`${message} · ${Math.ceil(delay / 1000)} 秒后重连（${context.retries}/${retryDelays.length}）`);
    context.timer = setTimeout(() => openDesktop(context), delay);
  } else {
    context.password = '';
    desktopState(message);
    show('desktop-retry');
  }
}

async function openDesktop(context) {
  if (desktop !== context) return;
  if (context.retries && document.hidden) {
    desktopState('返回此页面后继续重连');
    context.waiting = true;
    return;
  }
  context.waiting = false;
  const current = { context, connectedAt: 0, password: context.password };
  attempt = current;
  desktopState(context.retries ? '正在重新连接本机桌面…' : '正在连接…');
  try {
    const size = UmekoRemoteDesktop.dimensions(context.viewport, context.mode, context.tier);
    const { ticket } = await api('desktop-ticket', { ...size, username: context.username, password: context.password });
    if (!context.auto) context.password = '';
    if (attempt !== current) return;
    const tunnel = UmekoRemoteDesktop.createTunnel({
      url: desktopUrl, ticket,
      onClosed: (code, hint) => endAttempt(current, hint || '桌面连接已断开', code !== 1008),
      onStats: (stats) => {
        if (attempt !== current) return;
        $('desktop-latency').textContent = stats.rtt === null || stats.pingAge > 10000 ? '—' : `${stats.rtt} ms`;
        $('desktop-bitrate').textContent = stats.bitrate >= 1000000
          ? `${(stats.bitrate / 1000000).toFixed(2)} Mb/s` : `${Math.round(stats.bitrate / 1000)} kb/s`;
        if (context.mode !== 'auto' || !current.connectedAt) return;
        const tier = current.adaptive.sample(stats, performance.now());
        if (tier !== null) { context.tier = tier; requestDesktopSize(context); }
      },
    });
    current.adaptive = UmekoRemoteDesktop.adaptiveState(context.tier);
    const desktopClient = new Guacamole.Client(tunnel);
    client = desktopClient;
    $('display').replaceChildren(desktopClient.getDisplay().getElement());
    desktopClient.getDisplay().onresize = scaleDesktop;
    desktopClient.onerror = (status) => {
      const retryable = ![Guacamole.Status.Code.CLIENT_UNAUTHORIZED, Guacamole.Status.Code.CLIENT_FORBIDDEN,
        Guacamole.Status.Code.CLIENT_BAD_REQUEST].includes(status.code);
      endAttempt(current, status.message || '桌面连接失败', retryable);
    };
    desktopClient.onstatechange = (state) => {
      if (state === Guacamole.Client.State.CONNECTED) {
        current.connectedAt = performance.now();
        current.password = '';
        desktopState('已连接');
        scaleDesktop();
        if (!$('desktop-view').inert) $('display').focus();
      } else if (state === Guacamole.Client.State.DISCONNECTED) {
        // A protocol error may report its reason immediately after this event.
        queueMicrotask(() => endAttempt(current, '桌面连接已断开'));
      }
    };
    desktopClient.onrequired = (parameters) => {
      const password = context.password || current.password;
      desktopState(password ? '正在验证本机账号…' : '正在打开系统登录界面…');
      for (const name of parameters) {
        if (!['username', 'password', 'domain'].includes(name)) { notice('桌面网关请求了不支持的连接参数'); continue; }
        const writer = new Guacamole.StringWriter(desktopClient.createArgumentValueStream('text/plain', name));
        writer.sendText(name === 'password' ? password : name === 'username' && password ? context.username : '');
        writer.sendEnd();
      }
    };
    if (!keyboard) {
      keyboard = new Guacamole.Keyboard($('display'));
      keyboard.onkeydown = (keysym) => { client?.sendKeyEvent(1, keysym); return false; };
      keyboard.onkeyup = (keysym) => { client?.sendKeyEvent(0, keysym); };
    }
    const element = desktopClient.getDisplay().getElement();
    pointerCleanup = [new Guacamole.Mouse(element), new Guacamole.Mouse.Touchscreen(element)]
      .map((source) => UmekoRemoteInput.bindPointer(source, desktopClient, () => $('display').focus()));
    desktopClient.onclipboard = (stream, type) => {
      if (type !== 'text/plain') { stream.sendAck('Only text is supported', 256); return; }
      const reader = new Guacamole.StringReader(stream); let content = '';
      reader.ontext = (text) => { if (content.length + text.length <= 32768) content += text; };
      reader.onend = () => { if (attempt === current) $('clipboard-text').value = content; };
    };
    desktopClient.connect();
  } catch (error) {
    const retryable = !error.status || error.status === 409 || error.status >= 500;
    endAttempt(current, error.message || '无法打开远程桌面', retryable);
  }
}

$('desktop-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const context = {
    username: $('desktop-user').value, password: $('desktop-password').value,
    auto: $('desktop-auto').checked, mode: $('desktop-quality').value, tier: 0, retries: 0,
    viewport: { width: innerWidth, height: innerHeight - 85 },
  };
  $('desktop-password').value = '';
  $('desktop-login').close();
  disconnectDesktop(); show('desktop-view');
  desktop = context;
  document.body.classList.add('remote-open'); $('workspace').inert = true;
  openDesktop(context);
});
$('desktop-retry').addEventListener('click', () => $('desktop-login').showModal());
$('desktop-quality').addEventListener('change', () => {
  if (!desktop) return;
  desktop.mode = $('desktop-quality').value;
  desktop.tier = 0;
  if (attempt) attempt.adaptive = UmekoRemoteDesktop.adaptiveState();
  requestDesktopSize(desktop);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && desktop?.waiting) openDesktop(desktop);
});
$('desktop-disconnect').addEventListener('click', disconnectDesktop);
$('desktop-fullscreen').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $('desktop-view').requestFullscreen().catch(() => notice('浏览器不支持全屏')); });
$('desktop-ctrl-alt-del').addEventListener('click', () => { for (const code of [0xffe3, 0xffe9, 0xffff]) client?.sendKeyEvent(1, code); for (const code of [0xffff, 0xffe9, 0xffe3]) client?.sendKeyEvent(0, code); });
$('display').addEventListener('blur', () => keyboard?.reset());
window.addEventListener('blur', () => keyboard?.reset());
window.addEventListener('resize', scaleDesktop);
document.addEventListener('fullscreenchange', scaleDesktop);
$('desktop-ime').addEventListener('click', () => {
  keyboard?.reset();
  for (const code of [0xffe3, 0x20]) client?.sendKeyEvent(1, code);
  for (const code of [0x20, 0xffe3]) client?.sendKeyEvent(0, code);
  $('display').focus();
});
$('desktop-keyboard').addEventListener('click', () => { const open = $('mobile-input').classList.toggle('open'); show('send-mobile', open); if (open) $('mobile-input').focus(); scaleDesktop(); });
$('send-mobile').addEventListener('click', () => {
  if (!client) return;
  for (const character of $('mobile-input').value) {
    const point = character.codePointAt(0), keysym = point === 10 ? 0xff0d : point <= 255 ? point : 0x01000000 | point;
    client.sendKeyEvent(1, keysym); client.sendKeyEvent(0, keysym);
  }
  $('mobile-input').value = '';
});
$('desktop-clipboard').addEventListener('click', () => $('clipboard-dialog').showModal());
$('close-clipboard').addEventListener('click', () => $('clipboard-dialog').close());
$('clipboard-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (client) { const writer = new Guacamole.StringWriter(client.createClipboardStream('text/plain')); writer.sendText($('clipboard-text').value); writer.sendEnd(); }
  $('clipboard-dialog').close(); $('display').focus();
});
window.addEventListener('pagehide', () => { identity = null; disconnectDesktop(); });
refresh();
setInterval(() => { if (expires && Date.now() >= expires) { signedOut(); notice('登录已到期，请重新使用密钥登录'); } else if (expires) refresh(); }, 10000);
