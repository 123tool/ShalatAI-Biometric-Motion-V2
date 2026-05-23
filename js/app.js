
// 1. KONFIGURASI STATE AMBANG BATAS GERAKAN (MATEMATIKA SUNNAH)
const CONFIG = {
    // Ambang batas toleransi sudut sendi (Derajat)
    ANGLES: {
        STAND_KNEE: 165,      // Lutut hampir lurus saat berdiri tegak
        RUKU_HIP_MIN: 70,     // Batas minimal penurunan pinggul ruku'
        RUKU_HIP_MAX: 115,    // Batas maksimal penurunan pinggul ruku'
        RUKU_KNEE: 160,       // Lutut harus lurus saat ruku' (Sunnah)
        SUJUD_HIP: 55,        // Pinggul menekuk tajam saat sujud
        SUJUD_KNEE: 65,       // Lutut menekuk tajam saat sujud
    },
    // Sistem Validasi Waktu Ketenangan Gerakan (Milidetik)
    TIMERS: {
        TUMAKNINAH_MS: 3000,  // Wajib diam/konsisten selama minimal 3 detik
        STABILITY_WINDOW: 500 // Toleransi noise jittering kamera (0.5 detik)
    }
};

// 2. STATE MACHINE MANAGEMENT
let currentState = 'IDLE'; // IDLE, BERDIRI, RUKU, ITIDAL, SUJUD_1, DUDUK, SUJUD_2, DUDUK_TAHIYAT
let currentRakaat = 0;
let totalTargetRakaat = 4;
let isTrackingActive = false;
let modelLoaded = false;

// Variabel Kontrol Pengukur Waktu Tumakninah
let stateStartTime = null;
let tumakninahProgress = 0;
let isTumakninahValid = false;

// Logika Transisi
let transitionCandidate = null; // { pose: string, startTime: number }

// Logika Evaluasi Catatan Sesi Ibadah
let sessionLogs = [];
let consecutiveErrors = { rukuBack: 0 };

// Referensi global untuk MediaPipe dan kamera
let poseInstance = null;
let cameraInstance = null;

// 3. SELEKTOR ELEMEN ANTARMUKA (DOM)
const DOM = {
    video: document.getElementById('webcam'),
    canvas: document.getElementById('output_canvas'),
    btnStart: document.getElementById('btn-start'),
    btnStop: document.getElementById('btn-stop'),
    selectShalat: document.getElementById('shalat-select'),
    targetRakaat: document.getElementById('target-rakaat-val'),
    currentRakaat: document.getElementById('current-rakaat-val'),
    movementState: document.getElementById('movement-state'),
    meterFill: document.getElementById('meter-fill'),
    timerText: document.getElementById('tumakninah-timer'),
    feedback: document.getElementById('live-feedback'),
    loading: document.getElementById('loading-container'),
    overlayPose: document.getElementById('overlay-pose'),
    overlayBack: document.getElementById('overlay-back-angle'),
    toggleAudio: document.getElementById('toggle-audio'),
    // Modal Rapor Elements
    modal: document.getElementById('report-modal'),
    btnCloseReport: document.getElementById('btn-close-report'),
    repJenis: document.getElementById('rep-jenis'),
    repRakaat: document.getElementById('rep-rakaat'),
    repAkurasi: document.getElementById('rep-akurasi'),
    repCatatan: document.getElementById('rep-catatan')
};

const ctx = DOM.canvas.getContext('2d');

// 4. AUDIO TEXT-TO-SPEECH (TTS) ENGINE
const AudioEngine = {
    speak(text) {
        if (!DOM.toggleAudio.checked) return; // Jika toggle off, jangan bersuara
        
        // Hentikan suara yang sedang berjalan agar tidak tumpang tindih
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID'; // Set bahasa Indonesia
        utterance.rate = 1.0;    // Kecepatan normal
        utterance.pitch = 1.0;   // Nada standar artikulatif
        window.speechSynthesis.speak(utterance);
    }
};

