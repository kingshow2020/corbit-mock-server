const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// إعداد رفع الملفات
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ============================================
// قاعدة بيانات وهمية (في الذاكرة)
// ============================================
const db = {
  users: [
    {
      id: 1,
      name: 'أحمد محمد',
      username: 'admin',
      email: 'admin@orbit.sa',
      phone: '0501234567',
      password: '123456',
      balance: 5000,
      account_type: 'premium',
      two_factor_enabled: true,
      created_at: '2024-01-01T10:00:00Z'
    },
    {
      id: 2,
      name: 'محمد علي',
      username: 'user1',
      email: 'user1@orbit.sa',
      phone: '0559876543',
      password: '123456',
      balance: 1000,
      account_type: 'basic',
      two_factor_enabled: false,
      created_at: '2024-06-15T08:30:00Z'
    }
  ],
  
  senders: [
    { id: 1, user_id: 1, name: 'ORBIT', status: 'approved', type: 'communication' },
    { id: 2, user_id: 1, name: 'MYCOMPANY', status: 'pending', type: 'promotional' },
    { id: 3, user_id: 2, name: 'TESTCO', status: 'approved', type: 'communication' }
  ],
  
  groups: [
    { id: 1, user_id: 1, name: 'العملاء المميزين', contacts_count: 150 },
    { id: 2, user_id: 1, name: 'الموظفين', contacts_count: 45 },
    { id: 3, user_id: 1, name: 'الموردين', contacts_count: 23 },
    { id: 4, user_id: 2, name: 'عملاء VIP', contacts_count: 80 }
  ],
  
  contacts: [
    { id: 1, group_id: 1, name: 'خالد أحمد', phone: '0501111111' },
    { id: 2, group_id: 1, name: 'سعود محمد', phone: '0502222222' },
    { id: 3, group_id: 1, name: 'فهد علي', phone: '0503333333' },
    { id: 4, group_id: 2, name: 'عبدالله سعد', phone: '0504444444' },
    { id: 5, group_id: 2, name: 'ناصر خالد', phone: '0505555555' }
  ],
  
  messages: [],
  operations: [],
  notifications: [],
  sender_requests: [],
  
  packages: [
    { id: 1, name: 'باقة البداية', messages: 500, price: 50, is_popular: false },
    { id: 2, name: 'باقة الأعمال', messages: 2000, price: 150, is_popular: true },
    { id: 3, name: 'باقة المؤسسات', messages: 5000, price: 300, is_popular: false },
    { id: 4, name: 'باقة الشركات', messages: 10000, price: 500, is_popular: false }
  ],
  
  tokens: new Map(), // token -> { user_id, device_id, expires_at, remember_me }
  otps: new Map(), // identifier -> { otp, expires, type }
  
  // 🔐 نظام إدارة الأجهزة والإشعارات
  devices: [
    // { id, user_id, device_id, fcm_token, device_name, platform, app_version, last_active, created_at }
  ]
};

// ============================================
// Helper Functions
// ============================================
const generateToken = () => `token_${uuidv4()}`;
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

const verifyToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.substring(7);
  const tokenData = db.tokens.get(token);
  if (!tokenData) return null;
  
  // التحقق من انتهاء الصلاحية
  if (tokenData.expires_at && Date.now() > tokenData.expires_at) {
    db.tokens.delete(token);
    return null;
  }
  
  // تحديث آخر نشاط للجهاز
  const deviceId = req.headers['x-device-id'];
  if (deviceId) {
    const device = db.devices.find(d => d.user_id === tokenData.user_id && d.device_id === deviceId);
    if (device) {
      device.last_active = new Date().toISOString();
    }
  }
  
  return db.users.find(u => u.id === tokenData.user_id);
};

// دالة للحصول على device_id من الـ header
const getDeviceId = (req) => {
  return req.headers['x-device-id'] || null;
};

const getUserData = (user) => {
  const { password, ...userData } = user;
  return userData;
};

const addOperation = (userId, type, title, description, status = 'success', extra = {}) => {
  const operation = {
    id: db.operations.length + 1,
    user_id: userId,
    type,
    title,
    description,
    date: new Date().toISOString().replace('T', ' ').substring(0, 16),
    status,
    ...extra
  };
  db.operations.unshift(operation);
  return operation;
};

