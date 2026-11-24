import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
  dyno,
} from "@sparkjsdev/spark";
import * as THREE from "three";
// [OSS Edition] 절대경로(/examples/...)는 GitHub Pages의 /<저장소명>/ 하위 경로에서 404 → 상대경로로 변경
import { getAssetFileURL } from "../js/get-asset-url.js";

// ===== [OSS Edition] 여기 숫자만 바꿔도 효과가 달라집니다 =====
const params = new URLSearchParams(location.search);
// ?preset=original 을 붙이면 원본 예제의 효과 값으로 실행 (수정 전후 비교용)
const ORIGINAL = params.get("preset") === "original";
const RIPPLE_COLOR = ORIGINAL ? [1.0, 1.0, 1.0] : [1.0, 0.3, 0.9]; // 물결 빛 색 (R, G, B: 0~1) — 네온 핑크, 원본은 흰빛
const RIPPLE_SPEED = ORIGINAL ? 4.0 : 3.0; // 물결이 퍼지는 속도 (원본 4.0)
const RIPPLE_WAVELENGTH = ORIGINAL ? 5.0 : 8.0; // 클수록 물결 간격이 촘촘 (원본 5.0)
const RIPPLE_GLOW = ORIGINAL ? 10.0 : 20.0; // 물결 꼭대기 밝기 (원본 10.0)
// 장면 선택: 주소 뒤에 ?scene=fireplace.spz 처럼 붙이면 다른 3D 스캔으로 바뀜 (목록: ../assets.json)
const SCENE = params.get("scene") || "valley.spz";
const glsl = (n) => n.toFixed(3); // JS 숫자 → GLSL float 문자열

// [OSS Edition] 놀이터 모드: 숫자키로 효과를 바꾸고, 빠르게 연타하면 콤보로 효과가 커짐
const MODES = [
  { key: "1", name: "물결", emoji: "🌊" },
  { key: "2", name: "폭발", emoji: "💥" },
  { key: "3", name: "블랙홀", emoji: "🌀" },
  { key: "4", name: "무지개", emoji: "🌈" },
];
const COMBO_WINDOW_MS = 700; // 이 시간 안에 다시 클릭하면 콤보 +1
const COMBO_STEP = 0.35; // 콤보 1당 효과 세기 증가량
const MAX_POWER = 3.0; // 효과 세기 상한
// ============================================================

const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const spark = new SparkRenderer({ renderer });
scene.add(spark);

const camera = new THREE.PerspectiveCamera(
  50,
  canvas.clientWidth / canvas.clientHeight,
  0.01,
  2000,
);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);
scene.add(camera);

function handleResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", handleResize);

// Camera controls with mouse and WASD enabled
const controls = new SparkControls({ canvas: renderer.domElement });
controls.fpsMovement.enable = true; // Enable WASD movement
controls.pointerControls.enable = true; // Enable mouse controls

