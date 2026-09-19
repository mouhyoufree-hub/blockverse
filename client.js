/* ================== حالة عامة ================== */
let TOKEN = localStorage.getItem('token');
let ME = null;
let socket = null;
let currentMap = null;
let renderer, scene, camera, localPlayer;
let otherPlayers = {};
let keys = {};
let fpsLimit = 120, qualityScale = 1, shadows = true;
let pointerLocked = false;
let yaw = 0, pitch = 0;
let velocity = new THREE.Vector3();
let voiceStream = null, micOn = false;

/* ================== API Helper ================== */
async function api(url, data) {
  const r = await fetch(url, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: TOKEN, ...data }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j.error || 'خطأ');
  return j;
}

/* ================== واجهة الدخول ================== */
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('tab-' + b.dataset.tab).classList.add('active');
});

document.getElementById('btn-register').onclick = async () => {
  try {
    const body = {
      name: document.getElementById('r-name').value.trim(),
      password: document.getElementById('r-pass').value,
      age: document.getElementById('r-age').value,
      gender: document.getElementById('r-gender').value
    };
    const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    TOKEN = j.token; localStorage.setItem('token', TOKEN); ME = j.user; enterHome();
  } catch (e) { document.getElementById('auth-msg').textContent = '❌ ' + e.message; }
};

document.getElementById('btn-login').onclick = async () => {
  try {
    const body = { name: document.getElementById('l-name').value.trim(), password: document.getElementById('l-pass').value };
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    TOKEN = j.token; localStorage.setItem('token', TOKEN); ME = j.user; enterHome();
  } catch (e) { document.getElementById('auth-msg').textContent = '❌ ' + e.message; }
};

/* ================== استعادة الجلسة ================== */
async function tryAutoLogin() {
  if (!TOKEN) return;
  try {
    const r = await fetch('/api/me', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: TOKEN }) });
    if (!r.ok) { localStorage.removeItem('token'); return; }
    const j = await r.json(); ME = j.user; enterHome();
  } catch {}
}
tryAutoLogin();

/* ================== الدخول للرئيسية ================== */
function enterHome() {
  document.getElementById('auth').classList.add('hidden');
  document.getElementById('home').classList.remove('hidden');
  document.getElementById('me-name').textContent = ME.name;
  document.getElementById('me-avatar').textContent = ME.gender === 'female' ? '👩' : '👨';
  updateCoins(ME.coins);
  if (ME.isDev) document.getElementById('tab-dev').classList.remove('hidden');
  connectSocket();
  loadMaps(); loadFriends(); loadShop(); loadMissions(); loadWardrobe();
}

function updateCoins(n) { ME.coins = n; document.getElementById('coins').textContent = n; }

/* ================== Socket ================== */
function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('auth', TOKEN));
  socket.on('friend_request', d => { alert('📩 طلب صداقة من ' + d.from.name); loadFriends(); });
  socket.on('presence', updatePresence);
  socket.on('chat', d => addChat(`<b>${d.from}:</b> ${d.msg}`));
  socket.on('dm', d => addChat(`💬 <b>${d.fromName}:</b> ${d.msg}`));
  socket.on('player_joined', d => spawnOther(d.id, d.user));
  socket.on('player_left', d => removeOther(d.id));
  socket.on('pos', d => updateOther(d.id, d));
  socket.on('friend_online', () => loadFriends());
  socket.on('maps_updated', () => loadMaps());
}

function updatePresence({ userId, online }) {
  const el = document.querySelector(`[data-fid="${userId}"] .dot`);
  if (el) { el.className = 'dot ' + (online ? 'online' : 'offline'); }
}

/* ================== التبويبات الرئيسية ================== */
document.querySelectorAll('.tabs-main button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs-main button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('view-' + b.dataset.view).classList.add('active');
  if (b.dataset.view === 'friends') loadFriends();
  if (b.dataset.view === 'missions') loadMissions();
  if (b.dataset.view === 'wardrobe') loadWardrobe();
  if (b.dataset.view === 'dev') loadDev();
});

/* ================== الخرائط ================== */
let ALL_MAPS = [];
async function loadMaps() {
  const r = await fetch('/api/maps'); const j = await r.json();
  ALL_MAPS = j.maps; renderMaps(ALL_MAPS);
}
function renderMaps(maps) {
  const el = document.getElementById('maps-list'); el.innerHTML = '';
  maps.forEach(m => {
    const d = document.createElement('div');
    d.innerHTML = `<div style="font-size:36px;text-align:center">🗺️</div>
      <div style="font-weight:700;margin-top:6px">${m.name}</div>
      <div style="opacity:.6;font-size:12px">بواسطة ${m.author}</div>`;
    d.onclick = () => joinMap(m);
    el.appendChild(d);
  });
}
document.getElementById('search-maps').oninput = e => {
  const q = e.target.value.trim().toLowerCase();
  renderMaps(ALL_MAPS.filter(m => m.name.toLowerCase().includes(q)));
};