// ============================================
// الإشعارات العشوائية
// ============================================
const notificationTemplates = [
  { type: 'success', title: 'تم الإرسال بنجاح', message: 'تم إرسال {count} رسالة بنجاح' },
  { type: 'info', title: 'تحديث جديد', message: 'تم تحديث التطبيق إلى الإصدار الأخير' },
  { type: 'warning', title: 'تنبيه الرصيد', message: 'رصيدك منخفض، يرجى الشحن قريباً' },
  { type: 'success', title: 'شحن ناجح', message: 'تم شحن {count} رسالة لحسابك' },
  { type: 'info', title: 'اسم مرسل جديد', message: 'تم اعتماد اسم المرسل الجديد' },
  { type: 'error', title: 'فشل في الإرسال', message: 'فشل إرسال بعض الرسائل، يرجى المحاولة لاحقاً' }
];

const getRandomNotification = () => {
  const template = notificationTemplates[Math.floor(Math.random() * notificationTemplates.length)];
  return {
    id: Date.now(),
    type: template.type,
    title: template.title,
    message: template.message.replace('{count}', Math.floor(Math.random() * 200) + 10),
    created_at: new Date().toISOString(),
    is_read: false
  };
};

// ============================================
// AUTHENTICATION APIs
// ============================================

// POST /api/v1/auth/login
app.post('/api/v1/auth/login', (req, res) => {
  const { identifier, password, remember_me = false, device_id } = req.body;
  
  if (!identifier || !password) {
    return res.status(400).json({
      status: false,
      message: 'يرجى إدخال اسم المستخدم وكلمة المرور',
      error_code: 'MISSING_CREDENTIALS'
    });
  }
  
  if (!device_id) {
    return res.status(400).json({
      status: false,
      message: 'معرف الجهاز مطلوب',
      error_code: 'MISSING_DEVICE_ID'
    });
  }
  
  const user = db.users.find(u => 
    (u.username === identifier || u.phone === identifier) && u.password === password
  );
  
  if (!user) {
    return res.status(401).json({
      status: false,
      message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
      error_code: 'INVALID_CREDENTIALS'
    });
  }
  
  // إذا كان التحقق بخطوتين مفعل
  if (user.two_factor_enabled) {
    const otp = generateOTP();
    db.otps.set(identifier, { 
      otp, 
      expires: Date.now() + 300000, 
      type: 'login', 
      userId: user.id,
      device_id,
      remember_me
    });
    console.log(`[OTP] Login OTP for ${identifier}: ${otp}`);
    
    return res.json({
      status: true,
      requires_otp: true,
      message: `تم إرسال رمز التحقق إلى ${user.phone.substring(0, 4)}****${user.phone.substring(8)}`,
      data: {
        otp_sent_to: `${user.phone.substring(0, 4)}****${user.phone.substring(8)}`,
        otp_expires_in: 300
      }
    });
  }
  
  // تسجيل دخول مباشر
  const token = generateToken();
  const expiresAt = remember_me 
    ? Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 يوم
    : Date.now() + (24 * 60 * 60 * 1000); // 24 ساعة
  
  db.tokens.set(token, { 
    user_id: user.id, 
    device_id, 
    expires_at: expiresAt,
    remember_me 
  });
  
  const userSenders = db.senders.filter(s => s.user_id === user.id);
  const userGroups = db.groups.filter(g => g.user_id === user.id);
  
  res.json({
    status: true,
    requires_otp: false,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      token,
      token_type: 'Bearer',
      expires_at: new Date(expiresAt).toISOString(),
      user: getUserData(user),
      senders: userSenders,
      groups: userGroups,
      packages: db.packages,
      stats: {
        total_sent: Math.floor(Math.random() * 5000) + 500,
        total_delivered: Math.floor(Math.random() * 4500) + 400,
        total_failed: Math.floor(Math.random() * 100) + 10,
        this_month: Math.floor(Math.random() * 1000) + 100
      }
    }
  });
});

