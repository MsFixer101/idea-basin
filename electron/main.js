const { app, BrowserWindow, shell, globalShortcut, ipcMain, clipboard, nativeImage, Tray, Menu } = require('electron');
const { join } = require('path');
const { fork, exec, spawn } = require('child_process');

const ROOT = join(__dirname, '..');

let mainWindow;
let captureWindow;
let serverProcess;
let viteProcess;
let tray;

const isDev = !app.isPackaged;
const SERVER_PORT = 3500;
const VITE_PORT = 5173;

async function isPortReady(port, path = '/') {
  try {
    const res = await fetch(`http://localhost:${port}${path}`);
    return res.ok;
  } catch { return false; }
}

async function startServer() {
  // Skip if server is already running (e.g. started manually)
  if (await isPortReady(SERVER_PORT, '/api/health')) {
    console.log('[server] Already running on port', SERVER_PORT);
    return;
  }

  const serverPath = join(ROOT, 'server', 'index.js');
  serverProcess = fork(serverPath, [], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, PORT: String(SERVER_PORT) },
    silent: true,
  });

  serverProcess.stdout?.on('data', (d) => console.log(`[server] ${d}`));
  serverProcess.stderr?.on('data', (d) => console.error(`[server] ${d}`));

  return new Promise((resolve) => {
    const check = setInterval(async () => {
      if (await isPortReady(SERVER_PORT, '/api/health')) {
        clearInterval(check);
        resolve();
      }
    }, 300);
  });
}

async function startVite() {
  // Skip if Vite is already running
  if (await isPortReady(VITE_PORT)) {
    console.log('[vite] Already running on port', VITE_PORT);
    return;
  }

  viteProcess = spawn('npx', ['vite'], {
    cwd: join(ROOT, 'client'),
    env: { ...process.env },
    stdio: 'pipe',
    shell: true,
  });

  viteProcess.stdout?.on('data', (d) => console.log(`[vite] ${d}`));
  viteProcess.stderr?.on('data', (d) => console.error(`[vite] ${d}`));

  return new Promise((resolve) => {
    const check = setInterval(async () => {
      if (await isPortReady(VITE_PORT)) {
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0a1a',
    icon: join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload-main.js'),
    },
  });

  const url = isDev
    ? `http://localhost:${VITE_PORT}`
    : `http://localhost:${SERVER_PORT}`;

  mainWindow.loadURL(url);

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // macOS: hide instead of destroy so tray can re-show instantly
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      app.dock?.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Quick Capture Window ---

function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 420,
    height: 380,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1a1025',
    icon: join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload-capture.js'),
    },
  });

  captureWindow.loadFile(join(__dirname, 'capture.html'));
  captureWindow.on('closed', () => { captureWindow = null; });
}

async function showCaptureWindow() {
  const needsCreate = !captureWindow || captureWindow.isDestroyed();
  if (needsCreate) {
    createCaptureWindow();
  }

  // Center on screen
  const { screen } = require('electron');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const [w, h] = captureWindow.getSize();
  captureWindow.setPosition(
    Math.round((width - w) / 2),
    Math.round((height - h) / 2),
  );

  if (needsCreate) {
    // Wait for initial load to finish — init() runs automatically
    captureWindow.webContents.once('did-finish-load', () => {
      captureWindow.show();
      captureWindow.focus();
    });
  } else {
    captureWindow.show();
    captureWindow.focus();
    captureWindow.webContents.reload();
  }
}

// Run macOS screen capture (select region → clipboard), then show capture window
function screencaptureThenShow() {
  // screencapture -ic = interactive selection, copy to clipboard
  exec('screencapture -ic', (err) => {
    // err means user cancelled (Escape) — still show popup with whatever's on clipboard
    showCaptureWindow();
  });
}

function registerCaptureShortcut() {
  const shortcuts = ['F13', 'PrintScreen', 'CommandOrControl+Shift+I'];
  for (const key of shortcuts) {
    const ok = globalShortcut.register(key, screencaptureThenShow);
    if (ok) {
      console.log(`[capture] Global shortcut registered: ${key}`);
      return;
    }
  }
  console.warn('[capture] Could not register any global shortcut');
}

// --- IPC Handlers for Capture ---

ipcMain.handle('get-clipboard', () => {
  const text = clipboard.readText() || null;
  const img = clipboard.readImage();
  let imageDataUrl = null;
  if (img && !img.isEmpty()) {
    imageDataUrl = img.toDataURL();
  }
  return { text, imageDataUrl };
});

ipcMain.handle('get-nodes', async () => {
  try {
    const res = await fetch(`http://localhost:${SERVER_PORT}/api/nodes/root`);
    if (!res.ok) return { nodes: [], scrapDrawerId: null };
    const root = await res.json();
    const flat = [];
    function walk(node, prefix) {
      const path = prefix ? `${prefix} > ${node.label}` : node.label;
      flat.push({ id: node.id, path });
      if (node.children) {
        for (const child of node.children) walk(child, path);
      }
    }
    // Skip root, start from children
    for (const child of root.children || []) walk(child, '');
    const scrapDrawer = root.children?.find(c => c.label === 'Idea Basin');
    return { nodes: flat, scrapDrawerId: scrapDrawer?.id || flat[0]?.id };
  } catch {
    return { nodes: [], scrapDrawerId: null };
  }
});

ipcMain.handle('capture-saved', async (_event, nodeId) => {
  console.log('[capture] saved to node:', nodeId, 'mainWindow:', !!mainWindow);
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const hasRefresh = await mainWindow.webContents.executeJavaScript('typeof window.__ideaBasinRefresh');
      console.log('[capture] __ideaBasinRefresh type:', hasRefresh);
      if (hasRefresh === 'function') {
        // Validate nodeId is a UUID to prevent JS injection
        const safeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nodeId) ? nodeId : null;
        if (!safeId) throw new Error('Invalid node ID format');
        await mainWindow.webContents.executeJavaScript(`window.__ideaBasinRefresh('${safeId}')`);
        console.log('[capture] refresh called successfully');
      } else {
        // Fallback: just reload the page
        console.log('[capture] no refresh function, reloading main window');
        mainWindow.webContents.reload();
      }
    } catch (err) {
      console.error('[capture] executeJavaScript error:', err);
      mainWindow.webContents.reload();
    }
  }
});

ipcMain.on('trigger-capture', () => {
  screencaptureThenShow();
});

ipcMain.handle('popout-window', (_event, html, title) => {
  const popout = new BrowserWindow({
    width: 800, height: 900,
    title: title || 'Artifact',
    backgroundColor: '#0d0819',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  popout.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});

ipcMain.handle('close-capture', () => {
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
});

// --- Tray Icon ---

function createTray() {
  const trayIcon = nativeImage.createFromPath(join(__dirname, 'icons', 'trayIcon.png'));
  tray = new Tray(trayIcon);
  tray.setToolTip('Idea Basin');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Quick Capture', click: screencaptureThenShow },
    { label: 'Show Idea Basin', click: () => {
      app.dock?.show();
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
      else createWindow();
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

app.setName('Idea Basin');

app.whenReady().then(async () => {
  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(__dirname, 'icons', 'icon.png'));
  }

  // Always start the server (dev and production)
  await startServer();

  // In dev mode, also start the Vite dev server for hot reloading
  if (isDev) {
    await startVite();
  }

  createWindow();
  createTray();
  registerCaptureShortcut();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (viteProcess) viteProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  globalShortcut.unregisterAll();
  if (serverProcess) serverProcess.kill();
  if (viteProcess) viteProcess.kill();
});
