import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
  dyno,
} from "@sparkjsdev/spark";
import * as THREE from "three";
// [OSS Edition] 절대경로(/examples/...)는 GitHub Pages의 /<저장소명>/ 하위 경로에서 404 → 상대경로로 변경
import { getAssetFileURL } from "../js/get-asset-url.js";

// ╔══════════════════════════════════════════════════════════════════╗
// ║  [OSS Edition] 🎨 내 효과 목록 — 여기만 고치면 됩니다!              ║
// ║                                                                  ║
// ║  key      : 누를 키 (숫자 1~9 추천. W A S D Q E L 은 이미 사용 중)  ║
// ║  name     : 화면에 보일 이름          emoji : 아무 이모지          ║
// ║  type     : 효과 종류 7가지 중 하나                                 ║
// ║             ripple(물결) explode(폭발) blackhole(블랙홀)            ║
// ║             rainbow(무지개) float(둥실) glitch(글리치) ice(얼음)    ║
// ║  color    : "#RRGGBB" 색, 또는 "random"(클릭마다 랜덤)              ║
// ║  size     : 효과 범위   (0.2 ~ 3, 기본 1)                           ║
// ║  strength : 효과 세기   (0.2 ~ 3, 기본 1)                           ║
// ║  speed    : 효과 속도   (0.2 ~ 3, 기본 1)                           ║
// ║                                                                  ║
// ║  💡 줄을 복사해서 key만 바꾸면 새 효과가 추가돼요.                   ║
// ║  💡 화면에서 L 키 → 🧪 실험실에서 값을 바꿔 보고 "이 줄 복사"!       ║
// ╚══════════════════════════════════════════════════════════════════╝
const MY_EFFECTS = [
  { key: "1", name: "물결", emoji: "🌊", type: "ripple", color: "random", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "2", name: "폭발", emoji: "💥", type: "explode", color: "#ff7a1a", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "3", name: "블랙홀", emoji: "🌀", type: "blackhole", color: "#8c33ff", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "4", name: "무지개", emoji: "🌈", type: "rainbow", color: "random", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "5", name: "둥실", emoji: "🎈", type: "float", color: "#4dffea", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "6", name: "글리치", emoji: "📺", type: "glitch", color: "#ff4de1", size: 1.0, strength: 1.0, speed: 1.0 },
  { key: "7", name: "얼음", emoji: "❄️", type: "ice", color: "#9ad8ff", size: 1.0, strength: 1.0, speed: 1.0 },
];

// 연타 콤보: COMBO_WINDOW_MS 안에 다시 클릭하면 콤보 +1, 효과가 커짐
const COMBO_WINDOW_MS = 700;
const COMBO_STEP = 0.35; // 콤보 1당 커지는 정도
const MAX_POWER = 3.0; // 최대 몇 배까지

// color: "random" 일 때 고르는 색들
const RANDOM_COLORS = ["#ff4de1", "#4dffea", "#ffe84d", "#7c4dff", "#4dff7c", "#ff6b4d"];

// 장면 선택: 주소 뒤에 ?scene=fireplace.spz 처럼 붙이면 다른 3D 스캔으로 바뀜 (목록: ../assets.json)
const params = new URLSearchParams(location.search);
const SCENE = params.get("scene") || "valley.spz";
// ?preset=original 을 붙이면 원본 예제(흰빛 물결) 그대로 실행 — 수정 전후 비교용
const ORIGINAL = params.get("preset") === "original";
// ════════════════════════════ 여기까지 ════════════════════════════

const TYPES = ["ripple", "explode", "blackhole", "rainbow", "float", "glitch", "ice"];
const EFFECTS = ORIGINAL
  ? [{ key: "1", name: "원본 물결", emoji: "🌊", type: "ripple", color: "#ffffff", size: 1, strength: 1, speed: 1 }]
  : MY_EFFECTS;

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

