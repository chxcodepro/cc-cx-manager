// 桌面程序主进程：创建窗口，把界面请求通过 IPC 转给后台 API
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApi, describeError, API_METHODS } from '../server/api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const isMac = process.platform === 'darwin';

app.setName('CC-CX 配置管理器');
if (process.platform === 'win32') app.setAppUserModelId('com.chxcode.cc-cx-manager');

// 自检模式（打包后的冒烟测试）：使用独立的数据目录，也不抢单实例锁，
// 这样即使你正开着程序，自检也能照常运行
const SELFTEST = !!process.env.CCM_SELFTEST;
if (SELFTEST) {
  app.setPath('userData', path.join(process.env.CC_CX_MANAGER_HOME || os.tmpdir(), 'selftest-userdata'));
}

// 单实例：再次双击时激活已有窗口
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

const api = createApi({
  reveal: (p) => shell.showItemInFolder(p),
  openExternal: (url) => shell.openExternal(url),
  pickDirectory: async (current) => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择项目目录',
      defaultPath: current || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  },
});

ipcMain.handle('ccm', async (event, method, payload) => {
  // 只接受来自本程序页面的调用
  const url = event.senderFrame?.url || '';
  if (!url.startsWith('file://')) return { ok: false, error: '非法来源', status: 403 };
  if (!API_METHODS.includes(method)) return { ok: false, error: '未知方法：' + method, status: 404 };
  try {
    const data = await api[method](payload || {});
    return { ok: true, data };
  } catch (e) {
    const d = describeError(e);
    return { ok: false, error: d.message, status: d.status, code: d.code };
  }
});

ipcMain.handle('ccm:confirm-close', () => true);

function iconPath() {
  const candidates = [path.join(ROOT, 'build', 'icon.png'), path.join(process.resourcesPath || '', 'icon.png')];
  return candidates.find((p) => fs.existsSync(p));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: 'CC-CX 配置管理器 · Claude Code / Codex',
    icon: iconPath(),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161514' : '#f6f5f2',
    autoHideMenuBar: !isMac,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => { if (!process.env.CCM_SELFTEST) win.show(); });
  win.loadFile(path.join(ROOT, 'dist', 'index.html'));

  // 自检模式：加载界面后通过 IPC 调用几个接口，输出结果并退出（用于打包后的冒烟测试）
  if (process.env.CCM_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const out = await win.webContents.executeJavaScript(`(async () => {
          const s = await window.ccm.invoke('state');
          const catalogs = {};
          for (const name of ['claude-settings', 'claude-env', 'claude-mcp', 'codex-config', 'codex-env']) {
            const c = await window.ccm.invoke('catalog', { name });
            catalogs[name] = c.ok
              ? { total: c.data.stats.total, untranslated: c.data.stats.untranslated, overlayErrors: c.data.overlayErrors.length }
              : { error: c.error };
          }
          const f = await window.ccm.invoke('file', { id: 'codex-user' });
          // ~/.claude.json 只应把 mcpServers 发给界面，且不带全文
          const m = await window.ccm.invoke('file', { id: 'claude-mcp-user' });
          await new Promise((r) => setTimeout(r, 800));
          return {
            state: s.ok, platform: s.data && s.data.platform, desktop: s.data && s.data.desktop,
            catalogs, fileOk: f.ok, fileExists: f.data && f.data.exists,
            mcp: m.ok ? { exists: m.data.exists, textHidden: m.data.text === '', keys: Object.keys(m.data.data || {}), servers: Object.keys((m.data.data || {}).mcpServers || {}).length } : { error: m.error },
            rendered: !!document.querySelector('.sidebar'), title: document.title,
          };
        })()`);
        process.stdout.write('CCM_SELFTEST ' + JSON.stringify(out) + '\n');
        app.exit(0);
      } catch (e) {
        process.stdout.write('CCM_SELFTEST_FAIL ' + (e && e.message) + '\n');
        app.exit(1);
      }
    });
  }

  // 外部链接用系统浏览器打开；禁止页面跳转到其他地址
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // 有未保存修改时关闭窗口前确认（由页面通过 beforeunload 告知）
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['放弃修改并关闭', '取消'],
      defaultId: 1,
      cancelId: 1,
      title: '有未保存的修改',
      message: '还有未保存的修改，确定要关闭吗？',
    });
    if (choice === 0) e.preventDefault();
  });
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
