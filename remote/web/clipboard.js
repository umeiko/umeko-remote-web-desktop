'use strict';
(() => {
  const type = 'text/plain';
  const maxBytes = 262143;
  const encoder = new TextEncoder();

  function bind({ display, client, ready, resetKeys, showText, notice }) {
    const apple = /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform || navigator.platform);
    const systemClipboard = navigator.clipboard;
    const events = new AbortController();
    const capture = { capture: true, signal: events.signal };
    const active = () => ready() && !document.hidden && document.hasFocus() && display.contains(document.activeElement);
    let pendingCopy, pasteWithShift = false, knownText, revision = 0;

    function send(text) {
      if (!ready()) return false;
      // CLIPRDR converts the text to UTF-16 using an equally sized buffer.
      if (text.includes('\0') || encoder.encode(text).length > maxBytes || text.length * 2 + 2 > maxBytes) {
        notice('这段文字超出远程剪贴板支持的范围');
        return false;
      }
      revision++;
      knownText = text;
      const writer = new Guacamole.StringWriter(client.createClipboardStream(type));
      writer.sendText(text);
      writer.sendEnd();
      return true;
    }

    function shortcut(key, shift) {
      resetKeys();
      client.sendKeyEvent(1, 0xffe3);
      if (shift) client.sendKeyEvent(1, 0xffe1);
      client.sendKeyEvent(1, key);
      client.sendKeyEvent(0, key);
      if (shift) client.sendKeyEvent(0, 0xffe1);
      client.sendKeyEvent(0, 0xffe3);
    }

    function finishCopy(text) {
      if (!pendingCopy) return;
      const { timer, resolve, reject } = pendingCopy;
      pendingCopy = null;
      clearTimeout(timer);
      if (text !== undefined) resolve(new Blob([text], { type }));
      else reject(new Error('Remote copy ended without text'));
    }

    function awaitRemoteCopy() {
      finishCopy();
      revision++;
      if (!globalThis.ClipboardItem || !systemClipboard?.write) return;
      // Start the system write during the key gesture. The RDP reply can arrive later.
      const content = new Promise((resolve, reject) => {
        pendingCopy = { resolve, reject, timer: setTimeout(() => finishCopy(), 4000) };
      });
      const request = pendingCopy;
      content.catch(() => {});
      try {
        systemClipboard.write([new ClipboardItem({ [type]: content })]).catch(() => {
          if (pendingCopy === request) finishCopy();
        });
      } catch {
        finishCopy();
      }
    }

    document.addEventListener('keydown', (event) => {
      if (!active() || !event.isTrusted || event.defaultPrevented || event.isComposing || event.altKey) return;
      if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      event.stopImmediatePropagation();
      if (key === 'v' && !event.repeat) {
        // Let the browser deliver its trusted paste event with the current text.
        pasteWithShift = event.shiftKey;
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      awaitRemoteCopy();
      shortcut(0x63, event.shiftKey);
    }, capture);

    document.addEventListener('keyup', (event) => {
      if (event.key.toLowerCase() === 'v') pasteWithShift = false;
    }, capture);

    document.addEventListener('paste', (event) => {
      if (!active() || !event.isTrusted) return;
      event.preventDefault();
      const text = event.clipboardData?.getData(type);
      if (text && send(text)) shortcut(0x76, pasteWithShift);
      pasteWithShift = false;
    }, capture);

    async function syncOnFocus() {
      if (!active() || pendingCopy || !systemClipboard?.readText) return;
      const before = revision;
      try {
        // Paste events work without this permission. A granted permission also
        // lets remote context-menu Paste work after returning to the desktop.
        const permission = await navigator.permissions?.query({ name: 'clipboard-read' });
        if (permission?.state !== 'granted' || !active() || revision !== before) return;
        const text = await systemClipboard.readText();
        if (text && text !== knownText && revision === before && active()) send(text);
      } catch { /* Browsers are allowed to deny programmatic reads. */ }
    }
    display.addEventListener('focus', syncOnFocus, { signal: events.signal });
    window.addEventListener('focus', syncOnFocus, { signal: events.signal });

    client.onclipboard = (stream, mime) => {
      if (mime !== type) { stream.sendAck('Only text is supported', 256); return; }
      const reader = new Guacamole.StringReader(stream);
      let content = '', tooLarge = false;
      reader.ontext = (text) => {
        if (tooLarge || content.length + text.length > maxBytes) { tooLarge = true; return; }
        content += text;
      };
      reader.onend = () => {
        if (!ready() || tooLarge || encoder.encode(content).length > maxBytes) return;
        revision++;
        const changed = content !== knownText;
        knownText = content;
        showText(content);
        if (pendingCopy) finishCopy(content || undefined);
        else if (changed && content && active()) systemClipboard?.writeText?.(content).catch(() => {});
      };
    };

    return { send, close() { events.abort(); finishCopy(); client.onclipboard = null; } };
  }

  globalThis.UmekoRemoteClipboard = { bind };
})();
