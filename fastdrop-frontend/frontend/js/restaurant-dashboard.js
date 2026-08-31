let restaurantDashTab = 'orders';

async function renderRestaurantDashboard() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  let restaurant;
  try {
    ({ restaurant } = await api.get('/restaurants/mine'));
  } catch (err) {
    app.innerHTML = `<div class="container"><div class="alert alert-error">${escapeHtml(err.message)}</div></div>`;
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>${escapeHtml(restaurant.name)}</h1><p>لوحة تحكم المطعم</p></div>
      <div class="tabs">
        <a class="tab ${restaurantDashTab === 'orders' ? 'active' : ''}" onclick="restaurantDashTab='orders';renderRestaurantDashboard()">الطلبات</a>
        <a class="tab ${restaurantDashTab === 'menu' ? 'active' : ''}" onclick="restaurantDashTab='menu';renderRestaurantDashboard()">القائمة</a>
        <a class="tab ${restaurantDashTab === 'reviews' ? 'active' : ''}" onclick="restaurantDashTab='reviews';renderRestaurantDashboard()">التقييمات</a>
        <a class="tab ${restaurantDashTab === 'settings' ? 'active' : ''}" onclick="restaurantDashTab='settings';renderRestaurantDashboard()">إعدادات المطعم</a>
      </div>
      <div id="dash-content"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  const content = document.getElementById('dash-content');
  if (restaurantDashTab === 'orders') content.innerHTML = await restaurantOrdersTab(restaurant);
  else if (restaurantDashTab === 'menu') content.innerHTML = await restaurantMenuTab(restaurant);
  else if (restaurantDashTab === 'reviews') content.innerHTML = await businessReviewsTab(restaurant.id, 'restaurant');
  else content.innerHTML = restaurantSettingsTab(restaurant);
}

async function restaurantOrdersTab(restaurant) {
  const { orders } = await api.get('/orders/incoming');
  const NEXT = { pending: 'accepted', accepted: 'preparing', preparing: 'ready' };
  const NEXT_LABEL = { accepted: 'قبول الطلب', preparing: 'بدء التجهيز', ready: 'الطلب جاهز' };
  if (!orders.length) return emptyState('📭', 'لا توجد طلبات واردة حاليًا');
  return `<div class="card-list">
    ${orders.map((o) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b>#${o.id.slice(0, 8)}</b>${statusBadge(o.status)}
        </div>
        <p class="helper-text">${new Date(o.created_at).toLocaleString('ar-SD')} — الإجمالي ${fmtMoney(o.total)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          ${NEXT[o.status] ? `<button class="btn btn-primary btn-sm" onclick="updateOrderStatus('${o.id}', '${NEXT[o.status]}', 'restaurantDashboard')">${NEXT_LABEL[NEXT[o.status]]}</button>` : ''}
          ${['pending', 'accepted'].includes(o.status) ? `<button class="btn btn-danger btn-sm" onclick="updateOrderStatus('${o.id}', 'cancelled', 'restaurantDashboard')">إلغاء</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="navigate('#/orders/${o.id}')">التفاصيل</button>
        </div>
      </div>`).join('')}
  </div>`;
}

async function updateOrderStatus(orderId, newStatus, refreshFn) {
  try {
    await api.patch(`/orders/${orderId}/status`, { status: newStatus });
  } catch (err) {
    alert(err.message);
  }
  if (refreshFn === 'restaurantDashboard') renderRestaurantDashboard();
  else if (refreshFn === 'pharmacyDashboard') renderPharmacyDashboard();
  else if (refreshFn === 'driverDashboard') renderDriverDashboard();
}

async function restaurantMenuTab(restaurant) {
  const { menu } = await api.get(`/restaurants/${restaurant.id}`);
  return `
    <button class="btn btn-primary btn-sm" style="margin-bottom:14px;" onclick="showMenuItemForm('${restaurant.id}')">+ إضافة صنف جديد</button>
    <div id="menu-form-holder"></div>
    <div class="card-list">
      ${menu.map((m) => `
        <div class="item-card">
          <div class="thumb">🍴</div>
          <div class="info">
            <h3>${escapeHtml(m.name)} ${!m.available ? '<span class="badge">غير متوفر</span>' : ''}</h3>
            <p>${escapeHtml(m.category || '')}</p>
            ${priceLabel(m.price)}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick='showMenuItemForm("${restaurant.id}", ${JSON.stringify(m)})'>تعديل</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMenuItem('${restaurant.id}','${m.id}')">حذف</button>
          </div>
        </div>`).join('') || emptyState('🍴', 'لا توجد أصناف بعد')}
    </div>`;
}

