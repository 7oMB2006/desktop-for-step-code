import * as THREE from 'three';

// Settled lettering from Release060/chapters/closing.ts, tuned for a 22-25px
// greeting: preserve the counters and move the light, not the text silhouette.
const vertex = `
attribute vec3 aLight;
uniform float uTime, uMotion, uPixelRatio, uHalo;
varying float vAlpha, vHalo;
void main() {
  vec3 p = position;
  float seed = aLight.z;
  p.xy += vec2(sin(uTime*.8+p.y*.029+p.z*.01),
    cos(uTime*.65+p.x*.026)) * .12 * uMotion;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p.xy,0.,1.);
  gl_PointSize = max(.7,aLight.x*uPixelRatio*mix(1.,5.,uHalo));
  float breath = .82+.18*sin(uTime*(.4+seed*.7)+seed*170.);
  float ridge = .85+.15*sin(p.y*.107+p.x*.041+p.z*.049-uTime*1.15);
  vAlpha = aLight.y*breath*ridge*mix(1.,.024,uHalo);
  vHalo = uHalo;
}`;
const fragment = `
uniform vec3 uColor;
varying float vAlpha, vHalo;
void main() {
  vec2 p = gl_PointCoord*2.-1.;
  float r = length(p);
  if(r>1.) discard;
  float light = exp(-r*r*9.)+exp(-r*r*4.)*.22;
  if(vHalo>.5) light = exp(-r*r*3.);
  gl_FragColor = vec4(uColor,light*vAlpha);
}`;

export class StellarLetteringRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, .1, 10);
  private geometry = new THREE.BufferGeometry();
  private materials: THREE.ShaderMaterial[];
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    this.camera.position.z = 1;
    this.materials = [0, 1].map(halo => new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uPixelRatio: { value: 1 },
        uHalo: { value: halo }, uColor: { value: new THREE.Color('#edf4f7') } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    for (const material of this.materials) {
      const points = new THREE.Points(this.geometry, material);
      points.frustumCulled = false;
      this.scene.add(points);
    }
  }

  resize(text: string, element: HTMLElement) {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    const width = Math.max(1, Math.ceil(box.width)) + 8, height = Math.ceil(box.height) + 8;
    const resolution = 4;
    const mask = document.createElement('canvas');
    mask.width = width * resolution; mask.height = height * resolution;
    const ctx = mask.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(resolution, resolution);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = '#fff';
    const metrics = ctx.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    ctx.fillText(text, 4, 4 + (box.height - ascent - descent) / 2 + ascent);
    const pixels = ctx.getImageData(0, 0, mask.width, mask.height).data;
    let seed = 60625;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 | 0) >>> 0) / 4294967296;
    const positions: number[] = [], lights: number[] = [];
    for (let y = 4; y < height - 4; y += .45) for (let x = 4; x < width - 4; x += .45) {
      const px = x + random() * .35, py = y + random() * .35;
      const i = (Math.floor(py * resolution) * mask.width + Math.floor(px * resolution)) * 4;
      if (pixels[i + 3] < 100) continue;
      const wave = Math.sin(py * .067 + Math.sin(px * .027) * 2.5 + Math.sin(py * .017 + px * .013) * 2);
      if (random() > .88 + .12 * wave ** 2) continue;
      positions.push(px, height - py, random() * 3);
      lights.push(.8 + random() ** 3 * .75, 1.45 + random() * .6, random());
    }
    this.geometry.dispose();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('aLight', new THREE.Float32BufferAttribute(lights, 3));
    // Supersample this small surface so subpixel stars do not become a hard
    // one-pixel grid on standard-DPI displays.
    const ratio = 2;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.right = width; this.camera.top = height;
    this.camera.updateProjectionMatrix();
    this.materials.forEach(material => { material.uniforms.uPixelRatio.value = ratio; });
  }

  draw(delta: number, motion: boolean) {
    if (motion) this.time += delta;
    this.materials.forEach(material => {
      material.uniforms.uTime.value = this.time;
      material.uniforms.uMotion.value = Number(motion);
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