// 5. UPDATE TAMPILAN ANTARMUKA GERAKAN
function updateStateUI(newState) {
    if (currentState === newState) return;
    
    // Hapus kelas warna state yang lama
    DOM.movementState.className = 'badge-state';
    DOM.movementState.innerText = newState;
    
    // Berikan kelas warna baru sesuai hirarki biomekanis
    switch(newState) {
        case 'BERDIRI': DOM.movementState.classList.add('state-berdiri'); break;
        case 'RUKU': DOM.movementState.classList.add('state-ruku'); break;
        case 'ITIDAL': DOM.movementState.classList.add('state-itidal'); break;
        case 'SUJUD_1':
        case 'SUJUD_2': DOM.movementState.classList.add('state-sujud'); break;
        case 'DUDUK':
        case 'DUDUK_TAHIYAT': DOM.movementState.classList.add('state-duduk'); break;
        default: DOM.movementState.classList.add('state-idle');
    }
    
    currentState = newState;
    DOM.overlayPose.innerText = `State: ${newState}`;
    stateStartTime = null; // Reset stopwatch tumakninah
    isTumakninahValid = false;
    tumakninahProgress = 0;
    DOM.meterFill.style.width = '0%';
    DOM.timerText.textContent = '0.0s';
}

// 6. FUNGSI LOGIKA LIVE FEEDBACK & KOREKSI
function pushFeedback(message, type = 'normal') {
    DOM.feedback.className = 'feedback-box';
    DOM.feedback.innerText = message;
    
    if (type === 'warning') {
        DOM.feedback.classList.add('warning-status');
    } else if (type === 'success') {
        DOM.feedback.classList.add('success-status');
    } else {
        DOM.feedback.classList.add('normal');
    }
    
    // Catat ke log sesi
    sessionLogs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// 7. TRIGONOMETRI VEKTOR (MENGHITUNG SUDUT 3 TITIK RANGKA)
function calculateAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 0;
    const radians = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    
    if (angle > 180.0) {
        angle = 360.0 - angle;
    }
    return angle;
}

// 8. KLASIFIKASI POSE BERDASARKAN SUDUT SENDI
function classifyPose(landmarks) {
    // Coba sisi kiri dulu
    const leftShoulder = landmarks[11];
    const leftHip = landmarks[23];
    const leftKnee = landmarks[25];
    const leftAnkle = landmarks[27];
    
    if (leftShoulder && leftHip && leftKnee && leftAnkle) {
        return classifyFromKeypoints(leftShoulder, leftHip, leftKnee, leftAnkle);
    }
    
    // Fallback ke sisi kanan
    const rightShoulder = landmarks[12];
    const rightHip = landmarks[24];
    const rightKnee = landmarks[26];
    const rightAnkle = landmarks[28];
    if (rightShoulder && rightHip && rightKnee && rightAnkle) {
        return classifyFromKeypoints(rightShoulder, rightHip, rightKnee, rightAnkle);
    }
    
    return 'STANDING'; // default
}

function classifyFromKeypoints(shoulder, hip, knee, ankle) {
    const hipKneeAnkleAngle = calculateAngle(hip, knee, ankle);
    const shoulderHipKneeAngle = calculateAngle(shoulder, hip, knee);
    
    // Deteksi berdasarkan sudut
    if (hipKneeAnkleAngle > CONFIG.ANGLES.STAND_KNEE && shoulderHipKneeAngle > 160) {
        return 'STANDING';
    } else if (shoulderHipKneeAngle >= CONFIG.ANGLES.RUKU_HIP_MIN && 
               shoulderHipKneeAngle <= CONFIG.ANGLES.RUKU_HIP_MAX &&
               hipKneeAnkleAngle > CONFIG.ANGLES.RUKU_KNEE) {
        return 'RUKU';
    } else if (shoulderHipKneeAngle < CONFIG.ANGLES.SUJUD_HIP && 
               hipKneeAnkleAngle < CONFIG.ANGLES.SUJUD_KNEE) {
        return 'SUJUD';
    } else if (shoulderHipKneeAngle > 70 && shoulderHipKneeAngle < 120 &&
               hipKneeAnkleAngle > 60 && hipKneeAnkleAngle < 120) {
        return 'DUDUK';
    } else {
        // Jika ragu, anggap berdiri sebagai default
        return 'STANDING';
    }
}

