## 🕋 ShalatAI V2 : Real-Time Biometric Motion Analyzer

ShalatAI Ultra Pro adalah platform berbasis web inovatif (*Advanced Computer Vision Application*) yang memanfaatkan kamera perangkat untuk melacak, menganalisis, dan mengevaluasi kualitas gerakan fisik rukun shalat secara instan.

Aplikasi ini menggabungkan kecerdasan buatan (*AI Biometric Tracking*) dengan ilmu fiqih ibadah. Sistem mengkalkulasi sudut persendian secara presisi menggunakan rumus trigonometri hukum kosinus vektor, lalu mengujinya menggunakan sistem pengunci **Tumakninah Engine** untuk memastikan bahwa setiap rukun fisik dilakukan dengan tenang, tertib, dan tidak terburu-buru.

---

### 🌟 Keunggulan :
1. **Privasi Mutlak (100% Client-Side):** Seluruh pemrosesan video feed dilakukan langsung di memori browser pengguna (*Local Sandbox*). Tidak ada data wajah, gambar, atau video yang dikirim ke server luar.
2. **Koreksi Berbasis Sunnah:** Menggunakan pemodelan sudut ideal untuk memitigasi kesalahan umum, seperti punggung yang terlalu membungkuk atau lutut yang menekuk saat ruku'.
3. **Anti-Cheat (Validasi Tumakninah):** Sistem mendeteksi manipulasi gerakan. Pengguna tidak bisa mendapatkan status "Rakaat Sah" jika berpindah rukun secara kilat atau terburu-buru.

---

## 🛠️ Spesifikasi Logika Biomekanis & Ambang Batas (Threshold)
Sistem menggunakan matriks koordinat $XYZ$ untuk menentukan transisi antar-rukun. Berikut adalah tabel acuan kalkulasi matematika yang ditanamkan pada sistem:

| Gerakan Rukun | Sendi Utama yang Dipantau | Rentang Sudut Ideal ($^\circ$) | Logika Validasi Utama | Syarat Tumakninah (Detik) |
| :--- | :--- | :--- | :--- | :--- |
| **BERDIRI** | Lutut (*Knee Joint*) | $> 165^\circ$ | Tubuh tegak lurus, menyaring data awal rangka wajah dan bahu. | Instan (State Awal) |
| **RUKU'** | Pinggul (*Hip Joint*) & Lutut | Pinggul: $70^\circ - 115^\circ$<br>Lutut: $> 160^\circ$ | Punggung harus sejajar mendekati garis horizontal ($90^\circ$). Lutut wajib lurus (Sunnah). | $\ge 3.0$ Detik |
| **I'TIDAL** | Pinggul & Lutut | $> 165^\circ$ | Transisi vertikal naik dari posisi ruku' kembali ke posisi berdiri tegak. | $\ge 3.0$ Detik |
| **SUJUD** | Pinggul, Lutut, & Hidung | Pinggul: $< 55^\circ$<br>Lutut: $< 65^\circ$ | Titik koordinat Y (Vertikal) Hidung berada jauh di bawah koordinat Y Pinggul. | $\ge 3.0$ Detik |
| **DUDUK** | Lutut & Pergelangan Kaki | Menekuk Tajam | Posisi tubuh merendah di lantai di antara dua siklus sujud. | $\ge 3.0$ Detik |

---

## 📐 Penjelasan Rumus Matematika yang Digunakan
Untuk menghasilkan deteksi sudut yang akurat tanpa bergantung pada posisi kemiringan kamera perangkat, aplikasi ini menggunakan **Hukum Kosinus Vektor**.
Misalkan kita ingin menghitung sudut pinggul ($\theta$), kita mengambil 3 titik koordinat MediaPipe:
*   $A(x_1, y_1)$ = Bahu (*Shoulder*)
*   $B(x_2, y_2)$ = Pinggul (*Hip*) — *Sebagai Titik Sudut Tengah*
*   $C(x_3, y_3)$ = Lutut (*Knee*)
Sistem akan membentuk dua buah vektor:
$$\vec{BA} = (x_1 - x_2, y_1 - y_2)$$
$$\vec{BC} = (x_3 - x_2, y_3 - y_2)$$
Sudut $\theta$ kemudian dihitung secara real-time di dalam berkas `js/app.js` menggunakan fungsi `Math.atan2` untuk performa komputasi tercepat di browser:
```javascript
const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
let angle = Math.abs((radians * 180.0) / Math.PI);
if (angle > 180.0) angle = 360.0 - angle;
```

---

## 📂 Alur Kerja Arsitektur State Machine (Siklus Rakaat)
​Aplikasi ini menggunakan metode Deterministic Finite State Machine (FSM) berantai. Artinya, rakaat tidak akan bertambah jika pengguna melompati salah satu rukun secara acak.
```
       [ IDLE / SIAP ]
              │
              ▼
        [ BERDIRI ]
              │
              ▼
          [ RUKU' ] ───► (Cek Sudut Punggung Sunnah & Diam 3 Detik)
              │
              ▼
         [ I'TIDAL ] ──► (Kembali Tegak & Diam 3 Detik)
              │
              ▼
        [ SUJUD 1 ] ───► (Hidung di Bawah Pinggul & Diam 3 Detik)
              │
              ▼
    [ DUDUK DI ANTARA SUJUD ]
              │
              ▼
        [ SUJUD 2 ] ───► (Konfirmasi Sujud Kedua & Diam 3 Detik)
              │
              ▼
   (Kembali ke BERDIRI) ───► [ SIKLUS RAKAAT BERTAMBAH +1 ]
```

---

## ​🛡️ Panduan Posisi Kamera Kunci untuk Akurasi Maksimal

​Agar kecerdasan buatan (Computer Vision) dapat memetakan titik rangka tubuh dengan sempurna, instruksikan pengguna untuk mengikuti aturan penempatan berikut :

- ​Jarak Ideal : Letakkan perangkat sejauh 2 hingga 3 meter dari baris sejadah.
- Sudut Pandang : Kamera harus menangkap posisi tubuh secara Full-Body (dari ujung kepala hingga ujung kaki harus terlihat jelas di dalam frame).
- Pencahayaan : Hindari area backlight (cahaya terang menyorot langsung ke arah lensa kamera). Gunakan pencahayaan ruangan yang merata.
