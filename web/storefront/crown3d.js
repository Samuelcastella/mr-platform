// Corona 3D de MR עדולם — emblema extruido a partir del arte aprobado.
// La silueta (crown-shapes.json) se extruye con bisel; el grabado original
// se aplica como textura + normal map sobre ambas caras (metal pulido).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TAU = Math.PI * 2;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let shared = null; // renderer + escena persistentes (el SPA monta/desmonta la portada)

async function build(base) {
  const loader = new THREE.TextureLoader();
  const [data, albedo, normal] = await Promise.all([
    fetch(base + 'crown-shapes.json').then(r => r.json()),
    loader.loadAsync(base + 'crown-albedo.webp'),
    loader.loadAsync(base + 'crown-normal.webp'),
  ]);
  albedo.colorSpace = THREE.SRGBColorSpace;
  for (const t of [albedo, normal]) { t.anisotropy = 8; t.generateMipmaps = true; }

  const W = data.w, H = data.h;
  const pt = (x, y) => new THREE.Vector2(x - W / 2, H / 2 - y);
  const ring = a => { const p = []; for (let i = 0; i < a.length; i += 2) p.push(pt(a[i], a[i + 1])); return p; };
  const shapes = data.shapes.map(s => {
    const sh = new THREE.Shape(ring(s.o));
    s.h.forEach(h => sh.holes.push(new THREE.Path(ring(h))));
    return sh;
  });

  const depth = 30;
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth, curveSegments: 1, steps: 1,
    bevelEnabled: true, bevelThickness: 6, bevelSize: 3, bevelOffset: 0, bevelSegments: 3,
  });
  geo.translate(0, 0, -depth / 2);
  // UV planar para ambas caras (el grabado se ve igual por delante y por detrás)
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + W / 2) / W, (pos.getY(i) + H / 2) / H);

  const face = new THREE.MeshStandardMaterial({
    map: albedo, normalMap: normal, normalScale: new THREE.Vector2(0.9, 0.9),
    color: 0xffe6a0, metalness: 1, roughness: 0.22, envMapIntensity: 2.2,
  });
  const edge = new THREE.MeshStandardMaterial({ color: 0xd9ae50, metalness: 1, roughness: 0.3, envMapIntensity: 1.8 });
  const mesh = new THREE.Mesh(geo, [face, edge]);
  mesh.scale.setScalar(2 / W); // ancho = 2 unidades
  return { mesh, aspect: H / W };
}

