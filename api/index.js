// ══════════════════════════════════════════════════════
// VERCEL ENTRY POINT
// ══════════════════════════════════════════════════════
// Vercel har request ek serverless function ko deta hai, kisi chalte hue port
// ko nahi. backend/server.js isi ke liye taiyar hai:
//
//   • IS_SERVERLESS (process.env.VERCEL) true hone par wo app.listen() nahi
//     karta — sirf `module.exports = app` chhod deta hai.
//   • Background schedulers (setInterval) wahan start hi nahi hote, kyunki
//     response jaate hi function freeze ho jaata hai aur timer kabhi fire
//     nahi karta. Unka kaam /api/cron/* endpoints karte hain, jinhe Vercel
//     Cron time par HTTP se bulata hai (schedule vercel.json me hai).
//
// Isliye yahan sirf wahi app uthana hai. Express ka app khud (req,res) wala
// handler hai, to Vercel ise seedha bula leta hai — koi adapter nahi chahiye.
//
// vercel.json ka rewrite HAR path yahin bhejta hai (/api/... bhi aur
// /, /app.html, /logo.png jaise static bhi), kyunki static files Express ke
// express.static se hi jaati hain. Isi wajah se vercel.json me includeFiles
// se frontend/ aur fonts bundle me daale jaate hain — wo path se padhi jaati
// hain, require se nahi, isliye Vercel ka tracer unhe apne aap nahi pakadta.
module.exports = require('../backend/server');
