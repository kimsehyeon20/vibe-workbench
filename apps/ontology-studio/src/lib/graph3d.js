// 3D 그래프 화면(three.js + 3d-force-graph)을 감싼 작은 클래스. React 밖에서 직접 그린다.
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { forceX, forceY, forceZ } from 'd3-force-3d';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURFACE, INK, mix } from './palette.js';

const FONT = '"Pretendard Variable", Pretendard, system-ui, sans-serif';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 클래스마다 다른 모양(색과 함께 이중으로 구분)
const GEOMS = [
  () => new THREE.SphereGeometry(1, 20, 14),
  () => new THREE.BoxGeometry(1.55, 1.55, 1.55),
  () => new THREE.OctahedronGeometry(1.35),
  () => new THREE.TetrahedronGeometry(1.55),
  () => new THREE.CylinderGeometry(0.95, 0.95, 1.7, 16),
  () => new THREE.TorusGeometry(0.9, 0.38, 10, 20),
  () => new THREE.DodecahedronGeometry(1.2),
  () => mergeGeometries([new THREE.BoxGeometry(2.2, 0.7, 0.7), new THREE.BoxGeometry(0.7, 2.2, 0.7), new THREE.BoxGeometry(0.7, 0.7, 2.2)]),
];

function fibonacciSphere(i, n, r) {
  if (n <= 1) return { x: 0, y: 0, z: 0 };
  const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = Math.PI * (3 - Math.sqrt(5)) * i;
  return { x: Math.cos(th) * rad * r, y: y * r, z: Math.sin(th) * rad * r };
}