// POST /api/v1/auth/verify-login-otp
app.post('/api/v1/auth/verify-login-otp', (req, res) => {
  const { identifier, password, otp, device_id, remember_me } = req.body;
  
  const stored = db.otps.get(identifier);
  if (!stored || stored.type !== 'login') {
    return res.status(400).json({
      status: false,
      message: 'لم يتم طلب رمز تحقق',
      error_code: 'NO_OTP_REQUESTED'
    });
  }
  
  if (Date.now() > stored.expires) {
    db.otps.delete(identifier);
    return res.status(400).json({
      status: false,
      message: 'انتهت صلاحية رمز التحقق',
      error_code: 'OTP_EXPIRED'
    });
  }
  
  if (stored.otp !== otp) {
    return res.status(400).json({
      status: false,
      message: 'رمز التحقق غير صحيح',
      error_code: 'INVALID_OTP'
    });
  }
  
  db.otps.delete(identifier);
  const user = db.users.find(u => u.id === stored.userId);
  const token = generateToken();
  
  const useRememberMe = remember_me !== undefined ? remember_me : stored.remember_me;
  const useDeviceId = device_id || stored.device_id;
  
  const expiresAt = useRememberMe 
    ? Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 يوم
    : Date.now() + (24 * 60 * 60 * 1000); // 24 ساعة
  
  db.tokens.set(token, { 
    user_id: user.id, 
    device_id: useDeviceId, 
    expires_at: expiresAt,
    remember_me: useRememberMe
  });
  
  const userSenders = db.senders.filter(s => s.user_id === user.id);
  const userGroups = db.groups.filter(g => g.user_id === user.id);
  
  res.json({
    status: true,
    message: 'تم تسجيل الدخول بنجاح',
    data: {
      token,
      token_type: 'Bearer',
      expires_at: new Date(expiresAt).toISOString(),
      user: getUserData(user),
      senders: userSenders,
      groups: userGroups,
      packages: db.packages,
      stats: {
        total_sent: Math.floor(Math.random() * 5000) + 500,
        total_delivered: Math.floor(Math.random() * 4500) + 400,
        total_failed: Math.floor(Math.random() * 100) + 10,
        this_month: Math.floor(Math.random() * 1000) + 100
      }
    }
  });
});

// POST /api/v1/auth/resend-otp
app.post('/api/v1/auth/resend-otp', (req, res) => {
  const { identifier } = req.body;
  
  const stored = db.otps.get(identifier);
  if (!stored) {
    return res.status(400).json({
      status: false,
      message: 'لم يتم طلب رمز تحقق'
    });
  }
  
  const otp = generateOTP();
  db.otps.set(identifier, { ...stored, otp, expires: Date.now() + 300000 });
  console.log(`[OTP] Resend OTP for ${identifier}: ${otp}`);
  
  res.json({
    status: true,
    message: 'تم إعادة إرسال رمز التحقق'
  });
});

// POST /api/v1/auth/register
app.post('/api/v1/auth/register', (req, res) => {
  const { name, phone, password } = req.body;
  
  if (!name || !phone || !password) {
    return res.status(400).json({
      status: false,
      message: 'يرجى إدخال جميع البيانات المطلوبة'
    });
  }
  
  if (db.users.find(u => u.phone === phone)) {
    return res.status(400).json({
      status: false,
      message: 'رقم الجوال مسجل مسبقاً'
    });
  }
  
  const otp = generateOTP();
  db.otps.set(phone, { otp, expires: Date.now() + 300000, type: 'register', name, password });
  console.log(`[OTP] Register OTP for ${phone}: ${otp}`);
  
  res.json({
    status: true,
    message: 'تم إرسال رمز التحقق'
  });
});

// POST /api/v1/auth/verify-register-otp
app.post('/api/v1/auth/verify-register-otp', (req, res) => {
  const { phone, otp } = req.body;
  
  const stored = db.otps.get(phone);
  if (!stored || stored.type !== 'register') {
    return res.status(400).json({
      status: false,
      message: 'لم يتم طلب رمز تحقق'
    });
  }
  
  if (Date.now() > stored.expires) {
    db.otps.delete(phone);
    return res.status(400).json({
      status: false,
      message: 'انتهت صلاحية رمز التحقق'
    });
  }
  
  if (stored.otp !== otp) {
    return res.status(400).json({
      status: false,
      message: 'رمز التحقق غير صحيح'
    });
  }
  
  // إنشاء المستخدم
  const newUser = {
    id: db.users.length + 1,
    name: stored.name,
    username: `user_${Date.now()}`,
    email: '',
    phone,
    password: stored.password,
    balance: 0,
    account_type: 'basic',
    two_factor_enabled: false,
    created_at: new Date().toISOString()
  };
  
  db.users.push(newUser);
  db.otps.delete(phone);
  
  const token = generateToken();
  db.tokens.set(token, newUser.id);
  
  res.json({
    status: true,
    message: 'تم إنشاء الحساب بنجاح',
    data: {
      token,
      user: getUserData(newUser),
      senders: [],
      groups: [],
      packages: db.packages,
      stats: { total_sent: 0, total_delivered: 0, total_failed: 0, this_month: 0 }
    }
  });
});

// POST /api/v1/auth/forgot-password
app.post('/api/v1/auth/forgot-password', (req, res) => {
  const { phone } = req.body;
  
  const user = db.users.find(u => u.phone === phone);
  if (!user) {
    return res.status(404).json({
      status: false,
      message: 'رقم الجوال غير مسجل'
    });
  }
  
  const otp = generateOTP();
  db.otps.set(phone, { otp, expires: Date.now() + 300000, type: 'reset', userId: user.id });
  console.log(`[OTP] Reset OTP for ${phone}: ${otp}`);
  
  res.json({
    status: true,
    message: 'تم إرسال رمز التحقق'
  });
});

