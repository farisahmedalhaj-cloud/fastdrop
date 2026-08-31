let pharmacyDashTab = 'orders';

async function renderPharmacyDashboard() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  let pharmacy, categories;
  try {
    ({ pharmacy } = await api.get('/pharmacies/mine'));
    ({ categories } = await api.get('/pharmacies/categories'));
  } catch (err) {
    app.innerHTML = `<div class="container"><div class="alert alert-error">${escapeHtml(err.message)}</div></div>`;
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>${escapeHtml(pharmacy.name)}</h1><p>لوحة تحكم الصيدلية</p></div>
      <div class="tabs">
        <a class="tab ${pharmacyDashTab === 'orders' ? 'active' : ''}" onclick="pharmacyDashTab='orders';renderPharmacyDashboard()">الطلبات</a>
        <a class="tab ${pharmacyDashTab === 'products' ? 'active' : ''}" onclick="pharmacyDashTab='products';renderPharmacyDashboard()">المنتجات</a>
        <a class="tab ${pharmacyDashTab === 'reviews' ? 'active' : ''}" onclick="pharmacyDashTab='reviews';renderPharmacyDashboard()">التقييمات</a>
        <a class="tab ${pharmacyDashTab === 'settings' ? 'active' : ''}" onclick="pharmacyDashTab='settings';renderPharmacyDashboard()">إعدادات الصيدلية</a>
      </div>
      <div id="dash-content"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;

  const content = document.getElementById('dash-content');
  if (pharmacyDashTab === 'orders') content.innerHTML = await pharmacyOrdersTab(pharmacy);
  else if (pharmacyDashTab === 'products') content.innerHTML = await pharmacyProductsTab(pharmacy, categories);
  else if (pharmacyDashTab === 'reviews') content.innerHTML = await businessReviewsTab(pharmacy.id, 'pharmacy');
  else content.innerHTML = pharmacySettingsTab(pharmacy);

  if (pharmacyDashTab === 'orders') wirePrescriptionButtons();
}

