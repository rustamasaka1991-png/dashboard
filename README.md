# Uz-Grow — Sotuv bo'limi KPI dashboard

Sotuv menejerlarining kunlik / haftalik / oylik / yillik KPI natijalari va reytingi.

- **Qo'ng'iroqlar** (real aloqa soni, suhbat vaqti) — **OnlinePBX**'dan avtomatik.
- **Sotuvlar** (yutilgan bitimlar soni va summasi) — **amoCRM**'dan avtomatik (ixtiyoriy).
- **Skript bali, konversiya, sotuv summasi** — "Natija kiritish" sahifasida qo'lda kiritiladi.
  Qo'lda kiritilgan qiymat har doim avtomatik qiymatdan ustun.
- **Xodimlar**: qo'shish, tahrirlash (rasm, ichki raqam, amoCRM ID), faolsizlantirish, o'chirish.
- **Filtr**: Hafta / Oy / Yil / Oraliq, istalgan kun, xodimlar bo'yicha, KPI bo'yicha saralash.
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
| Real aloqa | OnlinePBX: suhbat ≥ `minTalkSec` (default 30 s) bo'lgan qo'ng'iroqlar | yig'indi |
| Suhbat vaqti | OnlinePBX: `user_talk_time` yig'indisi | yig'indi |
| Skript bali | qo'lda | o'rtacha |
| Konversiya | qo'lda, yoki "avto": sotuvlar soni / real aloqa | qo'lda: o'rtacha; avto: jami sotuv / jami aloqa |
| Sotuv summasi | qo'lda yoki amoCRM yutilgan bitimlar byudjeti | yig'indi |

Plan = kunlik plan × davrdagi ish kunlari (hafta = 6, oy = 24, yil = 24×12, oraliq = dam olish
kunlaridan tashqari kunlar). Skript va konversiya plani davr uchun o'zgarmaydi.

Ekrandagi foiz har doim natija / davrning to'liq plani. Davr hali tugamagan bo'lsa (masalan, oy
o'rtasi), **rang va reyting bali** bugungi kungacha o'tgan ish kunlariga nisbatan hisoblanadi:
grafik bo'yicha ketayotgan xodim yashil ko'rinadi, 100 ball = reja bajarilmoqda. Chiziqdagi
ingichka belgi — bugun qayerda bo'lish kerakligi.

Reyting bali = KPI bajarilish foizlarining og'irlikli o'rtachasi (har bir KPI maksimal 150%).
Plani yoki og'irligi 0 qilingan KPI hisobga olinmaydi (ball va kunlik bonusda).
Kunlik bonus: hisobga olinadigan barcha KPI bo'yicha kunlik planni ≥100% bajargan, ball bo'yicha 1-2-3 o'rin.
Oylik bonus: oy davomida eng ko'p sotuv summasi.

## Vercel'ga joylash

Kompyuterda dastur `data/db.json` fayliga yozadi va fonda har 5 daqiqada sinxronlaydi. Vercel'da
doimiy fayl ham, fon jarayoni ham yo'q, shuning uchun u yerda:

- ma'lumot **Upstash Redis**'da saqlanadi (bepul tarif yetadi);
- sinxronizatsiyani **ochiq turgan dashboard** boshlaydi (ma'lumot `syncMinutes` dan eski bo'lsa),
  bundan tashqari Vercel Cron har kuni Toshkent vaqti bilan 00:30 da bir marta ishlaydi.
  Hech kim sahifani ochmasa, kun davomida yangilanmaydi — TV'da ochiq tursa, muammo yo'q.

Qadamlar:

1. [vercel.com/new](https://vercel.com/new) → GitHub'dagi shu repozitoriyni tanlang → **Deploy**
   (sozlamalarga tegmang — Vercel o'zi "Node" deb taniydi).
2. Loyiha → **Storage** → **Create Database** → **Upstash for Redis** → region: Frankfurt →
   loyihaga ulang. (`KV_REST_API_URL` va `KV_REST_API_TOKEN` o'zi qo'shiladi.)
3. Loyiha → **Settings → Environment Variables** → `ADMIN_PASSWORD` = o'zingizning parolingiz.
   Bu qo'yilmaguncha Vercel'dagi saytda admin sifatida kirib bo'lmaydi.
4. **Deployments** → oxirgi deploy → **Redeploy** (yangi o'zgaruvchilar kuchga kirishi uchun).
5. Kompyuterdagi ma'lumotni ko'chirish: kompyuterdagi dashboardda **Sozlamalar → Zaxira nusxa →
   yuklab olish**, keyin Vercel'dagi saytda admin bo'lib kirib **Sozlamalar → Fayldan tiklash**.
   Kalitlar, xodimlar va statistika birga ko'chadi. Fayldan keyin parol kompyuterdagi parol bo'ladi
   (agar u Sozlamalarda o'zgartirilgan bo'lsa).

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
lib/db.js         ombor: JSON fayl (kompyuter) yoki Upstash Redis (Vercel)
public/           dashboard (HTML/CSS/JS)
```
