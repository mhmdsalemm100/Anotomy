// Minimal static 3D kd-tree for nearest-neighbour queries over Float32Array points.

export class KDTree {
  /** @param {Float32Array|number[]} points flat xyz array */
  constructor(points) {
    this.points = points;
    const n = points.length / 3;
    this.idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.idx[i] = i;
    // nodes stored implicitly: build recursively into arrays of [start,end,axis,split]
    this.nodes = [];
    this.root = this.#build(0, n, 0);
  }

  #build(start, end, depth) {
    if (end - start <= 8) {
      this.nodes.push({ leaf: true, start, end });
      return this.nodes.length - 1;
    }
    // choose axis with largest spread
    const p = this.points;
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const j = this.idx[i] * 3;
      for (let a = 0; a < 3; a++) {
        const v = p[j + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    let axis = 0;
    for (let a = 1; a < 3; a++) if (max[a] - min[a] > max[axis] - min[axis]) axis = a;
    const mid = (start + end) >> 1;
    this.#select(start, end - 1, mid, axis);
    const split = p[this.idx[mid] * 3 + axis];
    const node = { leaf: false, axis, split, left: -1, right: -1 };
    this.nodes.push(node);
    const id = this.nodes.length - 1;
    node.left = this.#build(start, mid, depth + 1);
    node.right = this.#build(mid, end, depth + 1);
    return id;
  }

  // quickselect on idx by coordinate
  #select(lo, hi, k, axis) {
    const p = this.points, idx = this.idx;
    while (hi > lo) {
      const pivot = p[idx[(lo + hi) >> 1] * 3 + axis];
      let i = lo, j = hi;
      while (i <= j) {
        while (p[idx[i] * 3 + axis] < pivot) i++;
        while (p[idx[j] * 3 + axis] > pivot) j--;
        if (i <= j) {
          const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
          i++; j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /** k nearest neighbours of (x,y,z). Returns {indices, dist2} sorted ascending. */
  knn(x, y, z, k) {
    const bestI = new Int32Array(k).fill(-1);
    const bestD = new Float64Array(k).fill(Infinity);
    const p = this.points;
    const visit = (nodeId) => {
      const node = this.nodes[nodeId];
      if (node.leaf) {
        for (let i = node.start; i < node.end; i++) {
          const j = this.idx[i];
          const dx = p[j * 3] - x, dy = p[j * 3 + 1] - y, dz = p[j * 3 + 2] - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD[k - 1]) {
            let m = k - 1;
            while (m > 0 && bestD[m - 1] > d) { bestD[m] = bestD[m - 1]; bestI[m] = bestI[m - 1]; m--; }
            bestD[m] = d; bestI[m] = j;
          }
        }
        return;
      }
      const q = node.axis === 0 ? x : node.axis === 1 ? y : z;
      const diff = q - node.split;
      const first = diff < 0 ? node.left : node.right;
      const second = diff < 0 ? node.right : node.left;
      visit(first);
      if (diff * diff < bestD[k - 1]) visit(second);
    };
    visit(this.root);
    return { indices: bestI, dist2: bestD };
  }

  nearest(x, y, z) {
    const r = this.knn(x, y, z, 1);
    return { index: r.indices[0], dist2: r.dist2[0] };
  }
}
