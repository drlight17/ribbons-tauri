const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined;

export const hasTauri = !!(tauri && tauri.core);

export function invoke(command, args) {
    if (!hasTauri) return Promise.reject(new Error('Tauri API is unavailable'));
    return tauri.core.invoke(command, args);
}

export function send(event, payload) {
    if (!hasTauri) {
        console.log('[tauri:event]', event, payload);
        return Promise.resolve();
    }
    return tauri.core.invoke('renderer_message', { event, payload });
}

export function on(event, handler) {
    if (!hasTauri) return () => {};
    // Bind listeners to this webview's label. Rust emits most screensaver
    // events with `emit_to(<label>)`; a listener registered with the default
    // "any" target would receive every window's copy and the last one wins.
    let target;
    try {
        const meta = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata;
        const label = meta && meta.currentWebview && meta.currentWebview.label;
        target = label ? { kind: 'WebviewWindow', label: label } : undefined;
    } catch (_) {
        target = undefined;
    }
    return tauri.event.listen(
        event,
        (message) => handler(message.payload),
        target ? { target } : undefined
    );
}

export function currentWindow() {
    return hasTauri ? tauri.window.getCurrentWindow() : null;
}

export function closeCurrentWindow() {
    const win = currentWindow();
    if (win) return win.close();
    window.close();
    return Promise.resolve();
}

let heartbeatTimer = null;

function sendHeartbeat() {
    if (!hasTauri) return;
    invoke('renderer_heartbeat').catch(() => {});
}

export function startHeartbeat(intervalMs = 2000) {
    if (!hasTauri || heartbeatTimer) return;
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, intervalMs);
}

startHeartbeat();

if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        if (!hasTauri) return;
        const where = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '';
        send('debug', `[js-error] ${event.message} ${where}`).catch(() => {});
    });
    window.addEventListener('unhandledrejection', (event) => {
        if (!hasTauri) return;
        send('debug', `[js-rejection] ${String(event.reason)}`).catch(() => {});
    });
}
