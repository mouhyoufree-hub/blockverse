const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

/* ============ DATABASE (JSON بسيط) ============ */
const DB_FILE = './db.json';
let db = { users: {}, maps: [], sessions: {} };
try { if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const hash = p => crypto.createHash('sha256').update(p + 'S4LT_x9').digest('hex');
const uid  = () => crypto.randomBytes(8).toString('hex');
const weekKey = () => {
  const d = new Date(); const onejan = new Date(d.getFullYear(),0,1);
  return d.getFullYear() + '-W' + Math.ceil(((d - onejan)/86400000 + onejan.getDay()+1)/7);
};

/* ============ 24 خريطة افتراضية ============ */
const defaultMaps = [
  { id:'m1',  name:'مدينة الليل',        theme:'city_night' },
  { id:'m2',  name:'صحراء الغروب',       theme:'desert' },
  { id:'m3',  name:'جزيرة القراصنة',     theme:'island' },
  { id:'m4',  name:'الفضاء الخارجي',     theme:'space' },
  { id:'m5',  name:'قلعة العصور الوسطى', theme:'castle' },
  { id:'m6',  name:'غابة الأمازون',      theme:'jungle' },
  { id:'m7',  name:'مدينة الثلوج',       theme:'snow' },
  { id:'m8',  name:'كهف الكريستال',      theme:'crystal' },
  { id:'m9',  name:'بركان النار',        theme:'volcano' },
  { id:'m10', name:'محطة الفضاء',        theme:'station' },
  { id:'m11', name:'ملعب كرة القدم',     theme:'stadium' },
  { id:'m12', name:'سباق السيارات',      theme:'race' },
  { id:'m13', name:'مدينة الرعب',        theme:'horror' },
  { id:'m14', name:'مدينة المستقبل',     theme:'future' },
  { id:'m15', name:'شاطئ الاسترخاء',     theme:'beach' },
  { id:'m16', name:'ملعب الباركور',      theme:'parkour' },
  { id:'m17', name:'ساحة القتال',        theme:'arena' },
  { id:'m18', name:'مزرعة الحيوانات',    theme:'farm' },
  { id:'m19', name:'مدينة الملاهي',      theme:'park' },
  { id:'g1',  name:'قصر الأميرات',       theme:'princess' },
  { id:'g2',  name:'حديقة الأزهار',      theme:'flowers' },
  { id:'g3',  name:'مملكة الحلوى',       theme:'candy' },
  { id:'g4',  name:'مقهى باريس',         theme:'cafe' },
  { id:'g5',  name:'بوتيك الموضة',       theme:'fashion' }
];
if (!db.maps || db.maps.length < 24) { db.maps = defaultMaps.map(m => ({...m, author:'system', createdAt: Date.now() })); save(); }

/* ============ المتجر ============ */
const SHOP = [
  // سكنات ذكور
  { id:'skin_m_knight', name:'درع الفارس',     price:35, type:'skin', gender:'male',   color:'#3a6ea5' },
  { id:'skin_m_ninja',  name:'زي النينجا',     price:35, type:'skin', gender:'male',   color:'#1c1c1c' },
  { id:'skin_m_hero',   name:'بدلة البطل',     price:35, type:'skin', gender:'male',   color:'#c0392b' },
  { id:'skin_m_casual', name:'ملابس عادية',    price:19, type:'skin', gender:'male',   color:'#7f8c8d' },
  { id:'skin_m_sport',  name:'زي رياضي',       price:19, type:'skin', gender:'male',   color:'#27ae60' },
  // سكنات إناث
  { id:'skin_f_princess', name:'فستان الأميرة', price:35, type:'skin', gender:'female', color:'#e91e63' },
  { id:'skin_f_queen',    name:'زي الملكة',     price:35, type:'skin', gender:'female', color:'#9b59b6' },
  { id:'skin_f_dress',    name:'فستان أنيق',    price:35, type:'skin', gender:'female', color:'#ff6f91' },
  { id:'skin_f_casual',   name:'ملابس عادية',   price:19, type:'skin', gender:'female', color:'#e0e0e0' },
  { id:'skin_f_sport',    name:'زي رياضي',      price:19, type:'skin', gender:'female', color:'#00bcd4' },
  // تأثيرات حركة
  { id:'fx_sparkle', name:'بريق ذهبي',  price:50, type:'effect', color:'#ffd700' },
  { id:'fx_fire',    name:'هالة نار',   price:50, type:'effect', color:'#ff4500' },
  { id:'fx_ice',     name:'هالة ثلج',   price:50, type:'effect', color:'#87ceeb' },
  // تأثيرات القفز
  { id:'jp_rocket',  name:'قفزة صاروخ', price:55, type:'jump', color:'#ff5722' },
  { id:'jp_rainbow', name:'قفزة قوس قزح', price:55, type:'jump', color:'#ff00ff' },
  { id:'jp_star',    name:'قفزة النجوم',  price:55, type:'jump', color:'#ffff00' }
];

/* ============ الحسابات والمهام ============ */
function refreshMissions(u) {
  const today = new Date().toDateString();
  const wk = weekKey();
  if (!u.missions) u.missions = {};
  if (u.missions.day !== today) {
    u.missions.day = today;
    u.missions.daily = {
      play60:   { progress:0, claimed:false, target:3600 },
      play120:  { progress:0, claimed:false, target:7200 },
      add5:     { progress:0, claimed:false, target:5   }
    };
  }
  if (u.missions.wk !== wk) {
    u.missions.wk = wk;
    u.missions.weekly = {
      play10h:   { progress:0, claimed:false, target:36000 },
      play8hWith:{ progress:0, claimed:false, target:28800 },
      createMap: { progress:0, claimed:false, target:1     }
    };
  }
}

function publicUser(u) {
  const { password, ...rest } = u;
  return rest;
}

/* ============ API: تسجيل / دخول ============ */
app.post('/api/register', (req, res) => {
  const { name, password, age, gender } = req.body;
  if (!name || !password) return res.status(400).json({ error:'بيانات ناقصة' });
  if (Object.values(db.users).find(u => u.name.toLowerCase() === name.toLowerCase()))
    return res.status(400).json({ error:'الاسم مستخدم' });
  const id = uid();
  const u = {
    id, name, password: hash(password),
    age: +age || 0, gender: gender === 'female' ? 'female' : 'male',
    coins: 50, friends: [], friendRequests: [],
    skins: ['default_' + (gender === 'female' ? 'female' : 'male')],
    ownedItems: [], equipped: { skin: null, effect: null, jump: null },
    missions: null, isDev:false, banned:false, createdAt: Date.now()
  };
  refreshMissions(u);
  db.users[id] = u;
  const token = uid(); db.sessions[token] = id; save();
  res.json({ token, user: publicUser(u) });
});

app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  const u = Object.values(db.users).find(u => u.name.toLowerCase() === name.toLowerCase());
  if (!u || u.password !== hash(password)) return res.status(400).json({ error:'خطأ في الاسم أو كلمة السر' });
  if (u.banned) return res.status(403).json({ error:'الحساب محظور' });
  const token = uid(); db.sessions[token] = u.id; save();
  res.json({ token, user: publicUser(u) });
});

