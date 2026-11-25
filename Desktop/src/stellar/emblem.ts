import * as THREE from 'three';
import type { StartupFrame } from '../startup-motion';

// Adapted from Release060/src/chapters/closing.ts: the settled logo only,
// retaining SVG color sampling, coherent grain, depth and the two light passes.
const vertex = `
attribute vec3 aColor;
attribute vec3 aLight;
attribute float aHalo;
uniform float uTime, uMotion, uPixelRatio, uHalo, uStartup, uBirth, uGather, uResolve, uGlow;
varying vec3 vColor;
varying vec2 vDirection;
varying float vAlpha, vStar, vHalo, vStretch;
vec2 approach(vec2 target, float seed, float capture) {
  float lane = floor(fract(seed*71.31)*3.);
  float angle = lane*2.094395+(1.-capture)*2.8+fract(seed*43.71)*.85+uBirth*.32;
  float radius = (91.+fract(seed*13.17)*8.)*smoothstep(0.,1.,uBirth);
  vec2 arc = vec2(cos(angle),sin(angle))*radius;
  return mix(arc,target*mix(.94,1.,uResolve),capture);
}
void main() {
  vec3 p = position;
  float seed = aLight.z;
  float capture = smoothstep(0.,1.,clamp((uGather-seed*.18)/.82,0.,1.));
  vec2 flight = approach(p.xy,seed,capture);
  vec2 previous = approach(p.xy,seed,max(0.,capture-.02));
  float speed = 4.*capture*(1.-capture)*uStartup;
  vDirection = normalize(mix(vec2(1.,0.),normalize(flight-previous+vec2(.00001)),speed)+vec2(.00001,0.));
  vDirection.y *= -1.;
  vStretch = 1.+speed*2.*(1.-uHalo);
  p.xy = mix(p.xy,flight,uStartup);
  float drift = mix(.65, 1.8, aHalo) * uMotion;
  p.xy += vec2(sin(uTime*.8+p.y*.029+p.z*.01),
    cos(uTime*.65+p.x*.026)) * drift;
  float ry = sin(uTime*.24)*.025*uMotion;
  float rx = cos(uTime*.21)*.018*uMotion;
  p.xz = mat2(cos(ry),sin(ry),-sin(ry),cos(ry))*p.xz;
  p.yz = mat2(cos(rx),sin(rx),-sin(rx),cos(rx))*p.yz;
  p.xy *= 1./(1.+p.z*.0007);
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p.xy,0.,1.);
  float settledSize = max(1.,aLight.x*uPixelRatio*mix(1.,7.,uHalo));
  float flightSize = mix(4.2,min(2.1,settledSize*1.4),smoothstep(.025,.08,seed));
  flightSize = mix(flightSize*vStretch,settledSize,pow(capture,6.));
  gl_PointSize = mix(settledSize,mix(flightSize,settledSize,uHalo),uStartup);
  float breath = .82+.18*sin(uTime*(.4+seed*.7)+seed*170.);
  float ridge = .68+.32*sin(p.y*.107+p.x*.041+p.z*.049-uTime*1.15);
  float coverage = max(uBirth*.024,smoothstep(.03,.86,uGather));
  float born = smoothstep(seed*.99-.003,seed*.99+.003,coverage)*uBirth;
  float flightLight = mix(1.8,1.,capture)*(1.+uGlow*.2);
  float haloLight = mix(.06,1.,capture)*(1.+uGlow*.65);
  vAlpha = aLight.y*breath*ridge*mix(1.,.035,uHalo)
    *mix(1.,born*flightLight*mix(1.,haloLight,uHalo),uStartup);
  vColor = aColor; vStar = step(.993,seed); vHalo = uHalo;
}`;
const fragment = `
varying vec3 vColor;
varying vec2 vDirection;
varying float vAlpha, vStar, vHalo, vStretch;
void main() {
  vec2 p = gl_PointCoord*2.-1.;
  p = vec2(dot(p,vDirection),dot(p,vec2(-vDirection.y,vDirection.x))*vStretch);
  float r = length(p);
  if(r>1.) discard;
  float light = exp(-r*r*9.)+exp(-r*r*4.)*.22;
  light += (exp(-abs(p.x)*45.)+exp(-abs(p.y)*45.))*pow(1.-r,2.)*.22*vStar;
  if(vHalo>.5) light = exp(-r*r*3.);
  gl_FragColor = vec4(vColor,light*vAlpha);
}`;

