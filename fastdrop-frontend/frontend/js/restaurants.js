async function renderRestaurantList() {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { restaurants } = await api.get('/restaurants');
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>المطاعم</h1></div>
      <div class="field"><input type="text" id="rest-search" placeholder="ابحث عن مطعم..." /></div>
      <div class="card-list" id="rest-list">
        ${restaurants.map(restaurantCardHtml).join('') || emptyState('🍽️', 'لا توجد مطاعم متاحة حاليًا')}
      </div>
    </div>`;
  let t;
  document.getElementById('rest-search').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const { restaurants: results } = await api.get('/restaurants?q=' + encodeURIComponent(e.target.value));
      document.getElementById('rest-list').innerHTML = results.map(restaurantCardHtml).join('') || emptyState('🔎', 'لا توجد نتائج');
    }, 300);
  });
}

async function renderRestaurantDetail(id) {
  app.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const [{ restaurant, menu, rating_avg, rating_count }, favData] = await Promise.all([
    api.get(`/restaurants/${id}`),
    currentUser.role === 'customer' ? api.get('/favorites') : Promise.resolve({ restaurants: [] }),
  ]);
  const isFav = favData.restaurants.some((r) => r.id === id);
  const grouped = {};
  menu.forEach((m) => { (grouped[m.category || 'أخرى'] = grouped[m.category || 'أخرى'] || []).push(m); });

  app.innerHTML = `
    <div class="container">
      <div style="margin:16px 0;">
        <button class="btn btn-ghost btn-sm" onclick="navigate('#/restaurants')">→ رجوع</button>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 6px;">${escapeHtml(restaurant.name)}</h2>
            <p class="helper-text">${escapeHtml(restaurant.location || '')}</p>
            ${rating_avg ? `<p>⭐ ${Number(rating_avg).toFixed(1)} (${rating_count} تقييم)</p>` : `<p class="helper-text">لا يوجد تقييمات بعد</p>`}
          </div>
          ${currentUser.role === 'customer' ? `<button class="btn ${isFav ? 'btn-danger' : 'btn-outline'} btn-sm" onclick="toggleFavorite('restaurant','${id}',${isFav})">${isFav ? '✕ إزالة من المفضلة' : '♡ إضافة للمفضلة'}</button>` : ''}
        </div>
      </div>

      ${Object.keys(grouped).length === 0 ? emptyState('🍽️', 'لا توجد أصناف في القائمة بعد') : Object.entries(grouped).map(([cat, items]) => `
        <div class="section-title">${escapeHtml(cat)}</div>
        <div class="card-list">
          ${items.map((m) => `
            <div class="item-card">
              <div class="thumb">🍴</div>
              <div class="info">
                <h3>${escapeHtml(m.name)}</h3>
                <p>${escapeHtml(m.description || '')}</p>
                ${priceLabel(m.price)}
              </div>
              ${currentUser.role === 'customer' ? (
                m.price === null || !m.available
                  ? `<span class="helper-text">${!m.available ? 'غير متوفر' : ''}</span>`
                  : `<button class="btn btn-primary btn-sm" onclick='addToRestaurantCart(${JSON.stringify({ id: restaurant.id, name: restaurant.name })}, ${JSON.stringify({ id: m.id, name: m.name, price: m.price })})'>أضف للسلة</button>`
              ) : ''}
            </div>`).join('')}
        </div>`).join('')}
    </div>
    ${cartFab('restaurant')}`;
}

function cartFab(type) {
  const cart = type === 'restaurant' ? restaurantCart : pharmacyCart;
  if (!cart || !cart.items.length) return '';
  const count = cart.items.reduce((s, i) => s + i.qty, 0);
  return `
    <div style="position:fixed;bottom:16px;left:16px;right:16px;max-width:928px;margin:0 auto;">
      <button class="btn btn-primary btn-block" onclick="navigate('#/cart/${type}')">
        🛒 عرض السلة (${count}) — ${escapeHtml(cart.restaurant_name || cart.pharmacy_name)}
      </button>
    </div>`;
}

function addToRestaurantCart(restaurant, item) {
  if (restaurantCart && restaurantCart.restaurant_id !== restaurant.id) {
    if (!confirm('سلتك تحتوي على أصناف من مطعم آخر. هل تريد إفراغ السلة والبدء بطلب جديد؟')) return;
    restaurantCart = null;
  }
  if (!restaurantCart) restaurantCart = { restaurant_id: restaurant.id, restaurant_name: restaurant.name, items: [] };
  const existing = restaurantCart.items.find((i) => i.menu_item_id === item.id);
  if (existing) existing.qty += 1;
  else restaurantCart.items.push({ menu_item_id: item.id, name: item.name, price: item.price, qty: 1 });
  saveCarts();
  render();
}

function renderRestaurantCartPage() {
  if (!restaurantCart || !restaurantCart.items.length) {
    app.innerHTML = `<div class="container">${emptyState('🛒', 'سلتك فارغة')}<div style="text-align:center;"><a href="#/restaurants" class="btn btn-primary">تصفح المطاعم</a></div></div>`;
    return;
  }
  const subtotal = restaurantCart.items.reduce((s, i) => s + i.price * i.qty, 0);
  app.innerHTML = `
    <div class="container">
      <div class="hero"><h1>سلة ${escapeHtml(restaurantCart.restaurant_name)}</h1></div>
      <div class="card-list" id="cart-items">
        ${restaurantCart.items.map((i, idx) => cartItemHtml(i, idx, 'restaurant')).join('')}
      </div>
      <div class="card" style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;"><span>المجموع الفرعي</span><b>${fmtMoney(subtotal)}</b></div>
        <p class="helper-text">رسوم التوصيل والمجموع النهائي سيتم احتسابهما من قبل السيرفر عند تأكيد الطلب.</p>
        <div id="checkout-alert"></div>
        <button class="btn btn-primary btn-block" style="margin-top:10px;" onclick="checkoutRestaurant()">تأكيد الطلب</button>
      </div>
    </div>`;
}

function cartItemHtml(item, idx, type) {
  const idKey = type === 'restaurant' ? 'menu_item_id' : 'pharmacy_product_id';
  return `
    <div class="item-card">
      <div class="info"><h3>${escapeHtml(item.name)}</h3>${priceLabel(item.price)}</div>
      <div class="qty-control">
        <button onclick="changeCartQty('${type}', '${item[idKey]}', -1)">−</button>
        <span>${item.qty}</span>
        <button onclick="changeCartQty('${type}', '${item[idKey]}', 1)">+</button>
      </div>
    </div>`;
}

function changeCartQty(type, itemId, delta) {
  const cart = type === 'restaurant' ? restaurantCart : pharmacyCart;
  const idKey = type === 'restaurant' ? 'menu_item_id' : 'pharmacy_product_id';
  const item = cart.items.find((i) => i[idKey] === itemId);
  item.qty += delta;
  if (item.qty <= 0) cart.items = cart.items.filter((i) => i[idKey] !== itemId);
  if (!cart.items.length) { if (type === 'restaurant') restaurantCart = null; else pharmacyCart = null; }
  saveCarts();
  render();
}

async function checkoutRestaurant() {
  const alertBox = document.getElementById('checkout-alert');
  try {
    const { order } = await api.post('/orders/restaurant', {
      restaurant_id: restaurantCart.restaurant_id,
      items: restaurantCart.items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.qty })),
    });
    restaurantCart = null;
    saveCarts();
    navigate('#/orders/' + order.id);
    render();
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

async function toggleFavorite(type, id, isFav) {
  if (isFav) await api.del(`/favorites/${type}/${id}`);
  else await api.post(`/favorites/${type}/${id}`);
  render();
}
