// ═══════════════════════════════════════════════
//  프렌즈뽑기 — game.js
// ═══════════════════════════════════════════════

// ── 캐릭터 정의 ──────────────────────────────────
const DEFAULT_CHARACTERS = [
  { id:'warrior',      defaultName:'전사',      file:'hero_warrior.png'      },
  { id:'wizard',       defaultName:'마법사',     file:'hero_wizard.png'       },
  { id:'assassin',     defaultName:'자객',       file:'hero_assassin.png'     },
  { id:'druid',        defaultName:'드루이드',    file:'hero_druid.png'        },
  { id:'bard',         defaultName:'음유시인',    file:'hero_bard.png'         },
  { id:'barbarian',    defaultName:'광전사',      file:'hero_barbarian.png'    },
  { id:'cleric',       defaultName:'성직자',      file:'hero_cleric.png'       },
  { id:'dogkinhunter', defaultName:'사냥꾼',      file:'hero_dogkinhunter.png' },
  { id:'gunner',       defaultName:'총잡이',      file:'hero_gunner.png'       },
  { id:'monk',         defaultName:'수도사',      file:'hero_monk.png'         },
  { id:'paladin',      defaultName:'성기사',      file:'hero_paladin.png'      },
  { id:'ranger',       defaultName:'레인저',      file:'hero_ranger.png'       },
  { id:'rogue',        defaultName:'도적',        file:'hero_rogue.png'        },
  { id:'warlock',      defaultName:'흑마법사',    file:'hero_warlock.png'      },
  { id:'warlord',      defaultName:'군주',        file:'hero_warlord.png'      },
  { id:'artificer',    defaultName:'발명가',      file:'hero_artificer.png'    },
];

// ── 상태 ────────────────────────────────────────
let characters = [];      // {id, name, file, img} 로드 완료 목록
let collection = {};      // {id: count}
let customNames = {};     // {id: '홍길동'}

let canvas, ctx;
let W, H;

// 크레인 상태
const claw = {
  x: 0,          // 현재 X (0~1 비율)
  depth: 0.5,    // 전후 깊이 (0~1)
  y: 0,          // 현재 y픽셀 (내려가는 중)
  state: 'idle', // idle | moving-left | moving-right | dropping | rising | grabbed | result
  grabbedChar: null,
  speed: 0.004,
};

// 인형 위치들 (물리 없이 고정 레이아웃, 랜덤 살짝 틀어짐)
let dollPositions = [];

let moveInterval = null;
let animFrame = null;
let dropLocked = false;

// ── 초기화 ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  setupCanvas();
  loadImages().then(() => {
    buildDollPositions();
    startLoop();
  });
});

function loadSavedData() {
  try {
    const saved = JSON.parse(localStorage.getItem('clawgame_data') || '{}');
    collection  = saved.collection  || {};
    customNames = saved.customNames || {};
  } catch(e) { collection = {}; customNames = {}; }
}

function saveData() {
  localStorage.setItem('clawgame_data', JSON.stringify({ collection, customNames }));
}

function getCharName(ch) {
  return customNames[ch.id] || ch.defaultName;
}

// ── 캔버스 세팅 ─────────────────────────────────
function setupCanvas() {
  canvas = document.getElementById('gameCanvas');
  const cabinet = document.getElementById('cabinet-inner');
  const resize = () => {
    W = cabinet.clientWidth;
    H = cabinet.clientHeight || window.innerHeight * 0.52;
    canvas.width  = W;
    canvas.height = H;
    if (dollPositions.length) buildDollPositions();
  };
  resize();
  window.addEventListener('resize', resize);
  ctx = canvas.getContext('2d');
  claw.x = 0.5;
  claw.y = 60;
}

// ── 이미지 로드 ─────────────────────────────────
function loadImages() {
  return new Promise(resolve => {
    let loaded = 0;
    characters = DEFAULT_CHARACTERS.map(c => ({...c, img: new Image()}));
    characters.forEach(c => {
      c.img.onload  = () => { if (++loaded === characters.length) resolve(); };
      c.img.onerror = () => { if (++loaded === characters.length) resolve(); };
      c.img.src = `assets/characters/${c.file}`;
    });
  });
}

