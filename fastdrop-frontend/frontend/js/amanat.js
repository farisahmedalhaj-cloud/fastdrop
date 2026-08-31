function renderAmanatForm() {
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>توصيل أمانات</h1><p>أرسل أي غرض من مكان إلى آخر عبر سائقي FastDrop</p></div>
      <div id="amanat-alert"></div>
      <form id="amanat-form" class="card">
        <div class="section-title" style="margin-top:0;">تفاصيل الأمانة</div>
        <div class="field"><label>اسم المنتج / الأمانة</label><input type="text" name="item_name" required /></div>
        <div class="field"><label>القيمة التقريبية للأمانة (اختياري، ج.س)</label><input type="number" name="estimated_value" min="0" /></div>
        <div class="field"><label>ملاحظات</label><textarea name="notes" rows="2"></textarea></div>

        <div class="section-title">معلومات الاستلام</div>
        <div class="field"><label>موقع الاستلام</label><input type="text" name="pickup_location" required /></div>
        <div class="field"><label>اسم الشخص عند الاستلام</label><input type="text" name="pickup_person_name" required /></div>
        <div class="field"><label>رقم هاتف الاستلام</label><input type="tel" name="pickup_phone" required /></div>

        <div class="section-title">معلومات التسليم</div>
        <div class="field"><label>موقع التسليم</label><input type="text" name="delivery_location" required /></div>
        <div class="field"><label>اسم المستلم</label><input type="text" name="recipient_name" required /></div>
        <div class="field"><label>رقم هاتف المستلم</label><input type="tel" name="recipient_phone" required /></div>

        <button class="btn btn-red btn-block" type="submit">إنشاء طلب توصيل أمانة</button>
      </form>
    </div>`;

  document.getElementById('amanat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (body.estimated_value) body.estimated_value = parseFloat(body.estimated_value); else delete body.estimated_value;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'جاري الإرسال...';
    try {
      const { order } = await api.post('/orders/amanat', body);
      navigate('#/orders/' + order.id);
      render();
    } catch (err) {
      document.getElementById('amanat-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'إنشاء طلب توصيل أمانة';
    }
  });
}
