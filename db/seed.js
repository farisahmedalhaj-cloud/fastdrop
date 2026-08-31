require('dotenv').config();
const db = require('./index');
const { hashPassword } = require('../utils/auth');
const { newId } = require('../utils/helpers');

function upsertUser({ name, email, password, phone, role, code }) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    console.log(`- user already exists, skipping: ${email}`);
    return existing;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, phone, role, code, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(id, name, email.toLowerCase(), hashPassword(password), phone || null, role, code || null);
  console.log(`+ created ${role}: ${email}`);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function upsertRestaurant(ownerUserId, data) {
  const existing = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?').get(ownerUserId);
  if (existing) return existing;
  const id = newId();
  db.prepare(
    `INSERT INTO restaurants (id, name, description, location, category, owner_user_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(id, data.name, data.description || null, data.location || null, data.category || null, ownerUserId);
  return db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id);
}

function ensureMenuItem(restaurantId, name, category) {
  const existing = db.prepare('SELECT id FROM menu_items WHERE restaurant_id = ? AND name = ?').get(restaurantId, name);
  if (existing) return;
  db.prepare(
    `INSERT INTO menu_items (id, restaurant_id, name, category, price, available, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))`
  ).run(newId(), restaurantId, name, category || null);
}

function upsertPharmacy(ownerUserId, data) {
  const existing = db.prepare('SELECT * FROM pharmacies WHERE owner_user_id = ?').get(ownerUserId);
  if (existing) return existing;
  const id = newId();
  db.prepare(
    `INSERT INTO pharmacies (id, name, description, location, plus_code, phone, owner_user_id, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(id, data.name, data.description || null, data.location || null, data.plus_code || null, data.phone || null, ownerUserId);
  return db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(id);
}

// A pharmacy record with no linked user account (spec: real pharmacies exist
// as businesses on the map/search results before an Owner necessarily issues
// them a login). owner_user_id still required by schema, so these are parked
// under the Owner account until a real pharmacy account is created for them.
function upsertUnstaffedPharmacy(ownerUserId, data) {
  const existing = db.prepare('SELECT * FROM pharmacies WHERE name = ? AND location = ?').get(data.name, data.location);
  if (existing) return existing;
  const id = newId();
  db.prepare(
    `INSERT INTO pharmacies (id, name, description, location, plus_code, phone, owner_user_id, is_active, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run(id, data.name, data.location || null, data.plus_code || null, data.phone || null, ownerUserId);
  return db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(id);
}

function ensureCategory(name) {
  const existing = db.prepare('SELECT * FROM pharmacy_categories WHERE name = ?').get(name);
  if (existing) return existing;
  const id = newId();
  db.prepare('INSERT INTO pharmacy_categories (id, name) VALUES (?, ?)').run(id, name);
  return db.prepare('SELECT * FROM pharmacy_categories WHERE id = ?').get(id);
}

function main() {
  console.log('=== FastDrop seed starting ===');

  // ---------------- Owner ----------------
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  const ownerPhone = process.env.OWNER_PHONE;
  const ownerCode = process.env.OWNER_CODE || 'SFR-OWN-2026';
  if (!ownerEmail || !ownerPassword) {
    console.error('OWNER_EMAIL and OWNER_PASSWORD must be set in .env before seeding. Aborting.');
    process.exit(1);
  }
  const owner = upsertUser({ name: 'FastDrop Owner', email: ownerEmail, password: ownerPassword, phone: ownerPhone, role: 'owner', code: ownerCode });

  // ---------------- Demo accounts ----------------
  const demoCustomer = upsertUser({
    name: 'عميل تجريبي', email: 'customer.demo@fastdrop.test', password: 'FastDropDemo123!', role: 'customer',
  });
  const demoRestaurantUser = upsertUser({
    name: 'مطعم تجريبي', email: 'restaurant.demo@fastdrop.test', password: 'FastDropDemo123!', role: 'restaurant', code: 'SFR-RES-000001',
  });
  const demoDriverUser = upsertUser({
    name: 'سائق تجريبي', email: 'driver.demo@fastdrop.test', password: 'FastDropDemo123!', role: 'driver', code: 'SFR-DRV-000001',
  });
  const demoPharmacyUser = upsertUser({
    name: 'صيدلية تجريبية', email: 'pharmacy.demo@fastdrop.test', password: 'FastDropDemo123!', role: 'pharmacy', code: 'SFR-PHA-000001',
  });
  if (!db.prepare('SELECT id FROM delivery_drivers WHERE user_id = ?').get(demoDriverUser.id)) {
    db.prepare(`INSERT INTO delivery_drivers (id, user_id, is_available, created_at, updated_at) VALUES (?, ?, 1, datetime('now'), datetime('now'))`)
      .run(newId(), demoDriverUser.id);
  }
  const demoRestaurant = upsertRestaurant(demoRestaurantUser.id, {
    name: 'مطعم تجريبي', description: 'حساب تجريبي لاختبار المنصة', category: 'تجريبي',
  });
  ['وجبة تجريبية 1', 'وجبة تجريبية 2'].forEach((n) => ensureMenuItem(demoRestaurant.id, n, 'تجريبي'));
  const demoPharmacy = upsertPharmacy(demoPharmacyUser.id, {
    name: 'صيدلية تجريبية', location: 'حساب تجريبي', description: 'حساب تجريبي لاختبار المنصة',
  });

  // ---------------- Real restaurants (section 19) ----------------
  const restaurantsData = [
    {
      name: 'مطعم الموناليزا',
      location: 'شارع الوادي - تقاطع شارع السيسي، مقابل باني أقاشي وشرق أولاد أم درمان',
      menu: [
        ['طاجن كوارع سادة', 'أطباق رئيسية'], ['فول بالكوارع', 'أطباق رئيسية'],
        ['شوربة كوارع مسبكة', 'أطباق رئيسية'], ['شية ضأن على الفحم', 'مشويات'],
        ['فراخ مشوي', 'مشويات'], ['أقاشي لحم', 'أقاشي'], ['أقاشي دجاج', 'أقاشي'],
        ['مخبازة بالقشطة والعسل والموز', 'حلويات'],
      ],
    },
    {
      name: 'كافتيريا الفكهاني',
      location: 'شارع الوادي مباشرة، وله فرع آخر في شارع النص بالحارة العاشرة',
      menu: [
        ['فطيرة الفكهاني - مشكل لحوم وجبن', 'فطائر'], ['فطيرة هوت دوق وجبنة موزاريلا', 'فطائر'],
        ['فطيرة لحم مفروم', 'فطائر'], ['فطيرة تونة', 'فطائر'], ['فطيرة دجاج', 'فطائر'],
        ['فطيرة نوتيلا', 'فطائر'], ['فطيرة كاسترد', 'فطائر'], ['فطيرة عسل وقشطة', 'فطائر'],
        ['بيتزا مارغريتا', 'بيتزا'], ['بيتزا خضار', 'بيتزا'], ['بيتزا دجاج', 'بيتزا'], ['بيتزا مشكل أجبان', 'بيتزا'],
        ['عصير مانجو', 'عصائر'], ['عصير جوافة', 'عصائر'], ['عصير فراولة', 'عصائر'], ['مكس فواكه طازج', 'عصائر'],
      ],
    },
    {
      name: 'مستر كريب (HWS)',
      location: 'شارع الوادي، في النطاق الحيوي القريب من تقاطعات الثورة',
      menu: [
        ['كريب زنجر', 'كريب مالح'], ['كريب فاهيتا دجاج', 'كريب مالح'], ['كريب شيش طاووق', 'كريب مالح'],
        ['كريب مشكل لحوم', 'كريب مالح'], ['كريب بطاطس بالجبنة', 'كريب مالح'],
        ['كريب نوتيلا سادة', 'كريب حلو'], ['كريب نوتيلا بالموز والمكسرات', 'كريب حلو'], ['كريب لوتس', 'كريب حلو'],
        ['ميلك شيك أوريو', 'مشروبات'], ['ميلك شيك فانيليا', 'مشروبات'], ['ميلك شيك شوكولاتة', 'مشروبات'],
        ['مشروبات غازية باردة', 'مشروبات'],
      ],
    },
    {
      name: 'مطعم الأمير الشطبي',
      location: 'شارع الوادي - حي الرياض الثورة',
      menu: [
        ['سندوتش شاورما دجاج', 'ساندويتشات'], ['سندوتش شاورما لحم', 'ساندويتشات'],
        ['برجر دجاج', 'ساندويتشات'], ['سندوتشات طعمية / فلافل', 'ساندويتشات'],
        ['فطائر مشكل جبن', 'فطائر'], ['فطائر لحوم', 'فطائر'],
      ],
    },
    {
      name: 'مطعم ديبونيرز',
      location: 'شارع الوادي مباشرة',
      menu: [['بيتزا إيطالية', 'بيتزا'], ['معجنات متنوعة', 'معجنات']],
    },
    {
      name: 'MoMo Sweets',
      location: 'شارع الوادي، مقابل تقاطع شارع السيسي، جوار شهد الشام',
      menu: [
        ['تورتات', 'حلويات'], ['كيك', 'حلويات'], ['دوناتس', 'حلويات'], ['قشطوطة', 'حلويات'],
        ['مشروبات باردة', 'مشروبات'], ['قهوة', 'مشروبات'], ['ماتشا', 'مشروبات'],
      ],
    },
  ];

  restaurantsData.forEach((r, idx) => {
    const email = `restaurant${idx + 1}@fastdrop.test`;
    const user = upsertUser({
      name: r.name, email, password: 'FastDropSeed123!', role: 'restaurant',
      code: `SFR-RES-${String(idx + 2).padStart(6, '0')}`,
    });
    const restaurant = upsertRestaurant(user.id, { name: r.name, location: r.location, category: 'مطاعم' });
    r.menu.forEach(([name, category]) => ensureMenuItem(restaurant.id, name, category));
    console.log(`+ restaurant ready: ${r.name} (${r.menu.length} menu items, prices unset)`);
  });

  // ---------------- Pharmacy categories (section 34) ----------------
  const categories = [
    'الصداع والألم والحرارة', 'الزكام والحساسية', 'الكحة والبلغم', 'المعدة والحموضة والارتجاع',
    'الإسهال ومشاكل الأمعاء', 'الغثيان والترجيع', 'المضادات الحيوية', 'الضغط والقلب', 'السكر',
    'الجلد والفطريات', 'الديدان والطفيليات', 'الملاريا', 'العين', 'الأنف والأذن والحنجرة',
    'الفيتامينات والمعادن', 'أدوية الأعصاب والنفسية',
  ];
  const categoryRecords = {};
  categories.forEach((c) => { categoryRecords[c] = ensureCategory(c); });

  // ---------------- Real pharmacies (section 38) ----------------
  const pharmaciesData = [
    { name: 'صيدلية هنا امدرمان', location: 'شارع الوادي، شمال استوب مكي', plus_code: 'MF3Q+MF9' },
    { name: 'صيدلية أربيل', location: 'شارع الوادي', plus_code: 'PG45+CF4' },
    { name: 'صيدلية الراعي الصالح', location: 'شارع الوادي، الثالثة', plus_code: 'MFGV+2VH' },
    { name: 'صيدلية الروضة', location: 'شارع الوادي / قرب تقاطع شارع عبد المنعم السيسي' },
    { name: 'صيدلية شارع النص', location: 'شارع الثورة بالنص', plus_code: 'MFGP+GCC' },
    { name: 'صيدلية د/ محمد عبده', location: 'شارع النص' },
    { name: 'صيدلية زحل', location: 'شارع النص' },
    { name: 'صيدلية حي العمدة', location: 'حي العمدة، أم درمان', plus_code: 'MF5P+56F', phone: '0912237628' },
    { name: 'صيدلية د. مايكل', location: 'حي العمدة، أم درمان', plus_code: 'MF5P+MG2' },
    { name: 'صيدلية الدومة', location: 'شارع الدومة', plus_code: 'MF5Q+JM9' },
  ];
  pharmaciesData.forEach((p) => {
    const pharmacy = upsertUnstaffedPharmacy(owner.id, p);
    console.log(`+ pharmacy ready: ${p.name} (no login account yet - create one from Owner Dashboard when ready)`);
  });

  // ---------------- Pharmacy product catalog reference (section 35) ----------------
  // Seeded on the demo pharmacy only, as a starting catalog reference with
  // price = NULL (spec: "لا تخترع أسعارًا" — the pharmacy must set real prices).
  const catalogByCategory = {
    'الصداع والألم والحرارة': ['باراسيتامول', 'إيبوبروفين', 'ديكلوفيناك', 'نابروكسين', 'أسبرين', 'ترامادول'],
    'الزكام والحساسية': ['سيتريزين', 'لوراتادين', 'كلورفينيرامين', 'ديفينهيدرامين', 'فيكسوفينادين'],
    'الكحة والبلغم': ['أمبروكسول', 'برومهيكسين', 'أسيتيل سيستئين', 'غايفينيسين', 'ديكستروميثورفان', 'سالبيوتامول'],
    'المعدة والحموضة والارتجاع': ['أوميبرازول', 'إيزوميبرازول', 'بانتوبرازول', 'فاموتيدين', 'ألجينات', 'هيدروكسيد الألمنيوم', 'هيدروكسيد المغنيسيوم'],
    'الإسهال ومشاكل الأمعاء': ['أملاح الإماهة الفموية ORS', 'زنك', 'لوبيراميد', 'ميترونيدازول', 'لاكتولوز'],
    'الغثيان والترجيع': ['أوندانسيترون', 'ميتوكلوبراميد', 'دومبيريدون'],
    'المضادات الحيوية': ['أموكسيسيلين', 'أموكسيسيلين/كلافولانيك أسيد', 'أزيثروميسين', 'سيفيكسيم', 'سيفترياكسون', 'ميترونيدازول', 'دوكسيسيكلين', 'سيبروفلوكساسين'],
    'الضغط والقلب': ['أملوديبين', 'لوسارتان', 'فالسارتان', 'كابتوبريل', 'إنالابريل', 'أتينولول', 'ميتوبرولول', 'فوروسيميد'],
    'السكر': ['ميتفورمين', 'غليبيزيد', 'غليكلازايد', 'إنسولين'],
    'الجلد والفطريات': ['كلوتريمازول', 'ميكونازول', 'تيربينافين', 'فلوكونازول', 'أسيكلوفير', 'هيدروكورتيزون', 'بنزيل بنزوات'],
    'الديدان والطفيليات': ['ألبيندازول', 'ميبندازول', 'برازيكوانتيل', 'إيفرمكتين'],
    'الملاريا': ['أرتيميثر/لوميفانترين', 'أرتيسونات', 'كينين'],
    'العين': ['كلورامفينيكول قطرة عين', 'تتراسيكلين مرهم عين', 'أسيكلوفير عين', 'تيمولول قطرة', 'لاتانوبروست قطرة'],
    'الأنف والأذن والحنجرة': ['محلول ملحي للأنف', 'أوكسي ميتازولين', 'زيلوميتازولين'],
    'الفيتامينات والمعادن': ['فيتامين D', 'فيتامين C', 'فيتامين B12', 'حمض الفوليك', 'حديد', 'كالسيوم', 'مغنيسيوم', 'زنك'],
    'أدوية الأعصاب والنفسية': ['كاربامازيبين', 'فالبروات الصوديوم', 'ليفيتيراسيتام', 'أميتريبتيلين', 'فلوكسيتين', 'سيرترالين'],
  };
  const antibioticNames = new Set(catalogByCategory['المضادات الحيوية']);
  let seededProducts = 0;
  Object.entries(catalogByCategory).forEach(([catName, items]) => {
    const cat = categoryRecords[catName];
    items.forEach((name) => {
      const existing = db.prepare('SELECT id FROM pharmacy_products WHERE pharmacy_id = ? AND name = ?').get(demoPharmacy.id, name);
      if (existing) return;
      const requiresRx = antibioticNames.has(name) ? 1 : 0; // conservative default; real requirement set by pharmacist per product
      db.prepare(
        `INSERT INTO pharmacy_products
          (id, pharmacy_id, name, category_id, price, available, requires_prescription, requires_pharmacist_review, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 1, ?, ?, datetime('now'), datetime('now'))`
      ).run(newId(), demoPharmacy.id, name, cat.id, requiresRx, requiresRx);
      seededProducts += 1;
    });
  });
  console.log(`+ seeded ${seededProducts} demo pharmacy catalog reference products (prices unset)`);

  console.log('=== FastDrop seed complete ===');
  console.log('NOTE: menu item and pharmacy product prices are intentionally NULL.');
  console.log('Restaurants/pharmacies must set real prices from their dashboards before items can be purchased.');
}

main();