app.post('/api/me', (req, res) => {
  const id = db.sessions[req.body.token];
  if (!id || !db.users[id]) return res.status(401).json({ error:'غير مصرح' });
  refreshMissions(db.users[id]); save();
  res.json({ user: publicUser(db.users[id]) });
});

/* ============ API: الأصدقاء + الكود السري ============ */
app.post('/api/friends/add', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  const target = req.body.name.trim();

  // ========= الكود السري =========
  if (target === 'mouha&najou989') {
    me.isDev = true; save();
    return res.json({ ok:true, msg:'👑 تم تفعيل وضع المطور', user: publicUser(me) });
  }
  if (target === 'mouha&najou990') {
    me.isDev = false; save();
    return res.json({ ok:true, msg:'تم تعطيل وضع المطور', user: publicUser(me) });
  }
  // ==============================

  const u = Object.values(db.users).find(x => x.name.toLowerCase() === target.toLowerCase());
  if (!u) return res.status(404).json({ error:'اللاعب غير موجود' });
  if (u.id === me.id) return res.status(400).json({ error:'لا يمكن إضافة نفسك' });
  if (me.friends.includes(u.id)) return res.status(400).json({ error:'صديق مسبقاً' });
  if (!u.friendRequests.includes(me.id)) u.friendRequests.push(me.id);
  save();
  io.to(u.id).emit('friend_request', { from: { id: me.id, name: me.name } });
  res.json({ ok:true, msg:'تم إرسال طلب الصداقة' });
});

