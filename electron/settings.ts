import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_CONFIG, type OverlayConfig } from './ipc';

export interface Settings extends OverlayConfig {
  /** Electron display id the flock lives on; null = primary */
  displayId: number | null;
}

const DEFAULTS: Settings = { ...DEFAULT_CONFIG, displayId: null };

function file(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    mkdirSync(dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(s, null, 2));
  } catch (err) {
    console.error('could not save settings', err);
  }
}