// 9. VALIDASI APAKAH POSE MASIH SESUAI DENGAN STATE TERTENTU
function checkStateCondition(landmarks, state) {
    // Pilih keypoints sisi kiri, fallback kanan
    let shoulder = landmarks[11];
    let hip = landmarks[23];
    let knee = landmarks[25];
    let ankle = landmarks[27];
    
    if (!shoulder || !hip || !knee || !ankle) {
        shoulder = landmarks[12];
        hip = landmarks[24];
        knee = landmarks[26];
        ankle = landmarks[28];
    }
    
    if (!shoulder || !hip || !knee || !ankle) return false;
    
    const hipKneeAnkleAngle = calculateAngle(hip, knee, ankle);
    const shoulderHipKneeAngle = calculateAngle(shoulder, hip, knee);
    
    switch(state) {
        case 'BERDIRI':
        case 'ITIDAL':
            return hipKneeAnkleAngle > CONFIG.ANGLES.STAND_KNEE && shoulderHipKneeAngle > 160;
        case 'RUKU':
            return shoulderHipKneeAngle >= CONFIG.ANGLES.RUKU_HIP_MIN && 
                   shoulderHipKneeAngle <= CONFIG.ANGLES.RUKU_HIP_MAX &&
                   hipKneeAnkleAngle > CONFIG.ANGLES.RUKU_KNEE;
        case 'SUJUD_1':
        case 'SUJUD_2':
            return shoulderHipKneeAngle < CONFIG.ANGLES.SUJUD_HIP && 
                   hipKneeAnkleAngle < CONFIG.ANGLES.SUJUD_KNEE;
        case 'DUDUK':
        case 'DUDUK_TAHIYAT':
            return shoulderHipKneeAngle > 70 && shoulderHipKneeAngle < 120 &&
                   hipKneeAnkleAngle > 60 && hipKneeAnkleAngle < 120;
        default: 
            return false;
    }
}

// 10. HANDLE TRANSISI STATE BERDASAR URUTAN GERAKAN SHALAT
function handleTransitions(poseClass, landmarks) {
    // Tentukan expected next pose class
    let expectedPose = null;
    switch(currentState) {
        case 'IDLE': expectedPose = 'STANDING'; break;
        case 'BERDIRI': expectedPose = 'RUKU'; break;
        case 'RUKU': expectedPose = 'STANDING'; break; // menuju ITIDAL
        case 'ITIDAL': expectedPose = 'SUJUD'; break;
        case 'SUJUD_1': expectedPose = 'DUDUK'; break;
        case 'DUDUK': expectedPose = 'SUJUD'; break; // menuju SUJUD_2
        case 'SUJUD_2': 
            if (currentRakaat < totalTargetRakaat) {
                expectedPose = 'STANDING'; // kembali berdiri
            } else {
                expectedPose = 'DUDUK'; // tasyahud akhir
            }
            break;
        // DUDUK_TAHIYAT tidak punya transisi berikutnya
        default: expectedPose = null;
    }
    
    if (expectedPose && poseClass === expectedPose) {
        // Mulai atau pertahankan kandidat transisi
        if (!transitionCandidate || transitionCandidate.pose !== poseClass) {
            transitionCandidate = { pose: poseClass, startTime: performance.now() };
        } else {
            const elapsed = performance.now() - transitionCandidate.startTime;
            if (elapsed >= CONFIG.TIMERS.STABILITY_WINDOW) {
                performTransition(poseClass);
                transitionCandidate = null;
            }
        }
    } else {
        // Reset kandidat jika pose tidak sesuai harapan
        transitionCandidate = null;
    }
}

