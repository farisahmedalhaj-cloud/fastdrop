async function renderPharmacyList() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { pharmacies } = await api.get('/pharmacies');
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>الصيدليات</h1></div>
      <div class="card" style="margin-bottom:16px;">
        <label style="font-weight:700;font-size:14px;">🔎 ابحث عن دواء في كل الصيدليات</label>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <input type="text" id="med-search-quick" placeholder="مثال: باراسيتامول" style="flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--brand-border);" />
          <button class="btn btn-blue" onclick="goMedicineSearch()">بحث</button>
        </div>
      </div>
      <div class="field"><input type="text" id="pharm-search" placeholder="ابحث عن صيدلية بالاسم أو الموقع..." /></div>
      <div class="card-list" id="pharm-list">
        ${pharmacies.map(pharmacyCardHtml).join('') || emptyState('💊', 'لا توجد صيدليات متاحة حاليًا')}
      </div>
    </div>`;
  let t;
  document.getElementById('pharm-search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const { pharmacies: results } = await api.get('/pharmacies?q=' + encodeURIComponent(e.target.value));
      document.getElementById('pharm-list').innerHTML = results.map(pharmacyCardHtml).join('') || emptyState('🔎', 'لا توجد نتائج');
    }, 300);
  });
  document.getElementById('med-search-quick').addEventListener('keydown', (e) => { if (e.key === 'Enter') goMedicineSearch(); });
}

function goMedicineSearch() {
  const q = document.getElementById('med-search-quick').value.trim();
  navigate('#/pharmacies/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
}

async function renderPharmacySearch() {
  const params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
  const q = params.get('q') || '';
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>بحث عن دواء</h1></div>
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <input type="text" id="medicine-search-input" value="${escapeHtml(q)}" placeholder="اسم الدواء..." style="flex:1;padding:11px;border-radius:10px;border:1.5px solid var(--brand-border);" />
        <button class="btn btn-blue" onclick="runMedicineSearch()">بحث</button>
      </div>
      <div id="med-results">${q ? `<div class="loading"><div class="spinner"></div></div>` : emptyState('💊', 'اكتب اسم الدواء للبحث')}</div>
    </div>`;
  if (q) await runMedicineSearch();
  document.getElementById('medicine-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runMedicineSearch(); });
}