/* ================== الأصدقاء ================== */
async function loadFriends() {
  const r = await fetch('/api/me', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: TOKEN })});
  const j = await r.json(); ME = j.user;
  const fl = document.getElementById('friends-list'); fl.innerHTML = '';
  const rq = document.getElementById('friend-reqs'); rq.innerHTML = '';

  if (ME.friendRequests?.length) {
    const t = document.createElement('div');
    t.style.marginBottom = '10px';
    t.innerHTML = '<b>طلبات معلقة:</b>';
    rq.appendChild(t);
    for (const fid of ME.friendRequests) {
      const row = document.createElement('div'); row.className='row';
      row.innerHTML = `<span>لاعب #${fid.slice(0,6)}</span>`;
      const btn = document.createElement('button'); btn.textContent = 'قبول';
      btn.onclick = async () => { await api('/api/friends/accept', { fromId: fid }); loadFriends(); };
      row.appendChild(btn); rq.appendChild(row);
    }
  }

  for (const fid of ME.friends) {
    // نعرض بيانات الأساسية - الأفضل لو ندخل endpoint لكن نبسّط هنا:
    const d = document.createElement('div');
    d.dataset.fid = fid;
    d.innerHTML = `<div class="friend-item"><span class="dot offline"></span><span>لاعب #${fid.slice(0,6)}</span></div>
      <button style="margin-top:8px;width:100%;font-size:12px" data-act="join">الانضمام للخريطة</button>
      <button style="margin-top:4px;width:100%;font-size:12px" data-act="dm">إرسال رسالة</button>`;
    d.querySelector('[data-act=join]').onclick = () => {
      const p = otherPlayers[fid]; if (p && p.mapId) joinMap({ id: p.mapId, name: 'خريطة الصديق' });
      else alert('الصديق ليس في خريطة حالياً');
    };
    d.querySelector('[data-act=dm]').onclick = () => {
      const m = prompt('اكتب رسالتك:'); if (m) socket.emit('dm', { toId: fid, msg: m });
    };
    fl.appendChild(d);
  }
}

document.getElementById('btn-add-friend').onclick = async () => {
  const name = document.getElementById('add-friend').value.trim(); if (!name) return;
  try {
    const r = await api('/api/friends/add', { name });
    if (r.user) { ME = r.user; if (ME.isDev) { document.getElementById('tab-dev').classList.remove('hidden'); } updateCoins(ME.coins); }
    alert(r.msg || 'تم');
    document.getElementById('add-friend').value = '';
    loadFriends();
  } catch (e) { alert('❌ ' + e.message); }
};

/* ================== المتجر ================== */
async function loadShop() {
  const r = await fetch('/api/shop'); const j = await r.json();
  const el = document.getElementById('shop-list'); el.innerHTML = '';
  j.items.forEach(i => {
    const d = document.createElement('div');
    const emoji = i.type === 'skin' ? (i.gender === 'female' ? '👗' : '🧥') : i.type === 'effect' ? '✨' : '⏫';
    d.innerHTML = `<div style="font-size:32px;text-align:center;color:${i.color}">${emoji}</div>
      <div style="font-weight:700;margin-top:6px">${i.name}</div>
      <div style="opacity:.7;font-size:12px">💰 ${i.price}</div>
      <button style="margin-top:8px;width:100%">${ME.ownedItems.includes(i.id) ? 'مملوك' : 'شراء'}</button>`;
    d.querySelector('button').onclick = async () => {
      try { const r = await api('/api/shop/buy', { itemId: i.id }); ME = r.user; updateCoins(ME.coins); loadShop(); }
      catch (e) { alert(e.message); }
    };
    el.appendChild(d);
  });
}