// [OSS Edition] GPU에서 도는 효과 코드(GLSL). 각 점(Gaussian)의 위치 c와 색 col을 바꿈.
// 원본은 물결 1종이었고, mode 값으로 7종 중 하나를 고르도록 확장.
// size·strength·speed·tint(색)·power(콤보)는 JS에서 uniform으로 넘어옴.
const FX_GLSL = /* glsl */ `
  float fxHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  vec3 fxHue(float h) { return clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); }

  void fx(inout vec3 c, inout vec4 col, float t, vec3 hit, float mode, float power,
          vec3 tint, float size, float strength, float speed) {
    vec3 c0 = c;
    vec3 dir = c0 - hit;
    float d = length(dir);
    float tt = t * speed;          // 속도
    float amp = strength * power;  // 세기 × 콤보
    float range = size * power;    // 범위 × 콤보
    vec3 up = vec3(0., -1., 0.);   // 장면이 뒤집혀 있어서 -y가 위쪽

    if (mode < 0.5) {
      // 🌊 물결 (원본 예제의 shockwave와 같은 식, size·strength·speed=1이면 원본과 동일)
      float s = sin(tt * 4. - d * 5. / size);
      c = c0 + normalize(dir) * s * exp(-tt) * smoothstep(tt * 2. * size, 0., d) * .5 * amp;
      float wave = s * exp(-tt * .7) * smoothstep(tt * 2. * size, 0., d);
      col.rgb += pow(abs(wave), 3.) * 10. * strength * tint;
    } else if (mode < 1.5) {
      // 💥 폭발: 튀어 올랐다가 제자리로
      float near = exp(-d / (1.5 * range));
      float burst = tt * 3. * exp(1. - tt * 3.);
      c = c0 + normalize(dir + up * .6) * burst * near * amp * 1.2;
      col.rgb += near * burst * (tint * 2.5 + .3);
    } else if (mode < 2.5) {
      // 🌀 블랙홀: 소용돌이치며 빨려 들어갔다가 풀려남
      float pull = exp(-d / (2. * range)) * smoothstep(0., 1., tt) * (1. - smoothstep(2.5, 3.5, tt));
      float ang = pull * 6. * strength / (d + .5);
      vec2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * dir.xz;
      c = hit + vec3(r.x, dir.y, r.y) * (1. - .85 * pull);
      col.rgb = mix(col.rgb, col.rgb * .2 + tint, pull * .7);
    } else if (mode < 3.5) {
      // 🌈 무지개: 무지개 고리가 퍼져 나감
      float band = exp(-pow((d - tt * 2. * size) * 1.5 / range, 2.)) * exp(-tt * .25);
      c = c0 + up * .15 * band * amp;
      col.rgb = mix(col.rgb, fxHue(fract(d * .35 / size - tt * .5)) * 1.6, clamp(band * 1.2 * strength, 0., 1.));
    } else if (mode < 4.5) {
      // 🎈 둥실: 하늘로 떠올라 흔들리다가 내려옴
      float near = exp(-d / (1.5 * range));
      float lift = near * smoothstep(0., 1.5, tt) * (1. - smoothstep(3., 4.5, tt));
      vec3 sway = vec3(sin(tt * 3. + c0.z * 4.), 0., cos(tt * 3. + c0.x * 4.)) * .15;
      c = c0 + (up * 2. + sway) * lift * amp;
      col.rgb += tint * lift;
    } else if (mode < 5.5) {
      // 📺 글리치: 화면이 가로로 찢어지며 색이 뒤섞임
      float near = exp(-d / (2. * range)) * exp(-tt * .6);
      float r = fxHash(vec3(floor(c0.y * 10. / size), floor(tt * 15.), 1.));
      float on = step(.55, r) * near;
      c = c0 + vec3((r - .5) * 1.2, 0., 0.) * on * amp;
      col.rgb = mix(col.rgb, col.gbr + tint * .6, clamp(on * 1.5, 0., 1.));
    } else {
      // ❄️ 얼음: 얼음이 퍼지며 반짝이다가 녹음
      float front = tt * 1.5 * size;
      float ice = (1. - smoothstep(front - .6, front, d)) * (1. - smoothstep(4., 5., tt)) * exp(-d / (6. * range));
      float lum = dot(col.rgb, vec3(.3, .59, .11));
      float sparkle = pow(fxHash(floor(c0 * 40.)), 30.) * (.5 + .5 * sin(tt * 8. + c0.x * 20.));
      col.rgb = mix(col.rgb, vec3(lum) * .5 + tint * 1.2 + sparkle * 2., clamp(ice * strength, 0., 1.));
      c = c0 + (vec3(fxHash(c0), fxHash(c0 + 1.), fxHash(c0 + 2.)) - .5) * .02 * ice * sin(tt * 60.);
    }
  }
`;