async function pharmacyOrdersTab(pharmacy) {
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
        ${o.requires_prescription_review ? `
          <div class="alert alert-info">
            وصفة طبية: ${o.prescription_status === 'approved' ? '✅ تمت الموافقة' : o.prescription_status === 'rejected' ? '❌ مرفوضة' : '⏳ بانتظار المراجعة'}
            ${o.prescription_status === 'pending' ? `
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" data-approve="${o.id}">موافقة</button>
                <button class="btn btn-danger btn-sm" data-reject="${o.id}">رفض</button>
              </div>` : ''}
          </div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          ${NEXT[o.status] && (!o.requires_prescription_review || o.prescription_status === 'approved') ? `<button class="btn btn-blue btn-sm" onclick="updateOrderStatus('${o.id}', '${NEXT[o.status]}', 'pharmacyDashboard')">${NEXT_LABEL[NEXT[o.status]]}</button>` : ''}
          ${['pending', 'accepted'].includes(o.status) ? `<button class="btn btn-danger btn-sm" onclick="updateOrderStatus('${o.id}', 'cancelled', 'pharmacyDashboard')">إلغاء</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="navigate('#/orders/${o.id}')">التفاصيل</button>
        </div>
      </div>`).join('')}
  </div>`;
}

function wirePrescriptionButtons() {
  document.querySelectorAll('[data-approve]').forEach((btn) =>
    btn.addEventListener('click', () => reviewPrescription(btn.dataset.approve, 'approved')));
  document.querySelectorAll('[data-reject]').forEach((btn) =>
    btn.addEventListener('click', () => reviewPrescription(btn.dataset.reject, 'rejected')));
}

async function reviewPrescription(orderId, decision) {
  try {
    await api.patch(`/orders/${orderId}/prescription`, { decision });
    renderPharmacyDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function pharmacyProductsTab(pharmacy, categories) {
  const { products } = await api.get(`/pharmacies/${pharmacy.id}`);
  window.__pharmacyCategories = categories;
  return `
    <button class="btn btn-blue btn-sm" style="margin-bottom:14px;" onclick="showProductForm('${pharmacy.id}')">+ إضافة منتج جديد</button>
    <div id="product-form-holder"></div>
    <div class="card-list">
      ${products.map((p) => `
        <div class="item-card pharmacy">
          <div class="thumb">💊</div>
          <div class="info">
            <h3>${escapeHtml(p.name)} ${!p.available ? '<span class="badge">غير متوفر</span>' : ''} ${p.requires_prescription ? '<span class="badge">وصفة</span>' : ''}</h3>
            ${priceLabel(p.price)}
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn btn-ghost btn-sm" onclick='showProductForm("${pharmacy.id}", ${JSON.stringify(p)})'>تعديل</button>
            <button class="btn btn-danger btn-sm" onclick="deleteProduct('${pharmacy.id}','${p.id}')">حذف</button>
          </div>
        </div>`).join('') || emptyState('💊', 'لا توجد منتجات بعد')}
    </div>`;
}

function showProductForm(pharmacyId, product) {
  const categories = window.__pharmacyCategories || [];
  const holder = document.getElementById('product-form-holder');
  holder.innerHTML = `
    <form id="product-form" class="card" style="margin-bottom:16px;">
      <div class="section-title" style="margin-top:0;">${product ? 'تعديل منتج' : 'منتج جديد'}</div>
      <div id="product-form-alert"></div>
      <div class="field"><label>الاسم</label><input name="name" value="${product ? escapeHtml(product.name) : ''}" required /></div>
      <div class="field"><label>التركيز / الجرعة</label><input name="strength" value="${product ? escapeHtml(product.strength || '') : ''}" /></div>
      <div class="field"><label>الشكل الصيدلاني</label><input name="form" value="${product ? escapeHtml(product.form || '') : ''}" /></div>
      <div class="field"><label>التصنيف</label>
        <select name="category_id">
          <option value="">— بدون —</option>
          ${categories.map((c) => `<option value="${c.id}" ${product && product.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>السعر (ج.س) — اتركه فارغًا إن لم يُحدد بعد</label><input type="number" name="price" min="0" value="${product && product.price !== null ? product.price : ''}" /></div>
      <div class="field"><label><input type="checkbox" name="requires_prescription" ${product && product.requires_prescription ? 'checked' : ''} style="width:auto;" /> يتطلب وصفة طبية</label></div>
      ${product ? `<div class="field"><label><input type="checkbox" name="available" ${product.available ? 'checked' : ''} style="width:auto;" /> متوفر</label></div>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-blue" type="submit">حفظ</button>
        <button class="btn btn-ghost" type="button" onclick="document.getElementById('product-form-holder').innerHTML=''">إلغاء</button>
      </div>
    </form>`;
  document.getElementById('product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get('name'), strength: fd.get('strength') || null, form: fd.get('form') || null,
      category_id: fd.get('category_id') || null,
      price: fd.get('price') === '' ? null : parseFloat(fd.get('price')),
      requires_prescription: fd.get('requires_prescription') === 'on',
    };
    if (product) body.available = fd.get('available') === 'on';
    try {
      if (product) await api.patch(`/pharmacies/${pharmacyId}/products/${product.id}`, body);
      else await api.post(`/pharmacies/${pharmacyId}/products`, body);
      renderPharmacyDashboard();
    } catch (err) {
      document.getElementById('product-form-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}

async function deleteProduct(pharmacyId, productId) {
  if (!confirm('هل تريد حذف هذا المنتج؟')) return;
  await api.del(`/pharmacies/${pharmacyId}/products/${productId}`);
  renderPharmacyDashboard();
}

function pharmacySettingsTab(pharmacy) {
  setTimeout(() => {
    const form = document.getElementById('pharmacy-settings-form');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try {
        await api.patch(`/pharmacies/${pharmacy.id}`, body);
        document.getElementById('settings-alert').innerHTML = `<div class="alert alert-success">تم الحفظ.</div>`;
      } catch (err) {
        document.getElementById('settings-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });
  });
  return `
    <form id="pharmacy-settings-form" class="card">
      <div id="settings-alert"></div>
      <div class="field"><label>اسم الصيدلية</label><input name="name" value="${escapeHtml(pharmacy.name)}" required /></div>
      <div class="field"><label>الوصف</label><textarea name="description" rows="2">${escapeHtml(pharmacy.description || '')}</textarea></div>
      <div class="field"><label>الموقع</label><input name="location" value="${escapeHtml(pharmacy.location || '')}" /></div>
      <div class="field"><label>Plus Code</label><input name="plus_code" value="${escapeHtml(pharmacy.plus_code || '')}" /></div>
      <div class="field"><label>الهاتف</label><input name="phone" value="${escapeHtml(pharmacy.phone || '')}" /></div>
      <button class="btn btn-blue" type="submit">حفظ التغييرات</button>
    </form>`;
}
