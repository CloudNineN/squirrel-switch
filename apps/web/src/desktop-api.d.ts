import type {
  ChatGptDesktopProfileInput,
  ChatGptAccountStatusResult,
  ChatGptExportBackupResult,
  ChatGptImportBackupResult,
  ChatGptSessionSummary,
} from "@squirrel-switch/shared";

declare global {
  interface DesktopActionResult {
    error: string | null;
  }

  interface OpenDesktopWindowResult extends DesktopActionResult {
    opened: boolean;
  }

  interface ClearChatGptSessionResult extends DesktopActionResult {
    cleared: boolean;
  }

  interface ChatGptSessionSummaryResult extends DesktopActionResult {
    summary: ChatGptSessionSummary | null;
  }

  interface ChatGptAccountStatusDesktopResult extends DesktopActionResult {
    status: ChatGptAccountStatusResult | null;
  }

  interface ChatGptExportDesktopResult extends DesktopActionResult {
    result: ChatGptExportBackupResult | null;
  }

  interface ChatGptImportDesktopResult extends DesktopActionResult {
    result: ChatGptImportBackupResult | null;
  }

  interface SquirrelSwitchDesktopApi {
    openLoginUrl: (sessionId: string, url: string) => Promise<OpenDesktopWindowResult>;
    openChatGpt: (profile: ChatGptDesktopProfileInput) => Promise<OpenDesktopWindowResult>;
    openUrlInChatGpt: (
      profile: ChatGptDesktopProfileInput,
      url: string,
    ) => Promise<OpenDesktopWindowResult>;
    clearChatGptSession: (
      profile: ChatGptDesktopProfileInput,
    ) => Promise<ClearChatGptSessionResult>;
    getChatGptSessionSummary: (
      profile: ChatGptDesktopProfileInput,
    ) => Promise<ChatGptSessionSummaryResult>;
    getChatGptAccountStatus: (
      input: ChatGptDesktopProfileInput & { accountId: string | null; closeAfterCheck?: boolean },
    ) => Promise<ChatGptAccountStatusDesktopResult>;
    exportChatGptBackup: (payload: {
      profiles: ChatGptDesktopProfileInput[];
      password: string;
    }) => Promise<ChatGptExportDesktopResult>;
    importChatGptBackup: (payload: {
      backupText: string;
      password: string;
    }) => Promise<ChatGptImportDesktopResult>;
  }

  interface Window {
    squirrelSwitchDesktop?: SquirrelSwitchDesktopApi;
  }
}

export {};
