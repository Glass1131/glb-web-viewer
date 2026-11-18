const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const THREE_ROOT = path.join(APP_ROOT, 'node_modules', 'three');
const CDN_THREE_PREFIX = 'https://cdn.jsdelivr.net/npm/three@0.187.0/';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
};

let mainWindow = null;
let localServer = null;
let serverOrigin = '';
let nextLocalFileId = 1;
const registeredLocalFiles = new Map();

function extractGlbArgs(argv) {
  return argv
    .slice(1)
    .filter((arg) => !arg.startsWith('-') && arg.toLowerCase().endsWith('.glb'))
    .map((arg) => path.resolve(arg))
    .filter((filePath) => fs.existsSync(filePath));
}

function registerLocalFiles(filePaths) {
  return filePaths.map((filePath) => {
    const id = String(nextLocalFileId++);
    const stat = fs.statSync(filePath);
    registeredLocalFiles.set(id, filePath);
    return {
      name: path.basename(filePath),
      sizeBytes: stat.size,
      url: `${serverOrigin}/__local__/${id}`,
    };
  });
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(reqUrl.pathname);

      if (pathname.startsWith('/__local__/')) {
        const id = pathname.slice('/__local__/'.length);
        const targetPath = registeredLocalFiles.get(id);
        if (!targetPath || !fs.existsSync(targetPath)) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        const stat = fs.statSync(targetPath);
        res.writeHead(200, {
          'Content-Type': 'model/gltf-binary',
          'Content-Length': stat.size,
        });
        fs.createReadStream(targetPath).pipe(res);
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        const htmlPath = path.join(APP_ROOT, 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        // PC 프로그램 오프라인 실행을 위해 CDN 경로를 번들된 node_modules/three로 연결
        html = html.replaceAll(CDN_THREE_PREFIX, '/__three__/');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (pathname === '/viewer.js') {
        const jsPath = path.join(APP_ROOT, 'viewer.js');
        let js = fs.readFileSync(jsPath, 'utf8');
        js = js.replaceAll(CDN_THREE_PREFIX, '/__three__/');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(js);
        return;
      }

      let baseDir = APP_ROOT;
      let relPath = pathname.replace(/^\/+/, '');
      if (pathname.startsWith('/__three__/')) {
        baseDir = THREE_ROOT;
        relPath = pathname.slice('/__three__/'.length);
      }

      const resolved = path.resolve(baseDir, relPath);
      if (!resolved.startsWith(baseDir) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      });
      fs.createReadStream(resolved).pipe(res);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      serverOrigin = `http://127.0.0.1:${addr.port}`;
      resolve(server);
    });
  });
}

function buildAppMenu() {
  const template = [
    {
      label: '파일',
      submenu: [
        {
          label: '.glb 파일 열기 (여러 개 가능)',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow?.webContents.send('trigger-open-dialog');
          },
        },
        { type: 'separator' },
        { label: '종료', role: 'quit' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '새로고침', role: 'reload' },
        { label: '전체 화면', role: 'togglefullscreen' },
        { label: '개발자 도구', role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(initialFiles) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    title: 'GLB 3D Viewer',
    backgroundColor: '#14171e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  buildAppMenu();
  mainWindow.loadURL(serverOrigin);

  mainWindow.webContents.on('did-finish-load', () => {
    if (initialFiles.length > 0) {
      mainWindow.webContents.send('open-glb-files', registerLocalFiles(initialFiles));
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const files = extractGlbArgs(argv);
    if (files.length > 0) {
      mainWindow.webContents.send('open-glb-files', registerLocalFiles(files));
    }
  });

  app.whenReady().then(async () => {
    localServer = await startStaticServer();
    const initialFiles = extractGlbArgs(process.argv);
    createWindow(initialFiles);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow([]);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (localServer) localServer.close();
    if (process.platform !== 'darwin') app.quit();
  });
}