// POST /api/v1/auth/reset-password
app.post('/api/v1/auth/reset-password', (req, res) => {
  const { phone, otp, new_password } = req.body;
  
  const stored = db.otps.get(phone);
  if (!stored || stored.type !== 'reset') {
    return res.status(400).json({
      status: false,
      message: 'لم يتم طلب إعادة تعيين كلمة المرور'
    });
  }
  
  if (stored.otp !== otp) {
    return res.status(400).json({
      status: false,
      message: 'رمز التحقق غير صحيح'
    });
  }
  
  const user = db.users.find(u => u.id === stored.userId);
  user.password = new_password;
  db.otps.delete(phone);
  
  res.json({
    status: true,
    message: 'تم تغيير كلمة المرور بنجاح'
  });
});

// POST /api/v1/auth/logout
app.post('/api/v1/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    db.tokens.delete(token);
  }
  
  res.json({
    status: true,
    message: 'تم تسجيل الخروج بنجاح'
  });
});

// ============================================
// USER APIs
// ============================================

// GET /api/v1/user/profile
app.get('/api/v1/user/profile', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  res.json({
    status: true,
    data: { user: getUserData(user) }
  });
});

// PUT /api/v1/user/profile
app.put('/api/v1/user/profile', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { name, email, phone, gender, city, organization } = req.body;
  
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (gender) user.gender = gender;
  if (city) user.city = city;
  if (organization) user.organization = organization;
  
  res.json({
    status: true,
    message: 'تم تحديث البيانات بنجاح',
    data: { user: getUserData(user) }
  });
});

// POST /api/v1/user/change-password
app.post('/api/v1/user/change-password', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { current_password, new_password } = req.body;
  
  if (user.password !== current_password) {
    return res.status(400).json({
      status: false,
      message: 'كلمة المرور الحالية غير صحيحة'
    });
  }
  
  user.password = new_password;
  
  res.json({
    status: true,
    message: 'تم تغيير كلمة المرور بنجاح'
  });
});

// POST /api/v1/user/2fa/toggle
app.post('/api/v1/user/2fa/toggle', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  user.two_factor_enabled = !user.two_factor_enabled;
  
  res.json({
    status: true,
    message: user.two_factor_enabled ? 'تم تفعيل التحقق بخطوتين' : 'تم إلغاء التحقق بخطوتين',
    data: { two_factor_enabled: user.two_factor_enabled }
  });
});

// ============================================
// DASHBOARD APIs
// ============================================

// GET /api/v1/dashboard/stats
app.get('/api/v1/dashboard/stats', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const userGroups = db.groups.filter(g => g.user_id === user.id);
  const userMessages = db.messages.filter(m => m.user_id === user.id);
  
  res.json({
    status: true,
    data: {
      sent_messages: userMessages.length || Math.floor(Math.random() * 1000) + 100,
      groups_count: userGroups.length,
      balance: user.balance,
      recent_activities: db.operations
        .filter(o => o.user_id === user.id)
        .slice(0, 5)
    }
  });
});

// GET /api/v1/notifications
app.get('/api/v1/notifications', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  res.json({
    status: true,
    data: {
      notification: getRandomNotification()
    }
  });
});

// ============================================
// SMS APIs
// ============================================

// POST /api/v1/sms/send
app.post('/api/v1/sms/send', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { sender, recipients, message } = req.body;
  
  if (!sender || !recipients || !message) {
    return res.status(400).json({
      status: false,
      message: 'يرجى إدخال جميع البيانات المطلوبة'
    });
  }
  
  const recipientList = Array.isArray(recipients) ? recipients : [recipients];
  const cost = recipientList.length;
  
  if (user.balance < cost) {
    return res.status(400).json({
      status: false,
      message: 'رصيدك غير كافٍ'
    });
  }
  
  // خصم الرصيد
  user.balance -= cost;
  
  // حفظ الرسائل
  recipientList.forEach(recipient => {
    db.messages.push({
      id: db.messages.length + 1,
      user_id: user.id,
      sender,
      recipient,
      message,
      status: Math.random() > 0.1 ? 'delivered' : 'failed',
      sent_at: new Date().toISOString(),
      delivered_at: new Date().toISOString()
    });
  });
  
  // إضافة عملية
  addOperation(user.id, 'sms', 'إرسال رسائل', `تم إرسال ${cost} رسالة`, 'success', {
    message_content: message,
    recipients: recipientList.map(p => ({ phone: p }))
  });
  
  res.json({
    status: true,
    message: `تم إرسال ${cost} رسالة بنجاح`,
    data: {
      sent_count: cost,
      remaining_balance: user.balance
    }
  });
});

