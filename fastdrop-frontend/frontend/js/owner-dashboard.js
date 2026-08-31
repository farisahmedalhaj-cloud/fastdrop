let ownerDashTab = 'stats';

async function renderOwnerDashboard() {
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>لوحة تحكم المالك</h1></div>
      <div class="tabs">
        <a class="tab ${ownerDashTab === 'stats' ? 'active' : ''}" onclick="ownerDashTab='stats';renderOwnerDashboard()">الإحصائيات</a>
        <a class="tab ${ownerDashTab === 'restaurants' ? 'active' : ''}" onclick="ownerDashTab='restaurants';renderOwnerDashboard()">المطاعم</a>
        <a class="tab ${ownerDashTab === 'pharmacies' ? 'active' : ''}" onclick="ownerDashTab='pharmacies';renderOwnerDashboard()">الصيدليات</a>
        <a class="tab ${ownerDashTab === 'drivers' ? 'active' : ''}" onclick="ownerDashTab='drivers';renderOwnerDashboard()">السائقون</a>
        <a class="tab ${ownerDashTab === 'customers' ? 'active' : ''}" onclick="ownerDashTab='customers';renderOwnerDashboard()">العملاء</a>
        <a class="tab ${ownerDashTab === 'orders' ? 'active' : ''}" onclick="ownerDashTab='orders';renderOwnerDashboard()">الطلبات</a>
        <a class="tab ${ownerDashTab === 'amanat' ? 'active' : ''}" onclick="ownerDashTab='amanat';renderOwnerDashboard()">الأمانات</a>
        <a class="tab ${ownerDashTab === 'fees' ? 'active' : ''}" onclick="ownerDashTab='fees';renderOwnerDashboard()">الرسوم المستحقة</a>
        <a class="tab ${ownerDashTab === 'reviews' ? 'active' : ''}" onclick="ownerDashTab='reviews';renderOwnerDashboard()">التقييمات</a>
        <a class="tab ${ownerDashTab === 'settings' ? 'active' : ''}" onclick="ownerDashTab='settings';renderOwnerDashboard()">الإعدادات</a>
        <a class="tab ${ownerDashTab === 'audit' ? 'active' : ''}" onclick="ownerDashTab='audit';renderOwnerDashboard()">سجل التدقيق</a>
      </div>
      <div id="dash-content"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;
  const content = document.getElementById('dash-content');
  const renderers = {
    stats: ownerStatsTab, restaurants: () => ownerAccountsTab('restaurant'), pharmacies: () => ownerAccountsTab('pharmacy'),
    drivers: () => ownerAccountsTab('driver'), customers: ownerCustomersTab, orders: ownerOrdersTab,
    amanat: ownerAmanatTab, fees: ownerFeesTab, reviews: ownerReviewsTab, settings: ownerSettingsTab, audit: ownerAuditTab,
  };
  content.innerHTML = await renderers[ownerDashTab]();
  if (ownerDashTab === 'settings') wireOwnerSettingsForm();
}

async function ownerStatsTab() {
  const s = await api.get('/owner/stats');
  const box = (num, label) => `<div class="stat-box"><div class="num">${num}</div><div class="label">${label}</div></div>`;
  return `<div class="stat-grid">
    ${box(s.customers, 'عملاء')}
    ${box(s.restaurants, 'مطاعم')}
    ${box(s.pharmacies, 'صيدليات')}
    ${box(s.drivers, 'سائقون')}
    ${box(s.orders_total, 'إجمالي الطلبات')}
    ${box(s.orders_pending, 'طلبات جارية')}
    ${box(s.orders_delivered, 'طلبات مكتملة')}
    ${box(s.orders_cancelled, 'طلبات ملغاة')}
    ${box(s.reviews_total, 'تقييمات')}
    ${box(fmtMoney(s.outstanding_fees_unpaid), 'رسوم مستحقة غير مدفوعة')}
  </div>`;
}

// ---------------- Generic account management (restaurant/pharmacy/driver) ----------------
async function ownerAccountsTab(role) {
  const endpoint = role === 'pharmacy' ? 'pharmacies' : `${role}s`;
  const { accounts } = await api.get(`/owner/${endpoint}`);
  const roleLabels = { restaurant: 'مطعم', pharmacy: 'صيدلية', driver: 'سائق' };
  return `
    <button class="btn btn-primary btn-sm" style="margin-bottom:14px;" onclick="showCreateAccountForm('${role}')">+ إنشاء حساب ${roleLabels[role]}</button>
    <div id="create-account-holder"></div>
    <table>
      <tr><th>الاسم</th><th>البريد</th><th>الكود</th><th>الحالة</th><th>إجراءات</th></tr>
      ${accounts.map((a) => `
        <tr>
          <td>${escapeHtml(a.name)}</td>
          <td>${escapeHtml(a.email)}</td>
          <td>${escapeHtml(a.code || '—')}</td>
          <td>${a.is_active ? '✅ نشط' : '⛔ معطل'}</td>
          <td>
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm" onclick="ownerChangeCode('${role}','${a.id}')">تغيير الكود</button>
              <button class="btn btn-ghost btn-sm" onclick="ownerChangePassword('${role}','${a.id}')">تغيير كلمة المرور</button>
              ${a.is_active
                ? `<button class="btn btn-ghost btn-sm" onclick="ownerToggleAccount('${role}','${a.id}','disable')">تعطيل</button>`
                : `<button class="btn btn-ghost btn-sm" onclick="ownerToggleAccount('${role}','${a.id}','enable')">تفعيل</button>`}
              <button class="btn btn-danger btn-sm" onclick="ownerDeleteAccount('${role}','${a.id}')">حذف</button>
            </div>
          </td>
        </tr>`).join('')}
    </table>`;
}

