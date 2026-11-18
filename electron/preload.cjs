// 预加载脚本：只向页面暴露一个受限的调用入口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccm', {
  invoke: (method, payload) => ipcRenderer.invoke('ccm', method, payload),
  platform: process.platform,
});
