# Uz-Grow — Sotuv bo'limi KPI dashboard

Sotuv menejerlarining kunlik / haftalik / oylik / yillik KPI natijalari va reytingi.

- **Qo'ng'iroqlar** (real aloqa soni, suhbat vaqti) — **OnlinePBX**'dan avtomatik.
- **Sotuvlar** (yutilgan bitimlar soni va summasi) — **amoCRM**'dan avtomatik (ixtiyoriy).
- **Ustiga bosib tahrirlash** (admin kirgan bo'lsa): doskadagi plan, bonus, sarlavha, ish kuni va
  xodimning kunlik natijasi (skript bali, konversiya, sotuv summasi va h.k.) ustiga bosiladi, yangi qiymat
  yoziladi, Enter — saqlaydi, Esc — bekor qiladi. Xodim ustiga bosilsa — uning ma'lumotlari ochiladi.
  Qo'lda kiritilgan qiymat yashil chiziq bilan belgilanadi; bo'shatib Enter bosilsa avtomatik qiymat qaytadi.
  ("Natija kiritish" sahifasi ham qoladi — bir kunda hammaga birdan kiritish uchun.)
- **Real aloqa** yonidagi "jami N" — o'sha xodim tergan barcha qo'ng'iroqlar (javobsiz va qisqalari bilan).
  Hech kimga bog'lanmagan ichki raqamdan qo'ng'iroq bo'lsa, doska ostida ogohlantirish chiqadi.
  Qo'lda kiritilgan qiymat har doim avtomatik qiymatdan ustun.
- **Xodimlar**: qo'shish, tahrirlash (rasm, ichki raqam, amoCRM ID), faolsizlantirish, o'chirish.
- **Filtr**: Kun / Hafta / Oy / Yil / Oraliq, istalgan kun, xodimlar bo'yicha, KPI bo'yicha saralash.
  "Kun" tanlansa doskada faqat o'sha kunning natijasi va plani ko'rinadi.
- **Reyting**: KPI foizlaridan ball hisoblanadi, eng yaxshi xodim tepaga chiqadi (1-2-3 medallar,
  kunlik bonus g'oliblari, oy lideri, dinamika grafigi).
- **TV rejim**: to'liq ekran, doska ekranga o'zi sig'adi, har daqiqada avtomatik yangilanadi.
  Televizorda darhol TV rejimda ochish uchun manzil: `http://<kompyuter-IP>:3000/?tv`.

## Ishga tushirish

1. [Node.js](https://nodejs.org) ni o'rnating ("LTS" versiya). Boshqa hech narsa kerak emas.
2. **Windows:** papkadagi `start.bat` faylini ikki marta bosing.
   **macOS:** `start.command` faylini ikki marta bosing.
3. Brauzer o'zi ochiladi: http://localhost:3000 . Admin parol (birinchi marta): `admin` —
   kirgach, **Sozlamalar → Admin parol** bo'limida darhol o'zgartiring.

Qora oyna (terminal) ochiq turganda dashboard ishlaydi; uni yopsangiz, dashboard to'xtaydi.

Terminal orqali:

```bash
cp .env.example .env      # ADMIN_PASSWORD, PBX_API_KEY va h.k. ni yozing
npm start                 # http://localhost:3000
```

Integratsiyasiz ko'rib chiqish uchun namuna ma'lumot: `npm run demo` (keyin `npm start`).
Testlar: `npm test`.

Ma'lumotlar `data/db.json` faylida saqlanadi (git'ga tushmaydi). Har kuni birinchi saqlashdan oldin
oldingi holat `data/db.backup.json` ga ko'chiriladi; baribir vaqti-vaqti bilan o'zingiz ham nusxa oling.

Parol unutilsa: dasturni to'xtating, `data/db.json` dan `"auth"` qismini o'chiring — parol yana
`.env` dagi `ADMIN_PASSWORD` bo'ladi. Parolni 8 marta xato kiritgan qurilma 5 daqiqaga bloklanadi.

## Sozlash

1. **Kirish** tugmasi → `.env` dagi `ADMIN_PASSWORD`.
2. **Sozlamalar → OnlinePBX**: domen (panelning yuqori o'ng burchagida yozilgan, masalan `pbx12345.onpbx.ru`) va API kalit
   (panel.onlinepbx.ru → Integratsiya → API). "OnlinePBX'ni tekshirish" bugungi qo'ng'iroqlardagi
   ichki raqamlarni ko'rsatadi.
3. **Sozlamalar → amoCRM**: subdomen va uzoq muddatli token (amoMarket → Integratsiya yaratish →
   Kalitlar va kirish). "amoCRM'ni tekshirish" foydalanuvchilar ID'larini va voronkalarni ko'rsatadi.
4. **Xodimlar**: ro'yxat amoCRM foydalanuvchilari va OnlinePBX ichki raqamlaridan o'zi to'ladi
   (har sinxronizatsiyada yoki "amoCRM / OnlinePBX'dan yuklash" tugmasi bilan). Bitta odam ikkala
   tizimda bo'lsa, ismi bo'yicha bitta xodimga birlashtiriladi. Sotuvchi bo'lmaganlarni o'chiring —
   ular qayta qo'shilmaydi. Ismlar har xil yozilgan bo'lsa (birlashmagan bo'lsa), bittasini o'chirib,
   ikkinchisiga ichki raqam / amoCRM ID'ni qo'lda yozing.
   OnlinePBX'da ichki raqamlarga ism yozilmagan bo'lsa ham, raqam egasi amoCRM'dagi qo'ng'iroq
   yozuvlaridan (oxirgi 7 kun) avtomatik aniqlanadi; qo'ng'iroq bo'lmagan raqamlar bo'sh qoladi.
5. **Sozlamalar → Sinxronizatsiya**: o'tgan davrni (masalan, oy boshidan) bir marta yuklang.
   Keyin bugungi/kechagi ma'lumotlar har 5 daqiqada avtomatik yangilanadi.

Kalitlarni `.env` faylida ham berish mumkin (u Sozlamalardagidan ustun). Tokenlar brauzerga
hech qachon qaytarilmaydi.

## Hisoblash qoidalari

| KPI | Manba | Davr bo'yicha |
| --- | --- | --- |
| Real aloqa (gaplashilgan) | OnlinePBX: javob berilgan qo'ng'iroqlar — kiruvchi ham, chiquvchi ham (xohlasangiz Sozlamalarda eng qisqa suhbat uzunligini qo'ying) | yig'indi |
| Suhbat vaqti | OnlinePBX: `user_talk_time` yig'indisi | yig'indi |
| Skript bali | qo'lda | o'rtacha |
| Konversiya | o'zi hisoblanadi: sotuvlar soni / real aloqa (qo'lda kiritilsa — o'sha) | qo'lda: o'rtacha; avto: jami sotuv / jami aloqa |
| Sotuvlar soni | amoCRM: bitim sotuv bosqichiga ("yutildi", "to'lov qilingan", "sotildi") o'tgan kuni | yig'indi |
| Sotuv summasi | amoCRM: sotuv bosqichiga o'tgan bitimlar byudjeti (kurs sozlamasiga bo'linadi), yoki qo'lda | yig'indi |

Plan = kunlik plan × davrdagi ish kunlari (hafta = 6, oy = 24, yil = 24×12, oraliq = dam olish
kunlaridan tashqari kunlar). Skript va konversiya plani davr uchun o'zgarmaydi.

Ekrandagi foiz har doim natija / davrning to'liq plani. Davr hali tugamagan bo'lsa (masalan, oy
o'rtasi), **rang va reyting bali** bugungi kungacha o'tgan ish kunlariga nisbatan hisoblanadi:
grafik bo'yicha ketayotgan xodim yashil ko'rinadi, 100 ball = reja bajarilmoqda. Chiziqdagi
ingichka belgi — bugun qayerda bo'lish kerakligi.

Ranglar foizga qarab silliq o'zgaradi: 0% — qizil, yarmi atrofida — sariq, 100% dan boshlab — yashil.

Reyting bali = KPI bajarilish foizlarining og'irlikli o'rtachasi (har bir KPI maksimal 150%).
To'liq izoh dasturning o'zida: Sozlamalar → "Reyting bali qanday hisoblanadi".
Plani yoki og'irligi 0 qilingan KPI hisobga olinmaydi (ball va kunlik bonusda).
Kunlik bonus: hisobga olinadigan barcha KPI bo'yicha kunlik planni ≥100% bajargan, ball bo'yicha 1-2-3 o'rin.
Oylik bonus: oy davomida eng ko'p sotuv summasi.

## Vercel'ga joylash

Kompyuterda dastur `data/db.json` fayliga yozadi va fonda har 5 daqiqada sinxronlaydi. Vercel'da
doimiy fayl ham, fon jarayoni ham yo'q, shuning uchun u yerda:

- ma'lumot **Supabase**'dagi bitta jadvalda saqlanadi (bepul tarif yetadi; Upstash Redis ham mumkin);
- sinxronizatsiyani **ochiq turgan dashboard** boshlaydi (ma'lumot `syncMinutes` dan eski bo'lsa),
  bundan tashqari Vercel Cron har kuni Toshkent vaqti bilan 00:30 da bir marta ishlaydi.
  Hech kim sahifani ochmasa, kun davomida yangilanmaydi — TV'da ochiq tursa, muammo yo'q.

Qadamlar:

1. [vercel.com/new](https://vercel.com/new) → GitHub'dagi shu repozitoriyni tanlang → **Deploy**
   (sozlamalarga tegmang — Vercel o'zi "Node" deb taniydi).
2. Supabase loyihasida **SQL Editor** → quyidagini qo'yib **Run** bosing (bir marta):

   ```sql
   create table if not exists public.dashboard_kv (
     key text primary key,
     value text not null,
     updated_at timestamptz not null default now()
   );
   alter table public.dashboard_kv enable row level security;
   ```

   Jadvalda OnlinePBX / amoCRM kalitlari ham turadi, shuning uchun u RLS bilan yopiladi va hech
   qanday "policy" qo'shilmaydi: uni faqat serverdagi maxfiy kalit o'qiy oladi.
3. Supabase → **Project Settings → API Keys** → **Secret key** (`sb_secret_...`; eski ko'rinishda
   `service_role`) ni nusxalang. `sb_publishable_...` (anon) kalit to'g'ri kelmaydi — u ochiq kalit.
4. Vercel → loyiha → **Settings → Environment Variables** ga uchta o'zgaruvchi qo'shing:
   - `SUPABASE_URL` — loyiha manzili (`https://xxxx.supabase.co`)
   - `SUPABASE_SECRET_KEY` — 3-qadamdagi maxfiy kalit
   - `ADMIN_PASSWORD` — o'zingizning admin parolingiz (busiz Vercel'dagi saytda admin bo'lib kirib bo'lmaydi)
5. **Deployments** → oxirgi deploy → **Redeploy** (yangi o'zgaruvchilar kuchga kirishi uchun).
6. Kompyuterdagi ma'lumotni ko'chirish: kompyuterdagi dashboardda **Sozlamalar → Zaxira nusxa →
   yuklab olish**, keyin Vercel'dagi saytda admin bo'lib kirib **Sozlamalar → Fayldan tiklash**.
   Kalitlar, xodimlar va statistika birga ko'chadi. Fayldan keyin parol kompyuterdagi parol bo'ladi
   (agar u Sozlamalarda o'zgartirilgan bo'lsa).

Tezlik uchun Vercel funksiyasi ombor bilan bir hududda turishi kerak: `vercel.json` dagi `regions`
Supabase loyihasi hududiga mos qo'yilgan (hozir Singapur — `sin1`). Supabase boshqa hududda bo'lsa,
shu qatorni o'zgartiring (Frankfurt — `fra1`, Mumbay — `bom1`).

Upstash Redis ishlatmoqchi bo'lsangiz: 2–4-qadamlar o'rniga Vercel → **Storage → Upstash for Redis**
ni (funksiya bilan bir hududda) loyihaga ulang (`KV_REST_API_URL` va `KV_REST_API_TOKEN` o'zi qo'shiladi) va `ADMIN_PASSWORD` ni qo'ying.

Eslatma: Vercel'dagi manzilni bilgan har kim doskani ko'ra oladi (ismlar va raqamlar). O'zgartirish
uchun esa admin parol kerak. Kalit va tokenlar brauzerga hech qachon berilmaydi.

## Tuzilma

```
server.js         HTTP server + API (kompyuterda); Vercel'da shu fayl funksiya sifatida ishlaydi
vercel.json       Vercel sozlamalari (region, kunlik cron)
lib/pbx.js        OnlinePBX API klienti
lib/amo.js        amoCRM API klienti
lib/sync.js       sinxronizatsiya (fon jadvali yoki so'rov bo'yicha)
lib/roster.js     xodimlarni amoCRM / OnlinePBX'dan yuklash, takrorlarni birlashtirish
lib/stats.js      KPI, plan, reyting hisoblari
lib/db.js         ombor: JSON fayl (kompyuter) yoki Supabase / Upstash Redis (Vercel)
public/           dashboard (HTML/CSS/JS)
```
