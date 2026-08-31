async function renderOrdersList() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { orders } = await api.get('/orders/mine');
  const typeLabel = { restaurant: '🍽️ مطعم', pharmacy: '💊 صيدلية', amanat: '📦 أمانة' };
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>طلباتي</h1></div>
      ${!orders.length ? emptyState('📭', 'لا توجد طلبات بعد') : `
        <div class="card-list">
          ${orders.map((o) => `
            <div class="item-card" style="cursor:pointer;" onclick="navigate('#/orders/${o.id}')">
              <div class="thumb">${typeLabel[o.order_type].split(' ')[0]}</div>
              <div class="info">
                <h3>#${o.id.slice(0, 8)} — ${typeLabel[o.order_type].split(' ')[1]}</h3>
                <p>${fmtMoney(o.total)} — ${new Date(o.created_at).toLocaleString('ar-SD')}</p>
              </div>
              ${statusBadge(o.status)}
            </div>`).join('')}
        </div>`}
    </div>`;
}

async function renderOrderDetail(id) {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { order } = await api.get(`/orders/${id}`);
  const typeLabel = { restaurant: 'طلب مطعم', pharmacy: 'طلب صيدلية', amanat: 'توصيل أمانة' };
  const canCancel = currentUser.role === 'customer' && order.customer_id === currentUser.id && ['pending', 'accepted'].includes(order.status);
  const canReview = currentUser.role === 'customer' && order.status === 'delivered' && order.order_type !== 'amanat';

  app.innerHTML = `
    <div class="container">
      <div style="margin:16px 0;"><button class="btn btn-ghost btn-sm" onclick="navigate('#/orders')">→ رجوع لطلباتي</button></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;">${typeLabel[order.order_type]} #${order.id.slice(0, 8)}</h2>
          ${statusBadge(order.status)}
        </div>
        <p class="helper-text">تاريخ الإنشاء: ${new Date(order.created_at).toLocaleString('ar-SD')}</p>

        ${order.amanat ? `
          <div class="section-title">تفاصيل الأمانة</div>
          <p><b>${escapeHtml(order.amanat.item_name)}</b></p>
          <p>📍 الاستلام: ${escapeHtml(order.amanat.pickup_location)} — ${escapeHtml(order.amanat.pickup_person_name)} (${escapeHtml(order.amanat.pickup_phone)})</p>
          <p>📍 التسليم: ${escapeHtml(order.amanat.delivery_location)} — ${escapeHtml(order.amanat.recipient_name)} (${escapeHtml(order.amanat.recipient_phone)})</p>
          ${order.amanat.estimated_value ? `<p>القيمة التقريبية: ${fmtMoney(order.amanat.estimated_value)}</p>` : ''}
        ` : ''}

        ${order.items && order.items.length ? `
          <div class="section-title">الأصناف</div>
          <table>
            <tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
            ${order.items.map((i) => `<tr><td>${escapeHtml(i.item_name)}</td><td>${i.quantity}</td><td>${fmtMoney(i.unit_price)}</td><td>${fmtMoney(i.subtotal)}</td></tr>`).join('')}
          </table>
        ` : ''}

        <div class="section-title">الفاتورة</div>
        <table>
          <tr><td>المجموع الفرعي</td><td>${fmtMoney(order.subtotal)}</td></tr>
          <tr><td>رسوم التوصيل</td><td>${fmtMoney(order.delivery_fee)}</td></tr>
          ${order.outstanding_fee_applied ? `<tr><td>رسوم مستحقة سابقًا</td><td>${fmtMoney(order.outstanding_fee_applied)}</td></tr>` : ''}
          ${order.cancellation_fee ? `<tr><td>رسوم إلغاء</td><td>${fmtMoney(order.cancellation_fee)}</td></tr>` : ''}
          <tr><td><b>الإجمالي</b></td><td><b>${fmtMoney(order.total)}</b></td></tr>
        </table>

        ${order.driver ? `<div class="section-title">السائق</div><p>${escapeHtml(order.driver.name)} — ${escapeHtml(order.driver.phone || '')}</p>` : ''}

        ${order.requires_prescription_review ? `<div class="alert alert-info">حالة مراجعة الوصفة الطبية: ${escapeHtml(order.prescription_status || 'قيد المراجعة')}</div>` : ''}

        <div class="section-title">سجل الحالة</div>
        <div class="card-list">
          ${order.status_history.map((h) => `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0;border-bottom:1px solid var(--brand-border);">
              <span>${STATUS_LABELS[h.new_status] || h.new_status}</span>
              <span class="helper-text">${new Date(h.created_at).toLocaleString('ar-SD')}</span>
            </div>`).join('')}
        </div>

        <div id="order-action-alert"></div>
        ${canCancel ? `<button class="btn btn-danger btn-block" style="margin-top:14px;" onclick="cancelOrder('${order.id}')">إلغاء الطلب</button>` : ''}
        ${canReview ? renderReviewForm(order.id) : ''}
      </div>
    </div>`;
}

function renderReviewForm(orderId) {
  return `
    <div class="section-title">قيّم تجربتك</div>
    <form id="review-form" onsubmit="submitReview(event, '${orderId}')">
      <div class="field">
        <label>التقييم</label>
        <select name="rating" required>
          <option value="5">⭐⭐⭐⭐⭐ ممتاز</option>
          <option value="4">⭐⭐⭐⭐ جيد جدًا</option>
          <option value="3">⭐⭐⭐ جيد</option>
          <option value="2">⭐⭐ مقبول</option>
          <option value="1">⭐ ضعيف</option>
        </select>
      </div>
      <div class="field"><label>تعليق (اختياري)</label><textarea name="comment" rows="2"></textarea></div>
      <button class="btn btn-primary btn-block" type="submit">إرسال التقييم</button>
    </form>`;
}

async function submitReview(e, orderId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api.post('/reviews', { order_id: orderId, rating: parseInt(fd.get('rating'), 10), comment: fd.get('comment') });
    document.getElementById('order-action-alert').innerHTML = `<div class="alert alert-success">شكرًا لتقييمك!</div>`;
    e.target.remove();
  } catch (err) {
    document.getElementById('order-action-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

async function cancelOrder(id) {
  if (!confirm('هل أنت متأكد من إلغاء الطلب؟')) return;
  try {
    await api.patch(`/orders/${id}/status`, { status: 'cancelled' });
    render();
  } catch (err) {
    document.getElementById('order-action-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}
