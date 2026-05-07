// ═══════════════════════════════════════════════
//  프렌즈뽑기 — game.js  v2 (중력 + 정확한 집기)
// ═══════════════════════════════════════════════

// ── 캐릭터 정의 ──────────────────────────────────
const DEFAULT_CHARACTERS = [
  { id:'warrior',      defaultName:'전사',     file:'hero_warrior.png'      },
  { id:'wizard',       defaultName:'마법사',    file:'hero_wizard.png'       },
  { id:'assassin',     defaultName:'자객',      file:'hero_assassin.png'     },
  { id:'druid',        defaultName:'드루이드',   file:'hero_druid.png'        },
  { id:'bard',         defaultName:'음유시인',   file:'hero_bard.png'         },
  { id:'barbarian',    defaultName:'광전사',     file:'hero_barbarian.png'    },
  { id:'cleric',       defaultName:'성직자',     file:'hero_cleric.png'       },
  { id:'dogkinhunter', defaultName:'사냥꾼',     file:'hero_dogkinhunter.png' },
  { id:'gunner',       defaultName:'총잡이',     file:'hero_gunner.png'       },
  { id:'monk',         defaultName:'수도사',     file:'hero_monk.png'         },
  { id:'paladin',      defaultName:'성기사',     file:'hero_paladin.png'      },
  { id:'ranger',       defaultName:'레인저',     file:'hero_ranger.png'       },
  { id:'rogue',        defaultName:'도적',       file:'hero_rogue.png'        },
  { id:'warlock',      defaultName:'흑마법사',   file:'hero_warlock.png'      },
  { id:'warlord',      defaultName:'군주',       file:'hero_warlord.png'      },
  { id:'artificer',    defaultName:'발명가',     file:'hero_artificer.png'    },
];

// ── 전역 상태 ─────────────────────────────────────
let characters = [];   // 로드된 캐릭터 배열
let collection  = {};  // {id: count}
let customNames = {};  // {id: '홍길동'}

let canvas, ctx, W, H;

// 인형 객체 배열 (물리 기반)
// 각 인형: { char, x, y, r, angle, vx, vy, settled, grabbed, removing }
let dolls = [];
const DOLL_RADIUS_RATIO = 0.075; // 캔버스 폭 대비 인형 반지름

// ── 크레인 상태 머신 ─────────────────────────────
// idle → dropping → hit(집기 판정) → rising → result → idle
const CLAW_STATE = { IDLE:'idle', DROPPING:'dropping', HIT:'hit', RISING:'rising', RESULT:'result' };
const claw = {
  x: 0.5,       // 0~1 (캔버스 폭 비율)
  y: 0,         // 현재 y 픽셀 (크레인 집게 끝 위치)
  topY: 0,      // 레일 y (고정, 초기화 시 설정)
  speed: 3.5,   // 하강/상승 속도(px/frame)
  state: CLAW_STATE.IDLE,
  grabbedDoll: null,
  hitY: 0,      // 충돌한 y (집기 위치)
};

// 이동 인터벌
let moveInterval = null;
let animFrame    = null;
let isDropping   = false;

// ── 초기화 ────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadSavedData();
  setupCanvas();
  loadImages().then(() => {
    spawnDolls();
    startLoop();
  });
});

// ── 저장/불러오기 ─────────────────────────────────
function loadSavedData() {
  try {
    const d = JSON.parse(localStorage.getItem('clawgame_v2') || '{}');
    collection  = d.collection  || {};
    customNames = d.customNames || {};
  } catch { collection = {}; customNames = {}; }
}
function saveData() {
  localStorage.setItem('clawgame_v2', JSON.stringify({ collection, customNames }));
}
function getCharName(ch) { return customNames[ch.id] || ch.defaultName; }

// ── 캔버스 설정 ───────────────────────────────────
function setupCanvas() {
  canvas = document.getElementById('gameCanvas');
  ctx    = canvas.getContext('2d');

  function resize() {
    const inner = document.getElementById('cabinet-inner');
    W = inner.clientWidth  || 360;
    H = inner.clientHeight || Math.round(W * 1.35);
    canvas.width  = W;
    canvas.height = H;
    claw.topY = 28;
    claw.y    = claw.topY;
    if (dolls.length) settleDolls();
  }
  resize();
  window.addEventListener('resize', () => { resize(); spawnDolls(); });
}

