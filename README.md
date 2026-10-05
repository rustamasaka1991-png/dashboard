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
- **TV rejim**: to'liq ekran, har daqiqada avtomatik yangilanadi.

## Ishga tushirish

Node.js 18+ kerak, boshqa kutubxona o'rnatish shart emas.

```bash
cp .env.example .env      # ADMIN_PASSWORD, PBX_API_KEY va h.k. ni yozing
npm start                 # http://localhost:3000
```

Integratsiyasiz ko'rib chiqish uchun namuna ma'lumot: `npm run demo` (keyin `npm start`).
Testlar: `npm test`.

Ma'lumotlar `data/db.json` faylida saqlanadi (git'ga tushmaydi) — zaxira nusxasini oling.

## Sozlash

1. **Kirish** tugmasi → `.env` dagi `ADMIN_PASSWORD`.
2. **Sozlamalar → OnlinePBX**: domen `pbx35074.onpbx.ru`, API kalit
   (panel.onlinepbx.ru → Integratsiya → API). "OnlinePBX'ni tekshirish" bugungi qo'ng'iroqlardagi
   ichki raqamlarni ko'rsatadi.
3. **Sozlamalar → amoCRM**: subdomen va uzoq muddatli token (amoMarket → Integratsiya yaratish →
   Kalitlar va kirish). "amoCRM'ni tekshirish" foydalanuvchilar ID'larini va voronkalarni ko'rsatadi.
4. **Xodimlar**: har bir xodimga OnlinePBX ichki raqami va amoCRM foydalanuvchi ID'sini yozing.
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
| Konversiya | qo'lda, yoki "avto": sotuvlar soni / real aloqa | o'rtacha |
| Sotuv summasi | qo'lda yoki amoCRM yutilgan bitimlar byudjeti | yig'indi |

Plan = kunlik plan × davrdagi ish kunlari (hafta = 6, oy = 24, yil = 24×12, oraliq = dam olish
kunlaridan tashqari kunlar). Skript va konversiya plani davr uchun o'zgarmaydi.

Reyting bali = KPI bajarilish foizlarining og'irlikli o'rtachasi (har bir KPI maksimal 150%).
Kunlik bonus: barcha 5 KPI bo'yicha kunlik planni ≥100% bajargan, ball bo'yicha 1-2-3 o'rin.
Oylik bonus: oy davomida eng ko'p sotuv summasi.

## Tuzilma

```
server.js         HTTP server + API
lib/pbx.js        OnlinePBX API klienti
lib/amo.js        amoCRM API klienti
lib/sync.js       avtomatik sinxronizatsiya
lib/stats.js      KPI, plan, reyting hisoblari
lib/db.js         JSON fayl ombori
public/           dashboard (HTML/CSS/JS)
```
