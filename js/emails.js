/* ============================================================
   قوالب الفواتير بالإيميل (HTML متوافق مع Gmail) + الإرسال عبر EmailJS
   - فاتورة المسؤول: لوجو ثم بيانات العميل ثم الطلب والإجمالي
   - فاتورة العميل: نفس الشكل + شكرًا + قيد التحضير + زر "ارفع الملف"
   - إشعار المسؤول عند رفع إيصال الدفع
   ============================================================ */
(function () {
  'use strict';
  const C = window.KZ_CONFIG || {};
  const E = C.EMAILJS || {};

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');
  const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + C.CURRENCY;

  // ألوان الهوية (رسالة العميل) وألوان فاتورة المسؤول (الزيتي الأصلي)
  const KB = { olive: '#143924', gold: '#d49831', brown: '#783600', cream: '#f1ead8', paper: '#ffffff', ink: '#2b2a26', muted: '#6b675c', line: '#e3d9bd', soft: '#f6efd9', outer: '#efe9d6', logoBg: '#f3ebd8', logoW: 240 };
  const KO = { olive: '#4a5a22', gold: '#c8963e', brown: '#783600', cream: '#fbf6ea', paper: '#ffffff', ink: '#2b2a26', muted: '#6b675c', line: '#e3d9bd', soft: '#f6efd9', outer: '#efe9d6', logoBg: '#f2ead8', logoW: 210 };
  let K = KB;
  const withPal = (pal, fn) => { K = pal; try { return fn(); } finally { K = KB; } };
  const FONT = "Tahoma,Arial,'Segoe UI',sans-serif";

  /* ---------- روابط ---------- */
  function base() {
    if (C.SITE_URL) return String(C.SITE_URL).replace(/\/*$/, '/');
    if (typeof location !== 'undefined' && location.protocol.indexOf('http') === 0) return location.origin + location.pathname.replace(/[^/]*$/, '');
    return '';
  }
  const siteReady = () => !!base();
  const url = (p) => base() + p;
  const uploadUrl = (o) => url('upload.html') + '?o=' + encodeURIComponent(o.id) + '&t=' + encodeURIComponent(o.upload_token || '');

  function dateText(o) {
    try { return new Date(o.created_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; }
  }

  /* ---------- قطع التصميم ---------- */
  const titleRow = (t, sub) =>
    `<tr><td align="center" style="padding:20px 24px 4px;font-family:${FONT}">` +
    `<div style="font-size:22px;font-weight:bold;color:${K.olive}">${t}</div>` +
    (sub ? `<div style="font-size:14px;color:${K.muted};margin-top:4px">${sub}</div>` : '') + `</td></tr>`;

  const metaRow = (o) =>
    `<tr><td style="padding:12px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.cream};border-radius:10px"><tr>` +
    `<td style="padding:10px 14px;font-family:${FONT}"><div style="font-size:12px;color:${K.muted}">رقم الطلب</div>` +
    `<div dir="ltr" style="text-align:right;font-size:17px;font-weight:bold;color:${K.olive}">${esc(o.id)}</div></td>` +
    `<td style="padding:10px 14px;font-family:${FONT}"><div style="font-size:12px;color:${K.muted}">التاريخ</div>` +
    `<div style="font-size:14px;font-weight:bold;color:${K.ink}">${esc(dateText(o))}</div></td>` +
    `</tr></table></td></tr>`;

  const heading = (t) =>
    `<tr><td style="padding:18px 24px 6px;font-family:${FONT}"><div style="font-size:16px;font-weight:bold;color:${K.olive};border-right:4px solid ${K.gold};padding-right:10px">${t}</div></td></tr>`;

  const infoRow = (label, valueHtml) =>
    `<tr><td style="padding:7px 0;width:30%;color:${K.muted};font-size:14px;vertical-align:top;font-family:${FONT}">${label}</td>` +
    `<td style="padding:7px 0;color:${K.ink};font-size:15px;font-weight:bold;vertical-align:top;font-family:${FONT}">${valueHtml}</td></tr>`;

  const infoBlock = (rowsHtml) =>
    `<tr><td style="padding:0 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table></td></tr>`;

  function customerRows(o) {
    const c = o.customer || {};
    let r = infoRow('الاسم', esc(c.name)) +
      infoRow('رقم التليفون', `<span dir="ltr">${esc(c.phone)}</span>`) +
      infoRow('العنوان', nl2br(c.address)) +
      (c.national ? infoRow('العنوان الوطني', `<span dir="ltr">${esc(c.national)}</span>`) : '');
    if (c.email) r += infoRow('البريد الإلكتروني', `<span dir="ltr">${esc(c.email)}</span>`);
    if (c.notes) r += infoRow('ملاحظات', nl2br(c.notes));
    return heading('بيانات العميل') + infoBlock(r);
  }

  function itemsTable(o) {
    const th = (t, i) => `<th style="background:${K.olive};color:#ffffff;padding:9px 8px;font-size:13px;text-align:${i === 0 ? 'right' : 'center'};font-family:${FONT}">${t}</th>`;
    const td = (v, extra) => `<td style="padding:11px 8px;border-bottom:1px solid ${K.line};font-size:14px;color:${K.ink};font-family:${FONT};${extra || ''}">${v}</td>`;
    const rows = (o.items || []).map((i) =>
      `<tr>${td(esc(i.name), 'text-align:right')}${td(esc(i.qty), 'text-align:center')}${td(money(i.price), 'text-align:center')}${td(money(i.price * i.qty), 'text-align:center;font-weight:bold')}</tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${['المنتج', 'الكمية', 'السعر', 'الإجمالي'].map(th).join('')}</tr>${rows}</table>`;
  }

  function totalsBlock(o) {
    const line = (l, v) => `<tr><td style="padding:5px 0;color:${K.muted};font-size:14px;font-family:${FONT}">${l}</td><td style="padding:5px 0;text-align:left;font-size:14px;color:${K.ink};font-family:${FONT}">${v}</td></tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${line('المجموع', money(o.subtotal))}${line('الشحن', o.shipping ? money(o.shipping) : 'تحدده شركة الشحن مع العميل')}</table>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;background:${K.soft};border:1px solid ${K.gold};border-radius:10px"><tr>` +
      `<td style="padding:12px 14px;font-size:17px;font-weight:bold;color:${K.olive};font-family:${FONT}">الإجمالي</td>` +
      `<td style="padding:12px 14px;text-align:left;font-size:20px;font-weight:bold;color:${K.olive};font-family:${FONT}">${money(o.total)}</td></tr></table>`;
  }

  const orderRows = (o) =>
    heading('الطلب') +
    `<tr><td style="padding:6px 24px 0">${itemsTable(o)}</td></tr>` +
    `<tr><td style="padding:12px 24px 0">${totalsBlock(o)}</td></tr>`;

  const callout = (inner) =>
    `<tr><td style="padding:16px 24px 0"><div style="background:${K.soft};border:1px dashed ${K.gold};border-radius:12px;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.9;color:${K.ink}">${inner}</div></td></tr>`;

  const button = (href, label) =>
    `<tr><td style="padding:14px 24px 0"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr>` +
    `<td align="center" style="background:${K.gold};border-radius:999px"><a href="${esc(href)}" style="display:inline-block;padding:13px 36px;color:#2b2a26;font-weight:bold;font-size:16px;text-decoration:none;font-family:${FONT}">${label}</a></td>` +
    `</tr></table></td></tr>`;

  function wrap(innerRows) {
    const logo = siteReady() ? url('images/logo.png') : '';
    const head = logo
      ? `<img src="${esc(logo)}" width="${K.logoW}" alt="${esc(C.STORE_NAME)}" style="display:block;border:0;width:${K.logoW}px;max-width:100%;height:auto;margin:0 auto">`
      : `<div style="font-size:28px;font-weight:bold;color:${K.olive};font-family:${FONT}">${esc(C.STORE_NAME)}</div>`;
    return `<div dir="rtl" style="margin:0;padding:24px 10px;background:${K.outer};font-family:${FONT};direction:rtl">` +
      `<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:${K.paper};border-radius:14px;overflow:hidden;direction:rtl;border:1px solid ${K.line}">` +
      `<tr><td align="center" bgcolor="${K.logoBg}" style="padding:14px 16px 10px;background:${K.logoBg}">${head}</td></tr>` +
      `<tr><td style="height:6px;line-height:6px;font-size:0;background:${K.olive};border-bottom:3px solid ${K.gold}">&nbsp;</td></tr>` +
      innerRows +
      `<tr><td style="height:22px;line-height:22px;font-size:0">&nbsp;</td></tr>` +
      `<tr><td align="center" style="padding:18px 24px;background:${K.olive};color:#f3ead2;font-size:13px;line-height:1.9;font-family:${FONT}">${esc(C.STORE_NAME)} — ${esc(C.TAGLINE)}` +
      (C.CONTACT_EMAIL ? `<br>${esc(C.CONTACT_EMAIL)}` : '') + `</td></tr>` +
      `</table></div>`;
  }

  /* ---------- الرسائل الثلاث ---------- */
  function ownerHTML(o) {
    return withPal(KO, () => wrap(
      titleRow('فاتورة طلب جديد', 'وصل طلب جديد من الموقع') +
      metaRow(o) + customerRows(o) + orderRows(o) +
      callout(`<strong>الحالة:</strong> في انتظار تحويل المبلغ وإيصال الدفع من العميل.<br>طابق المبلغ <strong>${money(o.total)}</strong> ورقم الطلب مع التحويل البنكي قبل التأكيد والشحن.`)
    ));
  }

  /* ============================================================
     شكل فاتورة العميل (على طراز فواتير المتاجر الحقيقية):
     شريط ملوّن + لوجو دائري + بطاقة بيضاء (بيانات الطلب، المنتجات، الملخص، الشحن) + فوتر
     ============================================================ */
  function storeInvoiceHTML(o, mode) {
    const paid = mode === 'paid';
    const c = o.customer || {};
    const logo = siteReady() ? url('images/logo.png') : '';
    const sec = (t) => `<tr><td style="padding:22px 22px 8px;font-family:${FONT};font-size:18px;font-weight:bold;color:${K.ink};text-align:right">${t}</td></tr>`;
    const para = (inner) => `<tr><td style="padding:0 22px;font-family:${FONT};font-size:15px;line-height:1.9;color:${K.ink};text-align:right">${inner}</td></tr>`;
    const sumRow = (l, v, vs) => `<tr><td style="padding:7px 0;font-family:${FONT};font-size:14px;color:${K.muted};text-align:right">${l}</td><td style="padding:7px 0;font-family:${FONT};font-size:14px;color:${K.ink};text-align:left;${vs || ''}">${v}</td></tr>`;

    const circle = logo
      ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0"><tr><td width="116" height="116" align="center" valign="middle" bgcolor="${K.logoBg}" style="width:116px;height:116px;border-radius:58px;background:${K.logoBg};overflow:hidden"><img src="${esc(logo)}" width="96" alt="${esc(C.STORE_NAME)}" style="display:block;border:0;width:96px;height:auto;margin:0 auto"></td></tr></table>`
      : `<div style="font-size:26px;font-weight:bold;color:${K.olive};font-family:${FONT}">${esc(C.STORE_NAME)}</div>`;

    const band =
      `<tr><td align="center" bgcolor="${K.gold}" style="background:${K.gold};padding:26px 16px 24px;font-family:${FONT}">${circle}` +
      `<div style="font-size:20px;font-weight:bold;color:${K.olive};margin-top:16px;line-height:1.7">شكرًا لطلبك من ${esc(C.STORE_NAME)}</div>` +
      `<div style="font-size:16px;color:${K.olive};margin-top:4px">رقم الطلب: <strong dir="ltr">${esc(o.id)}</strong></div></td></tr>`;

    const hello =
      `<tr><td style="padding:22px 22px 0;font-family:${FONT};font-size:12px;color:${K.muted};text-align:right">تاريخ إنشاء الطلب: ${esc(dateText(o))}</td></tr>` +
      `<tr><td style="padding:12px 22px 0;font-family:${FONT};font-size:20px;font-weight:bold;color:${K.olive};text-align:right">أهلاً ${esc(c.name || '')} 👋</td></tr>` +
      para(paid
        ? 'شكرًا لزيارتك موقعنا. استلمنا مبلغك وطلبك قيد التحضير، وستتواصل معك شركة الشحن لتحديد رسوم الشحن قبل التوصيل.'
        : 'استلمنا طلبك وبدأنا تجهيزه. لإتمام الطلب حوّل المبلغ على الحساب البنكي ثم ارفع صورة الحوالة من الزر أدناه.') +
      `<tr><td style="padding:12px 22px 0;font-family:${FONT};font-size:15px;color:${K.ink};text-align:right"><strong>حالة الطلب:</strong> <span style="color:${K.brown};font-weight:bold">${paid ? 'قيد التحضير' : 'جديد'}</span></td></tr>`;

    const th = (t, al) => `<td style="padding:10px 8px;background:${K.soft};font-family:${FONT};font-size:13px;color:${K.muted};text-align:${al}">${t}</td>`;
    const td = (v, al, x) => `<td style="padding:13px 8px;border-bottom:1px solid ${K.line};font-family:${FONT};font-size:14px;color:${K.ink};text-align:${al};${x || ''}">${v}</td>`;
    const rows = (o.items || []).map((i) => `<tr>${td(esc(i.name), 'right', 'font-weight:bold')}${td(esc(i.qty), 'center')}${td(money(i.price * i.qty), 'left')}</tr>`).join('');
    const products = sec('المنتجات') +
      `<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('المنتجات', 'right')}${th('الكمية', 'center')}${th('السعر', 'left')}</tr>${rows}</table></td></tr>`;

    const summary = sec('ملخص الطلب') +
      `<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
      sumRow('قيمة المنتجات', money(o.subtotal)) +
      sumRow('الشحن', o.shipping ? money(o.shipping) : 'تحدده شركة الشحن مع العميل') +
      sumRow('حالة الدفع', paid ? 'تم الدفع' : 'غير مدفوع', `font-weight:bold;color:${paid ? '#2f6b2a' : '#b3261e'}`) +
      sumRow('طريقة الدفع', 'تحويل بنكي') +
      `<tr><td colspan="2" style="padding:0"><div style="height:1px;background:${K.line};margin:6px 0"></div></td></tr>` +
      `<tr><td style="padding:8px 0;font-family:${FONT};font-size:17px;font-weight:bold;color:${K.ink};text-align:right">المجموع الكلي</td><td style="padding:8px 0;font-family:${FONT};font-size:19px;font-weight:bold;color:${K.olive};text-align:left">${money(o.total)}</td></tr>` +
      `</table></td></tr>`;

    let pay = '';
    if (!paid) {
      const link = siteReady() ? uploadUrl(o) : '';
      pay = sec('بيانات التحويل البنكي') +
        para(`اسم المستفيد: <strong>${esc(C.BANK.holder)}</strong><br>الآيبان: <strong dir="ltr">${esc(C.BANK.iban)}</strong><br>اكتب رقم الطلب <strong dir="ltr">${esc(o.id)}</strong> في ملاحظة التحويل.`) +
        (link ? `<tr><td style="padding:18px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="border:2px solid ${K.gold};border-radius:10px"><a href="${esc(link)}" style="display:block;padding:13px 10px;color:${K.olive};font-weight:bold;font-size:16px;text-decoration:none;font-family:${FONT}">رفع صورة من الحوالة البنكية</a></td></tr></table></td></tr>` +
          `<tr><td align="center" style="padding:8px 22px 0;font-family:${FONT};font-size:12px;color:${K.muted};line-height:1.8">لو الزر ما اشتغل انسخ الرابط في المتصفح:<br><span dir="ltr" style="word-break:break-all;color:${K.olive}">${esc(link)}</span></td></tr>` : '');
    }

    const ship = sec('عنوان الشحن وطريقته') + para(nl2br(c.address || '') + (c.national ? `<br>العنوان الوطني: <span dir="ltr">${esc(c.national)}</span>` : '') + `<br><span dir="ltr">${esc(c.phone || '')}</span>`);
    const notes = sec('ملاحظات') + para(c.notes ? nl2br(c.notes) : 'لا توجد ملاحظات');

    const foot =
      `<tr><td style="height:26px;line-height:26px;font-size:0">&nbsp;</td></tr>` +
      `<tr><td align="center" bgcolor="${K.cream}" style="background:${K.cream};padding:20px 16px;font-family:${FONT};font-size:12px;color:${K.muted};line-height:1.9">` +
      (logo ? `<img src="${esc(logo)}" width="64" alt="" style="display:block;border:0;width:64px;height:auto;margin:0 auto 8px">` : '') +
      `${esc(C.STORE_NAME)} — ${esc(C.TAGLINE)}<br>جميع الحقوق محفوظة ${new Date().getFullYear()} ©` +
      (C.CONTACT_EMAIL ? `<br>${esc(C.CONTACT_EMAIL)}` : '') + `</td></tr>`;

    return `<div dir="rtl" style="margin:0;padding:20px 10px;background:${K.outer};font-family:${FONT};direction:rtl">` +
      `<table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:${K.paper};border-radius:16px;overflow:hidden;direction:rtl;border:1px solid ${K.line}">` +
      band + hello + products + summary + pay + ship + notes + foot + `</table></div>`;
  }

  /* رسالة 1: تصل العميل فور الطلب (فيها زر رفع صورة الحوالة) */
  const uploadRequestHTML = (o) => storeInvoiceHTML(o, 'request');
  /* رسالة 2: تصل بعد رفع الإيصال وتأكيد المتجر (بدون زر رفع) */
  const customerHTML = (o) => storeInvoiceHTML(o, 'paid');

  function receiptHTML(o) {
    const c = o.customer || {};
    return withPal(KO, () => wrap(
      titleRow('وصل إيصال دفع جديد 📎', 'رفع العميل صورة الدفع') +
      `<tr><td style="padding:12px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${K.cream};border-radius:10px"><tr><td style="padding:10px 14px;font-family:${FONT}"><div style="font-size:12px;color:${K.muted}">رقم الطلب</div><div dir="ltr" style="text-align:right;font-size:17px;font-weight:bold;color:${K.olive}">${esc(o.id)}</div></td></tr></table></td></tr>` +
      infoBlock(infoRow('العميل', esc(c.name)) + infoRow('المبلغ المطلوب', money(o.total))) +
      callout('وصلك إيصال دفع جديد لهذا الطلب. راجع الإيصال من لوحة الإدارة وطابق المبلغ مع التحويل البنكي، ثم أكّد الطلب.')
    ));
  }

  /* ---------- الإرسال (EmailJS) ---------- */
  async function send(templateId, params) {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: E.SERVICE_ID, template_id: templateId, user_id: E.PUBLIC_KEY, template_params: params })
    });
    if (!res.ok) throw new Error('email ' + res.status);
  }
  const ready = (tpl) => !!(E.PUBLIC_KEY && E.SERVICE_ID && tpl);

  window.KZ_EMAIL = {
    ownerReady: () => ready(E.OWNER_TEMPLATE_ID),
    customerReady: () => ready(E.CUSTOMER_TEMPLATE_ID),
    siteReady, uploadUrl, ownerHTML, customerHTML, uploadRequestHTML, receiptHTML,
    sendOwnerInvoice: (o) => send(E.OWNER_TEMPLATE_ID, { subject: '🧾 طلب جديد ' + o.id + ' — ' + money(o.total), html: ownerHTML(o) }),
    sendUploadRequest: (o) => send(E.CUSTOMER_TEMPLATE_ID, { to_email: o.customer.email, to_name: o.customer.name, subject: 'ملخص طلبك رقم ' + o.id + ' — ' + C.STORE_NAME, html: uploadRequestHTML(o) }),
    sendCustomerInvoice: (o) => send(E.CUSTOMER_TEMPLATE_ID, { to_email: o.customer.email, to_name: o.customer.name, subject: 'شكرًا لطلبك رقم ' + o.id + ' — ' + C.STORE_NAME, html: customerHTML(o) }),
    sendReceiptNotice: (o) => send(E.OWNER_TEMPLATE_ID, { subject: '📎 إيصال دفع للطلب ' + o.id, html: receiptHTML(o) })
  };
})();
