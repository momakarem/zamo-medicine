# 🚀 Zamo API Server — دليل التشغيل

## ما أُنشئ

| ملف | الوصف |
|-----|-------|
| `src/api/server.ts` | نقطة الدخول — Fastify + CORS + Cookie + DI |
| `src/api/middleware/auth.ts` | طبقة المصادقة — Session + RLS injection |
| `src/api/routes/health.ts` | `GET /api/health` — فحص الصحة |
| `src/api/routes/auth.ts` | OTP + Session + Logout + /me |
| `src/api/routes/catalog.ts` | المنشآت + الخدمات + الأطباء (عام) |
| `src/api/routes/booking.ts` | إنشاء + عرض + تحديث الحجوزات |
| `src/api/routes/search.ts` | بحث الخدمات + المواعيد المتاحة |
| `src/db/pg.ts` | PostgreSQL adapter (node-postgres Pool) |

## الخطوات لتشغيل السيرفر

### 1. تثبيت PostgreSQL
```bash
# Windows (scoop)
scoop install postgresql

# أو Docker
docker run --name zamo-db -e POSTGRES_USER=zamo -e POSTGRES_PASSWORD=zamo -e POSTGRES_DB=zamo_dev -p 5432:5432 -d postgres:17
```

### 2. نسخ ملف البيئة
```bash
cp .env.example .env
# عدّل SESSION_SECRET و OTP_PEPPER بقيم عشوائية (32+ حرف)
```

### 3. تشغيل الترحيلات
```bash
npx tsx src/db/migrate.ts
```

### 4. تشغيل السيرفر
```bash
npm run dev:api
```

السيرفر يشتغل على `http://localhost:3000`

## API Endpoints

### عام (بدون مصادقة)
| Method | Path | الوصف |
|--------|------|-------|
| `GET` | `/api/health` | فحص الصحة |
| `GET` | `/api/facilities` | قائمة المنشآت |
| `GET` | `/api/facilities/:id` | تفاصيل المنشأة |
| `GET` | `/api/facilities/:id/services` | خدمات المنشأة |
| `GET` | `/api/practitioners/:id` | ملف الطبيب |
| `GET` | `/api/search?q=...` | بحث الخدمات |
| `GET` | `/api/slots?branchId=...&date=...` | المواعيد المتاحة |

### مصادقة
| Method | Path | الوصف |
|--------|------|-------|
| `POST` | `/api/auth/otp/request` | طلب رمز OTP |
| `POST` | `/api/auth/otp/verify` | تأكيد الرمز + جلسة |
| `GET` | `/api/auth/me` | بيانات المستخدم الحالي |
| `POST` | `/api/auth/logout` | تسجيل الخروج |

### حجوزات (تتطلب مصادقة)
| Method | Path | الوصف |
|--------|------|-------|
| `POST` | `/api/bookings` | إنشاء حجز |
| `GET` | `/api/bookings` | قائمة حجوزاتي |
| `GET` | `/api/bookings/:id` | تفاصيل الحجز |
| `PATCH` | `/api/bookings/:id/status` | تحديث حالة الحجز |

> [!NOTE]
> السيرفر يحتاج PostgreSQL شغّال. لو تبي تشغّله بدون DB، استخدم Docker.
