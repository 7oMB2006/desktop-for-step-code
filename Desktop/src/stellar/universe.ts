import * as THREE from 'three';
import { vertex, fragment } from './stellar-field';
import { createScenery, type SceneryRole } from './scenery';
import { defaults, qualityPresets } from './settings';
import type { StellarScene } from '../theme-packs';
import { compactDragonRect } from './composition';
const SPECTRUM_BINS = 64;

type Dragon = {
  width: number; height: number; layoutWidth: number; layoutHeight: number;
  eye: { x: number; y: number; rx: number; ry: number }; points: number[];
  relic: { x: number; y: number; radius: number };
  palette: number[][];
};
type Landmarks = { width: number; height: number; stride: number; points: number[] };
type Role = 'dragon' | 'title' | 'stars' | 'sea' | 'celestial' | 'duck' | 'wake' | 'spectrum' | SceneryRole;
// CSS-pixel travel at the viewport edge, independent of each point cloud's internal thickness.
const PARALLAX: Record<Role, number> = {
  stars: 2.5, canopy: 3, starfall: 4, sea: 7, galaxy: 9, celestial: 11,
  planetRings: 11, asteroids: 10, dragon: 5, duck: 8, wake: 8, title: 0, spectrum: 7,
};
type Star = { x: number; y: number; z: number; palette?: number; brightness?: number; identity?: number; eye?: number; tint?: number[]; size?: number; relic?: number; field?: number };
type Layer = {
  role: Role;
  group: THREE.Group;
  geometry: THREE.BufferGeometry;
  materials: THREE.RawShaderMaterial[];
  uniforms: Record<string, THREE.IUniform>;
  occlusion?: THREE.Mesh<THREE.BufferGeometry, THREE.RawShaderMaterial>;
};
type AudioFrame = { bass: number; mid: number; treble: number; ages: number[]; strengths: number[]; spectrum: number[]; peaks: number[] };

const clamp = THREE.MathUtils.clamp;
export const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// The world is present throughout; camera distance reveals its larger forms.
export const SHOTS = Object.freeze({
  arrival: .48, pullbackStart: .24, pullback: .82, title: .84, settled: .97,
});