/* ================== المهام ================== */
async function loadMissions() {
  const r = await fetch('/api/me', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token: TOKEN })});
  const j = await r.json(); ME = j.user;
  const daily = ME.missions.daily, weekly = ME.missions.weekly;
  const card = (title, key, m, reward, scope) => `
    <div style="background:#1c2140;padding:14px;border-radius:10px;margin-bottom:8px">
      <div style="font-weight:700">${title}</div>
      <div style="opacity:.7;font-size:12px;margin:4px 0">التقدم: ${Math.floor(m.progress)} / ${m.target} ثانية → 💰${reward}</div>
      <button ${m.claimed || m.progress < m.target ? 'disabled' : ''} onclick="claimMission('${scope}','${key}')">${m.claimed ? '✅ تم' : 'استلام'}</button>
    </div>`;
  document.getElementById('daily-missions').innerHTML =
    card('اللعب لمدة ساعة كاملة', 'play60', daily.play60, 29, 'daily') +
    card('اللعب لمدة ساعتين', 'play120', daily.play120, 29, 'daily') +
    card(`إضافة 5 أصدقاء (${daily.add5.progress}/5)`, 'add5', {...daily.add5, target:5}, 29, 'daily');
  document.getElementById('weekly-missions').innerHTML =
    card('اللعب لمدة 10 ساعات', 'play10h', weekly.play10h, 80, 'weekly') +
    card('اللعب مع الأصدقاء 8 ساعات', 'play8hWith', weekly.play8hWith, 80, 'weekly') +
    card('إنشاء خريطة', 'createMap', weekly.createMap, 100, 'weekly');
}
window.claimMission = async (scope, key) => {
  try { const r = await api('/api/missions/claim', { scope, key }); ME = r.user; updateCoins(ME.coins); loadMissions(); alert('+ ' + r.reward + ' عملة'); }
  catch (e) { alert(e.message); }
};

/* ================== خزنة الملابس ================== */
async function loadWardrobe() {
  const el = document.getElementById('wardrobe-list'); el.innerHTML = '';
  const shop = (await (await fetch('/api/shop')).json()).items;
  ME.ownedItems.forEach(id => {
    const i = shop.find(x => x.id === id) || { name: id, type: 'skin', color: '#888' };
    const d = document.createElement('div');
    d.innerHTML = `<div style="font-weight:700">${i.name}</div>
      <button style="margin-top:8px;width:100%">تفعيل</button>`;
    d.querySelector('button').onclick = async () => {
      const slot = i.type === 'skin' ? 'skin' : i.type === 'effect' ? 'effect' : 'jump';
      const r = await api('/api/shop/equip', { itemId: id, slot }); ME = r.user;
      alert('تم التفعيل');
    };
    el.appendChild(d);
  });
  if (!ME.ownedItems.length) el.innerHTML = '<p style="opacity:.6">لا تملك أي عناصر — تسوّق من المتجر.</p>';
}

/* ================== إنشاء خريطة ================== */
document.getElementById('btn-create-map').onclick = async () => {
  const name = document.getElementById('map-name').value.trim();
  const theme = document.getElementById('map-theme').value;
  if (!name) return alert('اكتب اسم الخريطة');
  try {
    const r = await api('/api/maps/create', { name, theme });
    ME = r.user; loadMaps(); alert('✅ تم إنشاء الخريطة');
    document.getElementById('map-name').value = '';
  } catch (e) { alert(e.message); }
};

/* ================== لوحة المطور ================== */
async function loadDev() {
  try {
    const r = await api('/api/dev/list', {});
    const el = document.getElementById('dev-list'); el.innerHTML = '';
    r.users.forEach(u => {
      const d = document.createElement('div');
      d.className = 'row';
      d.style.background = '#1c2140'; d.style.padding = '10px'; d.style.borderRadius = '8px';
      d.innerHTML = `<div style="flex:1">
        <b>${u.name}</b> ${u.isDev?'👑':''} ${u.banned?'🚫':''}<br>
        <span style="font-size:12px;opacity:.6">hash: ${u.hash.slice(0,12)}... | 💰${u.coins} | ${u.gender} | ${u.age}y</span>
      </div>`;
      const b = document.createElement('button'); b.textContent = u.banned ? 'فك الحظر' : 'حظر';
      b.onclick = async () => { await api('/api/dev/ban', { userId: u.id, banned: !u.banned }); loadDev(); };
      const del = document.createElement('button'); del.textContent = 'حذف'; del.style.background = '#e74c3c';
      del.onclick = async () => { if (confirm('حذف نهائي؟')) { await api('/api/dev/ban', { userId: u.id, action: 'delete' }); loadDev(); } };
      d.appendChild(b); d.appendChild(del);
      el.appendChild(d);
    });
  } catch (e) { alert('ليست لديك صلاحية'); }
}