function createStage(base) {
  const canvas = document.createElement('canvas');
  canvas.className = 'crown3d-canvas';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;

  const key = new THREE.DirectionalLight(0xffe2b0, 3.2); key.position.set(2.5, 3, 4);
  const rim = new THREE.DirectionalLight(0xbfd2ff, 1.1); rim.position.set(-3, 1, -3);
  scene.add(key, rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const pivot = new THREE.Group();
  scene.add(pivot);

  const st = {
    canvas, renderer, scene, camera, pivot, container: null, ro: null, io: null, raf: 0,
    rotY: 0, rotX: 0, velY: 0, velX: 0, dragging: false, lastX: 0, lastY: 0,
    idleAt: performance.now(), visible: true, ready: false, aspect: 0.58, t0: performance.now(),
    spinFrom: 0, spinStart: 0,
  };

  build(base).then(({ mesh, aspect }) => {
    pivot.add(mesh); st.aspect = aspect; st.ready = true; fit(st);
    canvas.dataset.ready = '1';
  }).catch(err => { console.warn('[crown3d]', err); canvas.dispatchEvent(new CustomEvent('crown3d:error')); });

  // --- interacción: arrastrar para girar (con inercia), flechas, doble clic = giro completo
  const down = e => {
    st.dragging = true; st.lastX = e.clientX; st.lastY = e.clientY; st.velY = st.velX = 0; st.spinStart = 0;
    canvas.setPointerCapture(e.pointerId); canvas.classList.add('grabbing');
  };
  const move = e => {
    if (!st.dragging) return;
    const dx = e.clientX - st.lastX, dy = e.clientY - st.lastY;
    st.lastX = e.clientX; st.lastY = e.clientY;
    st.rotY += dx * 0.011; st.rotX = Math.max(-0.6, Math.min(0.6, st.rotX + dy * 0.006));
    st.velY = dx * 0.011; st.velX = 0; st.idleAt = performance.now();
  };
  const up = e => { st.dragging = false; st.idleAt = performance.now(); canvas.classList.remove('grabbing'); try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => spin(st));
  canvas.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { st.velY = -0.12; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { st.velY = 0.12; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { st.rotX = Math.max(-0.6, st.rotX - 0.12); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { st.rotX = Math.min(0.6, st.rotX + 0.12); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === ' ') { spin(st); e.preventDefault(); }
    st.idleAt = performance.now();
  });
  return st;
}

function spin(st) { st.velY = 0; st.spinFrom = st.rotY; st.spinStart = performance.now(); }

function fit(st) {
  const el = st.container; if (!el) return;
  const w = el.clientWidth || 1, h = el.clientHeight || 1;
  st.renderer.setSize(w, h, false);
  st.camera.aspect = w / h;
  // distancia para que la corona (2 x aspect) quepa con margen, también al girar
  const vfov = THREE.MathUtils.degToRad(st.camera.fov);
  const needH = st.aspect * 1.55, needW = 2 * 1.18;
  const dH = needH / 2 / Math.tan(vfov / 2);
  const dW = needW / 2 / (Math.tan(vfov / 2) * st.camera.aspect);
  st.camera.position.set(0, 0.04, Math.max(dH, dW));
  st.camera.lookAt(0, 0, 0);
  st.camera.updateProjectionMatrix();
}

function frame(st) {
  st.raf = requestAnimationFrame(() => frame(st));
  if (!st.visible || !st.ready) return;
  const now = performance.now(), t = (now - st.t0) / 1000;
  if (st.spinStart) { // giro completo con easing
    const k = Math.min(1, (now - st.spinStart) / 1600), e = 1 - Math.pow(1 - k, 3);
    st.rotY = st.spinFrom + TAU * e;
    if (k >= 1) st.spinStart = 0;
  } else if (!st.dragging) {
    if (Math.abs(st.velY) > 0.0004) { st.rotY += st.velY; st.velY *= 0.94; }
    else if (!reduceMotion && now - st.idleAt > 2600) { // vuelve a la vista frontal
      const home = Math.round(st.rotY / TAU) * TAU;
      st.rotY += (home - st.rotY) * 0.045;
      st.rotX += (0 - st.rotX) * 0.04;
    }
  }
  const resting = !st.dragging && !st.spinStart && Math.abs(st.velY) <= 0.0004 && now - st.idleAt > 2600;
  const sway = !reduceMotion && resting ? Math.sin(t * 0.7) * 0.2 : 0;
  st.pivot.rotation.set(st.rotX + (reduceMotion ? 0 : Math.sin(t * 0.5) * 0.03), st.rotY + sway, 0);
  st.renderer.render(st.scene, st.camera);
}

export function mountCrown(container, { base = '/assets/' } = {}) {
  if (!container) return () => {};
  if (!shared) shared = createStage(base);
  const st = shared;
  st.container = container;
  container.appendChild(st.canvas);
  st.canvas.tabIndex = 0;
  st.canvas.setAttribute('role', 'img');
  st.canvas.setAttribute('aria-label', 'Corona de MR עדולם en 3D. Arrastra para girarla; doble clic o Enter para un giro completo.');
  st.ro = new ResizeObserver(() => fit(st)); st.ro.observe(container);
  st.io = new IntersectionObserver(([en]) => { st.visible = en.isIntersecting; }, { threshold: 0.01 }); st.io.observe(container);
  fit(st);
  st.idleAt = performance.now();
  if (!st.raf) frame(st);
  return () => {
    st.ro.disconnect(); st.io.disconnect();
    cancelAnimationFrame(st.raf); st.raf = 0;
    st.canvas.remove(); st.container = null;
  };
}

export { spin };
window.mrCrown = { mount: mountCrown };
window.dispatchEvent(new Event('mrcrown:ready'));