function effectDyno(u) {
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
          size: "float",
          strength: "float",
          speed: "float",
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [dyno.unindent(FX_GLSL)],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(/* glsl */ `
          ${outputs.gsplat} = ${inputs.gsplat};
          {
            vec3 fx_c = ${inputs.gsplat}.center;
            vec4 fx_col = ${inputs.gsplat}.rgba;
            fx(fx_c, fx_col, ${inputs.time}, ${inputs.hitpoint}, ${inputs.mode}, ${inputs.power},
               ${inputs.tint}, ${inputs.size}, ${inputs.strength}, ${inputs.speed});
            ${outputs.gsplat}.center = fx_c;
            ${outputs.gsplat}.rgba = fx_col;
          }
        `),
      });
      return {
        gsplat: shader.apply({ gsplat, ...u }).gsplat,
      };
    },
  );
}

// [OSS Edition] "#RRGGBB" → [r, g, b] (0~1)
function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

async function run() {
  // GPU로 넘기는 값(uniform)
  const u = {
    time: dyno.dynoFloat(0.0),
    hitpoint: dyno.dynoVec3(new THREE.Vector3(0, 0, 1000)), // 처음엔 멀리 두어 효과가 안 보이게
    mode: dyno.dynoFloat(0.0),
    power: dyno.dynoFloat(1.0),
    tint: dyno.dynoVec3(new THREE.Vector3(1, 1, 1)),
    size: dyno.dynoFloat(1.0),
    strength: dyno.dynoFloat(1.0),
    speed: dyno.dynoFloat(1.0),
  };

  // Load scene (default: valley.spz)
  const splatURL = await getAssetFileURL(SCENE);
  const valley = new SplatMesh({ url: splatURL });
  await valley.initialized;

  // Fix orientation - rotate 180 degrees around X axis
  valley.rotateX(Math.PI);

  valley.objectModifier = effectDyno(u);
  valley.updateGenerator();

  scene.add(valley);

  // Raycaster for click detection
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 1.0 }; // Increased threshold for better hit detection

  let timeCounter = 0;

  renderer.domElement.addEventListener("pointerdown", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(valley, false);
    const hit = hits?.length ? hits[0] : null;
    if (!hit) return;

    u.hitpoint.value.copy(valley.worldToLocal(hit.point.clone()));
    timeCounter = 0; // 클릭하면 효과 시간을 0부터 다시
    onClick(u);
  });

  setupPlayground(u);

  let lastMs = null;
  renderer.setAnimationLoop((timeMs) => {
    // [OSS Edition] 원본은 프레임당 0.016초 고정이라 느린 PC에서 효과도 느려짐 → 실제 경과 시간 사용(원본 모드는 그대로)
    const dt = ORIGINAL || lastMs === null ? 0.016 : Math.min((timeMs - lastMs) / 1000, 0.1);
    lastMs = timeMs;
    timeCounter += dt;
    u.time.value = timeCounter;

    valley.updateVersion(); // uniform 변경을 매 프레임 반영
    controls.update(camera);
    renderer.render(scene, camera);
  });
}

// ===== [OSS Edition] 놀이터: 키 입력, 콤보, 화면 표시, 🧪 실험실 =====
const hud = document.getElementById("hud");
const lab = document.getElementById("lab");
let current = 0;
let clicks = 0;
let combo = 0;
let lastClickMs = 0;

function applyEffect(u) {
  const e = EFFECTS[current];
  u.mode.value = Math.max(0, TYPES.indexOf(e.type));
  u.size.value = e.size;
  u.strength.value = e.strength;
  u.speed.value = e.speed;
  if (e.color !== "random") u.tint.value.set(...hexToRgb(e.color));
}

function onClick(u) {
  const now = performance.now();
  combo = now - lastClickMs < COMBO_WINDOW_MS ? combo + 1 : 1;
  lastClickMs = now;
  clicks += 1;
  u.power.value = ORIGINAL ? 1 : Math.min(1 + (combo - 1) * COMBO_STEP, MAX_POWER);
  applyEffect(u);
  if (EFFECTS[current].color === "random") {
    const pick = RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
    u.tint.value.set(...hexToRgb(pick));
  }
  renderHud();
}