/* ================== الإعدادات ================== */
document.getElementById('set-quality').onchange = e => {
  qualityScale = parseFloat(e.target.value);
  if (renderer) renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityScale));
};
document.getElementById('set-fps').onchange = e => { fpsLimit = parseInt(e.target.value); };
document.getElementById('set-shadows').onchange = e => { shadows = e.target.checked; if (renderer) renderer.shadowMap.enabled = shadows; };

/* ================== اللعبة (Three.js) ================== */
async function joinMap(map) {
  currentMap = map;
  document.getElementById('home').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('map-title').textContent = '📍 ' + map.name;

  if (!renderer) initThree();

  // اطلب الانضمام
  socket.emit('join_map', map.id);
  socket.emit('voice_join');

  // بدء تايمر اللعب
  startPlayTimer();
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityScale));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = shadows;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 40, 200);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);

  // أضواء
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(30, 60, 30); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  // الأرض
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4caf50 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  buildWorld(currentMap.theme);

  // اللاعب المحلي
  localPlayer = createAvatar(ME);
  scene.add(localPlayer);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  setupControls();
  animate();
}

function buildWorld(theme) {
  const colors = {
    city_night: 0x2c3e50, desert: 0xd2b48c, island: 0x4682b4, space: 0x000011,
    castle: 0x5d5d5d, jungle: 0x228b22, snow: 0xf0f8ff, crystal: 0x7fffd4,
    volcano: 0x8b0000, station: 0x555577, stadium: 0x2e8b57, race: 0x333333,
    horror: 0x220000, future: 0x1a1a2e, beach: 0xffe4b5, parkour: 0x654321,
    arena: 0x800000, farm: 0x90ee90, park: 0xff69b4,
    princess: 0xffd1dc, flowers: 0xffb6c1, candy: 0xffaec9, cafe: 0xd2b48c, fashion: 0xe6e6fa
  };
  const color = colors[theme] || 0x4caf50;
  scene.background = new THREE.Color(color);
  scene.fog = new THREE.Fog(color, 50, 250);
  // تبديل لون الأرض
  scene.children.forEach(c => { if (c.isMesh && c.geometry.type === 'PlaneGeometry') c.material.color.setHex(color); });

  // صناديق عشوائية
  for (let i = 0; i < 40; i++) {
    const size = 2 + Math.random() * 6;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5) })
    );
    box.position.set((Math.random()-0.5)*150, size/2, (Math.random()-0.5)*150);
    box.castShadow = true; box.receiveShadow = true;
    scene.add(box);
  }
}

function createAvatar(user) {
  const isFemale = user.gender === 'female';
  const bodyColor = isFemale ? 0xe91e63 : 0x3498db;
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.4, 0.5),
    new THREE.MeshStandardMaterial({ color: bodyColor })
  );
  body.position.y = 0.9; body.castShadow = true; group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xffdbac })
  );
  head.position.y = 1.9; head.castShadow = true; group.add(head);

  const legMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), legMat);
  legL.position.set(-0.25, 0.4, 0); group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.25; group.add(legR);

  group.userData = { user };
  return group;
}

function setupControls() {
  document.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
  document.addEventListener('keyup', e => { keys[e.code] = false; });

  const canvas = document.getElementById('canvas');
  canvas.addEventListener('click', () => canvas.requestPointerLock());
  document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === canvas; });
  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    yaw -= e.movementX * 0.002;
    pitch -= e.movementY * 0.002;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
  });

  // Joystick للموبايل (اتجاه عمودي/أفقي يُدار تلقائياً)
  const joy = document.getElementById('joystick');
  if ('ontouchstart' in window) joy.style.display = 'block';
}

/* ================== تحديث الوقت الحقيقي ================== */
function spawnOther(id, user) {
  if (otherPlayers[id]) return;
  const g = createAvatar(user);
  scene.add(g);
  otherPlayers[id] = { mesh: g, mapId: currentMap.id };
}
function removeOther(id) {
  if (otherPlayers[id]) { scene.remove(otherPlayers[id].mesh); delete otherPlayers[id]; }
}
function updateOther(id, d) {
  const p = otherPlayers[id]; if (!p) return;
  p.mesh.position.set(d.x, d.y, d.z);
  p.mesh.rotation.y = d.ry || 0;
}