export class GraphView {
  constructor(el, cb) {
    this.el = el;
    this.cb = cb;
    this.mode = 'light';
    this.objs = new Map();
    this.cache = new Map();
    this.geoms = new Map();
    this.mats = new Map();
    this.hl = null;
    this.selected = null;
    this.labelMode = 'auto';
    this.linkSprites = [];
    this.fitPending = true;
    this.data = { nodes: [], links: [] };

    const fg = new ForceGraph3D(el, { controlType: 'orbit' });
    this.fg = fg;
    fg.showNavInfo(false)
      .nodeId('id')
      .nodeLabel(n => `<div class="tip"><b>${esc(n.label)}</b><span>${esc(n.className)}</span></div>`)
      .nodeThreeObject(n => this.makeNode(n))
      .linkLabel(l => `<div class="tip">${esc(l.typeName)}${l.inferred ? ' (추론)' : ''}</div>`)
      .linkOpacity(0.9)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticleWidth(1.8)
      .linkDirectionalParticleSpeed(0.006)
      .linkCurvature('curve')
      .onNodeClick(n => cb.onNodeClick?.(n.id))
      .onBackgroundClick(() => cb.onBackgroundClick?.())
      .onDagError(() => cb.onDagError?.())
      .cooldownTicks(220)
      .onEngineTick(() => this.updateLinkLabels())
      .onEngineStop(() => {
        this.updateLinkLabels();
        if (this.fitPending && this.data.nodes.length) { this.fitPending = false; fg.zoomToFit(700, 40); }
      });
    this.applyLinkAccessors();
    try { fg.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch { /* 무시 */ }
    this.setMode('light');

    this.offset = 0;
    this.ro = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w && h) { fg.width(w).height(h); this.applyOffset(); }
    });
    this.ro.observe(el);
  }

  // ── 노드 ──
  geom(shape) {
    const k = ((shape % GEOMS.length) + GEOMS.length) % GEOMS.length;
    if (!this.geoms.has(k)) this.geoms.set(k, GEOMS[k]());
    return this.geoms.get(k);
  }
  mat(color, state) {
    const key = `${color}|${state}`;
    if (!this.mats.has(key)) {
      const dim = state.includes('dim'), stub = state.includes('stub');
      const c = dim ? mix(color, SURFACE[this.mode], 0.78) : color;
      this.mats.set(key, new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: dim ? 0.35 : stub ? 0.55 : 0.96, wireframe: stub && !dim }));
    }
    return this.mats.get(key);
  }
  nodeState(n) {
    const dim = this.hl && !this.hl.nodes.has(n.id);
    return `${n.stub ? 'stub' : 'solid'}${dim ? '-dim' : ''}`;
  }
  makeNode(n) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.geom(n.shape), this.mat(n.color, this.nodeState(n)));
    mesh.scale.setScalar(n.r);
    group.add(mesh);
    const o = { group, mesh, sprite: null, halo: null, label: n.label };
    this.objs.set(n.id, o);
    this.styleNode(n, o);
    return group;
  }
  styleNode(n, o) {
    o.mesh.geometry = this.geom(n.shape);
    o.mesh.material = this.mat(n.color, this.nodeState(n));
    o.mesh.scale.setScalar(n.r);
    if (o.sprite && o.label !== n.label) { o.group.remove(o.sprite); o.sprite.material.map?.dispose(); o.sprite.material.dispose(); o.sprite = null; }
    o.label = n.label;
    const show = this.labelVisible(n);
    if (show && !o.sprite) {
      const s = new SpriteText(n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label, 3.4, INK[this.mode]);
      s.fontFace = FONT; s.fontWeight = '600';
      s.backgroundColor = this.mode === 'dark' ? 'rgba(26,26,25,.78)' : 'rgba(252,252,251,.82)';
      s.padding = [1.4, 0.8]; s.borderRadius = 2;
      s.material.depthWrite = false;
      o.sprite = s; o.group.add(s);
    }
    if (o.sprite) { o.sprite.visible = show; o.sprite.position.set(0, n.r + 4.2, 0); }
    const sel = this.selected === n.id;
    if (sel && !o.halo) {
      o.halo = new THREE.Mesh(this.geom(0), new THREE.MeshBasicMaterial({ color: INK[this.mode], transparent: true, opacity: 0.14, depthWrite: false }));
      o.group.add(o.halo);
    }
    if (o.halo) { o.halo.visible = sel; o.halo.scale.setScalar(n.r * 1.9); }
  }
  labelVisible(n) {
    if (n.id === this.selected) return true;
    if (this.labelMode === 'none') return false;
    if (this.hl) return this.hl.nodes.has(n.id) && this.hl.nodes.size <= 80;
    if (this.labelMode === 'all') return this.data.nodes.length <= 600 || n.hub;
    return n.hub;
  }
  restyleNodes() {
    for (const n of this.data.nodes) { const o = this.objs.get(n.id); if (o) this.styleNode(n, o); }
  }

  // ── 연결선 ──
  isHl(l) { return this.hl?.links.has(l.id); }
  linkColor(l) {
    if (this.hl && !this.isHl(l)) return mix(l.color, SURFACE[this.mode], 0.85);
    return l.inferred ? mix(l.color, SURFACE[this.mode], 0.4) : l.color;
  }
  applyLinkAccessors() {
    const many = this.data.links.length > 2500;
    this.fg
      .linkColor(l => this.linkColor(l))
      .linkWidth(l => (many && !this.isHl(l) ? 0 : this.isHl(l) ? 1.5 : l.inferred ? 0.35 : 0.7))
      .linkDirectionalArrowLength(l => (l.directed ? (this.isHl(l) ? 4.2 : 3) : 0))
      .linkDirectionalArrowColor(l => this.linkColor(l))
      .linkDirectionalParticles(l => (this.isHl(l) && this.hl.links.size <= 200 ? 2 : 0))
      .linkDirectionalParticleColor(l => l.color);
  }
  clearLinkLabels() {
    for (const s of this.linkSprites) { this.fg.scene().remove(s); s.material.map?.dispose(); s.material.dispose(); }
    this.linkSprites = [];
  }
  makeLinkLabels() {
    this.clearLinkLabels();
    if (!this.hl || this.hl.links.size > 40) return;
    for (const l of this.data.links) {
      if (!this.isHl(l)) continue;
      const s = new SpriteText(l.typeName + (l.inferred ? ' (추론)' : ''), 2.4, INK[this.mode]);
      s.fontFace = FONT; s.fontWeight = '600';
      s.backgroundColor = this.mode === 'dark' ? 'rgba(26,26,25,.9)' : 'rgba(252,252,251,.92)';
      s.borderColor = l.color; s.borderWidth = 0.4; s.borderRadius = 2; s.padding = [1.2, 0.6];
      s.material.depthWrite = false;
      s.__link = l;
      this.fg.scene().add(s);
      this.linkSprites.push(s);
    }
    this.updateLinkLabels();
  }
  updateLinkLabels() {
    for (const s of this.linkSprites) {
      const l = s.__link, a = l.source, b = l.target;
      if (typeof a !== 'object' || typeof b !== 'object' || a.x == null) continue;
      if (l.__curve) { const p = l.__curve.getPoint(0.5); s.position.set(p.x, p.y, p.z); }
      else s.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    }
  }

  // ── 바깥에서 부르는 함수 ──
  setMode(mode) {
    if (mode === this.mode && this.fg.backgroundColor() === SURFACE[mode]) return;
    this.mode = mode;
    this.fg.backgroundColor(SURFACE[mode]);
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
    for (const o of this.objs.values()) {
      if (o.sprite) { o.group.remove(o.sprite); o.sprite.material.map?.dispose(); o.sprite.material.dispose(); o.sprite = null; }
      if (o.halo) { o.group.remove(o.halo); o.halo.material.dispose(); o.halo = null; }
    }
  }

  setData(data) {
    // 이미 있던 노드는 같은 객체를 다시 써서 위치를 유지한다
    const nodes = data.nodes.map(n => {
      const old = this.cache.get(n.id);
      return old ? Object.assign(old, n) : n;
    });
    this.cache = new Map(nodes.map(n => [n.id, n]));
    for (const id of [...this.objs.keys()]) if (!this.cache.has(id)) this.objs.delete(id);
    if (!this.data.nodes.length && nodes.length) {
      this.fitPending = true;
      // 배치가 끝나기 전에도 한 번 화면에 맞춰서 처음부터 작게 보이지 않게
      clearTimeout(this.fitTimer);
      this.fitTimer = setTimeout(() => { if (this.data.nodes.length) this.fg.zoomToFit(600, 40); }, 1400);
    }
    this.data = { nodes, links: data.links };
    this.fg.graphData(this.data);
    this.applyLinkAccessors();
    this.restyleNodes();
    this.makeLinkLabels();
  }

  setHighlight(hl, selected) {
    this.hl = hl && hl.nodes.size ? hl : null;
    this.selected = selected || null;
    this.restyleNodes();
    this.applyLinkAccessors();
    this.makeLinkLabels();
  }

  setLabelMode(mode) { this.labelMode = mode; this.restyleNodes(); }

  setLayout(mode) {
    const fg = this.fg;
    fg.dagMode(mode === 'dag' ? 'td' : mode === 'radial' ? 'radialout' : null).dagLevelDistance(mode === 'dag' || mode === 'radial' ? 34 : null);
    if (mode === 'cluster') {
      const groups = new Set(this.data.nodes.map(n => n.group));
      const n = Math.max(groups.size, 1), R = 45 + 9 * Math.sqrt(this.data.nodes.length);
      const anchor = new Map([...groups].sort((a, b) => a - b).map((g, i) => [g, fibonacciSphere(i, n, R)]));
      fg.d3Force('x', forceX(d => anchor.get(d.group)?.x || 0).strength(0.09));
      fg.d3Force('y', forceY(d => anchor.get(d.group)?.y || 0).strength(0.09));
      fg.d3Force('z', forceZ(d => anchor.get(d.group)?.z || 0).strength(0.09));
    } else {
      fg.d3Force('x', null); fg.d3Force('y', null); fg.d3Force('z', null);
    }
    this.fitPending = true;
    fg.d3ReheatSimulation();
  }

  focus(id) {
    const n = this.cache.get(id);
    if (!n || n.x == null) return;
    const d = 150, len = Math.hypot(n.x, n.y, n.z) || 1, k = 1 + d / len;
    this.fg.cameraPosition({ x: n.x * k, y: n.y * k, z: (n.z || 0) * k + (len < 1 ? d : 0) }, n, 900);
  }
  // 아래 정보 패널에 가리지 않게 화면 중심을 위로 올린다(0~0.5: 화면 높이 비율)
  setOffset(frac) { this.offset = frac; this.applyOffset(); }
  applyOffset() {
    const cam = this.fg.camera(), w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    if (this.offset) cam.setViewOffset(w, h, 0, Math.round(h * this.offset), w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
  }
  fit() { this.fg.zoomToFit(700, 40); }
  pause() { this.fg.pauseAnimation(); }
  resume() { this.fg.resumeAnimation(); }
  screenshot() {
    const r = this.fg.renderer();
    r.render(this.fg.scene(), this.fg.camera());
    return r.domElement.toDataURL('image/png');
  }
  destroy() {
    clearTimeout(this.fitTimer);
    this.ro.disconnect();
    this.clearLinkLabels();
    this.fg._destructor?.();
    for (const g of this.geoms.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