function performTransition(poseClass) {
    switch(currentState) {
        case 'IDLE':
            if (poseClass === 'STANDING') {
                updateStateUI('BERDIRI');
                pushFeedback('🕌 Mulai shalat. Berdiri tegak.', 'normal');
            }
            break;
        case 'BERDIRI':
            if (poseClass === 'RUKU') {
                updateStateUI('RUKU');
                pushFeedback('Ruku\' dengan punggung rata.', 'normal');
                AudioEngine.speak('Ruku');
            }
            break;
        case 'RUKU':
            if (poseClass === 'STANDING') {
                updateStateUI('ITIDAL');
                pushFeedback('I\'tidal, berdiri sempurna.', 'normal');
                AudioEngine.speak('I\'tidal');
            }
            break;
        case 'ITIDAL':
            if (poseClass === 'SUJUD') {
                updateStateUI('SUJUD_1');
                pushFeedback('Sujud pertama.', 'normal');
                AudioEngine.speak('Sujud');
            }
            break;
        case 'SUJUD_1':
            if (poseClass === 'DUDUK') {
                updateStateUI('DUDUK');
                pushFeedback('Duduk di antara dua sujud.', 'normal');
                AudioEngine.speak('Duduk');
            }
            break;
        case 'DUDUK':
            if (poseClass === 'SUJUD') {
                updateStateUI('SUJUD_2');
                pushFeedback('Sujud kedua.', 'normal');
                AudioEngine.speak('Sujud kedua');
            }
            break;
        case 'SUJUD_2':
            if (poseClass === 'STANDING' && currentRakaat < totalTargetRakaat) {
                currentRakaat++;
                DOM.currentRakaat.textContent = currentRakaat;
                updateStateUI('BERDIRI');
                pushFeedback(`Rakaat ${currentRakaat} dimulai.`, 'normal');
                AudioEngine.speak(`Rakaat ${currentRakaat}`);
            } else if (poseClass === 'DUDUK' && currentRakaat >= totalTargetRakaat) {
                updateStateUI('DUDUK_TAHIYAT');
                pushFeedback('Duduk tasyahud akhir.', 'normal');
                AudioEngine.speak('Tasyahud akhir');
            }
            break;
        // Tidak ada transisi dari DUDUK_TAHIYAT (akan diselesaikan oleh tumakninah)
    }
}

// 11. PEMROSESAN UTAMA SETIAP FRAME
function processPose(landmarks) {
    if (!isTrackingActive) return;
    
    const poseClass = classifyPose(landmarks);
    DOM.overlayPose.textContent = `State: ${currentState} (${poseClass})`;
    
    // Update sudut punggung untuk HUD (shoulder-hip vertical)
    const shoulder = landmarks[11] || landmarks[12];
    const hip = landmarks[23] || landmarks[24];
    if (shoulder && hip) {
        const backAngle = calculateAngle(
            {x: shoulder.x, y: shoulder.y - 0.5}, // titik di atas bahu
            shoulder,
            hip
        );
        DOM.overlayBack.textContent = `Sudut Punggung: ${Math.round(backAngle)}°`;
    }
    
    // Jalankan logika transisi
    handleTransitions(poseClass, landmarks);
    
    // Evaluasi tumakninah jika tidak dalam IDLE
    if (currentState !== 'IDLE') {
        const inCorrectPose = checkStateCondition(landmarks, currentState);
        if (inCorrectPose) {
            if (stateStartTime === null) {
                stateStartTime = performance.now();
            }
            const elapsed = performance.now() - stateStartTime;
            const progress = Math.min(elapsed / CONFIG.TIMERS.TUMAKNINAH_MS, 1);
            tumakninahProgress = progress;
            DOM.meterFill.style.width = (progress * 100) + '%';
            DOM.timerText.textContent = (elapsed / 1000).toFixed(1) + 's';
            
            if (elapsed >= CONFIG.TIMERS.TUMAKNINAH_MS && !isTumakninahValid) {
                isTumakninahValid = true;
                AudioEngine.speak(`${currentState.replace('_', ' ')} sah.`);
                pushFeedback(`✅ Tumakninah ${currentState} tercapai.`, 'success');
                
                // Jika ini DUDUK_TAHIYAT, langsung akhiri sesi
                if (currentState === 'DUDUK_TAHIYAT') {
                    endSession();
                }
                // Jika ini SUJUD_2 dan tumakninah valid, jangan tambah rakaat di sini
                // karena sudah dihitung saat transisi ke BERDIRI
            }
        } else {
            // Posisi tidak sesuai, reset timer tumakninah
            if (stateStartTime !== null) {
                pushFeedback(`⚠️ Posisi ${currentState} tidak sempurna. Pertahankan posisi yang benar.`, 'warning');
                AudioEngine.speak('Posisi tidak tepat, perbaiki.');
            }
            stateStartTime = null;
            isTumakninahValid = false;
            tumakninahProgress = 0;
            DOM.meterFill.style.width = '0%';
            DOM.timerText.textContent = '0.0s';
        }
    }
}

