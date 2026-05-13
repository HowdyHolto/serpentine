import { BoundaryShape, Point } from '../types';

export class OccupancyGrid {
  private grid: boolean[][];
  public readonly cols: number;
  public readonly rows: number;
  public readonly cellSize: number;
  public readonly originX: number;
  public readonly originY: number;

  constructor(boundary: BoundaryShape, cellSize: number) {
    this.cellSize = cellSize;
    this.originX = boundary.x;
    this.originY = boundary.y;
    this.cols = Math.max(1, Math.floor(boundary.width / cellSize));
    this.rows = Math.max(1, Math.floor(boundary.height / cellSize));

    this.grid = Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => false)
    );

    this.markOutOfBounds(boundary);
  }

  private markOutOfBounds(boundary: BoundaryShape) {
    if (boundary.type === 'ellipse') {
      const cx = boundary.width / 2;
      const cy = boundary.height / 2;
      const rx = boundary.width / 2;
      const ry = boundary.height / 2;
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          const x = (col + 0.5) * this.cellSize;
          const y = (row + 0.5) * this.cellSize;
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy > 1) {
            this.grid[row][col] = true;
          }
        }
      }
    }
  }

  isAvailable(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return false;
    return !this.grid[row][col];
  }

  occupy(col: number, row: number): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.grid[row][col] = true;
    }
  }

  unoccupy(col: number, row: number): void {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.grid[row][col] = false;
    }
  }

  cellToWorld(col: number, row: number): Point {
    return {
      x: this.originX + (col + 0.5) * this.cellSize,
      y: this.originY + (row + 0.5) * this.cellSize,
    };
  }

  worldToCell(wx: number, wy: number): { col: number; row: number } {
    return {
      col: Math.floor((wx - this.originX) / this.cellSize),
      row: Math.floor((wy - this.originY) / this.cellSize),
    };
  }

  countAvailable(): number {
    let count = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.grid[r][c]) count++;
      }
    }
    return count;
  }

  floodFillCount(startCol: number, startRow: number, useDiagonals: boolean = false): number {
    if (!this.isAvailable(startCol, startRow)) return 0;

    const visited = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
    const stack: number[] = [startCol, startRow];
    visited[startRow][startCol] = 1;
    let count = 1;

    while (stack.length > 0) {
      const r = stack.pop()!;
      const c = stack.pop()!;

      if (c > 0 && !visited[r][c - 1] && this.isAvailable(c - 1, r)) {
        visited[r][c - 1] = 1; count++; stack.push(c - 1, r);
      }
      if (c < this.cols - 1 && !visited[r][c + 1] && this.isAvailable(c + 1, r)) {
        visited[r][c + 1] = 1; count++; stack.push(c + 1, r);
      }
      if (r > 0 && !visited[r - 1][c] && this.isAvailable(c, r - 1)) {
        visited[r - 1][c] = 1; count++; stack.push(c, r - 1);
      }
      if (r < this.rows - 1 && !visited[r + 1][c] && this.isAvailable(c, r + 1)) {
        visited[r + 1][c] = 1; count++; stack.push(c, r + 1);
      }

      if (useDiagonals) {
        if (c > 0 && r > 0 && !visited[r - 1][c - 1] && this.isAvailable(c - 1, r - 1)) {
          visited[r - 1][c - 1] = 1; count++; stack.push(c - 1, r - 1);
        }
        if (c < this.cols - 1 && r > 0 && !visited[r - 1][c + 1] && this.isAvailable(c + 1, r - 1)) {
          visited[r - 1][c + 1] = 1; count++; stack.push(c + 1, r - 1);
        }
        if (c > 0 && r < this.rows - 1 && !visited[r + 1][c - 1] && this.isAvailable(c - 1, r + 1)) {
          visited[r + 1][c - 1] = 1; count++; stack.push(c - 1, r + 1);
        }
        if (c < this.cols - 1 && r < this.rows - 1 && !visited[r + 1][c + 1] && this.isAvailable(c + 1, r + 1)) {
          visited[r + 1][c + 1] = 1; count++; stack.push(c + 1, r + 1);
        }
      }
    }

    return count;
  }

  isMoveSafe(toCol: number, toRow: number, useDiagonals: boolean = false): boolean {
    this.occupy(toCol, toRow);

    const total = this.countAvailable();
    if (total === 0) {
      this.unoccupy(toCol, toRow);
      return true;
    }

    let startC = -1;
    let startR = -1;
    const cardinalDirs = [
      { dc: 0, dr: -1 }, { dc: 0, dr: 1 },
      { dc: -1, dr: 0 }, { dc: 1, dr: 0 },
    ];
    const diagDirs = [
      { dc: -1, dr: -1 }, { dc: 1, dr: -1 },
      { dc: -1, dr: 1 }, { dc: 1, dr: 1 },
    ];
    const searchDirs = useDiagonals ? [...cardinalDirs, ...diagDirs] : cardinalDirs;

    for (const d of searchDirs) {
      const nc = toCol + d.dc;
      const nr = toRow + d.dr;
      if (this.isAvailable(nc, nr)) {
        startC = nc;
        startR = nr;
        break;
      }
    }

    if (startC === -1) {
      this.unoccupy(toCol, toRow);
      return false;
    }

    const reachable = this.floodFillCount(startC, startR, useDiagonals);
    this.unoccupy(toCol, toRow);

    return reachable === total;
  }
}