// ── 인형 위치 생성 ───────────────────────────────
function buildDollPositions() {
  dollPositions = [];
  const rows = [
    { y: 0.72, count: 6, scale: 0.90 },
    { y: 0.55, count: 5, scale: 0.80 },
    { y: 0.41, count: 4, scale: 0.70 },
    { y: 0.29, count: 3, scale: 0.62 },
  ];
  let idx = 0;
  rows.forEach(row => {
    for (let i = 0; i < row.count; i++) {
      const ch = characters[idx % characters.length];
      const jx = (Math.random() - 0.5) * 0.03;
      const jy = (Math.random() - 0.5) * 0.03;
      dollPositions.push({
        char: ch,
        nx: (i + 1) / (row.count + 1) + jx,
        ny: row.y + jy,
        scale: row.scale + (Math.random() - 0.5) * 0.05,
        angle: (Math.random() - 0.5) * 0.25,
        grabbed: false,
      });
      idx++;
    }
  });
}

// ── 메인 루프 ────────────────────────────────────
function startLoop() {
  if (animFrame) cancelAnimationFrame(animFrame);
  function loop() {
    update();
    draw();
    animFrame = requestAnimationFrame(loop);
  }
  loop();
}

function update() {
  if (claw.state === 'dropping') {
    claw.y += 5;
    const maxY = H * 0.78;
    if (claw.y >= maxY) {
      // 집기 판정
      const hit = tryGrab();
      if (hit) {
        claw.state = 'grabbed';
        claw.grabbedChar = hit;
      } else {
        claw.state = 'rising';
      }
    }
  } else if (claw.state === 'rising' || claw.state === 'grabbed') {
    claw.y -= 5;
    if (claw.y <= 60) {
      claw.y = 60;
      if (claw.state === 'grabbed') {
        showWin(claw.grabbedChar);
      } else {
        showFail();
      }
      claw.state = 'result';
    }
  }
}

function tryGrab() {
  const cx = claw.x * W;
  const depth = claw.depth; // 0~1
  // 같은 depth 근처에 있는 인형 중 x 가장 가까운 것
  const candidates = dollPositions.filter(d => {
    if (d.grabbed) return false;
    const dx = Math.abs(d.nx * W - cx);
    // depth 기반 y 범위 - 깊이에 따라 row 다름
    const dyFit = Math.abs(d.ny - (0.35 + depth * 0.45)) < 0.18;
    return dx < W * 0.14 && dyFit;
  });
  if (!candidates.length) return null;
  // 거리 가장 가까운 것
  candidates.sort((a,b) => Math.abs(a.nx*W-cx) - Math.abs(b.nx*W-cx));
  const target = candidates[0];
  // 성공 확률 60%
  if (Math.random() < 0.60) {
    target.grabbed = true;
    return target;
  }
  return null;
}

// ── 그리기 ──────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 바닥 표시
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, H * 0.82, W, H * 0.18);

  // 인형들
  dollPositions.forEach(d => {
    if (d.grabbed) return;
    const x = d.nx * W;
    const y = d.ny * H;
    const size = Math.min(W, H) * d.scale * 0.19;
    drawDoll(d.char, x, y, size, d.angle, false);
  });

  // 크레인 줄
  const clawX = claw.x * W;
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(clawX, 0);
  ctx.lineTo(clawX, claw.y - 10);
  ctx.stroke();

  // 크레인 집게
  drawClawHead(clawX, claw.y);

  // 잡은 인형
  if (claw.state === 'grabbed' && claw.grabbedChar) {
    const size = Math.min(W, H) * 0.18;
    drawDoll(claw.grabbedChar.char, clawX, claw.y + size * 0.6, size, 0, true);
  }

  // 트랙 레일
  ctx.fillStyle = '#e5a800';
  ctx.fillRect(0, 12, W, 8);
  // 크레인 트롤리
  ctx.fillStyle = '#f5c518';
  ctx.beginPath();
  ctx.roundRect(clawX - 16, 8, 32, 16, 4);
  ctx.fill();
  ctx.strokeStyle = '#e5a800';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawClawHead(x, y) {
  const armLen = 22;
  const spread = 14;
  ctx.strokeStyle = '#f5c518';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  // 왼쪽 집게
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - spread, y + armLen);
  ctx.stroke();
  // 오른쪽 집게
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + spread, y + armLen);
  ctx.stroke();
  // 별 장식
  ctx.fillStyle = '#fff200';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e5a800';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDoll(char, x, y, size, angle, isHeld) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(0, size * 0.52, size * 0.38, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // 캐릭터 이미지
  if (char.img && char.img.complete && char.img.naturalWidth > 0) {
    ctx.drawImage(char.img, -size/2, -size/2, size, size);
  } else {
    // 폴백 원
    ctx.fillStyle = '#f0c060';
    ctx.beginPath();
    ctx.arc(0, 0, size/2, 0, Math.PI*2);
    ctx.fill();
  }

  // 이름 태그
  const name = getCharName(char);
  const tagW = Math.max(name.length * 9 + 12, 44);
  const tagH = 18;
  const tagY = -size/2 - tagH - 2;

  ctx.fillStyle = 'rgba(30,30,30,0.75)';
  ctx.beginPath();
  ctx.roundRect(-tagW/2, tagY, tagW, tagH, 5);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${tagH - 5}px "Apple SD Gothic Neo", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 0, tagY + tagH/2);

  ctx.restore();
}

