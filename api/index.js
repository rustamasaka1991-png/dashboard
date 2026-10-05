'use strict';

// Vercel serverless funksiyasi: barcha /api/* so'rovlari shu yerga keladi (vercel.json'dagi rewrite).
// Statik fayllar (public/) Vercel tomonidan to'g'ridan-to'g'ri beriladi.
module.exports = require('../server').handler;