// ── 이미지 로드 ───────────────────────────────────
function loadImages() {
  return new Promise(resolve => {
    let done = 0;
    characters = DEFAULT_CHARACTERS.map(c => ({ ...c, img: new Image() }));
    characters.forEach(c => {
      c.img.onload = c.img.onerror = () => { if (++done === characters.length) resolve(); };
      c.img.src = `assets/characters/${c.file}`;
    });
  });
}

// ── 인형 생성 & 중력 정착 ─────────────────────────
const FLOOR_RATIO = 0.88;  // 바닥 y 위치 (캔버스 높이 비율)
const GRAVITY     = 0.55;
const BOUNCE      = 0.18;
const FRICTION    = 0.82;

function spawnDolls() {
  dolls = [];
  const R     = W * DOLL_RADIUS_RATIO;
  const floor = H * FLOOR_RATIO;
  const cols  = Math.floor((W - R * 2) / (R * 2.1));
  const total = Math.min(characters.length, 16);

  // 셔플된 캐릭터 목록
  const shuffled = [...characters].sort(() => Math.random() - 0.5).slice(0, total);

  shuffled.forEach((ch, i) => {
    const col  = i % cols;
    const row  = Math.floor(i / cols);
    // 약간의 랜덤 offset
    const jx   = (Math.random() - 0.5) * R * 0.6;
    const startX = R + col * (R * 2.1) + R + jx;
    // 위에서 떨어지는 시작 위치 (row별로 간격)
    const startY = -R * 2 - row * R * 3.5;

    dolls.push({
      char:     ch,
      x:        Math.max(R, Math.min(W - R, startX)),
      y:        startY,
      r:        R,
      angle:    (Math.random() - 0.5) * 0.4,
      vx:       (Math.random() - 0.5) * 1.5,
      vy:       0,
      settled:  false,
      grabbed:  false,
      removing: false,
    });
  });

  // 물리 시뮬레이션으로 바닥까지 정착
  settleDolls();
}

function settleDolls() {
  const floor = H * FLOOR_RATIO;
  const R     = W * DOLL_RADIUS_RATIO;

  // 최대 400 스텝 돌려서 모두 정착
  for (let step = 0; step < 400; step++) {
    let allSettled = true;
    dolls.forEach(d => {
      if (d.grabbed || d.removing) return;
      d.vy += GRAVITY;
      d.x  += d.vx;
      d.y  += d.vy;
      d.vx *= FRICTION;

      // 벽 충돌
      if (d.x - d.r < 0)     { d.x = d.r;     d.vx = Math.abs(d.vx) * BOUNCE; }
      if (d.x + d.r > W)     { d.x = W - d.r; d.vx = -Math.abs(d.vx) * BOUNCE; }

      // 바닥 충돌
      if (d.y + d.r > floor) {
        d.y  = floor - d.r;
        d.vy = -Math.abs(d.vy) * BOUNCE;
        d.vx *= FRICTION;
        if (Math.abs(d.vy) < 0.4) d.vy = 0;
      }

      // 인형끼리 충돌
      dolls.forEach(other => {
        if (other === d || other.grabbed || other.removing) return;
        const dx   = d.x - other.x;
        const dy   = d.y - other.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minD = d.r + other.r;
        if (dist < minD && dist > 0) {
          const nx  = dx / dist;
          const ny  = dy / dist;
          const overlap = (minD - dist) * 0.52;
          d.x     += nx * overlap;
          d.y     += ny * overlap;
          other.x -= nx * overlap;
          other.y -= ny * overlap;
          const relV = (d.vx - other.vx) * nx + (d.vy - other.vy) * ny;
          if (relV < 0) {
            d.vx     -= relV * nx * BOUNCE;
            d.vy     -= relV * ny * BOUNCE;
            other.vx += relV * nx * BOUNCE;
            other.vy += relV * ny * BOUNCE;
          }
        }
      });

      if (Math.abs(d.vy) > 0.2 || Math.abs(d.vx) > 0.2) allSettled = false;
    });
    if (allSettled) break;
  }

  // 확실히 정착 처리
  dolls.forEach(d => { d.settled = true; d.vx = 0; d.vy = 0; });
}

