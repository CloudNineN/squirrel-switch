import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("squirrelSwitchDesktop", {
  openLoginUrl: (sessionId: string, url: string) =>
    ipcRenderer.invoke("login:open-url", { sessionId, url }),
  openChatGpt: (profile: unknown) => ipcRenderer.invoke("chatgpt:open", profile),
  openUrlInChatGpt: (profile: unknown, url: string) =>
    ipcRenderer.invoke("chatgpt:open-url", { profile, url }),
  clearChatGptSession: (input: unknown) => ipcRenderer.invoke("chatgpt:clear-session", input),
  getChatGptSessionSummary: (input: unknown) => ipcRenderer.invoke("chatgpt:session-summary", input),
  getChatGptAccountStatus: (input: unknown) => ipcRenderer.invoke("chatgpt:account-status", input),
  exportChatGptBackup: (payload: unknown) => ipcRenderer.invoke("chatgpt:export-backup", payload),
  importChatGptBackup: (payload: unknown) => ipcRenderer.invoke("chatgpt:import-backup", payload),
});
