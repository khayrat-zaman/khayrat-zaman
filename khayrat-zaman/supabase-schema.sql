-- ============================================================
-- قاعدة بيانات متجر خيرات زمان (Supabase)
-- الصق هذا الملف كله في: Supabase > SQL Editor > Run
-- ============================================================

-- جدول الطلبات
create table if not exists public.orders (
  id           text primary key,                       -- رقم الطلب المميز مثل KZ-20261024-4821
  user_id      uuid references auth.users(id) on delete set null,
  customer     jsonb not null,                         -- الاسم/الهاتف/العنوان/الإيميل/الملاحظات
  items        jsonb not null,
  subtotal     numeric not null check (subtotal >= 0),
  shipping     numeric not null check (shipping >= 0),
  total        numeric not null check (total >= 0),
  status       text not null default 'pending'
               check (status in ('pending','confirmed','shipped','cancelled')),
  upload_token text not null check (char_length(upload_token) >= 20),  -- سر رابط رفع الإيصال
  receipt_path text,                                   -- مسار صورة الإيصال في التخزين
  receipt_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- جدول المسؤولين (إيميلات من يحق لهم إدارة الطلبات)
create table if not exists public.admins (
  email text primary key
);

alter table public.orders enable row level security;
alter table public.admins enable row level security;

-- أي زائر يقدر يرسل طلب جديد بحالة "pending" وبدون إيصال
drop policy if exists "anyone can create pending order" on public.orders;
create policy "anyone can create pending order" on public.orders
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and receipt_path is null and receipt_at is null
    and (user_id is null or user_id = auth.uid())
  );

-- العميل يشوف طلباته فقط
drop policy if exists "users read own orders" on public.orders;
create policy "users read own orders" on public.orders
  for select to authenticated
  using (user_id = auth.uid());

-- المسؤول يشوف كل الطلبات
drop policy if exists "admins read all orders" on public.orders;
create policy "admins read all orders" on public.orders
  for select to authenticated
  using (exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')));

-- المسؤول فقط يغير حالة الطلب
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders
  for update to authenticated
  using (exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')))
  with check (exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')));

-- كل مسؤول يقرأ صفه فقط (لمعرفة هل هو مسؤول)
drop policy if exists "admin reads self" on public.admins;
create policy "admin reads self" on public.admins
  for select to authenticated
  using (email = (auth.jwt() ->> 'email'));

-- ============================================================
-- رفع الإيصالات
-- ============================================================

-- مخزن خاص للإيصالات (حد أقصى 5 ميجا، صور و PDF فقط)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','application/pdf'];

-- يتحقق أن مسار الملف = رقم الطلب/سر الطلب/اسم الملف
create or replace function public.receipt_path_ok(p_name text)
returns boolean
language sql security definer set search_path = public, storage as $$
  select exists (
    select 1 from public.orders o
    where o.id = (storage.foldername(p_name))[1]
      and o.upload_token = (storage.foldername(p_name))[2]
  );
$$;

-- الزائر يرفع فقط بمسار يحتوي سر طلبه الصحيح
drop policy if exists "upload receipt with valid token" on storage.objects;
create policy "upload receipt with valid token" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'receipts' and public.receipt_path_ok(name));

-- المسؤول فقط يشوف الإيصالات
drop policy if exists "admins read receipts" on storage.objects;
create policy "admins read receipts" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts'
         and exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email')));

-- بيانات مختصرة لصفحة الرفع (بعد التحقق من السر)
create or replace function public.get_order_for_upload(p_id text, p_token text)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'total', o.total, 'status', o.status, 'receipt_at', o.receipt_at,
    'customer', jsonb_build_object('name', o.customer ->> 'name'))
  from public.orders o
  where o.id = p_id and o.upload_token = p_token;
$$;

-- ربط الإيصال المرفوع بالطلب (بعد التحقق من السر)
create or replace function public.attach_receipt(p_id text, p_token text, p_path text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.orders
     set receipt_path = p_path, receipt_at = now()
   where id = p_id and upload_token = p_token
     and starts_with(p_path, p_id || '/' || p_token || '/');
  return found;
end;
$$;

grant execute on function public.get_order_for_upload(text, text) to anon, authenticated;
grant execute on function public.attach_receipt(text, text, text) to anon, authenticated;

-- ============================================================
-- بعد التشغيل: أضف إيميل المسؤول (غيّر الإيميل ثم شغّل السطر):
-- insert into public.admins (email) values ('admin@example.com');
-- ============================================================
   insert into public.admins (email) values ('halawanycompany@gmail.com');
   insert into public.admins (email) values ('zizoola2510@gmail.com');
