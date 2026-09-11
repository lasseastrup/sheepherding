/** Uniform grid rebuilt every step with a counting sort. Zero allocation after construction. */
export class UniformGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly fill: Int32Array;

  constructor(width: number, height: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    this.cellItems = new Int32Array(capacity);
    this.cellOf = new Int32Array(capacity);
    this.fill = new Int32Array(this.cols * this.rows);
  }

  cellX(x: number): number {
    const c = Math.floor(x / this.cellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cellY(y: number): number {
    const r = Math.floor(y / this.cellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  build(px: Float32Array, py: Float32Array, n: number): void {
    const cs = this.cellStart;
    cs.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellY(py[i]) * this.cols + this.cellX(px[i]);
      this.cellOf[i] = c;
      cs[c + 1]++;
    }
    for (let c = 0; c < cs.length - 1; c++) cs[c + 1] += cs[c];
    for (let c = 0; c < this.fill.length; c++) this.fill[c] = cs[c];
    for (let i = 0; i < n; i++) this.cellItems[this.fill[this.cellOf[i]]++] = i;
  }
}
