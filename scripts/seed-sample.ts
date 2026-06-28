/**
 * scripts/seed-sample.ts
 * Seeds 20 sample Hajj/Umrah fatawa directly into Firestore with real Gemini embeddings.
 * Run: npx ts-node --project tsconfig.scripts.json scripts/seed-sample.ts
 */

import 'dotenv/config';
import { upsertFatwa } from '../src/services/firestore.service';
import { embedText } from '../src/services/embeddings.service';

// ─── Sample Data ──────────────────────────────────────────────────────────────

const SAMPLE_FATAAWA = [
  // ── Ihram ─────────────────────────────────────────────────────────────────
  {
    category: 'Ihram',
    raw_question: 'Ihram mein perfume lagana jaiz hai?',
    shaikh_answer: 'Nahi, ihram ki halat mein perfume lagana bilkul mana hai. Agar koi jan-boojh kar perfume lagaye toh uski kaffarah dena wajib hogi — ya toh teen roz rozay rakhna, ya chhe miskeen ko khana khilana, ya ek bhed ka zabeeha karna. Khushboo ki koi bhi cheez, jaise scented soap ya deodorant, bhi istemal nahi ki ja sakti.',
    historical_frequency_count: 47,
    confidence_score: 0.98,
  },
  {
    category: 'Ihram',
    raw_question: 'Can I use unscented soap while in ihram?',
    shaikh_answer: 'Yes, unscented soap is permissible during ihram. However, any soap with fragrance or perfume is strictly prohibited. You must ensure the soap has no added scent. Similarly, unscented shampoo and unscented body wash are allowed.',
    historical_frequency_count: 31,
    confidence_score: 0.95,
  },
  {
    category: 'Ihram',
    raw_question: 'Ihram mein silay huay kapray pehenna kaisa hai?',
    shaikh_answer: 'Mard ke liye ihram ki halat mein silay huay kapray pehenna haram hai. Mard sirf do alag adhokhey kapray pahne ga — ek tehband aur ek chaadar. Agar koi mard silay huay kapray pahane bina uzer ke, toh uski kaffarah dena hogi. Auratein apne aam silay kapray mein ihram bandh sakti hain, bas munh aur haath khule rakhne chahiye.',
    historical_frequency_count: 52,
    confidence_score: 0.97,
  },
  {
    category: 'Ihram',
    raw_question: 'What is meeqat and where should I enter ihram?',
    shaikh_answer: 'Meeqat refers to the designated boundary points around Makkah beyond which no pilgrim may pass without entering the state of ihram. For those coming from Pakistan and India, the meeqat is Yalamlam (also called As-Sadiyah). If traveling by air, you must enter ihram before the plane reaches the meeqat, so prepare before boarding or when the pilot announces it.',
    historical_frequency_count: 68,
    confidence_score: 0.99,
  },
  // ── Tawaf ──────────────────────────────────────────────────────────────────
  {
    category: 'Tawaf',
    raw_question: 'Tawaf mein koi chakkar chhoot jaye toh kya karna chahiye?',
    shaikh_answer: 'Agar tawaf mein koi chakkar bhool se chhoot jaye, toh chhuta hua chakkar dobara laga kar tawaf poora karna hoga. Tawaf saat chakkar mein mukammal hota hai — agar kuch yaad na rahe toh yaqeeni taur par kam ginti par amal karo. Tawaf mukammal hone ke baad hi do rakat namaz padhna waajib hai.',
    historical_frequency_count: 38,
    confidence_score: 0.96,
  },
  {
    category: 'Tawaf',
    raw_question: 'Is it permissible to perform tawaf in a wheelchair?',
    shaikh_answer: 'Yes, it is completely permissible to perform tawaf in a wheelchair due to illness, old age, or physical inability. The tawaf of a person in a wheelchair is valid, and they receive the full reward. If someone pushes the wheelchair, that person also completes their own tawaf simultaneously.',
    historical_frequency_count: 29,
    confidence_score: 0.97,
  },
  {
    category: 'Tawaf',
    raw_question: 'Tawaf ke dauran baat karna kaisa hai?',
    shaikh_answer: 'Tawaf ke dauran dunyavi baatein karna makrooh (naa-pasandeedah) hai. Tawaf dhikr, dua aur quran tilawat ka waqt hai. Agar zaroorat ho toh thodi baat ki ja sakti hai, lekin jitna mumkin ho khaamoshi mein ibadat mein mashghool rahein. Tawaf ki halat mein bhi wazu zaroor hona chahiye.',
    historical_frequency_count: 22,
    confidence_score: 0.92,
  },
  // ── Sa'i ───────────────────────────────────────────────────────────────────
  {
    category: "Sa'i",
    raw_question: "Safa aur Marwa ke darmiyan sa'i kab karna hai?",
    shaikh_answer: "Sa'i Hajj aur Umrah dono mein wajib hai. Umrah mein tawaf ke foran baad sa'i ki jati hai. Hajj mein sa'i ya tawaf al-qudoom ke baad ya tawaf al-ifadah ke baad ki ja sakti hai. Sa'i saat phere mein mukammal hoti hai — Safa se Marwa pehla fera, Marwa se Safa doosra fera, aur is tarah saat phere Marwa par khatam hote hain.",
    historical_frequency_count: 55,
    confidence_score: 0.98,
  },
  {
    category: "Sa'i",
    raw_question: "Can sa'i be performed without wudu?",
    shaikh_answer: "According to the majority of scholars, wudu is not a strict condition for sa'i — unlike tawaf which requires wudu. However, it is strongly recommended and better to be in a state of purity while performing sa'i out of respect. If a woman experiences her menstrual cycle, she can still perform sa'i but cannot perform tawaf.",
    historical_frequency_count: 34,
    confidence_score: 0.94,
  },
  // ── Arafat ─────────────────────────────────────────────────────────────────
  {
    category: 'Waquf-e-Arafat',
    raw_question: 'Arafat mein waquf ka sahi waqt kya hai?',
    shaikh_answer: 'Waquf-e-Arafat Hajj ka sabse aham rukn hai — Hajj ka dil. Arafat mein waquf ka waqt 9 Zilhijja ko zawal (dopahar) ke baad se lekar 10 Zilhijja ki subah hone se pehle tak hai. Jis shakhs ne is waqt mein Arafat ki hududon mein kuch waqt bhi guzara, uska Hajj mukammal hua. Agar koi Arafat se chhoot jaye toh uska Hajj nahi hoga.',
    historical_frequency_count: 78,
    confidence_score: 0.99,
  },
  {
    category: 'Waquf-e-Arafat',
    raw_question: 'What duas should be recited at Arafat?',
    shaikh_answer: 'The best dua at Arafat is the one the Prophet (PBUH) taught: "La ilaha illallahu wahdahu la sharika lahu, lahul mulku wa lahul hamdu wa huwa ala kulli shayin qadeer." Also recite Surah Al-Ikhlas, send salawat upon the Prophet, seek forgiveness (istighfar), and make sincere personal duas. Arafat is the greatest opportunity for dua acceptance in the entire year.',
    historical_frequency_count: 61,
    confidence_score: 0.97,
  },
  // ── Qurbani ────────────────────────────────────────────────────────────────
  {
    category: 'Qurbani / Hady',
    raw_question: 'Hajj mein qurbani kab aur kahan karna hai?',
    shaikh_answer: '10 Zilhijja ko rami-e-jamarat ke baad qurbani (hady) karna wajib hai. Qurbani Mina mein ki jati hai ya Makkah mein bhi jaiz hai. Aaj kal Saudi government ke authorized slaughterhouses mein voucher se qurbani di ja sakti hai jo sabse asaan aur saheeh tareeqa hai. Qurbani ke baad sar mundana ya baal katana wajib hai, phir ihram khul jata hai.',
    historical_frequency_count: 71,
    confidence_score: 0.98,
  },
  {
    category: 'Qurbani / Hady',
    raw_question: 'What animals are valid for hady sacrifice in Hajj?',
    shaikh_answer: 'Valid animals for hady include sheep (at least 6 months old), goat (at least 1 year old), cow or buffalo (at least 2 years old, can be shared by up to 7 people), and camel (at least 5 years old, can be shared by up to 7 people). The animal must be free from defects such as blindness, lameness, extreme thinness, or disease.',
    historical_frequency_count: 44,
    confidence_score: 0.96,
  },
  // ── Medical ────────────────────────────────────────────────────────────────
  {
    category: 'Medical / Mazeerat',
    raw_question: 'Hajj mein beemar ho jayen toh kya karna chahiye?',
    shaikh_answer: 'Beemar hone ki soorat mein ilaaj karwana jaiz hai. Ihram ki halat mein bhi injection lena, tablet khana, drip lagwana — sab jaiz hain. Agar bimari itni shadeed ho ke Arafat nahi ja sakte, toh aap kisi aur ko apna naib (badal) bana sakte hain. Saudi Arabia mein hajj ke dauran medical services free hain — ambulance 911 par bulayein ya qareeb medical tent par jayein.',
    historical_frequency_count: 49,
    confidence_score: 0.95,
  },
  {
    category: 'Medical / Mazeerat',
    raw_question: 'Can I take medicine while in ihram for Hajj?',
    shaikh_answer: 'Yes, taking medicine while in ihram is completely permissible. Illness does not invalidate your ihram or Hajj. You may take tablets, injections, IV drips, or any necessary medical treatment. If the medicine contains fragrance (like some syrups), it is preferable to avoid such unless necessary. Seek medical help without hesitation — your health is a priority.',
    historical_frequency_count: 36,
    confidence_score: 0.96,
  },
  // ── Miscellaneous ──────────────────────────────────────────────────────────
  {
    category: 'General Hajj Rules',
    raw_question: 'Hajj badal karne ka kya hukm hai?',
    shaikh_answer: 'Hajj badal (kisi aur ki taraf se Hajj karna) jaiz hai un logon ke liye jo faut ho gaye hon aur Hajj unpar farz tha, ya jo zindagi mein Hajj karne se qasir hon (musalsal bimari ya budhapa). Hajj badal karne wale ne pehle apna Hajj farida ada kiya ho. Hadees mein aaya hai ke ek aurat ne Nabi (SAW) se poocha: Mere bap par Hajj farz tha lekin woh faut hogaye — kya main unki taraf se Hajj kar sakti hoon? Aap (SAW) ne farmaya: Haan.',
    historical_frequency_count: 33,
    confidence_score: 0.94,
  },
  {
    category: 'General Hajj Rules',
    raw_question: 'Masjid al-Haram mein namaz ka sawab kya hai?',
    shaikh_answer: 'Masjid al-Haram mein namaz ka sawab 100,000 (ek lakh) namazoun ke barabar hai. Hadees mein Nabi (SAW) ne farmaya: "Masjid al-Haram mein ek namaz baki tamam masajid mein ek lakh namaz se behtar hai." Isliye Makkah mein qiyam ke dauran zyada se zyada namazein Masjid al-Haram mein ada karne ki koshish karein.',
    historical_frequency_count: 88,
    confidence_score: 0.99,
  },
  {
    category: 'Mina / Rami',
    raw_question: 'Rami-e-jamarat ka tareeqa kya hai?',
    shaikh_answer: '10 Zilhijja ko sirf Jamarat al-Aqaba (bari jamrat) par 7 kankriyan maari jaati hain — subah se lekar raat tak. 11 aur 12 Zilhijja ko teenou jamraat (Sughra, Wusta, Aqaba) par 7-7 kankriyan maari jaati hain — zawal ke baad. Kankri chane ke daane ke brabar honi chahiye. Maarein ke waqt "Bismillah, Allahu Akbar" kahein. Agar bheed mein takleef ho toh raat ko bhi rami ki ja sakti hai.',
    historical_frequency_count: 66,
    confidence_score: 0.97,
  },
  {
    category: 'Umrah',
    raw_question: 'Umrah ki adan kya hain aur kaise ada ki jati hai?',
    shaikh_answer: 'Umrah ke arkan chaar hain: (1) Ihram — meeqat par bandha jata hai niyyat aur talbiyah ke saath, (2) Tawaf — Kaaba ke gird 7 chakkar anticlockwise, (3) Sa\'i — Safa aur Marwa ke darmiyan 7 phere, (4) Halq ya Qasr — sar mundana ya baal katna jis se ihram khul jata hai. In chaar arkan ke ada hone ke baad Umrah mukammal hoti hai.',
    historical_frequency_count: 92,
    confidence_score: 0.99,
  },
  {
    category: 'Ziyarat / Madina',
    raw_question: 'Madina mein Masjid Nabawi ki ziyarat ka tareeqa kya hai?',
    shaikh_answer: 'Masjid Nabawi pahunch kar do rakat tahiyyat al-masjid padhen. Phir Rawdah Mubarak (jannat ka baghicha) mein namaz ki koshish karein — yeh Nabi (SAW) ke ghar aur mimbar ke darmiyan ki jagah hai. Phir Nabi (SAW) ki qabr mubarak par salaam pesh karein: "As-salamu alaika ya Rasool-Allah." Umar (RA) aur Abu Bakr (RA) ki qabron par bhi salaam karein. Madina ki ziyarat Hajj ka hissa nahi — yeh mustaqil sunnat hai.',
    historical_frequency_count: 57,
    confidence_score: 0.96,
  },
];

