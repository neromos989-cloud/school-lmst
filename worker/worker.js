/* Perantara (proxy) aman antara aplikasi di GitHub dan Google Gemini API.
   Kunci API disimpan di sini sebagai Secret, tidak pernah masuk ke repo GitHub.

   Variabel yang harus diisi di Cloudflare (Settings > Variables and Secrets):
   - GEMINI_API_KEY     (Secret)  AQ.Ab8RN6KTEppS3FOElAmhGM516TYYpAQnsN5iMegYczLwOiL37Q
   - TEACHER_CODE       (Secret)  roxb-z
   - ALLOWED_ORIGIN     (Text)    https://man19jkt.assessment.web.id/
   - MODEL              (Text, opsional) bawaan: gemini-1.5-flash
*/

const MAX_IMAGES = 20;        // jumlah gambar per soal
const MAX_ONE = 6000000;      // batas satu gambar (karakter base64)
const MAX_TOTAL = 24000000;   // batas total semua gambar

const SYSTEM_INSTRUCTION =
  "Kamu membantu guru memeriksa soal ujian. Jawab soal berikut dengan tepat dalam bahasa Indonesia. " +
  "Jika soal disertai gambar, baca semua gambar itu dengan teliti (angka, label, grafik, diagram) dan gunakan untuk menjawab. " +
  "Jika ada beberapa gambar, gambar diberi nomor sesuai urutan di halaman (misalnya satu gambar untuk tiap pilihan jawaban); perhatikan semuanya. " +
  "Tulis baris \"Jawaban:\" (huruf dan isi pilihan untuk pilihan ganda; ringkas untuk isian atau esai), " +
  "lalu baris \"Alasan:\" berisi langkah singkat satu sampai tiga kalimat. " +
  "Jika soal ambigu, gambar kurang jelas, atau kamu tidak yakin, tambahkan baris \"Catatan:\" tentang apa yang perlu diperiksa guru. " +
  "Jangan memakai markdown dan jangan menulis pembuka atau penutup.";

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Teacher-Code",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Metode tidak diizinkan" }, 405, cors);
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return json({ error: "Asal tidak diizinkan" }, 403, cors);
    if (request.headers.get("X-Teacher-Code") !== env.TEACHER_CODE) return json({ error: "Kode guru salah" }, 401, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Format permintaan salah" }, 400, cors); }

    const question = String(body.question || "").slice(0, 8000);
    const list = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
    const parts = [];
    let n = 0, total = 0;

    for (const image of list) {
      if (n >= MAX_IMAGES) break;
      if (
        image && typeof image.data === "string" &&
        /^image\/(png|jpeg|webp|gif)$/.test(image.media_type) &&
        image.data.length < MAX_ONE && total + image.data.length <= MAX_TOTAL
      ) {
        n++;
        total += image.data.length;
        if (list.length > 1) parts.push({ text: "Gambar " + n + ":" });
        parts.push({
          inline_data: {
            mime_type: image.media_type,
            data: image.data
          }
        });
      }
    }

    if (!question && n === 0) return json({ error: "Soal kosong" }, 400, cors);
    parts.push({ text: "Soal:\n" + (question || "(Soal ada pada gambar.)") });

    const modelName = env.MODEL || "gemini-1.5-flash";
    const apiKey = env.GEMINI_API_KEY;

    if (!apiKey) {
      return json({ error: "GEMINI_API_KEY belum dikonfigurasi pada Cloudflare Worker" }, 500, cors);
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const payload = {
      system_instruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }]
      },
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      generationConfig: {
        maxOutputTokens: 1500,
        temperature: 0.2
      }
    };

    const r = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const status = r.status === 429 ? 429 : 502;
      return json({ error: status === 429 ? "Terlalu banyak permintaan, coba sebentar lagi" : "Layanan Gemini AI sedang bermasalah" }, status, cors);
    }

    const data = await r.json();
    const textOutput = data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";

    return json({ answer: textOutput.trim() || "(AI tidak memberi jawaban)" }, 200, cors);
  }
};
