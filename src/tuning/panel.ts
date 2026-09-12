/**
 * Framework-free tuning panel. Builds itself from the simulation schema, so a new config field
 * appears here automatically. Used by the desktop app's tuning window and by the web page.
 */
import { defaultConfig, type SimConfig } from '../sim';
import { diffFromDefaults, getPath, setPath, tuningSchema, type ParamSpec } from '../sim/schema';

export interface FlockState {
  count: number;
  seed: number;
  pxPerBL: number;
  paused: boolean;
  debugColours: boolean;
  links: boolean;
}

export interface PanelMetrics {
  fps: number;
  cohesion: number;
  nnd: number;
  polarisation: number;
  splits: number;
  /** graze, alert, walk, run, rest */
  fractions: number[];
}

export interface PanelOptions {
  container: HTMLElement;
  config: SimConfig;
  flock?: FlockState;
  /** show the flock controls (count, size, pause). The web page has its own. */
  showFlock: boolean;
  /** offer a button that writes the current values back as the app's defaults */
  showSave: boolean;
  onSim(path: string, value: number | boolean | [number, number], rebuild: boolean): void;
  onFlock?(key: keyof FlockState, value: number | boolean): void;
  onAction(action: 'reset' | 'respawn' | 'save', payload?: unknown): void;
}

export interface TuningPanel {
  setMetrics(m: PanelMetrics): void;
  /** adopt an externally changed config, e.g. after a reset elsewhere */
  setConfig(cfg: SimConfig): void;
  setFlock(f: FlockState): void;
  destroy(): void;
}

const STYLE_ID = 'sheep-tuning-style';
const CSS = `
.tp { --bg:#14180f; --panel:#1d2318; --line:#333a2b; --ink:#e8eade; --soft:#b0b7a6; --faint:#7d8574;
  --accent:#e0a92e; --graze:#d9d4c2; --alert:#e0a92e; --walk:#7fa3b8; --run:#c05a3e;
  font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink); background:var(--bg);
  display:flex; flex-direction:column; height:100%; overflow:hidden; }
.tp *{box-sizing:border-box}
.tp-head{padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; flex-direction:column; gap:8px}
.tp-title{font:600 12px/1 "IBM Plex Mono",monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin:0}
.tp-stats{display:flex; flex-wrap:wrap; gap:4px 14px; font-family:"IBM Plex Mono",monospace; font-size:12px; font-variant-numeric:tabular-nums}
.tp-stats b{color:var(--faint); font-weight:400}
.tp-census{display:flex; height:6px; border-radius:2px; overflow:hidden; gap:1px}
.tp-census span{transition:flex-grow .25s linear; min-width:0}
.tp-search{width:100%; padding:6px 8px; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:2px; font:inherit}
.tp-search:focus{outline:2px solid var(--accent); outline-offset:1px}
.tp-body{overflow-y:auto; flex:1; padding-bottom:8px}
.tp-group{border-bottom:1px solid var(--line)}
.tp-group>summary{cursor:pointer; padding:9px 12px; font-weight:600; list-style:none; display:flex; align-items:baseline; gap:8px}
.tp-group>summary::-webkit-details-marker{display:none}
.tp-group>summary::before{content:"▸"; color:var(--faint); font-size:10px}
.tp-group[open]>summary::before{content:"▾"}
.tp-group>summary em{font-style:normal; color:var(--faint); font-size:11px; font-family:"IBM Plex Mono",monospace}
.tp-blurb{margin:0 12px 8px; color:var(--faint); font-size:12px}
.tp-row{display:grid; grid-template-columns:minmax(0,1fr) 96px 56px 14px; align-items:center; gap:8px; padding:3px 12px}
.tp-row:hover{background:rgba(255,255,255,.03)}
.tp-row label{color:var(--soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:help}
.tp-row.changed label{color:var(--accent)}
.tp-row input[type=range]{width:100%; accent-color:var(--accent)}
.tp-row input[type=number]{width:100%; background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:2px; padding:2px 4px; font:12px "IBM Plex Mono",monospace; font-variant-numeric:tabular-nums}
.tp-row input[type=checkbox]{accent-color:var(--accent)}
.tp-reset{background:none; border:0; color:var(--faint); cursor:pointer; padding:0; font-size:14px; line-height:1; visibility:hidden}
.tp-row.changed .tp-reset{visibility:visible}
.tp-reset:hover{color:var(--accent)}
.tp-pair{display:grid; grid-template-columns:1fr 1fr; gap:4px}
.tp-note{grid-column:1 / -1; margin:0 0 4px; color:var(--faint); font-size:11px}
.tp-rebuild{color:var(--faint); font-size:10px; font-family:"IBM Plex Mono",monospace}
.tp-foot{border-top:1px solid var(--line); background:var(--panel); padding:9px 12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center}
.tp button.tp-btn{font:inherit; color:var(--ink); background:var(--bg); border:1px solid var(--line); border-radius:2px; padding:5px 10px; cursor:pointer}
.tp button.tp-btn:hover{border-color:var(--faint)}
.tp-msg{color:var(--faint); font-size:12px; margin-left:auto}
.tp-empty{padding:16px 12px; color:var(--faint)}
`;

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