// GET /api/v1/messages/sent
app.get('/api/v1/messages/sent', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { status, from, to, search } = req.query;
  
  let messages = db.messages.filter(m => m.user_id === user.id);
  
  if (status) {
    messages = messages.filter(m => m.status === status);
  }
  
  if (from) {
    messages = messages.filter(m => new Date(m.sent_at) >= new Date(from));
  }
  
  if (to) {
    messages = messages.filter(m => new Date(m.sent_at) <= new Date(to));
  }
  
  if (search) {
    messages = messages.filter(m => 
      m.message.includes(search) || m.recipient.includes(search)
    );
  }
  
  res.json({
    status: true,
    data: { messages }
  });
});

// ============================================
// GROUPS APIs
// ============================================

// GET /api/v1/groups
app.get('/api/v1/groups', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const groups = db.groups.filter(g => g.user_id === user.id);
  
  res.json({
    status: true,
    data: { groups }
  });
});

// POST /api/v1/groups
app.post('/api/v1/groups', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { name, contacts } = req.body;
  
  if (!name) {
    return res.status(400).json({
      status: false,
      message: 'يرجى إدخال اسم المجموعة'
    });
  }
  
  const newGroup = {
    id: db.groups.length + 1,
    user_id: user.id,
    name,
    contacts_count: contacts ? contacts.length : 0
  };
  
  db.groups.push(newGroup);
  
  // إضافة جهات الاتصال
  if (contacts && contacts.length > 0) {
    contacts.forEach(contact => {
      db.contacts.push({
        id: db.contacts.length + 1,
        group_id: newGroup.id,
        name: contact.name || '',
        phone: contact.phone
      });
    });
  }
  
  addOperation(user.id, 'group', 'إنشاء مجموعة', `تم إنشاء مجموعة "${name}"`, 'success');
  
  res.json({
    status: true,
    message: 'تم إنشاء المجموعة بنجاح',
    data: { group: newGroup }
  });
});

// PUT /api/v1/groups/:id
app.put('/api/v1/groups/:id', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const groupId = parseInt(req.params.id);
  const group = db.groups.find(g => g.id === groupId && g.user_id === user.id);
  
  if (!group) {
    return res.status(404).json({
      status: false,
      message: 'المجموعة غير موجودة'
    });
  }
  
  const { name } = req.body;
  if (name) group.name = name;
  
  res.json({
    status: true,
    message: 'تم تحديث المجموعة بنجاح',
    data: { group }
  });
});

// DELETE /api/v1/groups/:id
app.delete('/api/v1/groups/:id', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const groupId = parseInt(req.params.id);
  const groupIndex = db.groups.findIndex(g => g.id === groupId && g.user_id === user.id);
  
  if (groupIndex === -1) {
    return res.status(404).json({
      status: false,
      message: 'المجموعة غير موجودة'
    });
  }
  
  db.groups.splice(groupIndex, 1);
  
  res.json({
    status: true,
    message: 'تم حذف المجموعة بنجاح'
  });
});

// GET /api/v1/groups/:id/contacts
app.get('/api/v1/groups/:id/contacts', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const groupId = parseInt(req.params.id);
  const group = db.groups.find(g => g.id === groupId && g.user_id === user.id);
  
  if (!group) {
    return res.status(404).json({
      status: false,
      message: 'المجموعة غير موجودة'
    });
  }
  
  const contacts = db.contacts.filter(c => c.group_id === groupId);
  
  res.json({
    status: true,
    data: { contacts }
  });
});

// ============================================
// SENDERS APIs
// ============================================

// GET /api/v1/senders
app.get('/api/v1/senders', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const senders = db.senders.filter(s => s.user_id === user.id);
  
  res.json({
    status: true,
    data: { senders }
  });
});

// POST /api/v1/senders/request
app.post('/api/v1/senders/request', upload.fields([
  { name: 'commercial_register_file', maxCount: 1 },
  { name: 'contract_file', maxCount: 1 }
]), (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const {
    sender_name, sender_type, organization_type, commercial_register,
    organization_name, manager_name, id_number, position, phone, email
  } = req.body;
  
  if (!sender_name || !sender_type) {
    return res.status(400).json({
      status: false,
      message: 'يرجى إدخال جميع البيانات المطلوبة'
    });
  }
  
  const request = {
    id: db.sender_requests.length + 1,
    user_id: user.id,
    sender_name,
    sender_type,
    organization_type,
    commercial_register,
    organization_name,
    manager_name,
    id_number,
    position,
    phone,
    email,
    status: 'pending',
    created_at: new Date().toISOString()
  };
  
  db.sender_requests.push(request);
  
  // إضافة للـ senders بحالة pending
  db.senders.push({
    id: db.senders.length + 1,
    user_id: user.id,
    name: sender_name,
    status: 'pending',
    type: sender_type
  });
  
  addOperation(user.id, 'sender', 'طلب اسم مرسل', `تم طلب اسم مرسل "${sender_name}"`, 'success');
  
  res.json({
    status: true,
    message: 'تم إرسال الطلب بنجاح',
    data: {
      request_id: request.id,
      payment_url: `https://payment-gateway.example.com/pay/${request.id}`
    }
  });
});

