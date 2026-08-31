// ===================== Global state =====================
let currentUser = null; // populated from /auth/me
let restaurantCart = null; // { restaurant_id, restaurant_name, items: [{menu_item_id, name, price, qty}] }
let pharmacyCart = null; // { pharmacy_id, pharmacy_name, items: [{pharmacy_product_id, name, price, qty}] }

function loadCarts() {
  try {
    restaurantCart = JSON.parse(localStorage.getItem('fastdrop_restaurant_cart') || 'null');
    pharmacyCart = JSON.parse(localStorage.getItem('fastdrop_pharmacy_cart') || 'null');
  } catch (e) {
    restaurantCart = null; pharmacyCart = null;
  }
}
function saveCarts() {
  localStorage.setItem('fastdrop_restaurant_cart', JSON.stringify(restaurantCart));
  localStorage.setItem('fastdrop_pharmacy_cart', JSON.stringify(pharmacyCart));
}

function fmtMoney(n) {
  if (n === null || n === undefined) return null;
  return `${Number(n).toLocaleString('ar-SD')} ج.س`;
}

function priceLabel(price) {
  if (price === null || price === undefined) return `<span class="price unset">السعر غير محدد</span>`;
  return `<span class="price">${fmtMoney(price)}</span>`;
}

const STATUS_LABELS = {
  pending: 'قيد الانتظار', accepted: 'تم قبول الطلب', preparing: 'الطلب قيد التجهيز',
  ready: 'الطلب جاهز', picked_up: 'تم الاستلام من قبل السائق', delivering: 'في الطريق',
  delivered: 'تم التسليم', cancelled: 'ملغي',
};
function statusBadge(s) {
  return `<span class="badge status-${s}">${STATUS_LABELS[s] || s}</span>`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===================== Router =====================
const app = document.getElementById('app');

function navigate(hash) {
  window.location.hash = hash;
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadCarts();
  try {
    const { user } = await api.get('/auth/me');
    currentUser = user;
  } catch (e) {
    currentUser = null;
  }
  render();
}

function requireAuth(redirectHash) {
  if (!currentUser) {
    navigate('#/login');
    return false;
  }
  return true;
}

function requireRole(role, roles) {
  const list = Array.isArray(role) ? role : [role, ...(roles || [])];
  return currentUser && list.includes(currentUser.role);
}

async function render() {
  if (!currentUser) {
    // Login-first: any hash while logged out goes to login/register, except register itself.
    const hash = window.location.hash;
    if (hash === '#/register') return renderRegister();
    return renderLogin();
  }
  const hash = window.location.hash || defaultHashForRole(currentUser.role);
  const [, route, ...rest] = hash.split('/');
  const id = rest.join('/');

  renderNavbar();

  try {
    switch (true) {
      case hash.startsWith('#/home'): return await renderCustomerHome();
      case hash.startsWith('#/restaurants/'): return await renderRestaurantDetail(id);
      case hash.startsWith('#/restaurants'): return await renderRestaurantList();
      case hash.startsWith('#/pharmacies/search'): return await renderPharmacySearch();
      case hash.startsWith('#/pharmacies/'): return await renderPharmacyDetail(id);
      case hash.startsWith('#/pharmacies'): return await renderPharmacyList();
      case hash.startsWith('#/amanat/new'): return renderAmanatForm();
      case hash.startsWith('#/amanat'): return await renderAmanatList();
      case hash.startsWith('#/cart/restaurant'): return renderRestaurantCartPage();
      case hash.startsWith('#/cart/pharmacy'): return renderPharmacyCartPage();
      case hash.startsWith('#/orders/'): return await renderOrderDetail(id);
      case hash.startsWith('#/orders'): return await renderOrdersList();
      case hash.startsWith('#/favorites'): return await renderFavorites();
      case hash.startsWith('#/account'): return renderAccount();
      case hash.startsWith('#/dashboard/restaurant'): return await renderRestaurantDashboard();
      case hash.startsWith('#/dashboard/pharmacy'): return await renderPharmacyDashboard();
      case hash.startsWith('#/dashboard/driver'): return await renderDriverDashboard();
      case hash.startsWith('#/dashboard/owner'): return await renderOwnerDashboard();
      default:
        navigate(defaultHashForRole(currentUser.role));
    }
  } catch (err) {
    app.innerHTML = `<div class="container"><div class="alert alert-error">${escapeHtml(err.message)}</div></div>`;
  }
}

function defaultHashForRole(role) {
  if (role === 'customer') return '#/home';
  if (role === 'restaurant') return '#/dashboard/restaurant';
  if (role === 'pharmacy') return '#/dashboard/pharmacy';
  if (role === 'driver') return '#/dashboard/driver';
  if (role === 'owner') return '#/dashboard/owner';
  return '#/home';
}

// ===================== Navbar =====================
function renderNavbar() {
  const nav = document.getElementById('navbar');
  const hash = window.location.hash;
  const linksByRole = {
    customer: [
      ['#/home', 'الرئيسية'], ['#/restaurants', 'المطاعم'], ['#/pharmacies', 'الصيدليات'],
      ['#/amanat/new', 'توصيل أمانات'], ['#/orders', 'طلباتي'], ['#/favorites', 'المفضلة'],
    ],
    restaurant: [['#/dashboard/restaurant', 'لوحة التحكم']],
    pharmacy: [['#/dashboard/pharmacy', 'لوحة التحكم']],
    driver: [['#/dashboard/driver', 'لوحة التحكم']],
    owner: [['#/dashboard/owner', 'لوحة تحكم المالك']],
  };
  const links = linksByRole[currentUser.role] || [];
  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="#/home" class="brand-logo" onclick="navigate('${defaultHashForRole(currentUser.role)}')">FastDrop<span class="dot">.</span></a>
      <div class="nav-links">
        ${links.map(([h, label]) => `<a class="nav-link ${hash === h ? 'active' : ''}" href="${h}">${label}</a>`).join('')}
      </div>
      <div class="nav-user">
        <a class="nav-link" href="#/account">${escapeHtml(currentUser.name)}</a>
        <button class="btn btn-ghost btn-sm" onclick="doLogout()">خروج</button>
      </div>
    </div>`;
  nav.style.display = 'block';
}

async function doLogout() {
  await api.post('/auth/logout');
  currentUser = null;
  document.getElementById('navbar').style.display = 'none';
  navigate('#/login');
  render();
}

// ===================== Auth pages =====================
function renderLogin() {
  document.getElementById('navbar').style.display = 'none';
  app.innerHTML = `
    <div class="container">
      <div class="card form-card">
        <div style="text-align:center;margin-bottom:18px;">
          <div class="brand-logo" style="justify-content:center;font-size:26px;">FastDrop<span class="dot">.</span></div>
          <p class="helper-text">دليفري المطاعم، الصيدليات، وتوصيل الأمانات</p>
        </div>
        <div id="login-alert"></div>
        <form id="login-form">
          <div class="field"><label>البريد الإلكتروني</label><input type="email" name="email" required /></div>
          <div class="field"><label>كلمة المرور</label><input type="password" name="password" required /></div>
          <div class="field">
            <label>رمز الحساب (للمطاعم/الصيدليات/السائقين/المالك فقط)</label>
            <input type="text" name="code" placeholder="مثال: SFR-RES-000001" />
          </div>
          <button class="btn btn-primary btn-block" type="submit">تسجيل الدخول</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:13px;">
          ليس لديك حساب؟ <a href="#/register" style="color:var(--brand-orange);font-weight:700;">إنشاء حساب عميل</a>
        </p>
        <div class="alert alert-info" style="margin-top:16px;font-size:12px;">
          حسابات تجريبية: customer.demo@fastdrop.test / restaurant.demo@fastdrop.test (كود SFR-RES-000001) /
          pharmacy.demo@fastdrop.test (كود SFR-PHA-000001) / driver.demo@fastdrop.test (كود SFR-DRV-000001) —
          كلمة المرور للجميع: FastDropDemo123!
        </div>
      </div>
    </div>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { email: fd.get('email'), password: fd.get('password'), code: fd.get('code') || undefined };
    try {
      const { user } = await api.post('/auth/login', body);
      currentUser = user;
      navigate(defaultHashForRole(user.role));
      render();
    } catch (err) {
      document.getElementById('login-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function renderRegister() {
  document.getElementById('navbar').style.display = 'none';
  app.innerHTML = `
    <div class="container">
      <div class="card form-card">
        <h2 style="text-align:center;">إنشاء حساب عميل</h2>
        <div id="register-alert"></div>
        <form id="register-form">
          <div class="field"><label>الاسم الكامل</label><input type="text" name="name" required /></div>
          <div class="field"><label>البريد الإلكتروني</label><input type="email" name="email" required /></div>
          <div class="field"><label>رقم الهاتف</label><input type="tel" name="phone" /></div>
          <div class="field"><label>كلمة المرور</label><input type="password" name="password" minlength="8" required /></div>
          <button class="btn btn-primary btn-block" type="submit">إنشاء الحساب</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:13px;">
          لديك حساب؟ <a href="#/login" style="color:var(--brand-orange);font-weight:700;">تسجيل الدخول</a>
        </p>
      </div>
    </div>`;
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { name: fd.get('name'), email: fd.get('email'), phone: fd.get('phone'), password: fd.get('password') };
    try {
      const { user } = await api.post('/auth/register', body);
      currentUser = user;
      navigate('#/home');
      render();
    } catch (err) {
      document.getElementById('register-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ===================== Customer Home =====================
async function renderCustomerHome() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const [{ orders }, { restaurants }, { pharmacies }] = await Promise.all([
    api.get('/orders/mine'),
    api.get('/restaurants'),
    api.get('/pharmacies'),
  ]);
  const activeOrder = orders.find((o) => !['delivered', 'cancelled'].includes(o.status));

  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>أهلًا ${escapeHtml(currentUser.name)} 👋</h1><p>وش تحب توصل لك اليوم؟</p></div>

      <div class="field">
        <input type="text" id="global-search" placeholder="ابحث عن مطعم أو دواء..." />
      </div>

      <div class="service-grid">
        <a class="service-tile food" href="#/restaurants"><span class="icon">🍽️</span>المطاعم</a>
        <a class="service-tile pharmacy" href="#/pharmacies"><span class="icon">💊</span>الصيدليات</a>
        <a class="service-tile amanat" href="#/amanat/new"><span class="icon">📦</span>توصيل أمانات</a>
      </div>

      ${activeOrder ? `
        <div class="section-title">طلبك الحالي</div>
        <div class="card" onclick="navigate('#/orders/${activeOrder.id}')" style="cursor:pointer;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>#${activeOrder.id.slice(0, 8)} — ${activeOrder.order_type === 'restaurant' ? 'مطعم' : activeOrder.order_type === 'pharmacy' ? 'صيدلية' : 'أمانة'}</div>
            ${statusBadge(activeOrder.status)}
          </div>
        </div>` : ''}

      <div class="section-title">مطاعم مقترحة</div>
      <div class="card-list">
        ${restaurants.slice(0, 3).map(restaurantCardHtml).join('') || emptyState('🍽️', 'لا توجد مطاعم متاحة حاليًا')}
      </div>

      <div class="section-title">صيدليات قريبة</div>
      <div class="card-list">
        ${pharmacies.slice(0, 3).map(pharmacyCardHtml).join('') || emptyState('💊', 'لا توجد صيدليات متاحة حاليًا')}
      </div>
    </div>`;

  document.getElementById('global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      navigate('#/pharmacies/search?q=' + encodeURIComponent(e.target.value.trim()));
      setTimeout(() => { document.getElementById('medicine-search-input') && (document.getElementById('medicine-search-input').value = e.target.value); }, 50);
    }
  });
}

function emptyState(icon, text) {
  return `<div class="empty-state"><div class="icon">${icon}</div><div>${text}</div></div>`;
}

function restaurantCardHtml(r) {
  return `
    <div class="item-card" style="cursor:pointer;" onclick="navigate('#/restaurants/${r.id}')">
      <div class="thumb">🍽️</div>
      <div class="info">
        <h3>${escapeHtml(r.name)}</h3>
        <p>${escapeHtml(r.location || '')}</p>
        ${r.rating_avg ? `<p>⭐ ${Number(r.rating_avg).toFixed(1)} (${r.rating_count})</p>` : ''}
      </div>
    </div>`;
}
function pharmacyCardHtml(p) {
  return `
    <div class="item-card pharmacy" style="cursor:pointer;" onclick="navigate('#/pharmacies/${p.id}')">
      <div class="thumb">💊</div>
      <div class="info">
        <h3>${escapeHtml(p.name)}</h3>
        <p>${escapeHtml(p.location || '')}</p>
      </div>
    </div>`;
}