function endpointFor(role) { return role === 'pharmacy' ? 'pharmacies' : `${role}s`; }

function showCreateAccountForm(role) {
  const roleLabels = { restaurant: 'مطعم', pharmacy: 'صيدلية', driver: 'سائق' };
  const holder = document.getElementById('create-account-holder');
  const extraFields = role === 'restaurant'
    ? `<div class="field"><label>اسم المطعم</label><input name="restaurant_name" required /></div>
       <div class="field"><label>موقع المطعم</label><input name="location" /></div>`
    : role === 'pharmacy'
    ? `<div class="field"><label>اسم الصيدلية</label><input name="pharmacy_name" required /></div>
       <div class="field"><label>موقع الصيدلية</label><input name="location" /></div>`
    : '';
  const codePrefix = { restaurant: 'SFR-RES-XXXXXX', pharmacy: 'SFR-PHA-XXXXXX', driver: 'SFR-DRV-XXXXXX' }[role];
  holder.innerHTML = `
    <form id="create-account-form" class="card" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">إنشاء حساب ${roleLabels[role]}</div>
      <div id="create-account-alert"></div>
      <div class="field"><label>اسم صاحب الحساب</label><input name="name" required /></div>
      <div class="field"><label>البريد الإلكتروني</label><input type="email" name="email" required /></div>
      <div class="field"><label>الهاتف</label><input name="phone" /></div>
      <div class="field"><label>كلمة المرور</label><input type="password" name="password" minlength="8" required /></div>
      <div class="field"><label>الكود (اتركه فارغًا للتوليد التلقائي) — الصيغة: ${codePrefix}</label><input name="code" /></div>
      ${extraFields}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" type="submit">إنشاء</button>
        <button class="btn btn-ghost" type="button" onclick="document.getElementById('create-account-holder').innerHTML=''">إلغاء</button>
      </div>
    </form>`;
  document.getElementById('create-account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (!body.code) delete body.code;
    try {
      await api.post(`/owner/${endpointFor(role)}`, body);
      renderOwnerDashboard();
    } catch (err) {
      document.getElementById('create-account-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function ownerChangeCode(role, userId) {
  const code = prompt('أدخل الكود الجديد:');
  if (!code) return;
  try {
    await api.patch(`/owner/${endpointFor(role)}/${userId}/code`, { code });
    renderOwnerDashboard();
  } catch (err) { alert(err.message); }
}
async function ownerChangePassword(role, userId) {
  const password = prompt('أدخل كلمة المرور الجديدة (8 أحرف على الأقل):');
  if (!password) return;
  try {
    await api.patch(`/owner/${endpointFor(role)}/${userId}/password`, { password });
    alert('تم تغيير كلمة المرور.');
  } catch (err) { alert(err.message); }
}
async function ownerToggleAccount(role, userId, action) {
  await api.patch(`/owner/${endpointFor(role)}/${userId}/${action}`);
  renderOwnerDashboard();
}
async function ownerDeleteAccount(role, userId) {
  if (!confirm('سيتم تعطيل الحساب مع الاحتفاظ بالسجل التاريخي. هل تريد المتابعة؟')) return;
  await api.del(`/owner/${endpointFor(role)}/${userId}`);
  renderOwnerDashboard();
}

// ---------------- Customers (read-only + enable/disable) ----------------
async function ownerCustomersTab() {
  const { accounts } = await api.get('/owner/customers');
  return `<table>
    <tr><th>الاسم</th><th>البريد</th><th>الهاتف</th><th>الحالة</th><th>إجراءات</th></tr>
    ${accounts.map((a) => `
      <tr>
        <td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.email)}</td><td>${escapeHtml(a.phone || '—')}</td>
        <td>${a.is_active ? '✅ نشط' : '⛔ معطل'}</td>
        <td>${a.is_active
          ? `<button class="btn btn-ghost btn-sm" onclick="ownerToggleCustomer('${a.id}','disable')">تعطيل</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="ownerToggleCustomer('${a.id}','enable')">تفعيل</button>`}</td>
      </tr>`).join('')}
  </table>`;
}
async function ownerToggleCustomer(userId, action) {
  await api.patch(`/owner/customers/${userId}/${action}`);
  renderOwnerDashboard();
}

// ---------------- Orders / Amanat / Fees / Reviews oversight ----------------
async function ownerOrdersTab() {
  const { orders } = await api.get('/owner/orders');
  const typeLabel = { restaurant: '🍽️', pharmacy: '💊', amanat: '📦' };
  if (!orders.length) return emptyState('📭', 'لا توجد طلبات بعد');
  return `<table>
    <tr><th>النوع</th><th>#</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th></tr>
    ${orders.map((o) => `
      <tr style="cursor:pointer;" onclick="navigate('#/orders/${o.id}')">
        <td>${typeLabel[o.order_type]}</td><td>${o.id.slice(0, 8)}</td><td>${statusBadge(o.status)}</td>
        <td>${fmtMoney(o.total)}</td><td>${new Date(o.created_at).toLocaleDateString('ar-SD')}</td>
      </tr>`).join('')}
  </table>`;
}

async function ownerAmanatTab() {
  const { orders } = await api.get('/owner/amanat');
  if (!orders.length) return emptyState('📦', 'لا توجد طلبات أمانات بعد');
  return `<table>
    <tr><th>الأمانة</th><th>من</th><th>إلى</th><th>الحالة</th></tr>
    ${orders.map((o) => `
      <tr style="cursor:pointer;" onclick="navigate('#/orders/${o.order_id}')">
        <td>${escapeHtml(o.item_name)}</td><td>${escapeHtml(o.pickup_location)}</td>
        <td>${escapeHtml(o.delivery_location)}</td><td>${statusBadge(o.status)}</td>
      </tr>`).join('')}
  </table>`;
}

async function ownerFeesTab() {
  const { fees } = await api.get('/owner/outstanding-fees');
  if (!fees.length) return emptyState('💰', 'لا توجد رسوم مستحقة');
  return `<table>
    <tr><th>العميل</th><th>المبلغ</th><th>السبب</th><th>الحالة</th></tr>
    ${fees.map((f) => `
      <tr><td>${escapeHtml(f.customer_name)}</td><td>${fmtMoney(f.amount)}</td>
        <td>${escapeHtml(f.reason || '—')}</td><td>${f.is_paid ? '✅ مدفوعة' : '⏳ غير مدفوعة'}</td></tr>`).join('')}
  </table>`;
}

async function ownerReviewsTab() {
  const { reviews } = await api.get('/owner/reviews');
  if (!reviews.length) return emptyState('⭐', 'لا توجد تقييمات بعد');
  return `<div class="card-list">
    ${reviews.map((r) => `<div class="card"><b>${'⭐'.repeat(r.rating)}</b> — ${escapeHtml(r.customer_name)}${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : ''}</div>`).join('')}
  </div>`;
}

// ---------------- Settings (delivery fees) ----------------
async function ownerSettingsTab() {
  const { settings } = await api.get('/owner/settings');
  return `
    <form id="owner-settings-form" class="card">
      <div class="section-title" style="margin-top:0;">رسوم التوصيل (ج.س)</div>
      <div id="owner-settings-alert"></div>
      <div class="field"><label>رسوم توصيل المطاعم</label><input type="number" min="0" name="delivery_fee_restaurant" value="${settings.delivery_fee_restaurant}" /></div>
      <div class="field"><label>رسوم توصيل الصيدليات</label><input type="number" min="0" name="delivery_fee_pharmacy" value="${settings.delivery_fee_pharmacy}" /></div>
      <div class="field"><label>رسوم توصيل الأمانات</label><input type="number" min="0" name="delivery_fee_amanat" value="${settings.delivery_fee_amanat}" /></div>
      <button class="btn btn-primary" type="submit">حفظ</button>
    </form>`;
}
function wireOwnerSettingsForm() {
  const form = document.getElementById('owner-settings-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      delivery_fee_restaurant: parseFloat(fd.get('delivery_fee_restaurant')),
      delivery_fee_pharmacy: parseFloat(fd.get('delivery_fee_pharmacy')),
      delivery_fee_amanat: parseFloat(fd.get('delivery_fee_amanat')),
    };
    try {
      await api.patch('/owner/settings', body);
      document.getElementById('owner-settings-alert').innerHTML = `<div class="alert alert-success">تم الحفظ.</div>`;
    } catch (err) {
      document.getElementById('owner-settings-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

// ---------------- Audit log ----------------
async function ownerAuditTab() {
  const { logs } = await api.get('/owner/audit-logs');
  if (!logs.length) return emptyState('📜', 'لا توجد سجلات بعد');
  return `<table>
    <tr><th>الإجراء</th><th>التاريخ</th></tr>
    ${logs.map((l) => `<tr><td>${escapeHtml(l.action)}</td><td>${new Date(l.created_at).toLocaleString('ar-SD')}</td></tr>`).join('')}
  </table>`;
}