// ============================================
// BALANCE & PACKAGES APIs
// ============================================

// GET /api/v1/balance
app.get('/api/v1/balance', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  res.json({
    status: true,
    data: {
      balance: user.balance,
      subscription_expiry_date: '2025-12-31'
    }
  });
});

// GET /api/v1/packages
app.get('/api/v1/packages', (req, res) => {
  res.json({
    status: true,
    data: { packages: db.packages }
  });
});

// POST /api/v1/packages/purchase
app.post('/api/v1/packages/purchase', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { package_id } = req.body;
  const pkg = db.packages.find(p => p.id === package_id);
  
  if (!pkg) {
    return res.status(404).json({
      status: false,
      message: 'الباقة غير موجودة'
    });
  }
  
  // إضافة الرصيد (في الواقع يكون بعد الدفع)
  user.balance += pkg.messages;
  
  addOperation(user.id, 'recharge', 'شحن رصيد', `تم شحن ${pkg.messages} رسالة`, 'success');
  
  res.json({
    status: true,
    message: 'تم شراء الباقة بنجاح',
    data: {
      new_balance: user.balance,
      payment_url: `https://payment-gateway.example.com/pay/pkg_${package_id}`
    }
  });
});

// ============================================
// OPERATIONS APIs
// ============================================

// GET /api/v1/operations
app.get('/api/v1/operations', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const operations = db.operations.filter(o => o.user_id === user.id);
  
  res.json({
    status: true,
    data: { operations }
  });
});

// ============================================
// SUPPORT CHAT APIs (Webhook Ready)
// ============================================

// POST /api/v1/support/send
app.post('/api/v1/support/send', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  const { message } = req.body;
  
  res.json({
    status: true,
    message: 'تم إرسال الرسالة',
    data: {
      message_id: Date.now(),
      sent_at: new Date().toISOString()
    }
  });
});

// GET /api/v1/support/messages
app.get('/api/v1/support/messages', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'غير مصرح' });
  }
  
  res.json({
    status: true,
    data: {
      messages: [
        {
          id: 1,
          type: 'user',
          message: 'مرحباً، كيف أستطيع شحن رصيدي؟',
          created_at: '2024-12-31T10:00:00Z'
        },
        {
          id: 2,
          type: 'support',
          message: 'أهلاً بك! يمكنك شحن رصيدك من خلال قسم الرصيد في التطبيق',
          created_at: '2024-12-31T10:05:00Z'
        }
      ]
    }
  });
});

// ============================================
// WEBHOOKS (للشركة)
// ============================================

// POST /api/v1/webhooks/message-status
app.post('/api/v1/webhooks/message-status', (req, res) => {
  console.log('[WEBHOOK] Message Status:', req.body);
  res.json({ status: true, received: true });
});

// POST /api/v1/webhooks/balance-update
app.post('/api/v1/webhooks/balance-update', (req, res) => {
  console.log('[WEBHOOK] Balance Update:', req.body);
  res.json({ status: true, received: true });
});

// ============================================
// 🔐 DEVICE & FCM TOKEN MANAGEMENT APIs
// نظام إدارة الأجهزة والإشعارات
// ============================================

