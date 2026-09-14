# Electricare — Task Manager

Task manager for **Electricare** (electrical panel manufacturer, Jaipur).
Checklist + delegation tasks, approvals, leave, MIS reports and an FMS module
backed by Google Sheets.

Node 20+ / Express / MySQL 8+.

---

## Setup

```bash
npm install
cp .env.example .env     # values bharo (neeche dekho)
npm run db:migrate
npm run db:seed-admin
npm start                # http://localhost:3000
```

### Bina database ke chalana (sirf UI dekhne ke liye)

`.env` me `DB_KIND=demo` — in-memory database, koi MySQL nahi chahiye.
Demo logins: `admin@demo.local` / `hod@demo.local` / `pc@demo.local` /
`user@demo.local`, password sabka `demo1234`.
Server band hote hi saara data mit jaata hai — production me kabhi nahi.

### Zaroori env vars

`DB_KIND` (`mysql` ya `demo`), `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`. Baaki optional hain — SMTP na ho to emails
apne aap disable ho jaate hain, Google credentials na ho to FMS module chup
rehta hai. Poori list `.env.example` me.

---

## Branding

Sab kuch `brand.json` se aata hai:

```json
{ "company": "Electricare", "product": "Task Manager",
  "logo": "logo.png", "color": "#4369fc" }
```

`#4369fc` Electricare ke logo ka apna rang hai. UI ke saare shades isi se
derive hote hain — `backend/lib/brand-palette.js` hue/saturation rakh kar
lightness ghumata hai jab tak WCAG AA contrast na mil jaye, isliye text har
jagah padha jaata rehta hai.

Do logo files hain, kyunki Electricare ka logo ek **chaudi wordmark** hai:

| file | kahan | kya |
|---|---|---|
| `frontend/logo.png` | login page | poori wordmark (351×56, transparent) |
| `frontend/logo-mark.png` | sidebar, favicon | square tile — brand-neele par safed C+bolt |

Square jagah par wordmark mat lagana: `object-fit:cover` use 34px ke chip me
kaat kar beech ka ek tukda dikha dega.

Rang badalna ho to `brand.json` ka `color` badlo, phir
`frontend/css/app.css` aur `frontend/index.html` ke `brand-color:start/end`
markers ke beech wale tokens dobara likho (dono jagah, light + dark).

---

## Layout

```
backend/server.js      routes ka bada hissa
backend/lib/           brand, google sheets, whatsapp, dates, MIS render
backend/routes/        approvals, comments, dashboard, users, week-plan, ...
data/                  db drivers (mysql + demo) aur migrations
frontend/              index.html (login), app.html (app), css/, js/
```

---

## Vercel par deploy

Repo Vercel ke liye taiyar hai:

```
api/index.js    serverless entry — backend/server.js ka app uthata hai
vercel.json     routing (har path -> app) + cron schedules
```

`backend/server.js` khud serverless-aware hai: `process.env.VERCEL` set hone
par `app.listen()` skip ho jaata hai aur background schedulers start nahi hote.

### Database — Vercel par nahi hota

Vercel sirf code chalata hai, MySQL host nahi karta. Database bahar chahiye
(Hostinger, PlanetScale, Railway, Aiven — kuch bhi), aur uska connection
string `DATABASE_URL` me. `DB_KIND=demo` production me kabhi mat lagana —
wo in-memory hai, har request par naya aur khaali.

### Vercel me env vars

Zaroori: `DB_KIND=mysql`, `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`
(deployed URL), `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

Optional: `SMTP_*` (emails), `WAUMFY_*` (WhatsApp), `GOOGLE_CREDENTIALS_B64`
(FMS / Google Sheets), `CRON_SECRET`.

`SESSION_SECRET` JWT sign karta hai — badalne par sabke login gir jaate hain.

### Cron

`vercel.json` do jobs chalata hai. Vercel Cron UTC me chalta hai, isliye
schedule UTC me likhi hai:

| job | IST | UTC (vercel.json) |
|---|---|---|
| `/api/cron/reminders` | roz 12:00 PM | `30 6 * * *` |
| `/api/cron/whatsapp` | Mon–Sat 9:30 AM | `0 4 * * 1-6` |

Dono endpoints **fail-closed** hain: `CRON_SECRET` set na ho to 503 dete hain
aur kuch nahi bhejte. Vercel har cron request me
`Authorization: Bearer $CRON_SECRET` bhejta hai, isliye wo env var zaroor set
karo — warna reminders/WhatsApp chalenge hi nahi.

⚠️ Hobby plan par cron ka time approximate hota hai (aur limit 2 jobs).
Exact time chahiye to Pro.
