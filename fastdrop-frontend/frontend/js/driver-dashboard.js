let driverDashTab = 'available';

async function renderDriverDashboard() {
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>لوحة تحكم السائق</h1></div>
      <div class="tabs">
        <a class="tab ${driverDashTab === 'available' ? 'active' : ''}" onclick="driverDashTab='available';renderDriverDashboard()">الطلبات المتاحة</a>
        <a class="tab ${driverDashTab === 'assigned' ? 'active' : ''}" onclick="driverDashTab='assigned';renderDriverDashboard()">طلباتي الحالية</a>
        <a class="tab ${driverDashTab === 'history' ? 'active' : ''}" onclick="driverDashTab='history';renderDriverDashboard()">السجل</a>
      </div>
      <div id="dash-content"><div class="loading"><div class="spinner"></div></div></div>
    </div>`;
  const content = document.getElementById('dash-content');
  if (driverDashTab === 'available') content.innerHTML = await driverAvailableTab();
  else if (driverDashTab === 'assigned') content.innerHTML = await driverAssignedTab();
  else content.innerHTML = await driverHistoryTab();
}

function orderSummaryLine(o) {
  const typeLabel = { restaurant: '🍽️ طلب مطعم', pharmacy: '💊 طلب صيدلية', amanat: '📦 توصيل أمانة' };
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <b>${typeLabel[o.order_type]} #${o.id.slice(0, 8)}</b>${statusBadge(o.status)}
    </div>
    ${o.amanat ? `
      <p>📍 من: ${escapeHtml(o.amanat.pickup_location)} (${escapeHtml(o.amanat.pickup_person_name)}, ${escapeHtml(o.amanat.pickup_phone)})</p>
      <p>📍 إلى: ${escapeHtml(o.amanat.delivery_location)} (${escapeHtml(o.amanat.recipient_name)}, ${escapeHtml(o.amanat.recipient_phone)})</p>
    ` : `<p class="helper-text">الإجمالي: ${fmtMoney(o.total)}</p>`}`;
}

async function driverAvailableTab() {
  const { orders } = await api.get('/orders/available');
  if (!orders.length) return emptyState('📭', 'لا توجد طلبات متاحة حاليًا');
  return `<div class="card-list">
    ${orders.map((o) => `
      <div class="card">
        ${orderSummaryLine(o)}
        <button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="claimOrder('${o.id}', '${o.order_type === 'amanat' ? 'accepted' : 'picked_up'}')">استلام الطلب</button>
      </div>`).join('')}
  </div>`;
}

async function claimOrder(orderId, status) {
  try {
    await api.patch(`/orders/${orderId}/status`, { status });
    driverDashTab = 'assigned';
    renderDriverDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function driverAssignedTab() {
  const { orders } = await api.get('/orders/assigned');
  if (!orders.length) return emptyState('📭', 'لا توجد طلبات مسندة إليك حاليًا');
  const NEXT = { picked_up: 'delivering', delivering: 'delivered', accepted: 'picked_up' };
  const NEXT_LABEL = { delivering: 'بدء التوصيل', delivered: 'تم التسليم', picked_up: 'تم الاستلام' };
  return `<div class="card-list">
    ${orders.map((o) => `
      <div class="card">
        ${orderSummaryLine(o)}
        ${NEXT[o.status] ? `<button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="updateOrderStatus('${o.id}', '${NEXT[o.status]}', 'driverDashboard')">${NEXT_LABEL[NEXT[o.status]]}</button>` : ''}
      </div>`).join('')}
  </div>`;
}

async function driverHistoryTab() {
  const { orders } = await api.get('/orders/history');
  if (!orders.length) return emptyState('📭', 'لا يوجد سجل توصيل بعد');
  return `<div class="card-list">${orders.map((o) => `<div class="card">${orderSummaryLine(o)}</div>`).join('')}</div>`;
}
