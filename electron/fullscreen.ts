/**
 * Windows-only: is a fullscreen app or presentation running? Uses SHQueryUserNotificationState
 * through koffi. Anything that fails here degrades to "no", never to a crash.
 */

type Query = (out: Int32Array) => number;

let query: Query | null = null;
let attempted = false;

function init(): void {
  attempted = true;
  if (process.platform !== 'win32') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as {
      load(name: string): { func(sig: string): Query };
    };
    const shell32 = koffi.load('shell32.dll');
    query = shell32.func('int __stdcall SHQueryUserNotificationState(_Out_ int *state)');
  } catch (err) {
    console.warn('fullscreen detection unavailable:', (err as Error).message);
    query = null;
  }
}

/** QUERY_USER_NOTIFICATION_STATE values that mean "do not draw over this". */
const BUSY = new Set([2 /* QUNS_BUSY */, 3 /* QUNS_RUNNING_D3D_FULL_SCREEN */, 4 /* QUNS_PRESENTATION_MODE */]);

export function fullscreenAppRunning(): boolean {
  if (!attempted) init();
  if (!query) return false;
  try {
    const out = new Int32Array(1);
    const hr = query(out);
    if (hr !== 0) return false;
    return BUSY.has(out[0]);
  } catch {
    return false;
  }
}