function fmt(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a < 0.01) return v.toExponential(1);
  if (a < 1) return v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (a < 100) return String(Math.round(v * 1000) / 1000);
  return String(Math.round(v));
}

export function createTuningPanel(opts: PanelOptions): TuningPanel {
  const doc = opts.container.ownerDocument;
  ensureStyle(doc);
  const cfg = opts.config;
  const defaults = defaultConfig();
  let flock: FlockState = opts.flock ?? { count: 24, seed: 1, pxPerBL: 44, paused: false, debugColours: false, links: false };

  const root = doc.createElement('div');
  root.className = 'tp';
  root.innerHTML = `
    <div class="tp-head">
      <p class="tp-title">Flock tuning</p>
      <div class="tp-stats" id="tp-stats"></div>
      <div class="tp-census" id="tp-census">
        <span style="background:var(--graze)"></span><span style="background:var(--alert)"></span><span style="background:var(--walk)"></span><span style="background:var(--run)"></span>
      </div>
      <input class="tp-search" id="tp-search" type="search" placeholder="Filter parameters, e.g. fear, zone, speed" autocomplete="off">
    </div>
    <div class="tp-body" id="tp-body"></div>
    <div class="tp-foot">
      <button class="tp-btn" id="tp-reset" type="button">Reset all</button>
      <button class="tp-btn" id="tp-respawn" type="button">New flock</button>
      <button class="tp-btn" id="tp-copy" type="button">Copy changes</button>
      ${opts.showSave ? '<button class="tp-btn" id="tp-save" type="button">Save as default</button>' : ''}
      <span class="tp-msg" id="tp-msg"></span>
    </div>`;
  opts.container.appendChild(root);

  const body = root.querySelector('#tp-body') as HTMLElement;
  const statsEl = root.querySelector('#tp-stats') as HTMLElement;
  const censusEl = root.querySelector('#tp-census') as HTMLElement;
  const msgEl = root.querySelector('#tp-msg') as HTMLElement;
  const searchEl = root.querySelector('#tp-search') as HTMLInputElement;

  let msgTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string): void => {
    msgEl.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { msgEl.textContent = ''; }, 2500);
  };

  // --- rows -----------------------------------------------------------------------------------
  interface Row { el: HTMLElement; spec: ParamSpec; sync(): void; haystack: string }
  const rows: Row[] = [];

  function numberRow(spec: ParamSpec, index: 0 | 1 | null): { wrap: HTMLElement; sync(): void } {
    const range = doc.createElement('input');
    range.type = 'range';
    range.min = String(spec.min);
    range.max = String(spec.max);
    range.step = String(spec.step);
    const num = doc.createElement('input');
    num.type = 'number';
    num.step = String(spec.step);
    const read = (): number => {
      const v = getPath(cfg, spec.path);
      return index === null ? (v as number) : (v as [number, number])[index];
    };
    const write = (n: number): void => {
      if (index === null) {
        setPath(cfg, spec.path, n);
        opts.onSim(spec.path, n, spec.rebuild);
      } else {
        const pair = [...(getPath(cfg, spec.path) as [number, number])] as [number, number];
        pair[index] = n;
        // keep the pair ordered; a min above its max produces nonsense ranges
        if (pair[0] > pair[1]) pair[index === 0 ? 1 : 0] = n;
        setPath(cfg, spec.path, pair);
        opts.onSim(spec.path, pair, spec.rebuild);
      }
      sync();
      refreshChanged(spec);
    };
    range.addEventListener('input', () => write(Number(range.value)));
    num.addEventListener('change', () => write(Number(num.value)));
    const sync = (): void => {
      const v = read();
      range.value = String(v);
      num.value = fmt(v);
    };
    sync();
    const wrap = doc.createElement('div');
    wrap.style.display = 'contents';
    wrap.append(range, num);
    return { wrap, sync };
  }

  function refreshChanged(spec: ParamSpec): void {
    const row = rows.find((r) => r.spec.path === spec.path);
    if (!row) return;
    const same = JSON.stringify(getPath(cfg, spec.path)) === JSON.stringify(getPath(defaults, spec.path));
    row.el.classList.toggle('changed', !same);
  }

  function buildRow(spec: ParamSpec): Row {
    const el = doc.createElement('div');
    el.className = 'tp-row';
    const label = doc.createElement('label');
    label.textContent = spec.label;
    if (spec.rebuild) {
      const tag = doc.createElement('span');
      tag.className = 'tp-rebuild';
      tag.textContent = ' respawns';
      label.appendChild(tag);
    }
    label.title = `${spec.path}${spec.note ? `\n${spec.note}` : ''}`;
    el.appendChild(label);

    const syncs: (() => void)[] = [];
    if (spec.boolean) {
      const box = doc.createElement('input');
      box.type = 'checkbox';
      const sync = (): void => { box.checked = Boolean(getPath(cfg, spec.path)); };
      box.addEventListener('change', () => {
        setPath(cfg, spec.path, box.checked);
        opts.onSim(spec.path, box.checked, spec.rebuild);
        refreshChanged(spec);
      });
      sync();
      syncs.push(sync);
      el.append(box, doc.createElement('span'));
    } else if (spec.pair) {
      const holder = doc.createElement('div');
      holder.className = 'tp-pair';
      holder.style.gridColumn = 'span 2';
      for (const i of [0, 1] as const) {
        const cell = doc.createElement('div');
        const r = numberRow(spec, i);
        cell.append(...Array.from(r.wrap.children));
        cell.style.display = 'grid';
        cell.style.gridTemplateColumns = '1fr 48px';
        cell.style.gap = '4px';
        holder.appendChild(cell);
        syncs.push(r.sync);
      }
      el.appendChild(holder);
    } else {
      const r = numberRow(spec, null);
      el.append(...Array.from(r.wrap.children));
      syncs.push(r.sync);
    }

    const reset = doc.createElement('button');
    reset.className = 'tp-reset';
    reset.type = 'button';
    reset.textContent = '↺';
    reset.title = 'Back to the default';
    reset.addEventListener('click', () => {
      const d = getPath(defaults, spec.path);
      setPath(cfg, spec.path, Array.isArray(d) ? [...d] : d);
      opts.onSim(spec.path, d as number, spec.rebuild);
      syncs.forEach((s) => s());
      refreshChanged(spec);
    });
    el.appendChild(reset);

    if (spec.note) {
      const note = doc.createElement('p');
      note.className = 'tp-note';
      note.textContent = spec.note;
      el.appendChild(note);
    }
    const row: Row = {
      el,
      spec,
      sync: () => syncs.forEach((s) => s()),
      haystack: `${spec.label} ${spec.path} ${spec.note ?? ''}`.toLowerCase(),
    };
    return row;
  }

  // --- flock controls -------------------------------------------------------------------------
  if (opts.showFlock && opts.onFlock) {
    const det = doc.createElement('details');
    det.className = 'tp-group';
    det.open = true;
    det.innerHTML = '<summary>Flock <em>the basics</em></summary>';
    const mk = (key: keyof FlockState, label: string, min: number, max: number, step: number): void => {
      const el = doc.createElement('div');
      el.className = 'tp-row';
      const lab = doc.createElement('label');
      lab.textContent = label;
      const range = doc.createElement('input');
      range.type = 'range';
      range.min = String(min); range.max = String(max); range.step = String(step);
      range.value = String(flock[key]);
      const num = doc.createElement('input');
      num.type = 'number';
      num.step = String(step);
      num.value = String(flock[key]);
      const push = (v: number): void => {
        (flock as unknown as Record<string, number>)[key] = v;
        range.value = String(v);
        num.value = String(v);
        opts.onFlock!(key, v);
      };
      range.addEventListener('input', () => push(Number(range.value)));
      num.addEventListener('change', () => push(Number(num.value)));
      el.append(lab, range, num, doc.createElement('span'));
      det.appendChild(el);
    };
    const toggle = (key: keyof FlockState, label: string): void => {
      const el = doc.createElement('div');
      el.className = 'tp-row';
      const lab = doc.createElement('label');
      lab.textContent = label;
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(flock[key]);
      box.addEventListener('change', () => {
        (flock as unknown as Record<string, boolean>)[key] = box.checked;
        opts.onFlock!(key, box.checked);
      });
      el.append(lab, box, doc.createElement('span'), doc.createElement('span'));
      det.appendChild(el);
    };
    mk('count', 'Sheep', 1, 500, 1);
    mk('pxPerBL', 'Sheep size (px per body length)', 12, 120, 1);
    toggle('paused', 'Paused');
    toggle('debugColours', 'Colour by behaviour');
    toggle('links', 'Show who follows whom');
    body.appendChild(det);
  }

  for (const group of tuningSchema()) {
    const det = doc.createElement('details');
    det.className = 'tp-group';
    det.innerHTML = `<summary>${group.label} <em>${group.params.length}</em></summary>`;
    const blurb = doc.createElement('p');
    blurb.className = 'tp-blurb';
    blurb.textContent = group.blurb;
    det.appendChild(blurb);
    for (const spec of group.params) {
      const row = buildRow(spec);
      rows.push(row);
      det.appendChild(row.el);
      refreshChanged(spec);
    }
    body.appendChild(det);
  }

  const empty = doc.createElement('p');
  empty.className = 'tp-empty';
  empty.textContent = 'Nothing matches that.';
  empty.hidden = true;
  body.appendChild(empty);

  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = q === '' || row.haystack.includes(q);
      row.el.hidden = !hit;
      if (hit) shown++;
    }
    for (const det of Array.from(body.querySelectorAll('details.tp-group'))) {
      const d = det as HTMLDetailsElement;
      const any = Array.from(d.querySelectorAll('.tp-row')).some((r) => !(r as HTMLElement).hidden);
      d.hidden = q !== '' && !any;
      if (q !== '') d.open = true;
      const b = d.querySelector('.tp-blurb') as HTMLElement | null;
      if (b) b.hidden = q !== '';
    }
    empty.hidden = shown > 0 || q === '';
  });

  root.querySelector('#tp-reset')!.addEventListener('click', () => {
    const d = defaultConfig();
    for (const group of tuningSchema()) {
      for (const p of group.params) {
        const v = getPath(d, p.path);
        setPath(cfg, p.path, Array.isArray(v) ? [...v] : v);
      }
    }
    rows.forEach((r) => { r.sync(); refreshChanged(r.spec); });
    opts.onAction('reset');
    say('Back to defaults');
  });
  root.querySelector('#tp-respawn')!.addEventListener('click', () => opts.onAction('respawn'));
  root.querySelector('#tp-copy')!.addEventListener('click', () => {
    const patch = diffFromDefaults(cfg);
    const text = JSON.stringify(patch, null, 2);
    void navigator.clipboard?.writeText(text).then(
      () => say(`Copied ${Object.keys(patch).length} group(s)`),
      () => say('Clipboard refused; see the console'),
    );
    console.log('tuning patch:\n' + text);
  });
  root.querySelector('#tp-save')?.addEventListener('click', () => {
    opts.onAction('save', diffFromDefaults(cfg));
    say('Saved as the default');
  });

  return {
    setMetrics(m) {
      statsEl.innerHTML =
        `<span><b>fps</b> ${m.fps.toFixed(0)}</span>` +
        `<span><b>cohesion</b> ${m.cohesion.toFixed(2)}</span>` +
        `<span><b>spacing</b> ${m.nnd.toFixed(2)}</span>` +
        `<span><b>polarisation</b> ${m.polarisation.toFixed(2)}</span>` +
        `<span><b>groups</b> ${m.splits}</span>`;
      const bars = censusEl.children;
      const order = [0, 1, 2, 3];
      for (let i = 0; i < order.length; i++) {
        (bars[i] as HTMLElement).style.flexGrow = String(Math.max(0.001, m.fractions[order[i]] ?? 0));
      }
    },
    setConfig(next) {
      for (const group of tuningSchema()) {
        for (const p of group.params) {
          const v = getPath(next, p.path);
          setPath(cfg, p.path, Array.isArray(v) ? [...v] : v);
        }
      }
      rows.forEach((r) => { r.sync(); refreshChanged(r.spec); });
    },
    setFlock(f) { flock = f; },
    destroy() { root.remove(); },
  };
}
