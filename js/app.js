/* ============================================================
   متجر خيرات زمان - المنطق الرئيسي
   السلة + الطلبات + الحساب + الفواتير بالإيميل + رفع الإيصال + لوحة المسؤول
   ============================================================ */
(function () {
  'use strict';
  const C = window.KZ_CONFIG;
  const DEMO = !(C.SUPABASE_URL && C.SUPABASE_ANON_KEY);
  const PAGE = document.body.dataset.page || '';
  const EM = () => window.KZ_EMAIL || null;

  /* ---------------- helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + C.CURRENCY;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const STATUS = { pending: 'في انتظار الدفع', confirmed: 'تم التأكيد', shipped: 'تم الشحن', cancelled: 'ملغي' };

  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('تم النسخ'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('تم النسخ'); } catch (e2) { toast('انسخ يدويًا'); }
      ta.remove();
    }
  }
  async function sha256(text) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return btoa(unescape(encodeURIComponent(text))); }
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }
  function makeOrderId() {
    const d = new Date();
    const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    return 'KZ-' + ymd + '-' + String(1000 + (r[0] % 9000));
  }
  function makeToken() {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('تعذر قراءة الملف'));
      fr.onload = () => {
        if (file.type.indexOf('image/') !== 0) return resolve(fr.result);
        const img = new Image();
        img.onload = () => {
          const s = Math.min(1, 1000 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * s)); cv.height = Math.max(1, Math.round(img.height * s));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', 0.72));
        };
        img.onerror = () => resolve(fr.result);
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- cart ---------------- */
  const Cart = {
    get() { return ls.get('kz_cart', {}); },
    set(c) { ls.set('kz_cart', c); updateBadge(); },
    add(id, q = 1) { const c = this.get(); c[id] = Math.min(20, (c[id] || 0) + q); this.set(c); },
    setQty(id, q) { const c = this.get(); if (q <= 0) delete c[id]; else c[id] = Math.min(20, q); this.set(c); },
    clear() { this.set({}); },
    totals(cityId) {
      const c = this.get();
      const lines = C.PRODUCTS.filter((p) => c[p.id]).map((p) => ({ id: p.id, name: p.name, grams: p.grams, price: p.price, qty: c[p.id] }));
      const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
      const city = (C.CITIES || []).find((x) => x.id === cityId) || null;
      const shipping = lines.length && city ? Number(city.shipping) || 0 : 0;
      return { lines, subtotal, shipping, city, total: subtotal + shipping };
    },
    count() { return Object.values(this.get()).reduce((a, b) => a + b, 0); }
  };
  function updateBadge() {
    const n = Cart.count();
    $$('.cart-badge').forEach((b) => { b.textContent = n; b.classList.toggle('show', n > 0); });
  }

  /* ---------------- data layer (demo / supabase) ---------------- */
  let sb = null;
  const Data = {
    async init() {
      if (DEMO) return;
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل مكتبة قاعدة البيانات'));
        document.head.appendChild(s);
      });
      sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    },
    async user() {
      if (DEMO) return ls.get('kz_session', null);
      const { data } = await sb.auth.getUser();
      const u = data && data.user;
      return u ? { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.name) || u.email } : null;
    },
    async signUp({ name, phone, email, password }) {
      if (DEMO) {
        const users = ls.get('kz_users', []);
        email = email.toLowerCase();
        if (users.some((u) => u.email === email)) throw new Error('هذا البريد مسجل بالفعل');
        const u = { id: 'u' + Date.now(), email, name, phone, hash: await sha256(email + ':' + password) };
        users.push(u); ls.set('kz_users', users);
        ls.set('kz_session', { id: u.id, email, name });
        return { needsConfirm: false };
      }
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name, phone } } });
      if (error) throw new Error(error.message);
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) {
      if (DEMO) {
        email = email.toLowerCase();
        const h = await sha256(email + ':' + password);
        const u = ls.get('kz_users', []).find((x) => x.email === email && x.hash === h);
        if (!u) throw new Error('البريد أو كلمة المرور غير صحيحة');
        ls.set('kz_session', { id: u.id, email, name: u.name });
        return;
      }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        const m = String(error.message || '');
        if (/not confirmed/i.test(m)) throw new Error('البريد لم يتم تأكيده بعد. افتح رسالة التأكيد في بريدك، أو أكّد الحساب من لوحة Supabase.');
        if (/rate limit|too many/i.test(m) || error.status === 429) throw new Error('محاولات كثيرة، انتظر بضع دقائق ثم حاول مرة أخرى.');
        if (/invalid login/i.test(m)) throw new Error('البريد أو كلمة المرور غير صحيحة. (' + m + ')');
        throw new Error('تعذر تسجيل الدخول: ' + m);
      }
    },
    async signOut() { if (DEMO) ls.del('kz_session'); else await sb.auth.signOut(); },
    async createOrder(order) {
      if (DEMO) {
        const all = ls.get('kz_orders', []);
        if (all.some((o) => o.id === order.id)) { const e = new Error('dup'); e.code = '23505'; throw e; }
        all.unshift(order);
        if (!ls.set('kz_orders', all)) throw new Error('تعذر حفظ الطلب في المتصفح');
        return;
      }
      const { error } = await sb.from('orders').insert({
        id: order.id, user_id: order.user_id, customer: order.customer, items: order.items,
        subtotal: order.subtotal, shipping: order.shipping, total: order.total, upload_token: order.upload_token
      });
      if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
    },
    async myOrders(user) {
      if (DEMO) return ls.get('kz_orders', []).filter((o) => o.user_id === user.id);
      const { data, error } = await sb.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    async allOrders() {
      if (DEMO) return ls.get('kz_orders', []);
      const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data;
    },
    async isAdmin() {
      if (DEMO) return true;
      const { data, error } = await sb.from('admins').select('email');
      if (error) { const e = new Error(error.message || 'خطأ'); e.code = error.code; throw e; }
      return Array.isArray(data) && data.length > 0;
    },
    async setStatus(id, status) {
      if (DEMO) {
        const all = ls.get('kz_orders', []); const o = all.find((x) => x.id === id);
        if (o) { o.status = status; ls.set('kz_orders', all); } return;
      }
      const { error } = await sb.from('orders').update({ status }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    /* --- رفع الإيصال --- */
    async orderForUpload(id, token) {
      if (DEMO) {
        const o = ls.get('kz_orders', []).find((x) => x.id === id && x.upload_token === token);
        return o ? { id: o.id, total: o.total, status: o.status, receipt_at: o.receipt_at || null, customer: { name: o.customer.name } } : null;
      }
      const { data, error } = await sb.rpc('get_order_for_upload', { p_id: id, p_token: token });
      if (error) throw new Error(error.message);
      return data || null;
    },
    async uploadReceipt(order, token, file) {
      if (DEMO) {
        const dataUrl = await fileToDataUrl(file);
        const all = ls.get('kz_orders', []); const o = all.find((x) => x.id === order.id && x.upload_token === token);
        if (!o) throw new Error('الطلب غير موجود');
        o.receipt = { name: file.name, dataUrl }; o.receipt_at = new Date().toISOString();
        if (!ls.set('kz_orders', all)) throw new Error('مساحة المتصفح ممتلئة، جرّب صورة أصغر');
        return;
      }
      const safe = (file.name || 'receipt').replace(/[^\w.\-]+/g, '_').slice(-60) || 'receipt';
      const path = order.id + '/' + token + '/' + Date.now() + '-' + safe;
      const up = await sb.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw new Error('تعذر رفع الملف: ' + up.error.message);
      const r = await sb.rpc('attach_receipt', { p_id: order.id, p_token: token, p_path: path });
      if (r.error || r.data === false) throw new Error('تعذر ربط الإيصال بالطلب');
    },
    async receiptUrl(o) {
      if (DEMO) {
        if (!(o.receipt && o.receipt.dataUrl)) return null;
        const blob = await (await fetch(o.receipt.dataUrl)).blob();
        return URL.createObjectURL(blob);
      }
      if (!o.receipt_path) return null;
      const { data, error } = await sb.storage.from('receipts').createSignedUrl(o.receipt_path, 3600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    }
  };

  /* ---------------- إشعار نصي بديل (Web3Forms) ---------------- */
  async function sendEmail(subject, message, extra) {
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign({ access_key: C.WEB3FORMS_KEY, subject, from_name: C.STORE_NAME, message, botcheck: '' }, extra || {}))
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error((j.message || "email failed") + " (HTTP " + res.status + ")");
  }
  function orderEmailText(o) {
    const cur = ' ' + C.CURRENCY;
    const BIG = '━━━━━━━━━━━━━━━━━━━━━━';
    const THIN = '──────────────────────';
    const items = o.items.map((i, n) => (n + 1) + ') ' + i.name + '\n    ' + i.qty + ' × ' + i.price + cur + '  =  ' + (i.price * i.qty) + cur).join('\n');
    return [
      BIG, '🧾 فاتورة طلب جديد — ' + C.STORE_NAME, BIG,
      'رقم الطلب: ' + o.id, 'التاريخ: ' + fmtDate(o.created_at), 'الحالة: ⏳ في انتظار الدفع', '',
      '👤 بيانات العميل', THIN,
      'الاسم: ' + o.customer.name, 'الهاتف: ' + o.customer.phone, 'المدينة: ' + (o.customer.city || '-'), 'العنوان: ' + o.customer.address, (o.customer.national ? 'العنوان الوطني: ' + o.customer.national : null),
      'البريد: ' + (o.customer.email || 'غير مذكور'),
      (o.customer.notes ? 'ملاحظات: ' + o.customer.notes : null), '',
      '📦 المنتجات', THIN, items, THIN,
      'المجموع: ' + o.subtotal + cur, 'الشحن: ' + (o.shipping ? o.shipping + cur : 'مجاني'),
      '💰 الإجمالي المطلوب: ' + o.total + cur, BIG, '',
      '✅ للمسؤول: طابق المبلغ ' + o.total + cur + ' ورقم الطلب ' + o.id + ' مع الحساب، ثم أكد الطلب من لوحة الإدارة (admin.html) قبل الشحن.'
    ].filter((x) => x !== null).join('\n');
  }

  function customerEmailText(o) {
    const cur = ' ' + C.CURRENCY;
    const E = EM(); const link = E && E.siteReady() ? E.uploadUrl(o) : '(الرابط يظهر بعد رفع الموقع واكتابة SITE_URL)';
    return ['ارفع ملف الدفع لتأكيد طلبك', '', 'رقم طلبك: ' + o.id, 'المبلغ: ' + o.total + cur, '',
      'حوّل المبلغ على الحساب التالي، واحتفظ بفاتورة (لقطة شاشة) الدفع، ثم ارفعها من الرابط ليتم تأكيد الطلب:',
      'اسم المستفيد: ' + C.BANK.holder, 'الآيبان: ' + C.BANK.iban, 'اكتب رقم الطلب في ملاحظة الدفع.', '',
      'ارفع الملف: ' + link].join('\n');
  }
  function confirmedEmailText(o) {
    const cur = ' ' + C.CURRENCY;
    const items = o.items.map((i, n) => (n + 1) + ') ' + i.name + ' × ' + i.qty + ' = ' + (i.price * i.qty) + cur).join('\n');
    return ['شكرًا لزيارتك موقعنا 🌿', 'تم تأكيد طلبك وهو قيد التحضير ✅', '', 'رقم الطلب: ' + o.id, '',
      '📦 الطلب', items, 'الشحن: ' + (o.shipping ? o.shipping + cur : 'مجاني'), '💰 الإجمالي: ' + o.total + cur, '',
      'تم استلام مبلغك وطلبك قيد التحضير.'].join('\n');
  }
  async function sendConfirmedToCustomer(o) {
    const em = EM(); const email = o.customer && o.customer.email;
    if (C.CUSTOMER_EMAILS === false) return 'off';
    if (!email) return 'no-email';
    if (C.TEST_MODE) {
      await sendEmail('[تجربة - رسالة العميل بعد التأكيد] تم تأكيد طلبك ' + o.id, 'تجربة: هذه الرسالة كانت ستصل للعميل على ' + email + '\n\n' + confirmedEmailText(o), { name: o.customer.name || 'عميل', order_id: o.id });
      return 'test';
    }
    if (em && em.customerReady()) { await em.sendCustomerInvoice(o); return 'sent'; }
    return 'not-configured';
  }

  /* ---------------- shared layout ---------------- */
  const FLAG = '<img src="images/flag.jpg" alt="علم المملكة العربية السعودية" width="44" height="30">';
  function renderShell() {
    const nav = [['index.html', 'الرئيسية', 'home'], ['buy.html', 'شراء', 'buy'], ['about.html', 'من نحن', 'about'], ['contact.html', 'تواصل معنا', 'contact']];
    const h = $('#site-header');
    if (h) {
      h.className = 'site-header';
      h.innerHTML =
        '<div class="container nav-inner">' +
        '<a class="flag" href="index.html" title="المملكة العربية السعودية">' + FLAG + '</a>' +
        '<a class="brand" href="index.html">' + esc(C.STORE_NAME) + '</a>' +
        '<nav class="links" id="nav-links" aria-label="القائمة الرئيسية">' +
        nav.map((n) => '<a href="' + n[0] + '"' + (PAGE === n[2] ? ' class="active"' : '') + '>' + n[1] + '</a>').join('') + '</nav>' +
        '<div class="actions">' +
        '<a class="icon-btn" href="account.html" aria-label="حسابي"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg><span class="lbl">حسابي</span></a>' +
        '<a class="icon-btn" href="buy.html" aria-label="سلة التسوق"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L20.5 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg><span class="badge cart-badge">0</span></a>' +
        '<button class="icon-btn theme-btn" id="theme-btn" type="button" aria-label="تبديل الوضع الفاتح والداكن" title="تبديل الوضع">' +
        '<svg class="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>' +
        '<svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>' +
        '<button class="burger" id="burger" aria-label="فتح القائمة" aria-expanded="false">☰</button>' +
        '</div>' +
        '<a class="goat" href="index.html" aria-label="' + esc(C.STORE_NAME) + ' - الرئيسية"><img src="images/goat.png" alt="" width="82" height="46"></a>' +
        '</div>';
      $('#theme-btn').addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('kz_theme', next); } catch (e) { /* ignore */ }
      });
      $('#burger').addEventListener('click', (e) => {
        const open = $('#nav-links').classList.toggle('open');
        e.currentTarget.setAttribute('aria-expanded', open);
      });
    }
    const f = $('#site-footer');
    if (f) {
      f.className = 'site-footer';
      f.innerHTML =
        '<div class="container"><div class="foot">' +
        '<div><h3>' + esc(C.STORE_NAME) + '</h3><p>' + esc(C.TAGLINE) + '</p></div>' +
        '<div><h3>روابط</h3><ul>' + nav.map((n) => '<li><a href="' + n[0] + '">' + n[1] + '</a></li>').join('') + '<li><a href="account.html">حسابي</a></li><li><a href="policies.html#privacy">سياسة الخصوصية</a></li><li><a href="policies.html#returns">الاسترجاع والاستبدال</a></li><li><a href="policies.html#terms">الشروط والأحكام</a></li></ul></div>' +
        '<div><h3>تواصل</h3><ul><li><a href="contact.html">راسلنا من هنا</a></li>' +
        (C.CONTACT_EMAIL ? '<li><a href="mailto:' + esc(C.CONTACT_EMAIL) + '">' + esc(C.CONTACT_EMAIL) + '</a></li>' : '') +
        '<li>' + esc(C.ADDRESS) + '</li></ul></div>' +
        '</div><div class="copy">© ' + new Date().getFullYear() + ' ' + esc(C.STORE_NAME) + ' - جميع الحقوق محفوظة' + (C.COMMERCIAL_REG ? '<br>السجل التجاري: <span dir="ltr">' + esc(C.COMMERCIAL_REG) + '</span>' : '') + '</div></div>';
    }
    updateBadge();
  }

  function jarSVG(g) {
    const s = g >= 500 ? 1 : 0.82;
    return '<svg viewBox="0 0 120 150" width="' + Math.round(120 * s * 1.1) + '" aria-hidden="true">' +
      '<defs><linearGradient id="g' + g + '" x1="0" x2="1"><stop offset="0" stop-color="#e3b04e"/><stop offset=".5" stop-color="#f2cf7a"/><stop offset="1" stop-color="#c8963e"/></linearGradient></defs>' +
      '<rect x="22" y="14" width="76" height="22" rx="6" fill="#1f4d3a"/><rect x="26" y="36" width="68" height="8" fill="#2f6b50"/>' +
      '<rect x="14" y="44" width="92" height="98" rx="18" fill="url(#g' + g + ')"/>' +
      '<rect x="26" y="68" width="68" height="50" rx="8" fill="#fbf6ea"/>' +
      '<text x="60" y="88" text-anchor="middle" font-size="11" font-weight="800" fill="#1f4d3a" font-family="Tajawal,sans-serif">خيرات زمان</text>' +
      '<text x="60" y="108" text-anchor="middle" font-size="13" font-weight="800" fill="#8a5b13" font-family="Tajawal,sans-serif">' + (g >= 1000 ? '1 كيلو' : 'نص كيلو') + '</text></svg>';
  }

  /* ---------------- home ---------------- */
  function initHome() {
    const grid = $('#products-grid');
    if (grid) {
      grid.innerHTML = C.PRODUCTS.map((p) =>
        '<article class="card product"><div class="jar ' + (p.grams >= 1000 ? 'big' : 'small') + '"><img src="images/product.png" alt="' + esc(p.name) + '" loading="lazy"><span class="wtag"><i></i>' + (p.grams >= 1000 ? '1 كيلو' : p.grams + ' جرام') + '</span></div>' +
        '<h3>' + esc(p.name) + '</h3><p class="weight">الوزن: ' + (p.grams >= 1000 ? '1 كيلو' : p.grams + ' جرام') + '</p>' +
        '<p class="weight">' + (p.grams >= 1000 ? 'الحجم الوافي (1 كيلو): حجم البركة التوفيري للاستخدام اليومي المستمر في مطبخك.' : 'الحجم التجريبي (نصف كيلو): خيارك المثالي لتذوق النكهة واختبار الجودة بنفسك.') + '</p>' +
        '<p class="price">' + fmt(p.price) + '</p>' +
        '<div class="row"><button class="btn btn-outline" data-add="' + p.id + '">أضف للسلة</button>' +
        '<a class="btn btn-primary" href="buy.html?add=' + p.id + '">اشتري الآن</a></div></article>').join('');
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('[data-add]'); if (!b) return;
        Cart.add(b.dataset.add); toast('تمت الإضافة للسلة');
      });
    }
    const v = $('#video-box');
    if (v) {
      if (C.VIDEO_URL) v.innerHTML = '<video controls playsinline preload="metadata" src="' + esc(C.VIDEO_URL) + '"></video>';
      else v.innerHTML = '<div class="video-ph"><div class="play"></div><strong>مكان الإعلان (موشن جرافيك)</strong><span>سيتم إضافة الفيديو قريبًا</span></div>';
    }
  }

  /* ---------------- buy ---------------- */
  function initBuy() {
    const params = new URLSearchParams(location.search);
    const add = params.get('add');
    if (add && C.PRODUCTS.some((p) => p.id === add)) { Cart.add(add); history.replaceState(null, '', 'buy.html'); }

    const invBox = $('#invoice-body');
    const form = $('#order-form');
    const errBox = $('#form-error');
    let submitting = false;

    function renderInvoice() {
      const t = Cart.totals(form.city ? form.city.value : '');
      if (!t.lines.length) {
        invBox.innerHTML = '<div class="empty"><p>السلة فارغة</p><a class="btn btn-primary" href="index.html#products">تصفح المنتج</a></div>';
        $('#submit-btn').disabled = true; return;
      }
      $('#submit-btn').disabled = false;
      invBox.innerHTML =
        t.lines.map((l) =>
          '<div class="inv-line"><div class="nm"><strong>' + esc(l.name) + '</strong><small>' + fmt(l.price) + ' للوحدة</small></div>' +
          '<div class="qty"><button type="button" data-q="' + l.id + '" data-d="1" aria-label="زيادة">+</button><span>' + l.qty + '</span><button type="button" data-q="' + l.id + '" data-d="-1" aria-label="نقصان">−</button></div>' +
          '<strong>' + fmt(l.price * l.qty) + '</strong></div>').join('') +
        '<div class="inv-sum"><div class="r"><span>المجموع</span><span>' + fmt(t.subtotal) + '</span></div>' +
        '<div class="r"><span>الشحن</span><span>' + (!t.city ? 'اختر المدينة' : t.shipping ? fmt(t.shipping) : 'مجاني') + '</span></div>' +
        '<div class="r total"><span>الإجمالي</span><span>' + fmt(t.total) + '</span></div></div>';
    }
    invBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]'); if (!b) return;
      const cur = Cart.get()[b.dataset.q] || 0;
      Cart.setQty(b.dataset.q, cur + Number(b.dataset.d)); renderInvoice();
    });
    if (form.city) {
      (C.CITIES || []).forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; form.city.appendChild(o); });
      form.city.addEventListener('change', renderInvoice);
    }
    renderInvoice();

    // prefill from account
    Data.user().then((u) => { if (u) { if (!form.name.value) form.name.value = u.name || ''; if (!form.email.value) form.email.value = u.email || ''; } }).catch(() => {});

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      errBox.innerHTML = '';
      if (form.website && form.website.value) return; // honeypot
      const t = Cart.totals(form.city ? form.city.value : '');
      if (!t.lines.length) { errBox.innerHTML = '<div class="msg err">السلة فارغة</div>'; return; }
      const customer = {
        name: form.name.value.trim(), phone: form.phone.value.trim(),
        city: t.city ? t.city.name : '',
        address: form.address.value.trim(), national: (form.national ? form.national.value.trim().toUpperCase().replace(/\s+/g, '') : ''), email: form.email.value.trim(), notes: form.notes.value.trim()
      };
      const problems = [];
      if (customer.name.length < 3) problems.push('اكتب الاسم بالكامل');
      if (!t.city) problems.push('اختر المدينة');
      if (!/^\+?[0-9\s-]{8,16}$/.test(customer.phone)) problems.push('رقم التليفون غير صحيح');
      if (customer.address.length < 10) problems.push('اكتب العنوان بالتفصيل (المدينة، الحي، الشارع، رقم المبنى)');
      if (!/^[A-Z]{4}[0-9]{4}$/.test(customer.national)) problems.push('اكتب العنوان الوطني المختصر: 4 حروف إنجليزية و4 أرقام، مثل ABCD1234');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) problems.push('اكتب بريدك الإلكتروني بشكل صحيح');
      const last = ls.get('kz_last_submit', 0);
      if (Date.now() - last < 30000) problems.push('من فضلك انتظر نصف دقيقة قبل إرسال طلب جديد');
      if (problems.length) { errBox.innerHTML = '<div class="msg err">' + problems.map(esc).join('<br>') + '</div>'; return; }

      submitting = true; const btn = $('#submit-btn'); btn.disabled = true; btn.textContent = 'جاري إرسال الطلب...';
      try {
        const user = await Data.user();
        let order = null;
        for (let i = 0; i < 4 && !order; i++) {
          const cand = {
            id: makeOrderId(), upload_token: makeToken(), user_id: user ? user.id : null, customer,
            items: t.lines.map((l) => ({ id: l.id, name: l.name, qty: l.qty, price: l.price })),
            subtotal: t.subtotal, shipping: t.shipping, total: t.total, status: 'pending', created_at: new Date().toISOString()
          };
          try { await Data.createOrder(cand); order = cand; }
          catch (err) { if (err.code !== '23505') throw err; }
        }
        if (!order) throw new Error('تعذر إنشاء رقم الطلب، حاول مرة أخرى');
        ls.set('kz_last_submit', Date.now());

        // الفواتير بالإيميل (المسؤول + العميل) - لا تعطّل الطلب لو فشلت
        const em = EM(); const sent = { owner: 'none', customer: 'none' };
        await Promise.all([
          (async () => {
            if (em && em.ownerReady()) { try { await em.sendOwnerInvoice(order); sent.owner = 'html'; return; } catch (x) { /* جرّب البديل */ } }
            try { await sendEmail('طلب جديد ' + order.id + ' - ' + order.total + ' ' + C.CURRENCY, orderEmailText(order), { name: customer.name, email: customer.email, order_id: order.id }); sent.owner = 'text'; }
            catch (x) { sent.owner = 'failed'; sent.ownerErr = String((x && x.message) || x); }
          })(),
          (async () => {
            if (C.CUSTOMER_EMAILS === false) return;
            if (C.TEST_MODE) {
              try { await sendEmail('[تجربة - رسالة العميل] ارفع إيصال الدفع لطلبك رقم ' + order.id, 'تجربة: هذه الرسالة كانت ستصل للعميل على ' + customer.email + '\n\n' + customerEmailText(order), { name: customer.name, order_id: order.id }); sent.customer = 'sent'; } catch (x) { sent.customer = 'failed'; sent.custErr = String((x && x.message) || x); }
            } else if (em && em.customerReady()) { try { await em.sendUploadRequest(order); sent.customer = 'sent'; } catch (x) { sent.customer = 'failed'; } }
          })()
        ]);
        Cart.clear();
        showSuccess(order, sent);
      } catch (err) {
        errBox.innerHTML = '<div class="msg err">' + esc(err.message || 'حدث خطأ، حاول مرة أخرى') + '</div>';
        btn.disabled = false; btn.textContent = 'إتمام الطلب';
      } finally { submitting = false; }
    });

    function showSuccess(o, sent) {
      const main = $('#buy-main');
      const upLink = 'upload.html?o=' + encodeURIComponent(o.id) + '&t=' + encodeURIComponent(o.upload_token);
      let how;
      if (sent.customer === 'sent') how = 'أرسلنا لك رسالة على بريدك <span dir="ltr">' + esc(o.customer.email) + '</span> فيها رقم طلبك وزر <strong>ارفع الملف</strong>، ارفع منها لقطة شاشة الدفع ليتم تأكيد طلبك.';
      else if (sent.customer === 'failed') how = 'تعذر إرسال الرسالة على بريدك، لكن طلبك محفوظ. ارفع لقطة شاشة الدفع من الزر التالي ليتم تأكيد طلبك.';
      else how = 'بعد الدفع ارفع لقطة شاشة الدفع من الزر التالي ليتم تأكيد طلبك. تابع حالة طلبك من صفحة الرفع (يظهر فيها "تم التأكيد" عند اعتماده) أو من <a href="account.html">حسابي</a>.';
      main.innerHTML =
        '<div class="card narrow" style="text-align:center">' +
        '<h2>تم استلام طلبك ✅</h2><p>رقم طلبك:</p><div class="oid">' + esc(o.id) + '</div>' +
        '<p style="margin-top:14px">لإتمام الطلب حوّل مبلغ <strong>' + fmt(o.total) + '</strong> على حسابنا التالي، واكتب <strong>رقم الطلب</strong> في ملاحظة الدفع:</p>' +
        '<div class="bank">' +
        '<div class="row"><span>اسم المستفيد</span><span class="val ar">' + esc(C.BANK.holder) + '</span></div>' +
        '<div class="row"><span>الآيبان</span><span class="val">' + esc(C.BANK.iban) + '</span></div>' +
        '<div class="row"><span>المبلغ</span><span class="val ar">' + fmt(o.total) + '</span></div></div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn btn-outline btn-sm" id="cp-iban">نسخ الآيبان</button>' +
        '<button class="btn btn-outline btn-sm" id="cp-id">نسخ رقم الطلب</button></div>' +
        '<div class="msg info" style="text-align:right;margin-top:16px">📸 <strong>احتفظ بفاتورة (لقطة شاشة) عملية الدفع.</strong><br>' + how + '<br>🔖 احفظ رابط صفحة الرفع (أضفها للمفضلة) لتتابع حالة طلبك وتعرف متى يتم تأكيده.</div>' +
        '<a class="btn btn-primary" href="' + esc(upLink) + '">ارفع إيصال الدفع</a>' +
        (sent.owner === 'failed' ? '<div class="msg err">تم حفظ طلبك، لكن تعذر إشعار المتجر بالبريد تلقائيًا. احتفظ برقم الطلب وارفع الإيصال من الزر أعلاه.</div>' : '') +
        (C.TEST_MODE && (sent.ownerErr || sent.custErr) ? '<div class="msg err" style="text-align:right" dir="ltr">[TEST] Web3Forms error:<br>owner: ' + esc(sent.ownerErr || 'ok') + '<br>customer: ' + esc(sent.custErr || 'ok') + '</div>' : '') +
        '<p style="margin-top:18px"><a href="account.html">متابعة طلباتي</a> · <a href="index.html">العودة للرئيسية</a></p></div>';
      $('#cp-iban').onclick = () => copyText(C.BANK.iban);
      $('#cp-id').onclick = () => copyText(o.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /* ---------------- order card (account + admin) ---------------- */
  function orderCard(o, admin) {
    const c = o.customer || {};
    const hasRc = !!o.receipt_at;
    const acts = admin
      ? '<div class="acts">' +
        (hasRc ? '<button class="btn btn-outline btn-sm" data-rc="' + esc(o.id) + '">📎 عرض الإيصال</button>' : '') +
        (o.status !== 'confirmed' ? '<button class="btn btn-green btn-sm" data-id="' + esc(o.id) + '" data-st="confirmed">تم استلام المبلغ - تأكيد</button>' : '') +
        (o.status === 'confirmed' ? '<button class="btn btn-outline btn-sm" data-id="' + esc(o.id) + '" data-st="shipped">تم الشحن</button>' : '') +
        (o.status !== 'cancelled' && o.status !== 'shipped' ? '<button class="btn btn-outline btn-sm" data-id="' + esc(o.id) + '" data-st="cancelled">إلغاء</button>' : '') +
        (o.status !== 'pending' ? '<button class="btn btn-outline btn-sm" data-id="' + esc(o.id) + '" data-st="pending">إرجاع لانتظار الدفع</button>' : '') +
        '</div>' : '';
    const rcPill = hasRc ? ' <span class="pill confirmed">📎 إيصال مرفوع</span>' : (admin && o.status === 'pending' ? ' <span class="pill pending">بدون إيصال</span>' : '');
    return '<article class="card order"><div class="top"><span class="id">' + esc(o.id) + '</span>' +
      '<span><span class="pill ' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span>' + rcPill + '</span></div>' +
      '<div class="meta">' + esc(fmtDate(o.created_at)) + '</div>' +
      '<ul>' + (o.items || []).map((i) => '<li>' + esc(i.name) + ' × ' + esc(i.qty) + '</li>').join('') + '</ul>' +
      '<div><strong>الإجمالي: ' + fmt(o.total) + '</strong> <span class="meta">(' + (o.shipping ? 'شحن ' + fmt(o.shipping) : 'شحن مجاني') + ')</span></div>' +
      (admin ? '<div class="cust"><b>العميل:</b> ' + esc(c.name) + ' · <b>هاتف:</b> <span dir="ltr">' + esc(c.phone) + '</span><br><b>المدينة:</b> ' + esc(c.city || '-') + '<br><b>العنوان:</b> ' + esc(c.address) + (c.national ? '<br><b>العنوان الوطني:</b> <span dir="ltr">' + esc(c.national) + '</span>' : '') +
        (c.email ? '<br><b>البريد:</b> <span dir="ltr">' + esc(c.email) + '</span>' : '') + (c.notes ? '<br><b>ملاحظات:</b> ' + esc(c.notes) : '') + '</div>' : '') +
      acts +
      (!admin && o.upload_token && !hasRc && o.status === 'pending'
        ? '<div class="acts"><a class="btn btn-primary btn-sm" href="upload.html?o=' + encodeURIComponent(o.id) + '&t=' + encodeURIComponent(o.upload_token) + '">📎 ارفع إيصال الدفع</a></div>' : '') +
      '</article>';
  }

  /* ---------------- account ---------------- */
  async function initAccount() {
    const root = $('#account-root');
    async function render() {
      const user = await Data.user();
      if (!user) return renderAuth();
      // حساب المسؤول يدخل لوحة الإدارة مباشرة بعد تسجيل الدخول
      if (!DEMO) {
        let adm = false;
        try { adm = await Data.isAdmin(); } catch (e) { adm = false; }
        if (adm && !new URLSearchParams(location.search).has('me')) { location.replace('admin.html'); return; }
      }
      root.innerHTML = '<div class="card" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px">' +
        '<div><h2 style="margin:0">أهلاً ' + esc(user.name) + '</h2><span class="meta">' + esc(user.email) + '</span></div>' +
        '<button class="btn btn-outline btn-sm" id="logout">تسجيل الخروج</button></div>' +
        '<h2>سجل مشترياتي</h2><div id="orders" class="orders"><p class="empty">جاري التحميل...</p></div>';
      $('#logout').onclick = async () => { await Data.signOut(); render(); };
      try {
        const orders = await Data.myOrders(user);
        $('#orders').innerHTML = orders.length ? orders.map((o) => orderCard(o, false)).join('') :
          '<div class="card empty"><p>لا توجد طلبات حتى الآن.</p><a class="btn btn-primary" href="buy.html">اطلب الآن</a></div>';
      } catch (e) { $('#orders').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
    }
    function renderAuth() {
      root.innerHTML = '<div class="card narrow">' +
        '<div class="tabs"><button class="on" data-t="login">تسجيل الدخول</button><button data-t="reg">حساب جديد</button></div>' +
        '<div id="auth-msg"></div>' +
        '<form id="f-login" novalidate>' +
        '<div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr" autocomplete="email" required></div>' +
        '<div class="field"><label>كلمة المرور</label><input name="password" type="password" autocomplete="current-password" required></div>' +
        '<button class="btn btn-green" style="width:100%">دخول</button></form>' +
        '<form id="f-reg" novalidate hidden>' +
        '<div class="field"><label>الاسم</label><input name="name" autocomplete="name" required></div>' +
        '<div class="field"><label>رقم التليفون</label><input name="phone" type="tel" dir="ltr" autocomplete="tel" required></div>' +
        '<div class="field"><label>البريد الإلكتروني</label><input name="email" type="email" dir="ltr" autocomplete="email" required></div>' +
        '<div class="field"><label>كلمة المرور <span class="opt">(8 أحرف على الأقل)</span></label><input name="password" type="password" autocomplete="new-password" required minlength="8"></div>' +
        '<button class="btn btn-green" style="width:100%">إنشاء الحساب</button></form>' +
        (DEMO ? '<div class="msg info" style="margin-top:14px">وضع تجريبي: الحسابات والطلبات محفوظة في هذا المتصفح فقط.</div>' : '') + '</div>';
      const msg = (cls, t) => { $('#auth-msg').innerHTML = '<div class="msg ' + cls + '">' + esc(t) + '</div>'; };
      $$('.tabs button').forEach((b) => b.onclick = () => {
        $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
        $('#f-login').hidden = b.dataset.t !== 'login'; $('#f-reg').hidden = b.dataset.t !== 'reg'; $('#auth-msg').innerHTML = '';
      });
      $('#f-login').onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        try { await Data.signIn(f.email.value.trim(), f.password.value); render(); } catch (err) { msg('err', err.message); }
      };
      $('#f-reg').onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        if (f.name.value.trim().length < 3) return msg('err', 'اكتب الاسم بالكامل');
        if (!/^\+?[0-9\s-]{8,16}$/.test(f.phone.value.trim())) return msg('err', 'رقم التليفون غير صحيح');
        if (f.password.value.length < 8) return msg('err', 'كلمة المرور لازم تكون 8 أحرف على الأقل');
        try {
          const r = await Data.signUp({ name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), password: f.password.value });
          if (r.needsConfirm) { msg('ok', 'تم إنشاء الحساب. افتح بريدك وأكد الحساب ثم سجّل الدخول.'); } else render();
        } catch (err) { msg('err', err.message); }
      };
    }
    render();
  }

  /* ---------------- upload receipt ---------------- */
  async function initUpload() {
    const root = $('#upload-root');
    const p = new URLSearchParams(location.search);
    const id = (p.get('o') || '').trim(); const token = (p.get('t') || '').trim();
    const bad = (m) => { root.innerHTML = '<div class="card narrow"><div class="msg err">' + esc(m) + '</div><p style="text-align:center"><a href="index.html">العودة للرئيسية</a></p></div>'; };
    if (!id || !token) return bad('الرابط غير صحيح أو ناقص. استخدم الزر الموجود في فاتورة الطلب.');
    let order;
    try { order = await Data.orderForUpload(id, token); } catch (e) { return bad('تعذر التحقق من الطلب. حاول مرة أخرى بعد قليل.'); }
    if (!order) return bad('لم نجد هذا الطلب. تأكد من استخدام الرابط الأصلي من فاتورتك.');
    const cname = (order.customer && order.customer.name) || '';

    root.innerHTML = '<div class="card narrow">' +
      '<h2>رفع إيصال الدفع</h2>' +
      '<p>رقم الطلب: <span class="oid" style="font-size:1rem;padding:2px 12px">' + esc(order.id) + '</span></p>' +
      '<p>الإجمالي: <strong>' + fmt(order.total) + '</strong></p>' +
      '<p>حالة الطلب: <span class="pill ' + esc(order.status) + '">' + esc(STATUS[order.status] || order.status) + '</span></p>' +
      (order.status === 'confirmed' ? '<div class="msg ok">✅ تم تأكيد طلبك وهو قيد التحضير. شكرًا لثقتك.</div>' : '') +
      (order.status === 'shipped' ? '<div class="msg ok">🚚 تم شحن طلبك.</div>' : '') +
      (order.status === 'cancelled' ? '<div class="msg err">تم إلغاء هذا الطلب.</div>' : '') +
      (order.receipt_at ? '<div class="msg ok">تم استلام إيصال لهذا الطلب بالفعل. يمكنك رفع إيصال آخر لو لزم.</div>' : '') +
      '<form id="up-form" novalidate>' +
      '<div class="field"><label for="file">لقطة شاشة عملية الدفع (صورة أو PDF)</label><input id="file" name="file" type="file" accept="image/*,application/pdf" required></div>' +
      '<div id="up-msg"></div>' +
      '<button class="btn btn-primary" id="up-btn" style="width:100%" type="submit">ارفع الملف</button></form></div>';
    const msg = (cls, t) => { $('#up-msg').innerHTML = '<div class="msg ' + cls + '">' + esc(t) + '</div>'; };
    let busy = false;
    $('#up-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      const file = $('#file').files[0];
      if (!file) return msg('err', 'اختر الملف أولاً');
      if (!(file.type.indexOf('image/') === 0 || file.type === 'application/pdf')) return msg('err', 'الملف لازم يكون صورة أو PDF');
      if (file.size > 5 * 1024 * 1024) return msg('err', 'حجم الملف كبير، الحد الأقصى 5 ميجا');
      busy = true; const btn = $('#up-btn'); btn.disabled = true; btn.textContent = 'جاري الرفع...';
      try {
        await Data.uploadReceipt(order, token, file);
        const em = EM(); const info = { id: order.id, total: order.total, customer: { name: cname } };
        try {
          if (em && em.ownerReady()) await em.sendReceiptNotice(info);
          else await sendEmail('إيصال دفع للطلب ' + order.id,
            'وصل إيصال دفع للطلب ' + order.id + '\nالعميل: ' + cname + '\nالمبلغ: ' + order.total + ' ' + C.CURRENCY + '\nافتح لوحة الإدارة (admin.html) لمشاهدة الإيصال ثم أكد الطلب بعد مطابقة المبلغ.',
            { name: cname || 'عميل', order_id: order.id });
        } catch (x) { /* الإيصال اتحفظ حتى لو الإشعار فشل */ }
        root.innerHTML = '<div class="card narrow" style="text-align:center"><h2>تم استلام الإيصال ✅</h2>' +
          '<p>شكرًا لك. سنراجع الدفع ونؤكد طلب رقم <strong dir="ltr">' + esc(order.id) + '</strong> في أقرب وقت.</p>' +
          '<a class="btn btn-primary" href="index.html">العودة للرئيسية</a></div>';
      } catch (err) {
        msg('err', err.message || 'تعذر رفع الملف، حاول مرة أخرى');
        btn.disabled = false; btn.textContent = 'ارفع الملف';
      } finally { busy = false; }
    });
  }

  /* ---------------- admin ---------------- */
  async function initAdmin() {
    const root = $('#admin-root');
    let orders = [];
    async function gate() {
      const user = await Data.user();
      if (!DEMO && !user) {
        root.innerHTML = '<div class="card narrow"><h2>دخول المسؤول</h2><div id="am"></div><form id="f"><div class="field"><label>البريد</label><input name="email" type="email" dir="ltr" required></div>' +
          '<div class="field"><label>كلمة المرور</label><input name="password" type="password" required></div><button class="btn btn-green" style="width:100%">دخول</button></form></div>';
        $('#f').onsubmit = async (e) => { e.preventDefault(); try { await Data.signIn(e.target.email.value.trim(), e.target.password.value); gate(); } catch (err) { $('#am').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; } };
        return;
      }
      let adminOk = false, adminErr = '';
      try { adminOk = await Data.isAdmin(); } catch (ex) { adminErr = (ex.code ? ex.code + ': ' : '') + (ex.message || ex); }
      if (!adminOk) {
        root.innerHTML = '<div class="msg err">هذا الحساب ليس لديه صلاحية المسؤول.</div>' +
          '<div class="card" dir="ltr" style="text-align:left;font-size:.9rem">Logged in as: <b>' + esc(user ? user.email : '-') + '</b><br>' +
          (adminErr ? 'Database error: <b>' + esc(adminErr) + '</b>' : 'No row in admins for this email.') + '</div>' +
          '<button class="btn btn-outline" id="lo">تسجيل الخروج</button>';
        $('#lo').onclick = async () => { await Data.signOut(); gate(); }; return;
      }
      root.innerHTML = (DEMO ? '<div class="msg info">وضع تجريبي: لا توجد حماية. اربط Supabase قبل الإطلاق (راجع README).</div>' : '') +
        '<div class="admin-tools"><input id="q" placeholder="بحث برقم الطلب أو الاسم أو الهاتف"><select id="st"><option value="">كل الحالات</option>' +
        Object.keys(STATUS).map((k) => '<option value="' + k + '">' + STATUS[k] + '</option>').join('') + '</select>' +
        '<button class="btn btn-outline btn-sm" id="rf">تحديث</button>' +
        '<a class="btn btn-outline btn-sm" href="account.html?me">حسابي</a>' +
        '<button class="btn btn-outline btn-sm" id="admin-logout">تسجيل الخروج</button></div><div id="list" class="orders"></div>';
      $('#admin-logout').onclick = async () => { try { await Data.signOut(); } catch (e) { /* ignore */ } location.href = 'account.html'; };
      $('#q').oninput = draw; $('#st').onchange = draw; $('#rf').onclick = load;
      $('#list').addEventListener('click', async (e) => {
        const rcb = e.target.closest('[data-rc]');
        if (rcb) {
          const o = orders.find((x) => x.id === rcb.dataset.rc);
          const w = window.open('', '_blank');
          try {
            const u = await Data.receiptUrl(o);
            if (!u) throw new Error('لا يوجد إيصال لهذا الطلب');
            if (w) w.location.href = u; else location.href = u;
          } catch (err) { if (w) w.close(); toast(err.message); }
          return;
        }
        const b = e.target.closest('[data-st]'); if (!b) return;
        b.disabled = true;
        try {
          await Data.setStatus(b.dataset.id, b.dataset.st);
          let note = 'تم التحديث';
          if (b.dataset.st === 'confirmed') {
            const o = orders.find((x) => x.id === b.dataset.id);
            try { const r = await sendConfirmedToCustomer(o); note = r === 'sent' || r === 'test' ? 'تم التأكيد وإرسال فاتورة الشكر للعميل' : r === 'off' ? 'تم التأكيد. العميل سيرى الحالة في الموقع' : 'تم التأكيد (لم تُرسل رسالة للعميل: ' + r + ')'; }
            catch (mx) { note = 'تم التأكيد لكن تعذر إرسال الرسالة للعميل: ' + (mx.message || mx); }
          }
          await load(); toast(note);
        } catch (err) { toast(err.message); b.disabled = false; }
      });
      load();
    }
    async function load() {
      try { orders = await Data.allOrders(); draw(); } catch (e) { $('#list').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; }
    }
    function draw() {
      const q = ($('#q').value || '').trim().toLowerCase(); const st = $('#st').value;
      const rows = orders.filter((o) => (!st || o.status === st) &&
        (!q || (o.id + ' ' + (o.customer.name || '') + ' ' + (o.customer.phone || '')).toLowerCase().includes(q)));
      $('#list').innerHTML = rows.length ? rows.map((o) => orderCard(o, true)).join('') : '<div class="card empty">لا توجد طلبات</div>';
    }
    gate();
  }

  /* ---------------- contact ---------------- */
  function initContact() {
    const f = $('#contact-form'); if (!f) return;
    const box = $('#contact-msg');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); box.innerHTML = '';
      if (f.website.value) return;
      if (Date.now() - ls.get('kz_last_contact', 0) < 20000) { box.innerHTML = '<div class="msg err">انتظر لحظات قبل إرسال رسالة أخرى</div>'; return; }
      const name = f.name.value.trim(), phone = f.phone.value.trim(), message = f.message.value.trim();
      if (name.length < 2 || message.length < 5) { box.innerHTML = '<div class="msg err">اكتب الاسم والرسالة</div>'; return; }
      const btn = f.querySelector('button'); btn.disabled = true;
      try {
        await sendEmail('رسالة جديدة من ' + name, 'الاسم: ' + name + '\nالهاتف: ' + (phone || '-') + '\n\n' + message, { name, email: f.email.value.trim() || undefined });
        ls.set('kz_last_contact', Date.now()); f.reset();
        box.innerHTML = '<div class="msg ok">تم إرسال رسالتك، سنرد عليك قريبًا.</div>';
      } catch (err) { box.innerHTML = '<div class="msg err">تعذر الإرسال، حاول مرة أخرى بعد قليل.</div>'; }
      btn.disabled = false;
    });
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    renderShell();
    try { await Data.init(); } catch (e) { toast(e.message); }
    if (PAGE === 'home') initHome();
    else if (PAGE === 'buy') initBuy();
    else if (PAGE === 'account') initAccount();
    else if (PAGE === 'admin') initAdmin();
    else if (PAGE === 'contact') initContact();
    else if (PAGE === 'upload') initUpload();
  });
})();