// POST /api/v1/devices/register - تسجيل جهاز بعد Login
app.post('/api/v1/devices/register', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const { fcm_token, device_id, device_name, platform, app_version } = req.body;
  
  if (!fcm_token || !device_id || !platform) {
    return res.status(400).json({
      status: false,
      message: 'البيانات المطلوبة: fcm_token, device_id, platform',
      error_code: 'MISSING_REQUIRED_FIELDS'
    });
  }
  
  // البحث عن جهاز موجود
  const existingDeviceIndex = db.devices.findIndex(
    d => d.user_id === user.id && d.device_id === device_id
  );
  
  const deviceData = {
    id: existingDeviceIndex >= 0 ? db.devices[existingDeviceIndex].id : db.devices.length + 1,
    user_id: user.id,
    device_id,
    fcm_token,
    device_name: device_name || 'Unknown Device',
    platform,
    app_version: app_version || '1.0.0',
    last_active: new Date().toISOString(),
    created_at: existingDeviceIndex >= 0 ? db.devices[existingDeviceIndex].created_at : new Date().toISOString()
  };
  
  if (existingDeviceIndex >= 0) {
    // تحديث جهاز موجود
    db.devices[existingDeviceIndex] = deviceData;
    console.log(`[DEVICE] Updated device for user ${user.id}: ${device_id}`);
  } else {
    // إضافة جهاز جديد
    db.devices.push(deviceData);
    console.log(`[DEVICE] Registered new device for user ${user.id}: ${device_id}`);
  }
  
  console.log(`[FCM] Token registered: ${fcm_token.substring(0, 20)}...`);
  
  res.json({
    status: true,
    message: 'تم تسجيل الجهاز بنجاح',
    data: {
      device_registered: true,
      notifications_enabled: true
    }
  });
});

// PUT /api/v1/devices/update-fcm - تحديث FCM Token
app.put('/api/v1/devices/update-fcm', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const { fcm_token, device_id } = req.body;
  
  if (!fcm_token || !device_id) {
    return res.status(400).json({
      status: false,
      message: 'البيانات المطلوبة: fcm_token, device_id',
      error_code: 'MISSING_REQUIRED_FIELDS'
    });
  }
  
  const device = db.devices.find(
    d => d.user_id === user.id && d.device_id === device_id
  );
  
  if (!device) {
    return res.status(404).json({
      status: false,
      message: 'الجهاز غير مسجل',
      error_code: 'DEVICE_NOT_REGISTERED'
    });
  }
  
  device.fcm_token = fcm_token;
  device.last_active = new Date().toISOString();
  
  console.log(`[FCM] Token updated for device ${device_id}: ${fcm_token.substring(0, 20)}...`);
  
  res.json({
    status: true,
    message: 'تم تحديث التوكن'
  });
});

// DELETE /api/v1/devices/unregister - إلغاء تسجيل جهاز (عند Logout)
app.delete('/api/v1/devices/unregister', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const deviceId = req.headers['x-device-id'];
  
  if (!deviceId) {
    return res.status(400).json({
      status: false,
      message: 'معرف الجهاز مطلوب في X-Device-ID header',
      error_code: 'MISSING_DEVICE_ID'
    });
  }
  
  const deviceIndex = db.devices.findIndex(
    d => d.user_id === user.id && d.device_id === deviceId
  );
  
  if (deviceIndex >= 0) {
    const removedDevice = db.devices.splice(deviceIndex, 1)[0];
    console.log(`[DEVICE] Unregistered device for user ${user.id}: ${deviceId}`);
    console.log(`[FCM] Token removed: ${removedDevice.fcm_token.substring(0, 20)}...`);
  }
  
  res.json({
    status: true,
    message: 'تم إلغاء تسجيل الجهاز',
    data: {
      notifications_disabled: true
    }
  });
});

// GET /api/v1/devices - قائمة الأجهزة المسجلة
app.get('/api/v1/devices', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const currentDeviceId = req.headers['x-device-id'];
  
  const devices = db.devices
    .filter(d => d.user_id === user.id)
    .map(d => ({
      id: d.id,
      device_id: d.device_id,
      device_name: d.device_name,
      platform: d.platform,
      app_version: d.app_version,
      last_active: d.last_active,
      is_current: d.device_id === currentDeviceId
    }));
  
  res.json({
    status: true,
    data: { devices }
  });
});

// DELETE /api/v1/devices/:device_id/logout - تسجيل الخروج من جهاز محدد
app.delete('/api/v1/devices/:device_id/logout', (req, res) => {
  const user = verifyToken(req);
  if (!user) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const targetDeviceId = req.params.device_id;
  
  // حذف الجهاز
  const deviceIndex = db.devices.findIndex(
    d => d.user_id === user.id && d.device_id === targetDeviceId
  );
  
  if (deviceIndex >= 0) {
    db.devices.splice(deviceIndex, 1);
  }
  
  // حذف التوكنات المرتبطة بهذا الجهاز
  for (const [token, tokenData] of db.tokens) {
    if (tokenData.user_id === user.id && tokenData.device_id === targetDeviceId) {
      db.tokens.delete(token);
      console.log(`[TOKEN] Revoked token for device ${targetDeviceId}`);
    }
  }
  
  console.log(`[DEVICE] Remote logout for device ${targetDeviceId}`);
  
  res.json({
    status: true,
    message: 'تم تسجيل الخروج من الجهاز'
  });
});