app.post('/api/friends/accept', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  const fromId = req.body.fromId;
  if (!me.friendRequests.includes(fromId)) return res.status(400).json({ error:'لا يوجد طلب' });
  me.friendRequests = me.friendRequests.filter(x => x !== fromId);
  if (!me.friends.includes(fromId)) me.friends.push(fromId);
  const other = db.users[fromId];
  if (other && !other.friends.includes(me.id)) other.friends.push(me.id);

  // مهمة: إضافة 5 أصدقاء
  if (me.missions?.daily?.add5) {
    me.missions.daily.add5.progress = me.friends.length;
  }
  save();
  res.json({ ok:true, user: publicUser(me) });
});

/* ============ API: المتجر ============ */
app.get('/api/shop', (req, res) => res.json({ items: SHOP }));

app.post('/api/shop/buy', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  const item = SHOP.find(i => i.id === req.body.itemId);
  if (!item) return res.status(404).json({ error:'غير موجود' });
  if (me.ownedItems.includes(item.id)) return res.status(400).json({ error:'تملكه بالفعل' });
  if (me.coins < item.price) return res.status(400).json({ error:'عملات غير كافية' });
  me.coins -= item.price;
  me.ownedItems.push(item.id);
  if (item.type === 'skin') me.skins.push(item.id);
  save();
  res.json({ ok:true, user: publicUser(me) });
});

app.post('/api/shop/equip', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  const { itemId, slot } = req.body;
  if (itemId && !me.ownedItems.includes(itemId) && !me.skins.includes(itemId))
    return res.status(400).json({ error:'لا تملكه' });
  me.equipped[slot] = itemId;
  save();
  res.json({ ok:true, user: publicUser(me) });
});

/* ============ API: المهام ============ */
app.post('/api/missions/claim', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  refreshMissions(me);
  const { scope, key } = req.body; // scope:'daily'|'weekly'
  const m = me.missions[scope][key];
  if (!m || m.claimed) return res.status(400).json({ error:'لا يمكن' });
  if (m.progress < m.target) return res.status(400).json({ error:'لم تكتمل' });
  const rewards = { play60:29, play120:29, add5:29, play10h:80, play8hWith:80, createMap:100 };
  const reward = rewards[key] || 0;
  me.coins += reward; m.claimed = true; save();
  res.json({ ok:true, reward, user: publicUser(me) });
});

/* ============ API: الخرائط ============ */
app.get('/api/maps', (req, res) => res.json({ maps: db.maps }));

app.post('/api/maps/create', (req, res) => {
  const me = db.users[db.sessions[req.body.token]]; if (!me) return res.status(401).end();
  const { name, theme, objects } = req.body;
  if (!name) return res.status(400).json({ error:'اسم الخريطة مطلوب' });
  const map = { id: uid(), name, theme: theme || 'city_night',
                objects: objects || [], author: me.name, createdAt: Date.now() };
  db.maps.push(map);

  // مهمة أسبوعية: إنشاء خريطة
  if (me.missions?.weekly?.createMap) {
    me.missions.weekly.createMap.progress = 1;
  }
  save();
  io.emit('maps_updated', db.maps);
  res.json({ ok:true, map, user: publicUser(me) });
});

/* ============ API خاص بالمطور (سري) ============ */
app.post('/api/dev/list', (req, res) => {
  const me = db.users[db.sessions[req.body.token]];
  if (!me?.isDev) return res.status(403).json({ error:'غير مصرح' });
  const list = Object.values(db.users).map(u => ({
    id: u.id, name: u.name, password_plain: null, // لا يمكن عرض الكلمة الأصلية (مشفرة)
    hash: u.password, age: u.age, gender: u.gender,
    coins: u.coins, banned: u.banned, isDev: u.isDev,
    friends: u.friends.length
  }));
  res.json({ users: list });
});