// Dyno shader with time and shockwave function
function passthroughDyno(timeUniform, hitpointUniform, u) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const shader = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          time: "float",
          hitpoint: "vec3",
          mode: "float",
          power: "float",
          tint: "vec3",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(/* glsl */ `
           vec3 shockwave(vec3 center, float t, vec3 hitpoint, float power) {
             vec3 direction = center - hitpoint;
             float distance = length(direction);
             center += normalize(direction)*sin(t*${glsl(RIPPLE_SPEED)}-distance*${glsl(RIPPLE_WAVELENGTH)})*exp(-t)*smoothstep(t*2.,0.,distance)*.5*power;
             return center;
           }
           vec4 shockwaveColor(vec4 rgba, vec3 center, float t, vec3 hitpoint, vec3 tint) {
             vec3 direction = center - hitpoint;
             float distance = length(direction);
             float wave = sin(t*${glsl(RIPPLE_SPEED)}-distance*${glsl(RIPPLE_WAVELENGTH)})*exp(-t*.7)*smoothstep(t*2.,0.,distance);
             float brightness = pow(abs(wave),3.) * ${glsl(RIPPLE_GLOW)}; // Increase brightness on wave crests
             // [OSS Edition] 흰빛 대신 tint 색(클릭마다 바뀜)으로 빛나게
             rgba.rgb += brightness * tint;
             return rgba;
           }
           // [OSS Edition] 💥 폭발: 클릭 지점 주변 점들이 튀어 올랐다가 제자리로 돌아옴
           vec3 explode(vec3 center, float t, vec3 hitpoint, float power) {
             vec3 dir = center - hitpoint;
             float d = length(dir);
             float near = exp(-d / (1.5 * power));
             float burst = t * 3. * exp(1. - t * 3.); // 0 → 1(약 0.33초) → 0
             vec3 out_dir = normalize(dir + vec3(0., -0.6, 0.)); // 장면이 뒤집혀 있어 -y가 위쪽
             return center + out_dir * burst * near * power * 1.2;
           }
           vec4 explodeColor(vec4 rgba, vec3 center, float t, vec3 hitpoint, float power, vec3 tint) {
             float d = length(center - hitpoint);
             float near = exp(-d / (1.5 * power));
             float burst = t * 3. * exp(1. - t * 3.);
             rgba.rgb += near * burst * (vec3(1.0, 0.45, 0.1) * 2.5 + tint);
             return rgba;
           }
           // [OSS Edition] 🌀 블랙홀: 소용돌이치며 빨려 들어갔다가 3초 뒤 풀려남
           float blackholePull(vec3 center, float t, vec3 hitpoint, float power) {
             float d = length(center - hitpoint);
             return exp(-d / (2.0 * power)) * smoothstep(0., 1., t) * (1. - smoothstep(2.5, 3.5, t));
           }
           vec3 blackhole(vec3 center, float t, vec3 hitpoint, float power) {
             vec3 dir = center - hitpoint;
             float pull = blackholePull(center, t, hitpoint, power);
             float ang = pull * 6.0 / (length(dir) + 0.5);
             vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * dir.xz;
             return hitpoint + vec3(r.x, dir.y, r.y) * (1. - 0.85 * pull);
           }
           vec4 blackholeColor(vec4 rgba, vec3 center, float t, vec3 hitpoint, float power) {
             float pull = blackholePull(center, t, hitpoint, power);
             rgba.rgb = mix(rgba.rgb, rgba.rgb * 0.2 + vec3(0.55, 0.2, 1.0), pull * 0.7);
             return rgba;
           }
           // [OSS Edition] 🌈 무지개: 무지개색 고리가 클릭 지점에서 퍼져 나감
           vec3 hue2rgb(float h) {
             return clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
           }
           float rainbowBand(vec3 center, float t, vec3 hitpoint, float power) {
             float d = length(center - hitpoint);
             float front = t * 2.0;
             return exp(-pow((d - front) * 1.5 / power, 2.)) * exp(-t * 0.25);
           }
           vec3 rainbow(vec3 center, float t, vec3 hitpoint, float power) {
             return center + vec3(0., -0.15, 0.) * rainbowBand(center, t, hitpoint, power) * power;
           }
           vec4 rainbowColor(vec4 rgba, vec3 center, float t, vec3 hitpoint, float power) {
             float d = length(center - hitpoint);
             float band = rainbowBand(center, t, hitpoint, power);
             rgba.rgb = mix(rgba.rgb, hue2rgb(fract(d * 0.35 - t * 0.5)) * 1.6, clamp(band * 1.2, 0., 1.));
             return rgba;
           }
        `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(/* glsl */ `
          ${outputs.gsplat} = ${inputs.gsplat};
          // [OSS Edition] mode 값(0~3)에 따라 효과 선택
          if (${inputs.mode} < 0.5) {
            ${outputs.gsplat}.center = shockwave(${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
            ${outputs.gsplat}.rgba = shockwaveColor(${inputs.gsplat}.rgba, ${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.tint});
          } else if (${inputs.mode} < 1.5) {
            ${outputs.gsplat}.center = explode(${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
            ${outputs.gsplat}.rgba = explodeColor(${inputs.gsplat}.rgba, ${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power}, ${inputs.tint});
          } else if (${inputs.mode} < 2.5) {
            ${outputs.gsplat}.center = blackhole(${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
            ${outputs.gsplat}.rgba = blackholeColor(${inputs.gsplat}.rgba, ${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
          } else {
            ${outputs.gsplat}.center = rainbow(${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
            ${outputs.gsplat}.rgba = rainbowColor(${inputs.gsplat}.rgba, ${inputs.gsplat}.center, ${inputs.time}, ${inputs.hitpoint}, ${inputs.power});
          }
        `),
      });
      return {
        gsplat: shader.apply({
          gsplat,
          time: timeUniform,
          hitpoint: hitpointUniform,
          mode: u.mode,
          power: u.power,
          tint: u.tint,
        }).gsplat,
      };
    },
  );
}

