async function renderFavorites() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { restaurants, pharmacies } = await api.get('/favorites');
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>المفضلة</h1></div>
      <div class="section-title">مطاعم</div>
      <div class="card-list">${restaurants.map(restaurantCardHtml).join('') || emptyState('🍽️', 'لا توجد مطاعم في المفضلة')}</div>
      <div class="section-title">صيدليات</div>
      <div class="card-list">${pharmacies.map(pharmacyCardHtml).join('') || emptyState('💊', 'لا توجد صيدليات في المفضلة')}</div>
    </div>`;
}

function renderAccount() {
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>الحساب</h1></div>
      <div class="card">
        <table>
          <tr><td>الاسم</td><td>${escapeHtml(currentUser.name)}</td></tr>
          <tr><td>البريد الإلكتروني</td><td>${escapeHtml(currentUser.email)}</td></tr>
          <tr><td>الهاتف</td><td>${escapeHtml(currentUser.phone || '—')}</td></tr>
          <tr><td>نوع الحساب</td><td>${roleLabel(currentUser.role)}</td></tr>
        </table>
        <button class="btn btn-danger btn-block" style="margin-top:16px;" onclick="doLogout()">تسجيل الخروج</button>
      </div>
    </div>`;
}

function roleLabel(role) {
  return { customer: 'عميل', restaurant: 'مطعم', pharmacy: 'صيدلية', driver: 'سائق دليفري', owner: 'مالك المنصة' }[role] || role;
}