// 12. MENGAKHIRI SESI DAN MENAMPILKAN LAPORAN
function endSession() {
    if (!isTrackingActive) return;
    isTrackingActive = false;
    
    // Hentikan kamera dan MediaPipe
    if (cameraInstance) {
        cameraInstance.stop();
        cameraInstance = null;
    }
    if (DOM.video.srcObject) {
        DOM.video.srcObject.getTracks().forEach(track => track.stop());
        DOM.video.srcObject = null;
    }
    
    // Sembunyikan loading kalau masih ada
    DOM.loading.classList.add('hidden');
    
    // Isi data laporan
    const shalatName = DOM.selectShalat.options[DOM.selectShalat.selectedIndex].text;
    DOM.repJenis.textContent = shalatName;
    DOM.repRakaat.textContent = `${currentRakaat} / ${totalTargetRakaat}`;
    
    // Hitung akurasi sederhana: persentase rakaat yang terselesaikan
    const accuracy = totalTargetRakaat > 0 ? (currentRakaat / totalTargetRakaat) * 100 : 0;
    DOM.repAkurasi.textContent = `${accuracy.toFixed(1)}%`;
    
    // Tampilkan log sesi
    DOM.repCatatan.innerHTML = '';
    if (sessionLogs.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'Tidak ada catatan khusus.';
        DOM.repCatatan.appendChild(li);
    } else {
        sessionLogs.forEach(log => {
            const li = document.createElement('li');
            li.textContent = log;
            DOM.repCatatan.appendChild(li);
        });
    }
    
    // Tampilkan modal
    DOM.modal.classList.remove('hidden');
    
    // Reset state internal
    currentState = 'IDLE';
    currentRakaat = 0;
    DOM.currentRakaat.textContent = '0';
    updateStateUI('IDLE');
}

// 13. MEMULAI TRACKING KAMERA & MODEL
async function startTracking() {
    // Ambil target rakaat dari dropdown
    const selected = DOM.selectShalat.value;
    switch(selected) {
        case 'subuh': totalTargetRakaat = 2; break;
        case 'dhuhur': totalTargetRakaat = 4; break;
        case 'ashar': totalTargetRakaat = 4; break;
        case 'maghrib': totalTargetRakaat = 3; break;
        case 'isya': totalTargetRakaat = 4; break;
        case 'dhuha': totalTargetRakaat = 2; break;
        case 'tahajjud': totalTargetRakaat = 2; break;
        default: totalTargetRakaat = 4;
    }
    DOM.targetRakaat.textContent = totalTargetRakaat;
    
    // Reset variabel sesi
    currentRakaat = 0;
    currentState = 'IDLE';
    updateStateUI('IDLE');
    sessionLogs = [];
    transitionCandidate = null;
    stateStartTime = null;
    isTumakninahValid = false;
    DOM.currentRakaat.textContent = '0';
    DOM.meterFill.style.width = '0%';
    DOM.timerText.textContent = '0.0s';
    pushFeedback('Menghubungkan ke kamera...', 'normal');
    
    // Tampilkan loading
    DOM.loading.classList.remove('hidden');
    
    try {
        // Akses kamera
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false
        });
        DOM.video.srcObject = stream;
        await DOM.video.play();
        
        // Inisialisasi MediaPipe Pose
        poseInstance = new Pose({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
        });
        
        poseInstance.setOptions({
            modelComplexity: 1,
            smoothLandmarks: true,
            enableSegmentation: false,
            smoothSegmentation: false,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        poseInstance.onResults(onResults);
        
        // Mulai loop kamera
        cameraInstance = new Camera(DOM.video, {
            onFrame: async () => {
                if (poseInstance) {
                    await poseInstance.send({image: DOM.video});
                }
            },
            width: 640,
            height: 480
        });
        
        await cameraInstance.start();
        isTrackingActive = true;
        
    } catch (err) {
        alert('Gagal mengakses kamera: ' + err.message);
        DOM.loading.classList.add('hidden');
        DOM.btnStart.classList.remove('hidden');
        DOM.btnStop.classList.add('hidden');
    }
}

