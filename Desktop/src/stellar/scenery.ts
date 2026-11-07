import * as THREE from 'three';

export type SceneryRole = 'canopy' | 'galaxy' | 'asteroids' | 'starfall' | 'planetRings';
type Point = {
  x: number; y: number; z: number; tint: number[];
  brightness: number; size: number; identity: number;
};
type Box = { left: number; top: number; right: number; bottom: number };
type Layer = { role: SceneryRole; points: Point[]; center: THREE.Vector2; occlusion?: number[] };

export function createScenery(
  width: number, height: number, title: Box, text: Box[],
  clearance: (x: number, y: number) => number,
) {
  const mobile = width < 600, tablet = !mobile && width < 1050;
  let seed = 25102026;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-7))) * Math.cos(random() * Math.PI * 2);
  const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
  const world = (x: number, y: number) => new THREE.Vector2((x - width / 2) / height, (.5 * height - y) / height);
  const weight = (x: number, y: number) => {
    const p = world(x, y);
    const lowerLeft = smooth(height * .50, height * .62, y) * (1 - smooth(width * .43, width * .56, x));
    let result = Math.max(clearance(p.x, p.y), lowerLeft);
    for (const box of text) {
      const dx = Math.max(box.left - x, 0, x - box.right);
      const dy = Math.max(box.top - y, 0, y - box.bottom);
      result = Math.min(result, smooth(8, mobile ? 24 : 44, Math.hypot(dx, dy)));
    }
    return result;
  };
  const point = (x: number, y: number, z: number, tint: number[], brightness: number, size: number): Point => {
    const p = world(x, y);
    // Preserve the composed screen position while retaining depth during the camera pullback.
    const perspective = 1 + z * .4;
    return { x: p.x * perspective, y: p.y * perspective, z, tint, brightness, size, identity: 1 };
  };
  const layers: Layer[] = [];

  const canopy: Point[] = [];
  const cold = [[.25, .48, .85], [.36, .67, 1], [.66, .61, .88], [.73, .85, 1]];
  for (let i = 0; i < (mobile ? 26000 : 72000); i++) {
    const veil = i % 2 === 0, lane = i % 7, t = random();
    const x = veil ? (random() * 1.35 - .15) * width : width * (.32 + .92 * t + normal() * .025);
    const y = veil ? (random() * 1.35 - .18) * height
      : height * (-.22 + .78 * t + Math.sin(t * 7 + lane * .4) * .035
        + (lane - 3) * .025 + normal() * (i % 3 ? .028 : .10));
    const keep = weight(x, y);
    if (keep < .025) continue;
    const knots = .4 + .6 * Math.abs(Math.sin(t * 39 + Math.sin(t * 16) * 3));
    canopy.push(point(x, y, .16 + random() * .65, cold[i % cold.length],
      keep * (veil ? .75 + random() * .85 : .65 + random() * .85) * knots,
      .8 + random() ** 3 * (veil ? 1.7 : 2)));
  }
  layers.push({ role: 'canopy', points: canopy, center: new THREE.Vector2() });

  const galaxy: Point[] = [];
  const gx = mobile ? width * .80 : tablet ? width * .79 : title.right + (width - title.right) * .53;
  const gy = height * (mobile ? .455 : tablet ? .39 : .33);
  const radius = mobile ? Math.min(width * .145, height * .075)
    : tablet ? width * .14 : Math.min(height * .15, (width - title.right) * .39);
  const tilt = -.50, flatten = .46;
  const galaxyTints = [[.26, .53, 1], [.54, .43, .88], [.68, .40, .72], [1, .65, .43]];
  for (let i = 0; i < (mobile ? 10500 : 30000); i++) {
    const bulge = i % 5 === 0, interarm = !bulge && i % 7 === 0;
    const r = bulge ? Math.min(.45, Math.abs(normal()) * .13) : .08 + random() ** .65 * .92;
    const angle = bulge || interarm ? random() * Math.PI * 2
      : (i % 2) * Math.PI + r * 7.2 + Math.sin(r * 24) * .18 + normal() * (.18 + r * .18);
    const spread = bulge ? .008 : .02 + r * .045;
    const dx = (Math.cos(angle) * r + normal() * spread) * radius;
    const dy = (Math.sin(angle) * r + normal() * spread) * radius * flatten;
    const x = gx + dx * Math.cos(tilt) - dy * Math.sin(tilt);
    const y = gy + dx * Math.sin(tilt) + dy * Math.cos(tilt);
    const keep = weight(x, y);
    if (keep < .02) continue;
    const tint = bulge ? [1, .76 + random() * .12, .56 + random() * .16]
      : galaxyTints[i % galaxyTints.length];
    galaxy.push(point(x, y, 0, tint,
      keep * (bulge ? .28 + (1 - r) * .40 : interarm ? .30 : .60 + random() * .65)
        * (.45 + .55 * Math.sin(r * 39 + i % 2) ** 2) * (1 - r * .45),
      .65 + random() ** 3 * 1.8));
  }
  layers.push({ role: 'galaxy', points: galaxy, center: world(gx, gy) });

  const asteroids: Point[] = [];
  const occlusion: number[] = [];
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const vertices = geometry.getAttribute('position');
  const rocks: { x: number; y: number; radius: number; seed: number; depth: number }[] = [];
  const unit = mobile ? Math.min(width / 390, height / 844) : Math.min(width / 1440, height / 900);
  const foreground = mobile
    ? [[-.08, .78, 84], [.23, 1.04, 105], [.07, .59, 28], [.37, .84, 21]]
    : [[-.04, .88, 230], [.22, 1.06, 196], [.045, .60, 76], [.13, .74, 58], [.38, .88, 48]];
  foreground.forEach(([x, y, radius], index) => rocks.push({
    x: x * width, y: y * height, radius: radius * unit, seed: index * 5.17 + 2,
    depth: index < 2 ? -.55 : .04,
  }));
  for (let i = 0; i < (mobile ? 52 : 112); i++) {
    const t = random();
    const x = width * (-.08 + t * .64) + normal() * width * .025;
    const y = height * (.59 + t * .38 + Math.sin(t * Math.PI) * .026) + normal() * height * .035;
    const radius = (2 + random() ** 2.8 * (mobile ? 13 : 21)) * unit;
    rocks.push({ x, y, radius, seed: random() * 20, depth: .08 + random() * .22 });
  }
  for (const rock of rocks) {
    const rotation = new THREE.Euler(rock.seed, rock.seed * .7, rock.seed * .3);
    const facets: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; light: number; facing: number }[] = [];
    const deform = (at: number) => {
      const p = new THREE.Vector3().fromBufferAttribute(vertices, at);
      const rough = 1 + Math.sin(p.x * 5 + rock.seed) * .16 + Math.cos(p.y * 7 - rock.seed) * .12
        + Math.sin(p.z * 6 + rock.seed) * .10;
      return p.multiplyScalar(rough).applyEuler(rotation).multiply(new THREE.Vector3(1, .82, .85));
    };
    const sun = new THREE.Vector3(.65, -.48, .58).normalize();
    for (let at = 0; at < vertices.count; at += 3) {
      const a = deform(at), b = deform(at + 1), c = deform(at + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      if (normal.z <= 0) continue;
      facets.push({ a, b, c, light: Math.max(0, normal.dot(sun)), facing: normal.z });
      if (rock.depth <= .04) {
        for (const vertex of [a, b, c]) {
          const p = point(rock.x + vertex.x * rock.radius, rock.y + vertex.y * rock.radius,
            rock.depth + vertex.z * .014, [1, 1, 1], 1, 1);
          occlusion.push(p.x, p.y, p.z);
        }
      }
    }
    const count = Math.round(Math.max(45, Math.min(mobile ? 18000 : 40000, rock.radius ** 2 * 2.6)));
    for (let i = 0; i < count; i++) {
      const face = facets[Math.floor(random() * facets.length)];
      const u = Math.sqrt(random()), v = random();
      const p = face.a.clone().multiplyScalar(1 - u).addScaledVector(face.b, u * (1 - v)).addScaledVector(face.c, u * v);
      const x = rock.x + p.x * rock.radius, y = rock.y + p.y * rock.radius;
      const keep = weight(x, y);
      if (keep < .02) continue;
      const fissure = Math.abs(Math.sin(p.x * 19 + Math.sin(p.y * 14 + rock.seed) * 2 + p.z * 12));
      const glint = fissure < .14 && face.light > .28;
      const rim = (1 - face.facing) ** 2 * face.light;
      const light = .18 + face.light * .85 + rim * .80;
      const tint = glint ? [1, .76, .43] : [
        .55 + face.light * .40, .58 + face.light * .25, .72 - face.light * .20,
      ];
      asteroids.push(point(x, y, rock.depth + p.z * .014, tint,
        keep * (glint ? 1 + random() * .6 : light * (.7 + random() * .5)),
        glint ? 1.2 : .72 + random() ** 3 * 1.25));
    }
  }
  geometry.dispose();

  // Fine fragments bridge the boulders into one orbital belt without filling the flight path.
  for (let i = 0; i < (mobile ? 4500 : 14000); i++) {
    const t = random(), spread = normal() * height * .016;
    const x = width * (-.12 + t * .71);
    const y = height * (.59 + t * .38 + Math.sin(t * Math.PI) * .026) + spread;
    const keep = weight(x, y);
    if (keep < .02) continue;
    asteroids.push(point(x, y, .12 + random() * .3, i % 4 ? [.58, .69, .87] : [1, .72, .40],
      keep * (.25 + random() * .65), .6 + random() ** 3 * 1.7));
  }
  layers.push({ role: 'asteroids', points: asteroids, center: new THREE.Vector2(), occlusion });

  const planetRings: Point[] = [];
  const planetX = width * .81, planetY = height * .17;
  const planetRadius = mobile ? 23 : Math.min(height * .056, width * .044);
  for (let i = 0; i < (mobile ? 3400 : 9500); i++) {
    const a = random() * Math.PI * 2, edge = i % 3 === 0;
    const r = planetRadius * (edge ? 2.30 + random() * .055 : 2.42 + random() * .36);
    const x = Math.cos(a) * r, y = Math.sin(a) * r * .28, tilt = -.35;
    const px = x * Math.cos(tilt) - y * Math.sin(tilt);
    const py = x * Math.sin(tilt) + y * Math.cos(tilt);
    if (Math.sin(a) < 0 && Math.hypot(px, py) < planetRadius * 1.05) continue;
    planetRings.push(point(planetX + px, planetY + py, 0,
      edge ? [.66, .93, 1] : [.57, .53, .89],
      (edge ? .68 : .30) * (.65 + random() * .6), edge ? 1 : .75));
  }
  for (let i = 0; i < (mobile ? 5000 : 14500); i++) {
    const y = random() * 2 - 1, a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < 0) continue;
    // Retain the near-side ring crossing, with a fine-grained lit atmosphere above it.
    const ringY = x * Math.sin(.35) + y * Math.cos(.35);
    if (ringY > .10 && ringY < .65) continue;
    const latitude = y + x * .32 + Math.sin(x * 6 + y * 3) * .07;
    const bands = .5 + Math.sin(latitude * 24 + Math.sin(latitude * 9) * 1.6) * .5;
    const light = Math.max(.12, -x * .35 - y * .45 + z * .65), limb = (1 - z) ** 4;
    const tint = [.35 + bands * .44, .60 + bands * .20, 1];
    planetRings.push(point(planetX + x * planetRadius, planetY + y * planetRadius, z * .014,
      tint, (.25 + light * .85) * (.38 + bands * .62) + limb * .55, .68 + random() * .45));
  }
  layers.push({ role: 'planetRings', points: planetRings, center: new THREE.Vector2() });

  // Append the new sky after the approved scenery so its seeded rocks stay unchanged.
  const starfall: Point[] = [];
  const skyColors = [
    [.16, .55, .92], [.24, .86, 1], [.57, .68, 1],
    [.88, .48, .73], [1, .75, .47], [.66, .89, 1],
  ];
  for (let i = 0; i < (mobile ? 23000 : 66000); i++) {
    const lane = i % 6, t = random(), dust = i % 4 === 0;
    const wave = Math.sin(t * 6.2 + lane * .64);
    const x = width * (.48 + .70 * t + wave * .035);
    const y = height * (-.18 + .62 * t + (lane - 2.5) * .024
      + Math.sin(t * 8.4 + lane * .42) * .036
      + normal() * (dust ? .048 : .005 + lane * .001));
    const keep = weight(x, y);
    if (keep < .025) continue;
    const thread = .38 + .62 * Math.sin(t * 24 + lane * .9) ** 2;
    const envelope = smooth(0, .16, t) * (1 - smooth(.82, 1, t));
    starfall.push(point(x, y, .24 + random() * .38, skyColors[lane],
      keep * envelope * thread * (dust ? .38 : 1.05 + random() * .9),
      dust ? .8 + random() * .8 : .8 + random() ** 3 * 1.7));
  }
  layers.push({ role: 'starfall', points: starfall, center: new THREE.Vector2() });
  return layers;
}