export class Universe {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private layers: Layer[] = [];
  private duckSource: Landmarks | undefined;
  private width = 1;
  private height = 1;
  private sidebarInset = 0;
  private progress = 0;
  private clock = 0;
  private fieldClock = 0;
  private departure = { retreat: 0, selected: 1, energy: 0, travel: 0, zoom: 1, clock: 0, focus: new THREE.Vector2() };
  private seed = 19062026;
  private live = true;
  private disposed = false;
  private frames = 0;
  private zoom = 1;
  private cameraCenter = new THREE.Vector2();
  private clearances: { x: number; y: number; rx: number; ry: number }[] = [];
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private pointerStrength = 0;
  private pointerStrengthTarget = 0;
  private gravityPointer = new THREE.Vector2();
  private gravityTarget = new THREE.Vector2();
  private gravityStrength = 0;
  private gravityTargetStrength = 0;
  private audioFrame: AudioFrame = { bass: 0, mid: 0, treble: 0, ages: [1, 1, 1, 1], strengths: [0, 0, 0, 0],
    spectrum: Array(SPECTRUM_BINS).fill(0), peaks: Array(SPECTRUM_BINS).fill(0) };
  private spectrumPixels = new Uint8Array(SPECTRUM_BINS * 4);
  private spectrumTexture = new THREE.DataTexture(this.spectrumPixels, SPECTRUM_BINS, 1);
  private spectrumActive = false;
  private settings = { ...defaults };
  private duckScreen = { x: 0, y: 0, width: 0 };
  private relics: { shape: 'sphere' | 'cube'; x: number; y: number; radius: number; count: number }[] = [];
  private pointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || this.reducedMotion()) return;
    const bounds = this.stage.getBoundingClientRect();
    this.pointerTarget.set((event.clientX - bounds.left - this.width / 2) / this.height,
      (this.height / 2 - event.clientY + bounds.top) / this.height);
    this.pointerStrengthTarget = 1;
    this.gravityTarget.copy(this.pointerTarget);
    this.gravityTargetStrength = 1;
  };
  private pointerLeave = () => {
    this.pointerTarget.set(0, 0); this.pointerStrengthTarget = 0;
    // Leave the attractor where it was; fade its influence instead of sweeping to the center.
    this.gravityTargetStrength = 0;
  };

  constructor(private canvas: HTMLCanvasElement, private stage: HTMLElement, private artwork: StellarScene,
    private reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    private pointerSurface: HTMLElement = stage, private workspace = false) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, powerPreference: 'default',
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor('#05070a', 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.spectrumTexture.minFilter = THREE.LinearFilter;
    this.spectrumTexture.magFilter = THREE.LinearFilter;
    this.spectrumTexture.needsUpdate = true;
    this.pointerSurface.addEventListener('pointermove', this.pointerMove);
    this.pointerSurface.addEventListener('pointerleave', this.pointerLeave);
  }

  async ready() {
    this.duckSource = this.artwork.duck;
    if (!this.disposed) this.resize();
  }

  configure(settings: typeof defaults) {
    const rebuild = settings.quality !== this.settings.quality;
    this.settings = { ...settings };
    if (rebuild) this.resize();
  }

  setAudio(frame: AudioFrame) {
    this.audioFrame = frame;
    this.spectrumActive = false;
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const level = Math.round(frame.spectrum[i] * 255), peak = Math.round(frame.peaks[i] * 255);
      this.spectrumPixels.set([level, peak, 0, 255], i * 4);
      if (level > 0 || peak > 0) this.spectrumActive = true;
    }
    this.spectrumTexture.needsUpdate = true;
  }

  private random() {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return (this.seed >>> 0) / 4294967296;
  }
  private normal() {
    return Math.sqrt(-2 * Math.log(Math.max(this.random(), 1e-7))) * Math.cos(2 * Math.PI * this.random());
  }

  private addLayer(role: Role, points: Star[], center = new THREE.Vector2()) {
    const quality = qualityPresets[this.settings.quality as keyof typeof qualityPresets];
    // Sample across the entire cloud: truncating would remove late-built rings and rocks.
    points = points.filter((p, i) => p.eye || (i * .61803398875) % 1 < quality.density);
    const positions: number[] = [], origins: number[] = [], meta: number[] = [], styles: number[] = [], tints: number[] = [];
    const background = role === 'stars';
    for (const p of points) {
      positions.push(p.x, p.y, p.z);
      const seed = this.random();
      if (role !== 'title' && role !== 'duck') origins.push(p.x, p.y, p.z);
      else origins.push(center.x + (this.random() - .5) * this.width / this.height * 1.8,
        center.y + (this.random() - .5) * 1.4, (this.random() - .5) * .65);
      const size = p.size ?? (background ? .85 + this.random() ** 4 * 3.8 : seed > .997 ? 4.5 + this.random() * 2 : .65 + this.random() ** 4 * 2.1);
      meta.push(size, seed, background ? .40 + this.random() * .8 : .40 + this.random() ** 1.7 * 1.1, background ? 1 : 0);
      styles.push(p.palette ?? 0, p.brightness ?? 1, p.identity ?? 0, p.eye ?? 0);
      tints.push(...(p.tint ?? [1, 1, 1]));
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, data, size] of [
      ['aFrom', origins, 3], ['aTo', positions, 3], ['aMeta', meta, 4], ['aStyle', styles, 4], ['aTint', tints, 3],
    ] as const) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
    geometry.setAttribute('position', geometry.getAttribute('aFrom'));
    geometry.setAttribute('aRelic', new THREE.Float32BufferAttribute(points.map(p => p.relic ?? 0), 1));
    geometry.setAttribute('aField', new THREE.Float32BufferAttribute(points.map(p => p.field ?? 0), 1));
    geometry.setDrawRange(0, points.length);
    const uniforms: Layer['uniforms'] = {
      uProgress: { value: 1 }, uTime: { value: 0 }, uAspect: { value: this.width / this.height },
      uBrightness: { value: 1 / Math.sqrt(quality.density) },
      uDpr: { value: this.renderer.getPixelRatio() }, uHeight: { value: this.height },
      uMotion: { value: 1 }, uReveal: { value: 0 }, uScale: { value: 1 }, uZoom: { value: 1 },
      uTint: { value: ['duck', 'sea', 'wake', 'spectrum', 'celestial', 'canopy', 'galaxy', 'asteroids', 'starfall', 'planetRings'].includes(role) ? 1 : 0 }, uBreath: { value: this.layers.length * 1.7 },
      uKind: { value: role === 'spectrum' ? 8 : role === 'starfall' ? 6 : role === 'galaxy' ? 5 : role === 'duck' ? 4 : role === 'wake' ? 3 : role === 'sea' ? 2 : role === 'stars' ? 1 : 0 },
      uCamera: { value: new THREE.Vector2() }, uTrailHead: { value: new THREE.Vector2() },
      uTrailVector: { value: new THREE.Vector2() }, uTrailWidth: { value: .02 }, uDetail: { value: 1 },
      uFootprint: { value: 1 },
      uParallax: { value: PARALLAX[role] }, uNearParallax: { value: role === 'asteroids' ? 22 : 0 },
      uPointerStrength: { value: 0 },
      uGravity: { value: 0 }, uGravityPointer: { value: this.gravityPointer },
      uAudio: { value: new THREE.Vector3() },
      uSpectrum: { value: this.spectrumTexture }, uSpectrumActive: { value: 0 },
      uPulseAges: { value: new THREE.Vector4(1, 1, 1, 1) }, uPulseStrengths: { value: new THREE.Vector4() },
      uAudioRole: { value: role === 'sea' || role === 'wake' ? 1 : role === 'dragon' ? 2 : role === 'stars' || role === 'canopy' ? 3 : 0 },
      uRetreat: { value: 0 }, uCoreZoom: { value: 1 }, uCoreTravel: { value: 0 },
      uCoreSelected: { value: 1 }, uCoreEnergy: { value: 0 }, uCoreFocus: { value: new THREE.Vector2() },
      uFieldTime: { value: 0 }, uRelicOrigin: { value: new THREE.Vector3() },
      uPointerScatter: { value: ['stars', 'sea', 'wake', 'canopy', 'starfall'].includes(role) ? 1 : 0 },
      uBrandBox: { value: new THREE.Vector4() },
      uOffset: { value: new THREE.Vector3() }, uCenter: { value: center }, uPointer: { value: this.pointer },
    };
    const group = new THREE.Group();
    const materials = [1, 0].map(halo => {
      const material = new THREE.RawShaderMaterial({
        vertexShader: vertex, fragmentShader: fragment,
        uniforms: { ...uniforms, uHalo: { value: halo } },
        transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Points(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = role === 'asteroids' ? 2 : role === 'dragon' || role === 'title' ? 3 : 0;
      group.add(mesh);
      return material;
    });
    this.scene.add(group);
    const layer = { role, group, geometry, materials, uniforms };
    this.layers.push(layer);
    return layer;
  }

  private addForegroundOcclusion(layer: Layer, triangles: number[]) {
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.Float32BufferAttribute(triangles, 3), count = positions.count;
    for (const name of ['position', 'aFrom', 'aTo']) geometry.setAttribute(name, positions);
    const meta = new Float32Array(count * 4), styles = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      meta.set([1, .5, 1, 0], i * 4);
      styles.set([0, 1, 1, 0], i * 4);
    }
    geometry.setAttribute('aMeta', new THREE.BufferAttribute(meta, 4));
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(styles, 4));
    geometry.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    geometry.setAttribute('aRelic', new THREE.BufferAttribute(new Float32Array(count), 1));
    geometry.setAttribute('aField', new THREE.BufferAttribute(new Float32Array(count), 1));
    // This only suppresses the distant light behind the near rocks. Their visible surface stays points.
    const material = new THREE.RawShaderMaterial({
      vertexShader: vertex,
      fragmentShader: 'precision mediump float; void main(){gl_FragColor=vec4(.01960784,.02745098,.03921569,.97);}',
      uniforms: { ...layer.uniforms, uHalo: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    layer.group.add(mesh);
    layer.occlusion = mesh;
  }

  private makeStars() {
    const points: Star[] = [];
    const aspect = this.width / this.height;
    for (let i = 0; i < (this.width < 600 ? 9500 : 22000); i++) {
      const x = (this.random() - .5) * aspect * 2.5, y = (this.random() - .5) * 2;
      points.push({ x, y, z: this.random() * .8,
        brightness: (.8 + this.random() * .7) * (.25 + this.ambientWeight(x, y) * .75) });
    }
    this.addLayer('stars', points);
    const sea: Star[] = [];
    const colors = [[.20, .60, 1], [.28, .86, 1], [.67, .46, 1], [1, .68, .28], [.42, .68, 1]];
    for (let i = 0; i < (this.width < 600 ? 36000 : 88000); i++) {
      const x = (this.random() - .5) * Math.max(aspect * 2, 2);
      const lane = i % colors.length;
      const dust = i % 4 === 0;
      const spread = this.normal() * (dust ? .105 : .009 + lane * .002);
      const y = x * .24 - .20 + Math.sin(x * 2.8 + lane * .65) * .045 + (lane - 2) * .025 + spread;
      const clearance = this.ambientWeight(x, y);
      if (clearance < .015) continue;
      sea.push({ x, y, z: .08 + Math.abs(spread) * 1.4 + this.random() * .08,
        tint: colors[lane], brightness: (dust ? .75 : 1.4 + this.random() * 1.0) * clearance,
        size: dust ? 1.4 + this.random() * 2.7 : 1 + this.random() ** 3 * 2.2, identity: 1 });
      if (i % 6 === 0) {
        sea.push({ x, y: y + this.normal() * .018, z: .28,
          tint: colors[lane], brightness: (.055 + this.random() * .055) * clearance,
          size: 9 + this.random() * 14, identity: 1 });
      }
    }
    this.addLayer('sea', sea);
  }

  private makeSpectrum() {
    const points: Star[] = [];
    const palette = [[1, .65, .24], [1, .40, .57], [.63, .43, 1], [.22, .68, 1], [.27, 1, .91]];
    const count = this.width < 600 ? 18000 : 34000;
    for (let i = 0; i < count; i++) {
      const q = this.random(), ramp = q * (palette.length - 1), at = Math.min(palette.length - 2, Math.floor(ramp));
      const tint = palette[at].map((value, channel) => THREE.MathUtils.lerp(value, palette[at + 1][channel], ramp - at));
      const kind = i % 20 < 2 ? 0 : i % 20 < 15 ? 1 : i % 20 < 18 ? 2 : 3;
      points.push({ x: q, y: this.random(), z: kind, tint, identity: 1,
        brightness: kind === 0 ? 1.0 : kind === 2 ? 1.2 : 1.1,
        size: kind === 0 ? 1.25 : kind === 2 ? 1.9 : 1.2 + this.random() * .8 });
    }
    this.addLayer('spectrum', points);
  }

  private ambientWeight(x: number, y: number) {
    let weight = 1;
    for (const zone of this.clearances) {
      const distance = Math.hypot((x - zone.x) / zone.rx, (y - zone.y) / zone.ry);
      weight = Math.min(weight, smooth(.88, 1.45, distance));
    }
    return weight;
  }

  private makeCelestials() {
    const w = this.width, h = this.height, mobile = w < 600;
    const points: Star[] = [];
    const add = (x: number, y: number, z: number, tint: number[], brightness: number, size?: number) => {
      points.push({ x: (x - w / 2) / h, y: (h / 2 - y) / h, z,
        tint, brightness, identity: 1, size });
    };
    // A tilted stellar ring and a stippled, illuminated hemisphere, in the upper-right negative space.
    const cx = w * .81, cy = h * .17;
    const radius = mobile ? 23 : Math.min(h * .056, w * .044);
    for (let i = 0; i < (mobile ? 2100 : 5400); i++) {
      const y = this.random() * 2 - 1, angle = this.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y), x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      if (z < 0) continue;
      const light = Math.max(.10, x * -.35 + y * -.45 + z * .65);
      const latitude = y + x * .32 + Math.sin(x * 6 + y * 3) * .07;
      const bands = .5 + Math.sin(latitude * 24 + Math.sin(latitude * 9) * 1.6) * .5;
      const rim = (1 - z) ** 3;
      const shade = .46 + bands * .54;
      add(cx + x * radius, cy + y * radius, z * .014,
        [.35 + bands * .40 + rim * .18, .52 + bands * .23 + rim * .22, 1],
        (.30 + light * 1.35) * shade + rim * .40);
    }
    for (let i = 0; i < (mobile ? 2400 : 6000); i++) {
      const angle = this.random() * Math.PI * 2;
      const r = radius * (1.65 + this.random() * .50);
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r * .28;
      const tilt = -.35;
      const px = x * Math.cos(tilt) - y * Math.sin(tilt);
      const py = x * Math.sin(tilt) + y * Math.cos(tilt);
      if (Math.sin(angle) < 0 && Math.hypot(px, py) < radius * 1.05) continue;
      const band = (r / radius - 1.65) / .50;
      const gap = band > .44 && band < .52;
      const tint = band < .28 ? [1, .78, .52] : band < .65 ? [.37, .84, 1] : [.79, .57, .94];
      add(cx + px, cy + py, 0, tint, (.65 + this.random() * .8) * (gap ? .10 : 1));
    }
    // Diffraction rays establish one larger distant star, not a blurred decorative orb.
    const sx = w * .56, sy = h * .14, ray = mobile ? 13 : 25;
    for (let i = 0; i < 360; i++) {
      const arm = i % 4, t = this.random(), a = arm * Math.PI / 2 + .12;
      const length = t * ray * (arm % 2 ? 1 : .68);
      add(sx + Math.cos(a) * length + this.normal() * .45,
        sy + Math.sin(a) * length + this.normal() * .45, 0,
        [1, .87, .63], (1 - t) ** 1.7 * 1.3, 1 + (1 - t) * 2);
    }
    const rocks = mobile
      ? [[.12, .76, 8], [.20, .79, 5], [.29, .75, 4]]
      : [[.20, .75, 17], [.26, .79, 10], [.30, .74, 6], [.91, .28, 8], [.94, .25, 5]];
    rocks.forEach(([rx, ry, size], index) => {
      const count = Math.round(size * size * 5);
      for (let i = 0; i < count; i++) {
        const y = this.random() * 2 - 1, a = this.random() * Math.PI * 2;
        const s = Math.sqrt(1 - y * y), z = Math.sin(a) * s;
        if (z < 0) continue;
        const x = Math.cos(a) * s;
        const roughness = 1 + Math.sin(a * 5 + index) * .14 + Math.cos(y * 8 + index) * .08;
        const light = .3 + Math.max(0, -x * .55 - y * .25 + z * .5) * .7;
        add(w * rx + x * size * roughness, h * ry + y * size * roughness * .72, z * .012,
          [.69, .73, .86], light, .7 + this.random() * 1.3);
      }
    });
    this.addLayer('celestial', points);
  }

  private makeDuck() {
    const source = this.duckSource!;
    if (!source?.points.length) throw new Error('Missing motorcycle landmarks');
    const closeSize = this.width < 600 ? 144 : Math.min(this.width * .19, this.height * .34, 310);
    const pointScale = clamp(this.height / 900, .75, 1.35);
    const points: Star[] = [], count = Math.round(17000 * (closeSize / 274 / pointScale) ** 2);
    for (let i = 0; i < count; i++) {
      const at = Math.floor(this.random() * source.points.length / source.stride) * source.stride;
      const [x, y, r, g, b] = source.points.slice(at, at + source.stride);
      const dust = i % 17 === 0;
      const jitter = dust ? .7 : .22;
      let tint: number[];
      const light = (.2126 * r + .7152 * g + .0722 * b) / 255;
      const shadow = light < .23;
      const eye = x >= 112 && x <= 119 && y >= 23 && y <= 33 && light < .22;
      if (shadow) tint = [.48, .28, .84];
      else if (Math.min(r, g, b) > 185) tint = [.88, .96, 1];
      else if (r > 150 && g > 100 && b < 120) tint = [1, .76, .25];
      else if (g > r * 1.1 && b > 100) tint = [.20, .87, 1];
      else {
        const peak = Math.max(r, g, b);
        tint = [r / peak, g / peak, b / peak];
      }
      points.push({
        x: (x - source.width / 2 + this.normal() * jitter) / source.width,
        y: (source.height / 2 - y + this.normal() * jitter) / source.width,
        z: this.normal() * (dust ? .045 : .009),
        brightness: eye ? .035 : shadow ? .40 : .23 + light ** .85 * 1.35, identity: 1, tint,
      });
    }
    const wake: Star[] = [];
    const colors = [[.20, .88, 1], [.57, .36, 1], [1, .72, .24], [.66, .91, 1]];
    for (let i = 0; i < (this.width < 600 ? 7000 : 15000); i++) {
      const lane = i % colors.length;
      wake.push({ x: this.random(), y: this.normal() * (i % 7 === 0 ? .5 : .08), z: (lane - 1.5) / 1.5,
        identity: 1, tint: colors[lane], brightness: .6 + this.random() * .6,
        size: .7 + this.random() ** 3 * 1.6 });
    }
    this.addLayer('wake', wake);
    this.addLayer('duck', points);
  }

  private dragonRect(index: number, source: Dragon) {
    const w = this.width, h = this.height, mobile = w < 600;
    const artHeight = mobile ? Math.min(h * .23, 194) : Math.min(h * (index ? .47 : .55), w * (index ? .31 : .36)) * (w < 1050 ? .8 : 1);
    // Keep the approved environmental clearance independent of the new silhouettes.
    const artWidth = artHeight * source.layoutWidth / source.layoutHeight;
    const left = mobile ? index ? w - artWidth * .69 : -artWidth * .20 : index ? w * .975 - artWidth : w * .035;
    const top = mobile ? index ? h * .56 : 68 : index ? h * .43 : Math.max(80, h * .105);
    const rect = { left, top, scale: artHeight / source.height, artWidth, artHeight };
    return this.workspace ? compactDragonRect(w, h, index, source, rect, this.sidebarInset) : rect;
  }

  private makeDragons() {
    const asset = this.artwork.dragons;
    if (asset?.groups.length !== 2) throw new Error('Missing dragon landmarks');
    const sceneSeed = this.seed;
    this.relics = [];
    asset.groups.forEach((source, index) => {
      const data = source.points;
      const w = this.width, h = this.height, mobile = w < 600, tablet = !mobile && w < 1050;
      const titleLeft = w * .36;
      let scale = index ? (mobile ? h * .33 : tablet ? h * .40 : Math.min(h * .70, w * .50)) / source.height
        : (mobile ? Math.min(w * .85, h * .36) : tablet ? Math.min(w * .48, h * .50)
          : Math.min(w * .42, h * .66)) / source.width;
      const goldRight = Math.min(titleLeft - 18, w * .30);
      if (!index) {
        scale *= mobile ? 1.06 : tablet ? 1.10 : 1.14;
        if (!mobile && !tablet) {
          // Fit the held sphere and the title-side whiskers, not just the source rectangle.
          scale = Math.min(scale, (goldRight - 14) / (source.width - source.relic.x + source.relic.radius));
        }
      }
      const artWidth = source.width * scale, artHeight = source.height * scale;
      const brandCenter = h * .16;
      const originalRect = {
        scale, artWidth, artHeight,
        left: index ? w - artWidth * (mobile ? .70 : .90) + (mobile ? 7 : tablet ? 24 : 0)
          : mobile ? -artWidth * .34 : tablet ? w * .32 - artWidth
          : goldRight - artWidth,
        top: index ? h * (mobile ? .50 : tablet ? .445 : .36)
          : brandCenter - artHeight * (mobile ? .10 : .12),
      };
      const rect = this.workspace ? compactDragonRect(w, h, index, source, originalRect, this.sidebarInset) : originalRect;
      const indices: number[] = [], brow: number[] = [];
      for (let at = 0; at < data.length; at += asset.stride) {
        if (data[at + 3] > 0) continue;
        indices.push(at);
        const dx = data[at] - source.eye.x, dy = data[at + 1] - source.eye.y;
        const radius = (dx / source.eye.rx) ** 2 + (dy / source.eye.ry) ** 2;
        if (radius > 2 && radius < 18 && (dy < -.8 || dx > 2) && data[at + 2] > 80) brow.push(at);
      }
      const pointScale = clamp(this.height / 900, .75, 1.35);
      const count = Math.min(60000, Math.round(36000 * (rect.artWidth * rect.artHeight / (index ? 394 * 423 : 414 * 270)) / pointScale ** 2));
      const eyes = clamp(Math.round(rect.scale ** 2 * 18), 32, 80);
      const focus = eyes + Math.max(30, Math.round(count * .004));
      const points: Star[] = [];
      for (let i = 0; i < count; i++) {
        let at = indices[0];
        if (i < focus && brow.length) at = brow[Math.floor(this.random() * brow.length)];
        else for (let tries = 0; tries < 5; tries++) {
          at = indices[Math.floor(this.random() * indices.length)];
          if (this.random() < (data[at + 2] / 255) ** 1.15) break;
        }
        const eye = i < eyes, intensity = eye ? 1 : data[at + 2] / 255;
        const dust = i % 17 === 0 && !eye;
        const jitter = eye ? .19 : i < focus ? .26 : dust ? 1.5 : .38;
        const angle = i * 2.39996322973, radius = Math.sqrt((i + .5) / eyes) * .8;
        const x = eye ? source.eye.x + Math.cos(angle) * radius : data[at] + this.normal() * jitter;
        const y = eye ? source.eye.y + Math.sin(angle) * radius : data[at + 1] + this.normal() * jitter;
        const color = data.slice(at + 4, at + 7);
        const peak = Math.max(...color);
        points.push({
          x: (rect.left + x * rect.scale - this.width / 2) / this.height,
          y: (this.height / 2 - rect.top - y * rect.scale) / this.height,
          z: eye ? .006 + this.normal() * .001 : (intensity - .5) * .012 + this.normal() * (i < focus ? .002 : dust ? .035 : .004),
          palette: index, brightness: eye ? 1.55 : .12 + intensity ** 1.5 * 2,
          tint: eye ? [1, .98, .92] : color.map(value => value / peak),
          identity: 1, eye: eye ? 1 : 0,
        });
      }
      const relic = {
        x: rect.left + source.relic.x * rect.scale, y: rect.top + source.relic.y * rect.scale,
        radius: source.relic.radius * rect.scale,
      };
      const beforeRelic = points.length;
      this.makeRelic(points, index, relic);
      this.relics.push({ ...relic, shape: index ? 'cube' : 'sphere', count: points.length - beforeRelic });
      const layer = this.addLayer('dragon', points, new THREE.Vector2(
        (rect.left + rect.artWidth / 2 - this.width / 2) / this.height,
        (this.height / 2 - rect.top - rect.artHeight / 2) / this.height));
      layer.uniforms.uTint.value = 1;
      (layer.uniforms.uRelicOrigin.value as THREE.Vector3).set(
        (relic.x - w / 2) / h, (h / 2 - relic.y) / h, 0);
      if (!index) {
        layer.uniforms.uKind.value = 7;
        (layer.uniforms.uBrandBox.value as THREE.Vector4).set(100, 100, 101, 101);
      }
    });
    this.seed = sceneSeed;
  }

  private makeRelic(points: Star[], index: number, relic: { x: number; y: number; radius: number }) {
    const add = (point: THREE.Vector3, brightness: number, size = .85, field = 0) => {
      points.push({
        x: (relic.x + point.x * relic.radius - this.width / 2) / this.height,
        y: (this.height / 2 - relic.y - point.y * relic.radius) / this.height,
        z: point.z * relic.radius / this.height,
        tint: index ? [.40, .91, 1] : [1, .83, .42], identity: 1, brightness, size, relic: index + 1, field,
      });
    };
    // The held objects share the dragon layer, so breathing and camera motion cannot detach them.
    if (!index) {
      for (let i = 0; i < 1800; i++) {
        const angle = this.random() * Math.PI * 2;
        const ring = i % 7;
        const latitude = (ring % 3 - 1) * .56;
        const radius = Math.sqrt(1 - latitude * latitude);
        const point = ring < 3
          ? new THREE.Vector3(Math.cos(angle) * radius, latitude, Math.sin(angle) * radius)
          : new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), (ring - 3) * Math.PI / 4);
        point.applyEuler(new THREE.Euler(.22, -.25, -.30));
        add(point, .38 + (point.z + 1) * .32);
      }
      for (let i = 0; i < 600; i++) {
        const y = this.random() * 2 - 1, angle = this.random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
        add(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r), .16, .7);
      }
    } else {
      const vertices = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1));
      const rotation = new THREE.Euler(.36, -.56, -.08);
      for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) {
        const b = a ^ bit;
        if (b < a) continue;
        for (let i = 0; i < 120; i++) {
          const point = vertices[a].clone().lerp(vertices[b], (i + this.random() * .5) / 120).multiplyScalar(.78).applyEuler(rotation);
          add(point, .60 + (point.z + 1) * .25);
        }
      }
      for (let i = 0; i < 800; i++) {
        const point = new THREE.Vector3(this.random() * 2 - 1, this.random() * 2 - 1, this.random() * 2 - 1);
        point.setComponent(i % 3, i % 2 ? 1 : -1);
        add(point.multiplyScalar(.78).applyEuler(rotation), .14, .7);
      }
      // These shells use the very same vertices, transform and shader as the held cube.
      for (let shell = 1; shell <= 8; shell++) for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) {
        const b = a ^ bit;
        if (b < a) continue;
        for (let i = 0; i < 96; i++) {
          const point = vertices[a].clone().lerp(vertices[b], i / 95).multiplyScalar(.78).applyEuler(rotation);
          add(point, .82, 1.05, shell);
        }
      }
    }
  }

  private makeTitle() {
    if (!this.settings.showtitle) return;
    const stage = this.stage.getBoundingClientRect(), points: Star[] = [];
    for (const span of this.stage.querySelectorAll<HTMLElement>('h1 span')) {
      const bounds = span.getBoundingClientRect(), style = getComputedStyle(span);
      const palette = span.classList.contains('title-time') ? this.artwork.dragons.groups[0].palette.map(color => {
        // Lift the darkest sample enough to keep small star lettering legible.
        const exposure = Math.max(1, 184 / Math.max(...color));
        return color.map(channel => channel / 255 * exposure);
      }) : this.artwork.dragons.groups[1].palette.slice().reverse().map(color => color.map(channel => channel / 255));
      const bitmap = document.createElement('canvas');
      const resolution = 4;
      bitmap.width = Math.ceil(bounds.width * resolution); bitmap.height = Math.ceil(bounds.height * resolution);
      const context = bitmap.getContext('2d', { willReadFrequently: true })!;
      context.font = `600 ${parseFloat(style.fontSize) * resolution}px ${style.fontFamily}`;
      context.fillStyle = '#fff'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(span.textContent!, bitmap.width / 2, bitmap.height / 2);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const candidates: number[][] = [];
      for (let y = 0; y < bitmap.height; y += 2) for (let x = 0; x < bitmap.width; x += 2) {
        if (pixels[(y * bitmap.width + x) * 4 + 3] > 150) candidates.push([x, y]);
      }
      const pointScale = clamp(this.height / 900, .75, 1.35);
      const count = Math.round(23000 * (parseFloat(style.fontSize) / 88 / pointScale) ** 2);
      const detail = parseFloat(style.fontSize) / 88 * 900 / this.height;
      for (let i = 0; i < count; i++) {
        let source = candidates[0];
        for (let tries = 0; tries < 7; tries++) {
          source = candidates[Math.floor(this.random() * candidates.length)];
          const wave = Math.sin(source[1] * .067 + Math.sin(source[0] * .027) * 2.5 + Math.sin(source[1] * .017 + source[0] * .013) * 2);
          if (this.random() < .32 + .68 * Math.abs(wave) ** 4) break;
        }
        const dust = i % 7 === 0, spread = (dust ? .012 : .0011) * detail;
        const phase = clamp(source[0] / bitmap.width, 0, 1) * (palette.length - 1);
        const stop = Math.min(palette.length - 2, Math.floor(phase));
        const tint = palette[stop].map((channel, index) =>
          THREE.MathUtils.lerp(channel, palette[stop + 1][index], smooth(0, 1, phase - stop)));
        points.push({
          x: (bounds.left - stage.left + source[0] / resolution - this.width / 2) / this.height + this.normal() * spread,
          y: (this.height / 2 - bounds.top + stage.top - source[1] / resolution) / this.height + this.normal() * spread,
          z: (Math.sin(source[1] * .011 + source[0] * .005) * .035 + this.normal() * (dust ? .12 : .025)) * detail,
          brightness: .95, tint,
        });
      }
    }
    const layer = this.addLayer('title', points, new THREE.Vector2(0, .17));
    layer.uniforms.uTint.value = 1;
    layer.uniforms.uDetail.value = Math.min(1, parseFloat(getComputedStyle(this.stage.querySelector('h1')!).fontSize) / 76);
  }

  private clearLayers() {
    for (const layer of this.layers) {
      layer.occlusion?.geometry.dispose();
      layer.occlusion?.material.dispose();
      layer.geometry.dispose(); layer.materials.forEach(material => material.dispose()); this.scene.remove(layer.group);
    }
    this.layers = [];
  }
  resize() {
    if (this.disposed || !this.duckSource) return;
    if (this.reducedMotion()) {
      this.pointer.set(0, 0); this.pointerTarget.set(0, 0);
      this.pointerStrength = 0; this.pointerStrengthTarget = 0;
      this.gravityPointer.set(0, 0); this.gravityTarget.set(0, 0);
      this.gravityStrength = 0; this.gravityTargetStrength = 0;
    }
    const bounds = this.stage.getBoundingClientRect();
    this.width = bounds.width; this.height = bounds.height;
    this.sidebarInset = this.workspace ? parseFloat(getComputedStyle(this.stage).getPropertyValue('--sidebar-track')) || 0 : 0;
    const quality = qualityPresets[this.settings.quality as keyof typeof qualityPresets];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr, quality.maxHeight / this.height));
    this.renderer.setSize(this.width, this.height, false);
    this.clearLayers(); this.seed = 19062026;
    this.clearances = this.artwork.dragons.groups.map((source, index) => {
      const rect = this.dragonRect(index, source);
      return {
        x: (rect.left + rect.artWidth * .52 - this.width / 2) / this.height,
        y: (this.height / 2 - rect.top - rect.artHeight * .48) / this.height,
        rx: rect.artWidth * .65 / this.height, ry: rect.artHeight * .61 / this.height,
      };
    });
    this.makeStars(); this.makeCelestials(); this.makeDuck(); this.makeDragons(); this.makeTitle();
    const stageTop = bounds.top, stageLeft = bounds.left;
    const rect = (box: DOMRect) => ({
      left: box.left - stageLeft, top: box.top - stageTop,
      right: box.right - stageLeft, bottom: box.bottom - stageTop,
    });
    const headings = [...this.stage.querySelectorAll<HTMLElement>('h1 span')].map(span => rect(span.getBoundingClientRect()));
    const text = [...headings];
    for (const element of this.stage.querySelectorAll('.release-label, .subtitle, .hero-actions, .brand, .edition, .stage-footer')) {
      const range = document.createRange();
      range.selectNodeContents(element);
      text.push(rect(range.getBoundingClientRect()));
    }
    for (const layer of createScenery(this.width, this.height,
      { left: this.width * .3, top: this.height * .35, right: this.width * .7, bottom: this.height * .65 },
      text, (x, y) => this.ambientWeight(x, y))) {
      const result = this.addLayer(layer.role, layer.points, layer.center);
      result.uniforms.uDetail.value = layer.role === 'asteroids' ? .25 : .6;
      if (layer.occlusion) this.addForegroundOcclusion(result, layer.occlusion);
      if (layer.role === 'planetRings') {
        const planet = this.layers.find(item => item.role === 'celestial')!;
        result.uniforms.uBreath.value = planet.uniforms.uBreath.value;
        result.uniforms.uDetail.value = planet.uniforms.uDetail.value;
      }
    }
    // Append after the approved artwork so its deterministic point sampling is unchanged.
    this.makeSpectrum();
    this.draw(this.progress, 0, this.live);
  }

  private route(t: number) {
    const mobile = this.width < 600;
    return {
      x: THREE.MathUtils.lerp(mobile ? .22 : .17, .5, t) * this.width,
      y: (THREE.MathUtils.lerp(.77, mobile ? .49 : .54, t) - Math.sin(t * Math.PI) * .022) * this.height,
    };
  }

  coreScene(retreat: number, selected: number, energy: number, travel: number, zoom: number) {
    if (retreat > 0 && this.departure.retreat === 0) this.departure.clock = this.clock;
    Object.assign(this.departure, { retreat, selected: selected + 1, energy, travel, zoom });
    const clock = retreat > 0 ? this.departure.clock : this.clock;
    const dragons = this.layers.filter(layer => layer.role === 'dragon');
    const anchors = this.relics.map((relic, index) => {
      const u = dragons[index].uniforms, center = u.uCenter.value as THREE.Vector2;
      const breath = u.uBreath.value as number;
      const scale = 1 + Math.sin(clock * .43 + breath) * .008;
      const x = (relic.x - this.width / 2) / this.height;
      const y = (this.height / 2 - relic.y) / this.height;
      return { radius: relic.radius * scale,
        x: this.width / 2 + (center.x + (x - center.x) * scale) * this.height + this.pointer.x * 2 * this.height / this.width * 5,
        y: this.height / 2 - (center.y + (y - center.y) * scale + Math.sin(clock * .38 + breath) * .0025) * this.height - this.pointer.y * 2 * 5 };
    });
    const focus = anchors[selected];
    if (focus) this.departure.focus.set((focus.x - this.width / 2) / this.height, (this.height / 2 - focus.y) / this.height);
    return anchors;
  }

  draw(progress: number, delta: number, live: boolean) {
    if (this.disposed) return;
    this.progress = progress; this.live = live;
    const elapsed = Math.min(delta, .1) * this.settings.speed / 100;
    if (live) this.fieldClock += elapsed * (1 + (this.departure.selected === 2 ? this.departure.energy * 5 : 0));
    if (live && this.departure.retreat === 0) {
      this.clock += elapsed;
      const follow = 1 - Math.exp(-Math.min(delta, .06) * 6);
      this.pointer.lerp(this.pointerTarget, follow);
      this.pointerStrength += (this.pointerStrengthTarget - this.pointerStrength) * follow;
      this.gravityPointer.lerp(this.gravityTarget, 1 - Math.exp(-Math.min(delta, .06) * 12));
      const gravity = this.settings.gravity && !this.reducedMotion() ? this.gravityTargetStrength : 0;
      this.gravityStrength += (gravity - this.gravityStrength) * (1 - Math.exp(-Math.min(delta, .06) * 4));
    }
    const travel = smooth(0, SHOTS.arrival, progress);
    const pullback = smooth(SHOTS.pullbackStart, SHOTS.pullback, progress);
    this.zoom = Math.exp(Math.log(4.6) * (1 - pullback));
    this.cameraCenter.set(0, -.12 * (1 - pullback));
    const current = this.route(travel), mobile = this.width < 600;
    if (this.settings.cruise) {
      current.x += Math.sin(this.clock * .11) * this.width * .009;
      current.y += Math.sin(this.clock * .16) * this.height * .005;
    }
    const closeSize = mobile ? 144 : Math.min(this.width * .19, this.height * .34, 310);
    const size = closeSize * this.zoom / 4.6;
    this.duckScreen = { ...current, width: size };
    for (const layer of this.layers) {
      const u = layer.uniforms;
      const quality = qualityPresets[this.settings.quality as keyof typeof qualityPresets];
      u.uBrightness.value = this.settings.brightness / 100 / Math.sqrt(quality.density);
      u.uParallax.value = PARALLAX[layer.role] * this.settings.parallax / 100;
      u.uNearParallax.value = layer.role === 'asteroids' ? 22 * this.settings.parallax / 100 : 0;
      if (layer.role === 'dragon' && u.uKind.value === 7 && !this.settings.showbrand) u.uKind.value = 0;
      else if (layer.role === 'dragon' && u.uBrandBox.value.z !== 0 && this.settings.showbrand) u.uKind.value = 7;
      // Pausing holds the clock, not the displacement amplitude.
      u.uTime.value = this.departure.retreat > 0 ? this.departure.clock : this.clock; u.uMotion.value = 1;
      u.uRetreat.value = this.departure.retreat;
      u.uFieldTime.value = this.fieldClock;
      u.uCoreSelected.value = this.departure.selected; u.uCoreEnergy.value = this.departure.energy;
      u.uCoreTravel.value = this.departure.travel; u.uCoreZoom.value = this.departure.zoom;
      (u.uCoreFocus.value as THREE.Vector2).copy(this.departure.focus);
      if (layer.occlusion) layer.occlusion.visible = this.departure.retreat < .03;
      u.uPointerStrength.value = this.pointerStrength * this.settings.parallax / 100;
      u.uGravity.value = this.gravityStrength;
      const audio = this.audioFrame;
      u.uSpectrumActive.value = this.spectrumActive ? 1 : 0;
      (u.uAudio.value as THREE.Vector3).set(audio.bass, audio.mid, audio.treble);
      (u.uPulseAges.value as THREE.Vector4).fromArray(audio.ages);
      (u.uPulseStrengths.value as THREE.Vector4).fromArray(audio.strengths);
      u.uZoom.value = this.zoom; u.uReveal.value = 1; u.uProgress.value = 1;
      (u.uCamera.value as THREE.Vector2).copy(this.cameraCenter);
      layer.group.visible = true;
      if (layer.role === 'spectrum') {
        layer.group.visible = this.spectrumActive;
      } else if (layer.role === 'duck') {
        u.uFootprint.value = this.zoom / 4.6;
        u.uScale.value = size / this.height / this.zoom;
        (u.uOffset.value as THREE.Vector3).set(
          (current.x - this.width / 2) / this.height / this.zoom + this.cameraCenter.x,
          (this.height / 2 - current.y) / this.height / this.zoom + this.cameraCenter.y, 0);
      } else if (layer.role === 'wake') {
        const unit = this.height * this.zoom;
        (u.uTrailHead.value as THREE.Vector2).set(
          (current.x - size * .40 - this.width / 2) / unit + this.cameraCenter.x,
          (this.height / 2 - current.y - size * .20) / unit + this.cameraCenter.y);
        const length = Math.max(this.width * .48, 280) * Math.sqrt(this.zoom / 4.6);
        (u.uTrailVector.value as THREE.Vector2).set(-length / unit, -length * .32 / unit);
        u.uTrailWidth.value = (mobile ? 32 : 64) * Math.sqrt(this.zoom / 4.6) / unit;
        u.uReveal.value = .65 + Math.sin(travel * Math.PI) * .35;
      } else if (layer.role === 'title') {
        layer.group.visible = this.settings.showtitle;
        u.uProgress.value = smooth(SHOTS.title, SHOTS.settled, progress);
        u.uReveal.value = .16 + smooth(SHOTS.title, SHOTS.settled, progress) * .84;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  inspect() {
    const gl = this.renderer.getContext(), pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let lit = 0, warm = 0, cool = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (Math.max(r, g, b) > 70) lit++;
      if (r > 70 && r > b * 1.25) warm++;
      if (g > 60 && b > 60 && g > r * 1.2) cool++;
    }
    const layerInfo = (role: Role) => this.layers.filter(layer => layer.role === role).map(layer => {
      const points = layer.geometry.getAttribute('aTo');
      let inFrame = 0;
      if (role === 'dragon') for (let i = 0; i < points.count; i++) {
        const scale = this.zoom / (1 + points.getZ(i) * .4);
        const x = (points.getX(i) - this.cameraCenter.x) * scale;
        const y = (points.getY(i) - this.cameraCenter.y) * scale;
        if (Math.abs(x) < this.width / this.height / 2 && Math.abs(y) < .5) inFrame++;
      }
      return {
        kind: 'points', count: points.count,
        opacity: layer.uniforms.uReveal.value as number, formation: layer.uniforms.uProgress.value as number,
        visible: layer.group.visible, passes: layer.materials.length, inFrame,
        occlusionVertices: layer.occlusion?.geometry.getAttribute('position').count ?? 0,
        parallax: layer.uniforms.uParallax.value as number,
        nearParallax: layer.uniforms.uNearParallax.value as number,
        scatter: layer.uniforms.uPointerScatter.value as number,
      };
    });
    return { lit, warm, cool, frames: this.frames, clock: this.clock, audio: this.audioFrame,
      gravity: { enabled: this.settings.gravity, strength: this.gravityStrength, x: this.gravityPointer.x, y: this.gravityPointer.y },
      renderSize: { width: this.canvas.width, height: this.canvas.height },
      points: this.layers.reduce((count, layer) => count + layer.geometry.getAttribute('position').count, 0),
      pointer: { x: this.pointer.x * 2 * this.height / this.width, y: this.pointer.y * 2, strength: this.pointerStrength },
      duck: this.duckScreen, progress: this.progress, zoom: this.zoom,
      artwork: { duck: { ...layerInfo('duck')[0], view: 'rear-right', source: 'storyboard-panel-02' },
        title: layerInfo('title'), dragons: layerInfo('dragon'), relics: this.relics, sea: layerInfo('sea'),
        stars: layerInfo('stars'), wake: layerInfo('wake'), celestial: layerInfo('celestial'),
        spectrum: layerInfo('spectrum'),
        canopy: layerInfo('canopy'), galaxy: layerInfo('galaxy'), asteroids: layerInfo('asteroids'),
        starfall: layerInfo('starfall'), planetRings: layerInfo('planetRings'), texturedMeshes: 0 } };
  }

  captureArtwork() {
    const titles = [...this.stage.querySelectorAll<HTMLElement>('h1 span')].map(span => {
      const bounds = span.getBoundingClientRect(), stage = this.stage.getBoundingClientRect();
      const ratio = this.canvas.width / this.width;
      const image = document.createElement('canvas');
      image.width = Math.ceil(bounds.width * ratio); image.height = Math.ceil(bounds.height * ratio);
      image.getContext('2d')!.drawImage(this.canvas, (bounds.left - stage.left) * ratio,
        (bounds.top - stage.top) * ratio, image.width, image.height, 0, 0, image.width, image.height);
      return image.toDataURL('image/png');
    });
    const layers = this.layers.filter(layer => layer.role === 'title');
    layers.forEach(layer => { layer.group.visible = false; });
    this.renderer.render(this.scene, this.camera);
    const background = this.canvas.toDataURL('image/png');
    layers.forEach(layer => { layer.group.visible = true; });
    this.renderer.render(this.scene, this.camera);
    return { background, titles };
  }

  dispose() {
    this.disposed = true; this.clearLayers();
    this.spectrumTexture.dispose();
    this.pointerSurface.removeEventListener('pointermove', this.pointerMove);
    this.pointerSurface.removeEventListener('pointerleave', this.pointerLeave);
    this.renderer.dispose();
  }
}