/* ================== Loop ================== */
let lastFrame = 0, frameInterval = 1000/120;
function animate(t = 0) {
  requestAnimationFrame(animate);
  if (t - lastFrame < frameInterval) return;
  lastFrame = t;

  if (localPlayer) {
    const speed = 12;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right   = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(forward);
    if (keys['KeyS']) move.sub(forward);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (move.length() > 0) move.normalize().multiplyScalar(speed * 0.016);
    localPlayer.position.add(move);

    // جاذبية وقفز
    velocity.y -= 0.5;
    if (keys['Space'] && Math.abs(velocity.y) < 0.01) { velocity.y = 8; }
    localPlayer.position.y += velocity.y * 0.016;
    if (localPlayer.position.y < 0) { localPlayer.position.y = 0; velocity.y = 0; }
    localPlayer.rotation.y = yaw + Math.PI;

    // كاميرا منظور ثالث
    const camOffset = new THREE.Vector3(0, 3, 6).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    camera.position.copy(localPlayer.position).add(camOffset);
    camera.lookAt(localPlayer.position.x, localPlayer.position.y + 1, localPlayer.position.z);

    // بثّ الموقع
    if (socket && socket.connected) {
      socket.emit('pos', {
        x: localPlayer.position.x, y: localPlayer.position.y, z: localPlayer.position.z, ry: yaw
      });
    }
  }
  renderer.render(scene, camera);
}

/* ================== زر المغادرة ================== */
document.getElementById('btn-leave').onclick = () => {
  socket.emit('leave_map');
  stopPlayTimer();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('home').classList.remove('hidden');
  if (scene) {
    for (const id in otherPlayers) removeOther(id);
    if (localPlayer) { scene.remove(localPlayer); localPlayer = null; }
  }
  document.exitPointerLock && document.exitPointerLock();
};

/* ================== الشات ================== */
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    socket.emit('chat', e.target.value.trim());
    e.target.value = '';
  }
});
function addChat(html) {
  const box = document.getElementById('chat-box');
  const d = document.createElement('div'); d.innerHTML = html; box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  setTimeout(() => { if (d.parentElement) d.remove(); }, 30000);
}

/* ================== المايك (WebRTC بسيط) ================== */
let peerConnections = {};
document.getElementById('btn-mic').onclick = async () => {
  micOn = !micOn;
  const btn = document.getElementById('btn-mic');
  btn.classList.toggle('rec', micOn);
  if (micOn) {
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // أرسل offer لكل أصدقاء الخريطة
      for (const id in otherPlayers) createPeer(id, true);
    } catch (e) { alert('يجب HTTPS للمايك: ' + e.message); micOn = false; btn.classList.remove('rec'); }
  } else {
    if (voiceStream) voiceStream.getTracks().forEach(t => t.stop());
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
  }
};

function createPeer(peerId, initiator) {
  if (peerConnections[peerId]) return peerConnections[peerId];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peerConnections[peerId] = pc;
  if (voiceStream) voiceStream.getTracks().forEach(t => pc.addTrack(t, voiceStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('voice_signal', { toId: peerId, signal: { candidate: e.candidate } }); };
  pc.ontrack = e => {
    const audio = new Audio(); audio.srcObject = e.streams[0]; audio.play();
  };
  if (initiator) {
    pc.createOffer().then(o => { pc.setLocalDescription(o); socket.emit('voice_signal', { toId: peerId, signal: { sdp: o } }); });
  }
  return pc;
}

socket?.on?.('voice_signal', async ({ fromId, signal }) => {
  let pc = peerConnections[fromId] || createPeer(fromId, false);
  if (signal.sdp) { await pc.setRemoteDescription(signal.sdp); if (signal.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); socket.emit('voice_signal', { toId: fromId, signal: { sdp: a } }); } }
  if (signal.candidate) await pc.addIceCandidate(signal.candidate);
});
socket?.on?.('voice_peer_joined', ({ id }) => { if (micOn) createPeer(id, true); });

/* ================== مؤقّت اللعب ================== */
let playTimer = null;
function startPlayTimer() {
  stopPlayTimer();
  playTimer = setInterval(() => {
    const withFriend = Object.keys(otherPlayers).length > 0;
    socket.emit('play_tick', { seconds: 1, withFriend });
  }, 1000);
}
function stopPlayTimer() { if (playTimer) { clearInterval(playTimer); playTimer = null; } }

/* ================== جودة حسب الاتجاه ================== */
function applyOrientation() {
  if (!renderer) return;
  const portrait = window.innerHeight > window.innerWidth;
  // في الوضع العمودي نقلل الجودة قليلاً
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, portrait ? qualityScale * 0.7 : qualityScale));
}
window.addEventListener('resize', applyOrientation);
window.addEventListener('orientationchange', () => setTimeout(applyOrientation, 300));