// ── 메인 루프 ─────────────────────────────────────
function startLoop() {
  if (animFrame) cancelAnimationFrame(animFrame);
  (function loop() {
    updatePhysics();
    updateClaw();
    draw();
    animFrame = requestAnimationFrame(loop);
  })();
}

// ── 물리 업데이트 (잡힌 인형 제거 후 재정착) ─────────
function updatePhysics() {
  const floor = H * FLOOR_RATIO;
  let needSettle = false;

  dolls.forEach(d => {
    if (d.settled || d.grabbed || d.removing) return;
    d.vy += GRAVITY;
    d.x  += d.vx;
    d.y  += d.vy;
    d.vx *= FRICTION;

    if (d.x - d.r < 0)     { d.x = d.r;     d.vx =  Math.abs(d.vx) * BOUNCE; }
    if (d.x + d.r > W)     { d.x = W - d.r; d.vx = -Math.abs(d.vx) * BOUNCE; }
    if (d.y + d.r > floor) {
      d.y  = floor - d.r;
      d.vy = -Math.abs(d.vy) * BOUNCE;
      d.vx *= FRICTION;
      if (Math.abs(d.vy) < 0.3 && Math.abs(d.vx) < 0.3) {
        d.vy = 0; d.vx = 0; d.settled = true;
      }
    }

    dolls.forEach(other => {
      if (other === d || other.grabbed || other.removing) return;
      const dx   = d.x - other.x;
      const dy   = d.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = d.r + other.r;
      if (dist < minD && dist > 0) {
        const nx = dx / dist, ny = dy / dist;
        const ov = (minD - dist) * 0.52;
        d.x += nx * ov; d.y += ny * ov;
        other.x -= nx * ov; other.y -= ny * ov;
        const relV = (d.vx - other.vx) * nx + (d.vy - other.vy) * ny;
        if (relV < 0) {
          d.vx     -= relV * nx * BOUNCE;
          d.vy     -= relV * ny * BOUNCE;
          other.vx += relV * nx * BOUNCE;
          other.vy += relV * ny * BOUNCE;
          other.settled = false;
        }
      }
    });
  });
}

// ── 크레인 업데이트 ───────────────────────────────
function updateClaw() {
  const clawX = claw.x * W;

  if (claw.state === CLAW_STATE.DROPPING) {
    claw.y += claw.speed;

    // 집게 끝이 인형 상단에 닿는지 체크
    const hit = getTopDollAtX(clawX);
    const hitThreshold = hit ? hit.y - hit.r : H * FLOOR_RATIO;

    if (claw.y >= hitThreshold) {
      claw.y    = hitThreshold;
      claw.hitY = hitThreshold;
      claw.state = CLAW_STATE.HIT;
      attemptGrab(hit);
    }
  }

  else if (claw.state === CLAW_STATE.RISING) {
    claw.y -= claw.speed * 1.4;

    // 잡은 인형 함께 올리기
    if (claw.grabbedDoll) {
      claw.grabbedDoll.x = clawX;
      claw.grabbedDoll.y = claw.y + claw.grabbedDoll.r + 20;
    }

    if (claw.y <= claw.topY) {
      claw.y = claw.topY;
      if (claw.grabbedDoll) {
        showWin(claw.grabbedDoll);
      } else {
        showFail();
      }
      claw.state = CLAW_STATE.RESULT;
    }
  }
}

// 현재 clawX 위치의 가장 위쪽(y가 가장 작은) 인형 반환
function getTopDollAtX(clawX) {
  const reach = W * DOLL_RADIUS_RATIO * 1.4; // 집게 수평 범위
  const candidates = dolls.filter(d =>
    !d.grabbed && !d.removing && Math.abs(d.x - clawX) < reach
  );
  if (!candidates.length) return null;
  return candidates.reduce((top, d) => (d.y - d.r < top.y - top.r ? d : top));
}