function showMenuItemForm(restaurantId, item) {
  const holder = document.getElementById('menu-form-holder');
  holder.innerHTML = `
    <form id="menu-item-form" class="card" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">${item ? 'تعديل صنف' : 'صنف جديد'}</div>
      <div id="menu-form-alert"></div>
      <div class="field"><label>الاسم</label><input name="name" value="${item ? escapeHtml(item.name) : ''}" required /></div>
      <div class="field"><label>الوصف</label><textarea name="description" rows="2">${item ? escapeHtml(item.description || '') : ''}</textarea></div>
      <div class="field"><label>التصنيف</label><input name="category" value="${item ? escapeHtml(item.category || '') : ''}" /></div>
      <div class="field"><label>السعر (ج.س) — اتركه فارغًا إن لم يُحدد بعد</label><input type="number" name="price" min="0" value="${item && item.price !== null ? item.price : ''}" /></div>
      ${item ? `<div class="field"><label><input type="checkbox" name="available" ${item.available ? 'checked' : ''} style="width:auto;" /> متوفر</label></div>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" type="submit">حفظ</button>
        <button class="btn btn-ghost" type="button" onclick="document.getElementById('menu-form-holder').innerHTML=''">إلغاء</button>
      </div>
    </form>`;
  document.getElementById('menu-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), description: fd.get('description') || null, category: fd.get('category') || null,
      price: fd.get('price') === '' ? null : parseFloat(fd.get('price')),
    };
    if (item) body.available = fd.get('available') === 'on';
    try {
      if (item) await api.patch(`/restaurants/${restaurantId}/menu/${item.id}`, body);
      else await api.post(`/restaurants/${restaurantId}/menu`, body);
      renderRestaurantDashboard();
    } catch (err) {
      document.getElementById('menu-form-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function deleteMenuItem(restaurantId, itemId) {
  if (!confirm('هل تريد حذف هذا الصنف؟')) return;
  await api.del(`/restaurants/${restaurantId}/menu/${itemId}`);
  renderRestaurantDashboard();
}

async function businessReviewsTab(businessId, type) {
  const { reviews } = await api.get(`/${type === 'restaurant' ? 'restaurants' : 'pharmacies'}/${businessId}/reviews`);
  if (!reviews.length) return emptyState('⭐', 'لا توجد تقييمات بعد');
  return `<div class="card-list">
    ${reviews.map((r) => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;"><b>${'⭐'.repeat(r.rating)}</b><span class="helper-text">${escapeHtml(r.customer_name)}</span></div>
        ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : ''}
      </div>`).join('')}
  </div>`;
}

function restaurantSettingsTab(restaurant) {
  setTimeout(() => {
    const form = document.getElementById('restaurant-settings-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try {
        await api.patch(`/restaurants/${restaurant.id}`, body);
        document.getElementById('settings-alert').innerHTML = `<div class="alert alert-success">تم الحفظ.</div>`;
      } catch (err) {
        document.getElementById('settings-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  });
  return `
    <form id="restaurant-settings-form" class="card">
      <div id="settings-alert"></div>
      <div class="field"><label>اسم المطعم</label><input name="name" value="${escapeHtml(restaurant.name)}" required /></div>
      <div class="field"><label>الوصف</label><textarea name="description" rows="2">${escapeHtml(restaurant.description || '')}</textarea></div>
      <div class="field"><label>الموقع</label><input name="location" value="${escapeHtml(restaurant.location || '')}" /></div>
      <div class="field"><label>التصنيف</label><input name="category" value="${escapeHtml(restaurant.category || '')}" /></div>
      <button class="btn btn-primary" type="submit">حفظ التغييرات</button>
    </form>`;
}