function renderHud() {
  if (ORIGINAL || !hud) return;
  const e = EFFECTS[current];
  hud.innerHTML =
    `<div class="mode">${e.emoji} ${e.name}</div>` +
    `<div class="keys">${EFFECTS.map((x, i) => `<span class="${i === current ? "on" : ""}">${x.key} ${x.emoji}</span>`).join("")}` +
    "<span>Space 🎲</span><span>L 🧪</span></div>" +
    `<div class="stat">클릭 ${clicks}회${combo > 1 ? ` · <b class="combo">콤보 x${combo}!</b>` : ""}</div>`;
  renderLab();
}

function select(u, i) {
  current = i;
  applyEffect(u);
  renderHud();
}

// 🧪 실험실: 슬라이더로 값을 바꿔 보고, 마음에 들면 코드 한 줄을 복사
const fmt = (n) => Number(n).toFixed(1);
function effectLine(e) {
  return `{ key: "${e.key}", name: "${e.name}", emoji: "${e.emoji}", type: "${e.type}", color: "${e.color}", size: ${fmt(e.size)}, strength: ${fmt(e.strength)}, speed: ${fmt(e.speed)} },`;
}
function renderLab() {
  if (!lab || lab.hidden) return;
  const e = EFFECTS[current];
  lab.querySelector("#lab-name").textContent = `${e.emoji} ${e.name} (${e.type})`;
  for (const k of ["size", "strength", "speed"]) {
    lab.querySelector(`#lab-${k}`).value = e[k];
    lab.querySelector(`#lab-${k}-v`).textContent = fmt(e[k]);
  }
  lab.querySelector("#lab-type").value = e.type;
  if (e.color !== "random") lab.querySelector("#lab-color").value = e.color;
  lab.querySelector("#lab-random").checked = e.color === "random";
  lab.querySelector("#lab-code").textContent = effectLine(e);
}
function setupLab(u) {
  if (!lab) return;
  const typeSel = lab.querySelector("#lab-type");
  typeSel.innerHTML = TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
  const edit = (fn) => {
    fn(EFFECTS[current]);
    applyEffect(u);
    renderHud();
  };
  for (const k of ["size", "strength", "speed"]) {
    lab.querySelector(`#lab-${k}`).addEventListener("input", (ev) => edit((e) => { e[k] = Number(ev.target.value); }));
  }
  typeSel.addEventListener("change", (ev) => edit((e) => { e.type = ev.target.value; }));
  lab.querySelector("#lab-color").addEventListener("input", (ev) => edit((e) => { e.color = ev.target.value; }));
  lab.querySelector("#lab-random").addEventListener("change", (ev) =>
    edit((e) => { e.color = ev.target.checked ? "random" : lab.querySelector("#lab-color").value; }),
  );
  lab.querySelector("#lab-copy").addEventListener("click", async () => {
    const btn = lab.querySelector("#lab-copy");
    try {
      await navigator.clipboard.writeText(effectLine(EFFECTS[current]));
      btn.textContent = "✅ 복사됨!";
    } catch {
      btn.textContent = "위 글자를 드래그해서 복사하세요";
    }
    setTimeout(() => { btn.textContent = "📋 이 줄 복사"; }, 1500);
  });
  document.getElementById("lab-toggle")?.addEventListener("click", () => toggleLab());
}
function toggleLab() {
  if (!lab) return;
  lab.hidden = !lab.hidden;
  renderLab();
}

function setupPlayground(u) {
  applyEffect(u);
  if (ORIGINAL) {
    u.tint.value.set(1, 1, 1);
    document.getElementById("lab-toggle")?.remove();
    return;
  }
  setupLab(u);
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const i = EFFECTS.findIndex((x) => x.key === e.key);
    if (i >= 0) select(u, i);
    if (e.code === "Space") {
      e.preventDefault();
      if (EFFECTS.length > 1) select(u, (current + 1 + Math.floor(Math.random() * (EFFECTS.length - 1))) % EFFECTS.length);
    }
    if (e.code === "KeyL") toggleLab();
  });
  renderHud();
}

run();