async function run() {
  // Time and hitpoint uniforms for dyno shader
  const timeUniform = dyno.dynoFloat(0.0);
  const hitpointUniform = dyno.dynoVec3(new THREE.Vector3(0, 0, 1000)); // Initialize far away to avoid initial effect
  // [OSS Edition] 놀이터 모드용 uniform: 효과 종류, 세기(콤보), 빛 색
  const u = {
    mode: dyno.dynoFloat(0.0),
    power: dyno.dynoFloat(1.0),
    tint: dyno.dynoVec3(new THREE.Vector3(...RIPPLE_COLOR)),
  };

  // Load scene (default: valley.spz)
  const splatURL = await getAssetFileURL(SCENE);
  const valley = new SplatMesh({ url: splatURL });
  await valley.initialized;

  // Fix orientation - rotate 180 degrees around X axis
  valley.rotateX(Math.PI);

  // Apply dyno shader with time and hitpoint uniforms
  valley.objectModifier = passthroughDyno(timeUniform, hitpointUniform, u);
  valley.updateGenerator();

  scene.add(valley);

  // Raycaster for click detection
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 1.0 }; // Increased threshold for better hit detection

  // Simple time counter that resets on click
  let timeCounter = 0;

  // Click event listener to set hitpoint and reset time
  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(valley, false);
    const hit = hits?.length ? hits[0] : null;

    if (!hit) {
      return;
    }

    const localPoint = valley.worldToLocal(hit.point.clone());
    // Don't invert Y or Z - keep original coordinates

    hitpointUniform.value.copy(localPoint);
    timeCounter = 0; // Reset time counter
    if (!ORIGINAL) onPlaygroundClick(u);
  });

  if (!ORIGINAL) setupPlayground(u);

  renderer.setAnimationLoop((timeMs) => {
    // Increment time counter each frame
    timeCounter += 0.016; // ~60fps increment
    timeUniform.value = timeCounter;

    // Update dyno uniforms to propagate to the mesh each frame
    valley.updateVersion();

    controls.update(camera);
    renderer.render(scene, camera);
  });
}

// ===== [OSS Edition] 놀이터 모드: 키 입력, 콤보, 화면 표시 =====
const hud = document.getElementById("hud");
let clicks = 0;
let combo = 0;
let lastClickMs = 0;
let currentMode = 0;

function renderHud() {
  if (!hud) return;
  const m = MODES[currentMode];
  hud.innerHTML =
    `<div class="mode">${m.emoji} ${m.name}</div>` +
    `<div class="keys">${MODES.map((x, i) => `<span class="${i === currentMode ? "on" : ""}">${x.key} ${x.emoji}</span>`).join("")}<span>Space 🎲</span></div>` +
    `<div class="stat">클릭 ${clicks}회${combo > 1 ? ` · <b class="combo">콤보 x${combo}!</b>` : ""}</div>`;
}

function setMode(u, i) {
  currentMode = i;
  u.mode.value = i;
  renderHud();
}

function setupPlayground(u) {
  window.addEventListener("keydown", (e) => {
    const i = MODES.findIndex((m) => m.key === e.key);
    if (i >= 0) setMode(u, i);
    if (e.code === "Space") {
      e.preventDefault();
      setMode(u, (currentMode + 1 + Math.floor(Math.random() * (MODES.length - 1))) % MODES.length);
    }
  });
  renderHud();
}

function onPlaygroundClick(u) {
  const now = performance.now();
  combo = now - lastClickMs < COMBO_WINDOW_MS ? combo + 1 : 1;
  lastClickMs = now;
  clicks += 1;
  u.power.value = Math.min(1 + (combo - 1) * COMBO_STEP, MAX_POWER);
  // 클릭할 때마다 무작위 네온 색
  const c = new THREE.Color().setHSL(Math.random(), 1.0, 0.6);
  u.tint.value.set(c.r, c.g, c.b);
  renderHud();
}

run();