// 집기 시도 (60% 확률)
function attemptGrab(doll) {
  if (doll && Math.random() < 0.60) {
    doll.grabbed  = true;
    doll.settled  = false;
    claw.grabbedDoll = doll;
  } else {
    claw.grabbedDoll = null;
  }
  // 약간의 대기 후 상승
  setTimeout(() => { claw.state = CLAW_STATE.RISING; }, 220);
}

// ── 그리기 ───────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 배경 하단 바닥 영역
  const floor = H * FLOOR_RATIO;
  ctx.fillStyle = 'rgba(80,120,180,0.18)';
  ctx.fillRect(0, floor, W, H - floor);
  ctx.fillStyle = '#b03030';
  ctx.fillRect(0, floor, W, 4);

  // 인형 (grabbed 제외)
  dolls.forEach(d => {
    if (d.grabbed || d.removing) return;
    drawDoll(d);
  });

  // 크레인 줄 + 집게
  const cx = claw.x * W;
  drawCraneWire(cx, claw.y);
  drawClawHead(cx, claw.y);

  // 잡은 인형
  if (claw.grabbedDoll) drawDoll(claw.grabbedDoll);

  // 레일
  drawRail(cx);
}

function drawRail(cx) {
  // 레일 막대
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(0, claw.topY - 10, W, 10);
  // 반짝이
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(0, claw.topY - 10, W, 3);

  // 트롤리 (크레인 이동체)
  const tw = 36, th = 18;
  ctx.fillStyle = '#f5c518';
  ctx.beginPath();
  ctx.roundRect(cx - tw/2, claw.topY - th - 2, tw, th, 5);
  ctx.fill();
  ctx.strokeStyle = '#e5a800';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 트롤리 바퀴
  [-10, 10].forEach(ox => {
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(cx + ox, claw.topY - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawCraneWire(cx, clawY) {
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(cx, claw.topY);
  ctx.lineTo(cx, clawY);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawClawHead(cx, cy) {
  const armLen = 26;
  const spread = 16;
  ctx.lineWidth = 5;
  ctx.lineCap   = 'round';

  // 집게 3갈래
  [[-spread, armLen], [0, armLen + 8], [spread, armLen]].forEach(([ox, oy]) => {
    const grad = ctx.createLinearGradient(cx, cy, cx + ox, cy + oy);
    grad.addColorStop(0, '#f5c518');
    grad.addColorStop(1, '#c8860a');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + ox, cy + oy);
    ctx.stroke();
  });

  // 중앙 원 장식
  ctx.fillStyle = '#fff200';
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c8860a';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 별 모양
  ctx.fillStyle = '#f5c518';
  drawStar(cx, cy, 5, 5, 3);
}

function drawStar(cx, cy, n, r1, r2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r   = i % 2 === 0 ? r1 : r2;
    const ang = (i * Math.PI) / n - Math.PI / 2;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang))
            : ctx.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
  }
  ctx.closePath();
  ctx.fill();
}

function drawDoll(d) {
  ctx.save();
  ctx.translate(d.x, d.y);
  ctx.rotate(d.angle);

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, d.r * 0.55, d.r * 0.72, d.r * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();

  // 캐릭터 이미지
  const s = d.r * 2;
  if (d.char.img?.complete && d.char.img.naturalWidth > 0) {
    ctx.drawImage(d.char.img, -d.r, -d.r, s, s);
  } else {
    ctx.fillStyle = '#f0c060';
    ctx.beginPath();
    ctx.arc(0, 0, d.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 이름 태그 (머리 위)
  const name   = getCharName(d.char);
  const fsize  = Math.max(10, Math.round(d.r * 0.46));
  ctx.font     = `bold ${fsize}px "Apple SD Gothic Neo", sans-serif`;
  const tw     = ctx.measureText(name).width;
  const padX   = 7, padY = 4;
  const tagW   = tw + padX * 2;
  const tagH   = fsize + padY * 2;
  const tagX   = -tagW / 2;
  const tagY   = -d.r - tagH - 4;

  // 태그 배경
  ctx.fillStyle = 'rgba(20,20,20,0.82)';
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, tagW, tagH, 5);
  ctx.fill();
  // 태그 테두리
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 태그 텍스트
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 0, tagY + tagH / 2);

  ctx.restore();
}

// ── 컨트롤 ───────────────────────────────────────
const MOVE_SPEED = 0.006;

function startMove(dir) {
  stopMove();
  if (claw.state !== CLAW_STATE.IDLE) return;
  moveInterval = setInterval(() => {
    if (dir === 'left')  claw.x = Math.max(0.05, claw.x - MOVE_SPEED * 16);
    if (dir === 'right') claw.x = Math.min(0.95, claw.x + MOVE_SPEED * 16);
  }, 16);
}
function stopMove() { clearInterval(moveInterval); moveInterval = null; }

function dropClaw() {
  if (claw.state !== CLAW_STATE.IDLE) return;
  claw.grabbedDoll = null;
  claw.state = CLAW_STATE.DROPPING;
  claw.y     = claw.topY;
}

function resetClawToIdle() {
  // 잡혔던 인형 제거 & 나머지 재정착
  if (claw.grabbedDoll) {
    dolls = dolls.filter(d => d !== claw.grabbedDoll);
    dolls.forEach(d => { d.settled = false; d.vy = -0.5; });
    setTimeout(settleDolls, 600);
  }
  claw.state       = CLAW_STATE.IDLE;
  claw.y           = claw.topY;
  claw.grabbedDoll = null;
  isDropping       = false;
}

// ── 결과 팝업 ────────────────────────────────────
function showWin(doll) {
  const ch = doll.char;
  collection[ch.id] = (collection[ch.id] || 0) + 1;
  saveData();

  document.getElementById('win-box').innerHTML = `
    <img src="assets/characters/${ch.file}" style="width:100px;height:100px;object-fit:contain;" alt="">
    <div id="win-char-name">${getCharName(ch)}</div>
    <div id="win-msg">뽑았다! 🎉</div>
    <button onclick="closeWin()">계속하기</button>
  `;
  document.getElementById('overlay-win').classList.remove('hidden');
}
function showFail() { document.getElementById('overlay-fail').classList.remove('hidden'); }
function closeWin()  { document.getElementById('overlay-win').classList.add('hidden'); resetClawToIdle(); }
function closeFail() { document.getElementById('overlay-fail').classList.add('hidden'); resetClawToIdle(); }

// ── 컬렉션 모달 ──────────────────────────────────
function openCollection() {
  document.getElementById('collection-grid').innerHTML = characters.map(ch => {
    const cnt = collection[ch.id] || 0;
    return `
      <div class="col-item">
        <img src="assets/characters/${ch.file}" class="${cnt===0?'locked':''}" alt="">
        <div class="col-name">${getCharName(ch)}</div>
        <div class="col-count" style="color:${cnt>0?'#f04b3a':'#bbb'}">${cnt>0?`×${cnt}`:'미보유'}</div>
      </div>`;
  }).join('');
  document.getElementById('modal-collection').classList.remove('hidden');
}
function closeCollection() { document.getElementById('modal-collection').classList.add('hidden'); }

// ── 이름 편집 모달 ────────────────────────────────
function openNameEditor() {
  document.getElementById('name-editor-list').innerHTML = characters.map(ch => `
    <div class="name-row">
      <img src="assets/characters/${ch.file}" alt="">
      <input type="text" id="name-input-${ch.id}"
        placeholder="${ch.defaultName}"
        value="${customNames[ch.id]||''}"
        maxlength="8">
    </div>
  `).join('');
  document.getElementById('modal-names').classList.remove('hidden');
}
function saveNames() {
  characters.forEach(ch => {
    const v = document.getElementById(`name-input-${ch.id}`)?.value.trim();
    if (v) customNames[ch.id] = v; else delete customNames[ch.id];
  });
  saveData();
  closeNameEditor();
}
function closeNameEditor() { document.getElementById('modal-names').classList.add('hidden'); }

// ── 메뉴 ─────────────────────────────────────────
function toggleMenu() { document.getElementById('menu-panel').classList.toggle('hidden'); }
function resetCollection() {
  if (!confirm('컬렉션을 초기화할까요?')) return;
  collection = {};
  saveData();
  spawnDolls();
  toggleMenu();
}
