'use strict';
(() => {
  const encoder = new TextEncoder();
  const ratios = [1, 0.82, 0.66, 0.52];

  function dimensions(viewport, mode, tier = 0) {
    const width = Math.max(1024, Math.min(1600, viewport.width));
    const height = Math.max(640, Math.min(1000, viewport.height));
    const scale = mode === 'low' ? ratios[2] : mode === 'high' ? 1 : ratios[tier];
    return {
      width: Math.max(640, Math.floor(width * scale / 4) * 4),
      height: Math.max(480, Math.floor(height * scale / 4) * 4),
    };
  }

  function adaptiveState(tier = 0) {
    let pressure = 0, clear = 0, changed = -Infinity, bestRtt = Infinity;
    return {
      sample(stats, now) {
        if (stats.rtt !== null) bestRtt = Math.min(bestRtt, stats.rtt);
        const congested = stats.queued >= 384 * 1024 || stats.renderDelay > 500 ||
          stats.pingAge > 8500 || (stats.rtt !== null && stats.rtt > Math.max(520, bestRtt * 2.7));
        const quiet = stats.queued < 64 * 1024 && stats.renderDelay < 170 && stats.pingAge < 4800 &&
          stats.rtt !== null && stats.rtt < Math.max(320, bestRtt * 1.55);
        pressure = congested ? pressure + 1 : 0;
        clear = quiet ? clear + 1 : 0;
        if (pressure >= 3 && tier < ratios.length - 1 && now - changed > 10000) {
          changed = now; pressure = 0; clear = 0;
          return ++tier;
        }
        if (clear >= 15 && tier > 0 && now - changed > 45000) {
          changed = now; pressure = 0; clear = 0;
          return --tier;
        }
        return null;
      },
    };
  }

  function createTunnel({ url, ticket, onClosed, onStats }) {
    const tunnel = new Guacamole.Tunnel();
    let socket, timer, intentional = false, closeHint;
    let lastReceived = 0, sampleAt = 0, lastPing = 0, lastPong = 0, bytes = 0;
    let rtt = null, queued = 0, paintDelay = 0;
    const pendingPaint = new Map(), pings = new Map();

    tunnel.connect = () => {
      tunnel.setState(Guacamole.Tunnel.State.CONNECTING);
      const parser = new Guacamole.Parser();
      parser.oninstruction = (opcode, args) => {
        if (tunnel.state === Guacamole.Tunnel.State.CONNECTING) {
          if (opcode === '' && args.length === 1) tunnel.setUUID(args[0]);
          tunnel.setState(Guacamole.Tunnel.State.OPEN);
        }
        if (opcode === 'sync' && pendingPaint.size < 128) pendingPaint.set(args[0], performance.now());
        if (opcode !== '') tunnel.oninstruction?.(opcode, args);
      };
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        socket.send(JSON.stringify({ ticket, telemetry: true }));
        lastReceived = sampleAt = lastPong = performance.now();
        timer = setInterval(() => {
          const now = performance.now();
          if (!document.hidden && now - lastReceived > 52000) {
            closeHint = '桌面响应超时';
            socket.close();
            return;
          }
          if (tunnel.state !== Guacamole.Tunnel.State.OPEN || document.hidden) return;
          if (now - lastPing >= 3000) {
            const stamp = String(Math.round(now));
            pings.set(stamp, now);
            for (const [key, sent] of pings) if (now - sent > 30000) pings.delete(key);
            tunnel.sendMessage('', 'ping', stamp);
            lastPing = now;
          }
          const oldest = pendingPaint.values().next().value;
          onStats({ rtt, bitrate: bytes * 8000 / Math.max(1, now - sampleAt), queued,
            pingAge: now - lastPong, renderDelay: Math.max(paintDelay, oldest === undefined ? 0 : now - oldest) });
          bytes = 0; sampleAt = now; paintDelay = 0;
        }, 2000);
      };
      socket.onmessage = (event) => {
        lastReceived = performance.now();
        try {
          if (typeof event.data === 'string') {
            bytes += encoder.encode(event.data).byteLength;
            parser.receive(event.data);
            return;
          }
          const stats = JSON.parse(new TextDecoder().decode(event.data));
          if (stats.type !== 'pong' || !pings.has(stats.stamp)) return;
          lastPong = lastReceived;
          rtt = Math.round(lastReceived - pings.get(stats.stamp));
          queued = Number(stats.queued) || 0;
          pings.delete(stats.stamp);
        } catch {
          closeHint = '桌面数据通道异常';
          socket.close();
        }
      };
      socket.onclose = (event) => {
        clearInterval(timer);
        tunnel.setState(Guacamole.Tunnel.State.CLOSED);
        if (!intentional) onClosed(event.code, closeHint);
      };
      socket.onerror = () => { closeHint = '网络连接中断'; };
    };

    tunnel.sendMessage = (...args) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      if (args[0] === 'sync') {
        const timestamp = String(args[1]), received = pendingPaint.get(timestamp);
        if (received !== undefined) paintDelay = Math.max(paintDelay, performance.now() - received);
        for (const key of pendingPaint.keys()) {
          if (Number(key) <= Number(timestamp)) pendingPaint.delete(key);
        }
      }
      socket.send(Guacamole.Parser.toInstruction(args));
    };
    tunnel.disconnect = () => {
      intentional = true;
      clearInterval(timer);
      socket?.close();
      tunnel.setState(Guacamole.Tunnel.State.CLOSED);
    };
    return tunnel;
  }

  globalThis.UmekoRemoteDesktop = { adaptiveState, createTunnel, dimensions };
})();