// ── 컨트롤 액션 ─────────────────────────────────
function startMove(dir) {
  stopMove();
  if (claw.state !== 'idle') return;
  moveInterval = setInterval(() => {
    if (dir === 'left')  claw.x = Math.max(0.05, claw.x - claw.speed * 14);
    if (dir === 'right') claw.x = Math.min(0.95, claw.x + claw.speed * 14);
  }, 16);
}

function stopMove() {
  if (moveInterval) { clearInterval(moveInterval); moveInterval = null; }
}

function setDepth(val) {
  claw.depth = val / 100;
}

function dropClaw() {
  if (claw.state !== 'idle' || dropLocked) return;
  dropLocked = true;
  claw.state = 'dropping';
  claw.y = 60;
  claw.grabbedChar = null;
}

function resetClawToIdle() {
  claw.state = 'idle';
  claw.y = 60;
  claw.grabbedChar = null;
  dropLocked = false;
}

// ── 결과 팝업 ────────────────────────────────────
function showWin(dollPos) {
  const ch = dollPos.char;
  collection[ch.id] = (collection[ch.id] || 0) + 1;
  saveData();

  const box = document.getElementById('win-box');
  box.innerHTML = `
    <img src="assets/characters/${ch.file}" alt="${getCharName(ch)}">
    <div id="win-char-name">${getCharName(ch)}</div>
    <div id="win-msg">뽑았다! 🎉</div>
    <button onclick="closeWin()">계속하기</button>
  `;
  document.getElementById('overlay-win').classList.remove('hidden');
}

function showFail() {
  document.getElementById('overlay-fail').classList.remove('hidden');
}

function closeWin() {
  document.getElementById('overlay-win').classList.add('hidden');
  resetClawToIdle();
}

function closeFail() {
  document.getElementById('overlay-fail').classList.add('hidden');
  resetClawToIdle();
}

// ── 컬렉션 모달 ─────────────────────────────────
function openCollection() {
  const grid = document.getElementById('collection-grid');
  grid.innerHTML = characters.map(ch => {
    const cnt = collection[ch.id] || 0;
    const locked = cnt === 0;
    return `
      <div class="col-item">
        <img src="assets/characters/${ch.file}" class="${locked ? 'locked' : ''}" alt="${getCharName(ch)}">
        <div class="col-name">${getCharName(ch)}</div>
        ${cnt > 0 ? `<div class="col-count">×${cnt}</div>` : '<div class="col-count" style="color:#bbb">미보유</div>'}
      </div>`;
  }).join('');
  document.getElementById('modal-collection').classList.remove('hidden');
}

function closeCollection() {
  document.getElementById('modal-collection').classList.add('hidden');
}

// ── 이름 편집 모달 ───────────────────────────────
function openNameEditor() {
  const list = document.getElementById('name-editor-list');
  list.innerHTML = characters.map(ch => `
    <div class="name-row">
      <img src="assets/characters/${ch.file}" alt="">
      <input type="text"
        id="name-input-${ch.id}"
        placeholder="${ch.defaultName}"
        value="${customNames[ch.id] || ''}"
        maxlength="8">
    </div>
  `).join('');
  document.getElementById('modal-names').classList.remove('hidden');
}

function saveNames() {
  characters.forEach(ch => {
    const input = document.getElementById(`name-input-${ch.id}`);
    const val = input ? input.value.trim() : '';
    if (val) customNames[ch.id] = val;
    else delete customNames[ch.id];
  });
  saveData();
  closeNameEditor();
}

function closeNameEditor() {
  document.getElementById('modal-names').classList.add('hidden');
}

// ── 메뉴 ────────────────────────────────────────
function toggleMenu() {
  document.getElementById('menu-panel').classList.toggle('hidden');
}

function resetCollection() {
  if (confirm('컬렉션을 초기화할까요?')) {
    collection = {};
    saveData();
    buildDollPositions();
    toggleMenu();
  }
}