app.post('/api/dev/ban', (req, res) => {
  const me = db.users[db.sessions[req.body.token]];
  if (!me?.isDev) return res.status(403).json({ error:'غير مصرح' });
  const u = db.users[req.body.userId];
  if (!u) return res.status(404).end();
  if (req.body.action === 'delete') { delete db.users[u.id]; }
  else { u.banned = !!req.body.banned; }
  save();
  res.json({ ok:true });
});

/* ============ Socket.io: الوقت الحقيقي ============ */
const online = new Map(); // userId -> socketId

io.on('connection', socket => {
  let userId = null;

  socket.on('auth', token => {
    const id = db.sessions[token]; if (!id || !db.users[id]) return socket.disconnect();
    userId = id;
    online.set(id, socket.id);
    socket.join('user:' + id);
    io.emit('presence', { userId: id, online: true });

    // أبلغ أصدقائي أني متصل
    const me = db.users[id];
    me.friends.forEach(fid => io.to('user:'+fid).emit('friend_online', { id, name: me.name }));
  });

  socket.on('join_map', (mapId) => {
    if (!userId) return;
    socket.join('map:' + mapId);
    const map = db.maps.find(m => m.id === mapId);
    const peers = [];
    io.in('map:' + mapId).fetchSockets().then(socks => {
      socks.forEach(s => {
        if (s.id !== socket.id && s.data.userId) peers.push(s.data.userId);
      });
    });
    socket.data.userId = userId;
    socket.data.mapId = mapId;
    socket.to('map:' + mapId).emit('player_joined', { id: userId, user: publicUser(db.users[userId]) });
  });

  socket.on('leave_map', () => {
    if (socket.data.mapId) {
      socket.to('map:' + socket.data.mapId).emit('player_left', { id: userId });
      socket.leave('map:' + socket.data.mapId);
      socket.data.mapId = null;
    }
  });

  socket.on('pos', data => {
    if (!socket.data.mapId) return;
    socket.to('map:' + socket.data.mapId).emit('pos', { id: userId, ...data });
  });

  socket.on('chat', msg => {
    if (!userId) return;
    const me = db.users[userId];
    const payload = { from: me.name, id: userId, msg: String(msg).slice(0,300), at: Date.now() };
    if (socket.data.mapId) io.to('map:' + socket.data.mapId).emit('chat', payload);
  });

  socket.on('dm', ({ toId, msg }) => {
    if (!userId) return;
    io.to('user:' + toId).emit('dm', { from: userId, fromName: db.users[userId].name, msg, at: Date.now() });
    io.to('user:' + userId).emit('dm', { from: userId, fromName: db.users[userId].name, msg, at: Date.now() });
  });

  // تتبع وقت اللعب (كل ثانية يرسل العميل ping)
  socket.on('play_tick', ({ seconds, withFriend }) => {
    if (!userId) return;
    const u = db.users[userId]; refreshMissions(u);
    u.missions.daily.play60.progress  += seconds;
    u.missions.daily.play120.progress += seconds;
    u.missions.weekly.play10h.progress += seconds;
    if (withFriend) u.missions.weekly.play8hWith.progress += seconds;
    save();
  });

  // إشارات مايك (WebRTC)
  socket.on('voice_signal', ({ toId, signal }) => {
    io.to('user:' + toId).emit('voice_signal', { fromId: userId, signal });
  });
  socket.on('voice_join', () => {
    if (!socket.data.mapId) return;
    socket.to('map:' + socket.data.mapId).emit('voice_peer_joined', { id: userId });
  });

  socket.on('disconnect', () => {
    if (userId) {
      online.delete(userId);
      io.emit('presence', { userId, online: false });
      if (socket.data.mapId) socket.to('map:' + socket.data.mapId).emit('player_left', { id: userId });
    }
  });
});

/* ============ تشغيل ============ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎮 Game running on http://localhost:' + PORT));