export class StellarEmblemRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-64, 64, 64, -64, .1, 10);
  private geometry = new THREE.BufferGeometry();
  private materials: THREE.ShaderMaterial[];
  private time = 0;

  constructor(canvas: HTMLCanvasElement, image: HTMLImageElement) {
    const mask = document.createElement('canvas');
    mask.width = mask.height = 128;
    const ctx = mask.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 12, 12, 104, 104);
    const pixels = ctx.getImageData(0, 0, 128, 128).data;
    let seed = 606;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-7))) * Math.cos(2 * Math.PI * random());
    const positions: number[] = [], colors: number[] = [], lights: number[] = [], halos: number[] = [];
    for (let y = 12; y < 116; y += 1.15) for (let x = 12; x < 116; x += 1.15) {
      const px = Math.floor(x + random() * 1.3), py = Math.floor(y + random() * 1.3);
      const i = (py * 128 + px) * 4;
      if (pixels[i + 3] < 100) continue;
      const wave = Math.sin(py * .067 + Math.sin(px * .027) * 2.5 + Math.sin(py * .017 + px * .013) * 2);
      if (random() > .40 + .60 * Math.abs(wave) ** 4) continue;
      const halo = random() < 1 / 7, spread = halo ? 1.6 : .35;
      positions.push(px - 64 + normal() * spread, 64 - py + normal() * spread,
        Math.sin(py * .011 + px * .005) * 8 + normal() * (halo ? 18 : 5));
      colors.push(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255);
      lights.push(random() > .994 ? 3.5 + random() * 2 : .85 + random() ** 3 * 2, 1.4 + random() * .6, random());
      halos.push(Number(halo));
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    this.geometry.setAttribute('aLight', new THREE.Float32BufferAttribute(lights, 3));
    this.geometry.setAttribute('aHalo', new THREE.Float32BufferAttribute(halos, 1));
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' });
    this.camera.position.z = 1;
    this.materials = [0, 1].map(halo => new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uPixelRatio: { value: 1 }, uHalo: { value: halo },
        uStartup: { value: 0 }, uBirth: { value: 1 }, uGather: { value: 1 }, uResolve: { value: 1 }, uGlow: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    for (const material of this.materials) this.scene.add(new THREE.Points(this.geometry, material));
  }
  resize(size: number, extent = 128) {
    const ratio = Math.min(devicePixelRatio, 2);
    this.camera.left = this.camera.bottom = -extent / 2;
    this.camera.right = this.camera.top = extent / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size, size, false);
    this.materials.forEach(m => { m.uniforms.uPixelRatio.value = ratio * size / extent; });
  }
  draw(delta: number, motion: boolean, entrance?: StartupFrame) {
    if (motion) this.time += delta;
    this.materials.forEach(m => {
      m.uniforms.uTime.value = this.time;
      m.uniforms.uMotion.value = Number(motion);
      m.uniforms.uStartup.value = Number(Boolean(entrance));
      m.uniforms.uBirth.value = entrance?.birth ?? 1;
      m.uniforms.uGather.value = entrance?.gather ?? 1;
      m.uniforms.uResolve.value = entrance?.resolve ?? 1;
      m.uniforms.uGlow.value = entrance?.glow ?? 0;
    });
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.geometry.dispose();
    this.materials.forEach(m => m.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