// 14. CALLBACK HASIL POSE MEDIAPIPE
function onResults(results) {
    // Sembunyikan loading jika model sudah berjalan
    if (!modelLoaded) {
        modelLoaded = true;
        DOM.loading.classList.add('hidden');
    }
    
    // Bersihkan canvas
    ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
    
    if (results.poseLandmarks) {
        // Gambar skeleton
        if (window.drawConnectors && window.drawLandmarks) {
            window.drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
                color: '#6366f1',
                lineWidth: 2
            });
            window.drawLandmarks(ctx, results.poseLandmarks, {
                color: '#10b981',
                lineWidth: 1,
                radius: 3
            });
        }
        
        // Analisis pose jika tracking aktif
        if (isTrackingActive) {
            processPose(results.poseLandmarks);
        }
    }
    
    // Update FPS overlay sederhana
    if (results.poseLandmarks) {
        DOM.overlayBack.textContent = 'Model FPS: Stable';
    }
}

// 15. EVENT LISTENERS
DOM.btnStart.addEventListener('click', () => {
    if (isTrackingActive) return;
    DOM.btnStart.classList.add('hidden');
    DOM.btnStop.classList.remove('hidden');
    startTracking();
});

DOM.btnStop.addEventListener('click', () => {
    if (!isTrackingActive) return;
    endSession();
    DOM.btnStart.classList.remove('hidden');
    DOM.btnStop.classList.add('hidden');
});

DOM.btnCloseReport.addEventListener('click', () => {
    DOM.modal.classList.add('hidden');
    DOM.btnStart.classList.remove('hidden');
    DOM.btnStop.classList.add('hidden');
    updateStateUI('IDLE');
    DOM.meterFill.style.width = '0%';
    DOM.timerText.textContent = '0.0s';
    DOM.currentRakaat.textContent = '0';
    currentRakaat = 0;
    isTrackingActive = false;
    if (cameraInstance) {
        cameraInstance.stop();
        cameraInstance = null;
    }
    if (DOM.video.srcObject) {
        DOM.video.srcObject.getTracks().forEach(track => track.stop());
        DOM.video.srcObject = null;
    }
});

// Perbarui target rakaat saat dropdown berubah (meski belum mulai)
DOM.selectShalat.addEventListener('change', function() {
    const val = this.value;
    switch(val) {
        case 'subuh': totalTargetRakaat = 2; break;
        case 'dhuhur': totalTargetRakaat = 4; break;
        case 'ashar': totalTargetRakaat = 4; break;
        case 'maghrib': totalTargetRakaat = 3; break;
        case 'isya': totalTargetRakaat = 4; break;
        case 'dhuha': totalTargetRakaat = 2; break;
        case 'tahajjud': totalTargetRakaat = 2; break;
        default: totalTargetRakaat = 4;
    }
    DOM.targetRakaat.textContent = totalTargetRakaat;
});

// Inisialisasi awal
DOM.targetRakaat.textContent = totalTargetRakaat;
DOM.loading.classList.remove('hidden'); // loading screen tampil sampai model siap