// ============================================
// تحديث Logout ليحذف FCM Token
// ============================================

// POST /api/v1/auth/logout
app.post('/api/v1/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ 
      status: false, 
      message: 'غير مصرح',
      error_code: 'UNAUTHORIZED'
    });
  }
  
  const token = auth.substring(7);
  const tokenData = db.tokens.get(token);
  
  if (!tokenData) {
    return res.status(401).json({ 
      status: false, 
      message: 'توكن غير صالح',
      error_code: 'INVALID_TOKEN'
    });
  }
  
  const { logout_all_devices = false } = req.body;
  const deviceId = req.headers['x-device-id'];
  let devicesLoggedOut = 0;
  
  if (logout_all_devices) {
    // حذف جميع الأجهزة والتوكنات للمستخدم
    const userDevices = db.devices.filter(d => d.user_id === tokenData.user_id);
    devicesLoggedOut = userDevices.length;
    
    // حذف الأجهزة
    db.devices = db.devices.filter(d => d.user_id !== tokenData.user_id);
    
    // حذف جميع التوكنات
    for (const [t, data] of db.tokens) {
      if (data.user_id === tokenData.user_id) {
        db.tokens.delete(t);
      }
    }
    
    console.log(`[LOGOUT] User ${tokenData.user_id} logged out from ALL devices (${devicesLoggedOut})`);
  } else {
    // حذف الجهاز الحالي فقط
    if (deviceId) {
      const deviceIndex = db.devices.findIndex(
        d => d.user_id === tokenData.user_id && d.device_id === deviceId
      );
      if (deviceIndex >= 0) {
        const removedDevice = db.devices.splice(deviceIndex, 1)[0];
        console.log(`[FCM] Token removed on logout: ${removedDevice.fcm_token.substring(0, 20)}...`);
        devicesLoggedOut = 1;
      }
    }
    
    // حذف التوكن الحالي
    db.tokens.delete(token);
    
    console.log(`[LOGOUT] User ${tokenData.user_id} logged out from device ${deviceId}`);
  }
  
  res.json({
    status: true,
    message: logout_all_devices ? 'تم تسجيل الخروج من جميع الأجهزة' : 'تم تسجيل الخروج بنجاح',
    data: {
      devices_logged_out: devicesLoggedOut
    }
  });
});

// ============================================
// PUSH NOTIFICATION SIMULATION
// محاكاة إرسال الإشعارات
// ============================================

// POST /api/v1/notifications/send-push (للاختبار)
app.post('/api/v1/notifications/send-push', (req, res) => {
  const { user_id, title, body, data } = req.body;
  
  // البحث عن أجهزة المستخدم
  const userDevices = db.devices.filter(d => d.user_id === user_id);
  
  if (userDevices.length === 0) {
    return res.json({
      status: true,
      message: 'لا توجد أجهزة مسجلة للمستخدم',
      data: { sent_count: 0 }
    });
  }
  
  // محاكاة الإرسال
  userDevices.forEach(device => {
    console.log(`[PUSH] Sending to ${device.device_name} (${device.platform})`);
    console.log(`       FCM Token: ${device.fcm_token.substring(0, 20)}...`);
    console.log(`       Title: ${title}`);
    console.log(`       Body: ${body}`);
  });
  
  res.json({
    status: true,
    message: `تم إرسال الإشعار لـ ${userDevices.length} جهاز`,
    data: {
      sent_count: userDevices.length,
      devices: userDevices.map(d => ({
        device_name: d.device_name,
        platform: d.platform
      }))
    }
  });
});

// ============================================
// Health Check
// ============================================
app.get('/api/v1/health', (req, res) => {
  res.json({
    status: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// 404 Handler
// ============================================
app.use((req, res) => {
  res.status(404).json({
    status: false,
    message: `Endpoint not found: ${req.method} ${req.path}`
  });
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           CORBIT SMS - Mock Server                       ║
║══════════════════════════════════════════════════════════║
║  Server running at: http://localhost:${PORT}               ║
║  API Base URL: http://localhost:${PORT}/api/v1             ║
║                                                          ║
║  Test Users:                                             ║
║  ┌─────────────┬─────────────┬──────────┐               ║
║  │ Username    │ Password    │ 2FA      │               ║
║  ├─────────────┼─────────────┼──────────┤               ║
║  │ admin       │ 123456      │ ON       │               ║
║  │ user1       │ 123456      │ OFF      │               ║
║  │ 0501234567  │ 123456      │ ON       │               ║
║  └─────────────┴─────────────┴──────────┘               ║
║                                                          ║
║  OTP codes are logged in the console                     ║
╚══════════════════════════════════════════════════════════╝
  `);
});
