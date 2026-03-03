import { app, type BrowserWindow } from 'electron';
import electronUpdater, { type AppUpdater, type UpdateInfo } from 'electron-updater';
import { IPC_CHANNELS } from '../ipc/contracts.js';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateStatus =
  | { status: 'disabled'; reason: string }
  | { status: 'checking' }
  | { status: 'available'; version: string; notes?: string }
  | { status: 'not-available' }
  | {
      status: 'downloading';
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

function getAutoUpdater(): AppUpdater {
  // electron-updater is CommonJS under the hood; this keeps ESM compatible typing.
  const { autoUpdater } = electronUpdater;
  return autoUpdater;
}

function asNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') {
    return info.releaseNotes;
  }
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes
      .map((note) => (typeof note === 'string' ? note : note.note))
      .filter(Boolean)
      .join('\n\n');
  }
  return undefined;
}

export function setupAutoUpdates(mainWindow: BrowserWindow) {
  const autoUpdater = getAutoUpdater();
  const enabled = app.isPackaged && process.env.QUICKCUT_DISABLE_AUTO_UPDATE !== '1';

  const sendStatus = (payload: UpdateStatus) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.update.status, payload);
    }
  };

  if (!enabled) {
    const reason = app.isPackaged
      ? 'Disabled by QUICKCUT_DISABLE_AUTO_UPDATE=1'
      : 'Auto-updates run only in packaged builds';
    sendStatus({ status: 'disabled', reason });
    return {
      enabled: false,
      checkForUpdates: async () => ({ enabled: false, started: false, error: reason }),
      downloadUpdate: async () => ({ enabled: false, started: false, error: reason }),
      installUpdate: () => ({ enabled: false, started: false }),
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    sendStatus({ status: 'available', version: info.version, notes: asNotes(info) });
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      status: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    sendStatus({ status: 'error', message: error.message || 'Update failed' });
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, 10000);

  setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, UPDATE_CHECK_INTERVAL_MS);

  return {
    enabled: true,
    checkForUpdates: async () => {
      try {
        await autoUpdater.checkForUpdates();
        return { enabled: true, started: true };
      } catch (error) {
        return {
          enabled: true,
          started: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    downloadUpdate: async () => {
      try {
        await autoUpdater.downloadUpdate();
        return { enabled: true, started: true };
      } catch (error) {
        return {
          enabled: true,
          started: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    installUpdate: () => {
      autoUpdater.quitAndInstall(false, true);
      return { enabled: true, started: true };
    },
  };
}