// ─── Main Seeder ──────────────────────────────────────────────────────────────

async function seedSampleData(): Promise<void> {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║   Hajj/Umrah Fatawa — Sample Data Seeder          ║');
  console.log('║   Records to seed:', SAMPLE_FATAAWA.length, '                              ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  let success = 0;
  let failed = 0;

  for (let i = 0; i < SAMPLE_FATAAWA.length; i++) {
    const item = SAMPLE_FATAAWA[i];
    process.stdout.write(`[${i + 1}/${SAMPLE_FATAAWA.length}] Embedding: "${item.raw_question.slice(0, 50)}..."  `);

    try {
      // Generate real 768-dim embedding via Gemini text-embedding-004
      const embedding = await embedText(item.raw_question);

      // Write to Firestore
      const docId = await upsertFatwa({
        category: item.category,
        raw_question: item.raw_question,
        shaikh_answer: item.shaikh_answer,
        embedding,
        historical_frequency_count: item.historical_frequency_count,
        confidence_score: item.confidence_score,
      });

      console.log(`✅ ${docId}`);
      success++;

      // Small delay to avoid rate limits on embeddings API
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`❌ FAILED:`, err);
      failed++;
    }
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  ✅ Seeded: ${success} records`);
  console.log(`  ❌ Failed: ${failed} records`);
  console.log('══════════════════════════════════════════════════');
  console.log('\n🎉 Sample data is now in Firestore!');
  console.log('   The bot can now match questions and generate answers.\n');
}

seedSampleData().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