async function runMedicineSearch() {
  const q = document.getElementById('medicine-search-input').value.trim();
  if (!q) return;
  const resultsBox = document.getElementById('med-results');
  resultsBox.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const { count, results } = await api.get('/pharmacies/search?medicine=' + encodeURIComponent(q));
    if (!count) { resultsBox.innerHTML = emptyState('🔎', `لا توجد نتائج لـ "${escapeHtml(q)}"`); return; }
    resultsBox.innerHTML = `
      <p class="helper-text">"${escapeHtml(q)}" متوفر في ${count} نتيجة</p>
      <div class="card-list">
        ${results.map((r) => `
          <div class="item-card pharmacy" style="cursor:pointer;" onclick="navigate('#/pharmacies/${r.pharmacy.id}')">
            <div class="thumb">💊</div>
            <div class="info">
              <h3>${escapeHtml(r.product.name)} ${r.product.strength ? `(${escapeHtml(r.product.strength)})` : ''}</h3>
              <p>${escapeHtml(r.pharmacy.name)} — ${escapeHtml(r.pharmacy.location || '')}</p>
              ${priceLabel(r.product.price)} ${r.product.requires_prescription ? '<span class="badge">تتطلب وصفة</span>' : ''}
            </div>
          </div>`).join('')}
      </div>`;
  } catch (err) {
    resultsBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

async function renderPharmacyDetail(id) {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const [{ pharmacy, products }, favData] = await Promise.all([
    api.get(`/pharmacies/${id}`),
    currentUser.role === 'customer' ? api.get('/favorites') : Promise.resolve({ pharmacies: [] }),
  ]);
  const isFav = favData.pharmacies.some((p) => p.id === id);
  const { categories } = await api.get('/pharmacies/categories');
  const catName = (catId) => (categories.find((c) => c.id === catId) || {}).name || 'أخرى';
  const grouped = {};
  products.forEach((p) => { const c = catName(p.category_id); (grouped[c] = grouped[c] || []).push(p); });

  app.innerHTML = `
    <div class="container">
      <div style="margin:16px 0;"><button class="btn btn-ghost btn-sm" onclick="navigate('#/pharmacies')">→ رجوع</button></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 6px;">${escapeHtml(pharmacy.name)}</h2>
            <p class="helper-text">${escapeHtml(pharmacy.location || '')}</p>
            ${pharmacy.phone ? `<p class="helper-text">📞 ${escapeHtml(pharmacy.phone)}</p>` : ''}
          </div>
          ${currentUser.role === 'customer' ? `<button class="btn ${isFav ? 'btn-danger' : 'btn-outline'} btn-sm" onclick="toggleFavorite('pharmacy','${id}',${isFav})">${isFav ? '✕ إزالة من المفضلة' : '♡ إضافة للمفضلة'}</button>` : ''}
        </div>
      </div>

      ${Object.keys(grouped).length === 0 ? emptyState('💊', 'لا توجد منتجات بعد') : Object.entries(grouped).map(([cat, items]) => `
        <div class="section-title">${escapeHtml(cat)}</div>
        <div class="card-list">
          ${items.map((p) => `
            <div class="item-card pharmacy">
              <div class="thumb">💊</div>
              <div class="info">
                <h3>${escapeHtml(p.name)} ${p.strength ? `(${escapeHtml(p.strength)})` : ''}</h3>
                <p>${escapeHtml(p.description || '')}</p>
                ${priceLabel(p.price)}
                ${p.requires_prescription ? '<span class="badge">تتطلب وصفة طبية</span>' : ''}
              </div>
              ${currentUser.role === 'customer' ? (
                p.price === null || !p.available
                  ? `<span class="helper-text">${!p.available ? 'غير متوفر' : ''}</span>`
                  : `<button class="btn btn-blue btn-sm" onclick='addToPharmacyCart(${JSON.stringify({ id: pharmacy.id, name: pharmacy.name })}, ${JSON.stringify({ id: p.id, name: p.name, price: p.price, requires_prescription: !!p.requires_prescription })})'>أضف للسلة</button>`
              ) : ''}
            </div>`).join('')}
        </div>`).join('')}
    </div>
    ${cartFab('pharmacy')}`;
}

function addToPharmacyCart(pharmacy, product) {
  if (pharmacyCart && pharmacyCart.pharmacy_id !== pharmacy.id) {
    if (!confirm('السلة تحتوي على منتجات من صيدلية أخرى. هل تريد إفراغ السلة والبدء بطلب جديد؟')) return;
    pharmacyCart = null;
  }
  if (!pharmacyCart) pharmacyCart = { pharmacy_id: pharmacy.id, pharmacy_name: pharmacy.name, items: [] };
  const existing = pharmacyCart.items.find((i) => i.pharmacy_product_id === product.id);
  if (existing) existing.qty += 1;
  else pharmacyCart.items.push({ pharmacy_product_id: product.id, name: product.name, price: product.price, qty: 1, requires_prescription: product.requires_prescription });
  saveCarts();
  render();
}

function renderPharmacyCartPage() {
  if (!pharmacyCart || !pharmacyCart.items.length) {
    app.innerHTML = `<div class="container">${emptyState('🛒', 'سلتك فارغة')}<div style="text-align:center;"><a href="#/pharmacies" class="btn btn-blue">تصفح الصيدليات</a></div></div>`;
    return;
  }
  const subtotal = pharmacyCart.items.reduce((s, i) => s + i.price * i.qty, 0);
  const needsRx = pharmacyCart.items.some((i) => i.requires_prescription);
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>سلة ${escapeHtml(pharmacyCart.pharmacy_name)}</h1></div>
      <div class="card-list">
        ${pharmacyCart.items.map((i, idx) => cartItemHtml(i, idx, 'pharmacy')).join('')}
      </div>
      ${needsRx ? `
        <div class="card" style="margin-top:16px;">
          <label style="font-weight:700;font-size:14px;">📄 رفع الوصفة الطبية (مطلوبة لبعض الأصناف)</label>
          <input type="file" id="rx-file" accept="image/*,.pdf" style="margin-top:8px;" />
          <div id="rx-status" class="helper-text"></div>
        </div>` : ''}
      <div class="card" style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;"><span>المجموع الفرعي</span><b>${fmtMoney(subtotal)}</b></div>
        <p class="helper-text">رسوم التوصيل والمجموع النهائي سيتم احتسابهما من قبل السيرفر عند تأكيد الطلب.</p>
        <div id="checkout-alert"></div>
        <button class="btn btn-blue btn-block" style="margin-top:10px;" onclick="checkoutPharmacy(${needsRx})">تأكيد الطلب</button>
      </div>
    </div>`;
}

async function checkoutPharmacy(needsRx) {
  const alertBox = document.getElementById('checkout-alert');
  try {
    let prescriptionPath;
    if (needsRx) {
      const fileInput = document.getElementById('rx-file');
      if (!fileInput.files.length) throw new Error('الرجاء رفع صورة الوصفة الطبية.');
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      document.getElementById('rx-status').textContent = 'جاري رفع الملف...';
      const uploadRes = await api.upload('/uploads', fd);
      prescriptionPath = uploadRes.path;
    }
    const { order } = await api.post('/orders/pharmacy', {
      pharmacy_id: pharmacyCart.pharmacy_id,
      items: pharmacyCart.items.map((i) => ({ pharmacy_product_id: i.pharmacy_product_id, quantity: i.qty })),
      prescription_file_path: prescriptionPath,
    });
    pharmacyCart = null;
    saveCarts();
    navigate('#/orders/' + order.id);
    render();
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}
