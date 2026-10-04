// ============================================================================
// RETRO RALLY 3D - ENGINE DEFINITIVO CON 3 PISTAS SINCRO REALES
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });

const WIDTH = 800;
const HEIGHT = 450;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const FPS = 60;
const STEP = 1 / FPS;
const ROAD_WIDTH = 2000;       
const SEGMENT_LENGTH = 65;     
const DRAW_DISTANCE = 200;     
const BASE_CAMERA_DEPTH = 0.85;
const CAMERA_HEIGHT_DEFAULT = 1000; 

// Imágenes de los autos
const carTextures = [];
const carImageNames = ["escarabajo.png", "coupe.png", "hypercar.png"];
carImageNames.forEach((name, index) => {
    carTextures[index] = new Image();
    carTextures[index].src = name; 
});

const VEHICLE_PRESETS = [
    { name: "VW Escarabajo", maxSpeed: 198, accel: 182, brake: -330, decel: -80, handling: 3.2, surf: { asphalt: 0.95, gravel: 1.12, snow: 1.05 } },
    { name: "Coupé GT", maxSpeed: 231, accel: 215, brake: -372, decel: -88, handling: 3.5, surf: { asphalt: 1.00, gravel: 1.00, snow: 1.00 } },
    { name: "V12 Hypercar", maxSpeed: 273, accel: 256, brake: -454, decel: -100, handling: 3.9, surf: { asphalt: 1.06, gravel: 0.84, snow: 0.74 } }
];

// Mismo +10% aplicado a los rivales para no romper el balance de la carrera
const DIFFICULTY_PRESETS = [
    { name: "Fácil", minSpeed: 108, maxSpeedDelta: 33, curveSlowdown: 0.15 },
    { name: "Media", minSpeed: 136, maxSpeedDelta: 45, curveSlowdown: 0.05 },
    { name: "Difícil", minSpeed: 174, maxSpeedDelta: 42, curveSlowdown: 0.01 }
];

// Paleta visual por circuito: colores de pista/pasto, cielo y montañas, y tipo de decorado lateral.
// Antes las 3 pistas compartían exactamente los mismos colores; ahora cada una tiene identidad propia.
const TRACK_PALETTES = [
    { // 0 - Circuito del Lazo Completo: bosque genérico, paleta original
        grassA: '#1a5220', roadA: '#38383a', rumbleA: '#ffffff',
        grassB: '#113d16', roadB: '#303032', rumbleB: '#d60000',
        skyTop: '#04020a', skyMid: '#8a1f00', skyBottom: '#e57c00',
        mountain1: '#1c1026', mountain2: '#2d163d',
        scenery: 'tree'
    },
    { // 1 - Suzuka GP: bosque japonés, tonos más fríos/verdes
        grassA: '#0f4a28', roadA: '#333336', rumbleA: '#ffffff',
        grassB: '#0a3419', roadB: '#2a2a2d', rumbleB: '#d60000',
        skyTop: '#02060f', skyMid: '#123a52', skyBottom: '#4fa6c4',
        mountain1: '#0c2333', mountain2: '#164a5f',
        scenery: 'tree'
    },
    { // 2 - Mónaco: urbano junto al mar, sin pasto (pavimento/veredas)
        grassA: '#5c6670', roadA: '#3c3c40', rumbleA: '#ffffff',
        grassB: '#4d5761', roadB: '#333336', rumbleB: '#d6a300',
        skyTop: '#050a1c', skyMid: '#123256', skyBottom: '#4fa3d1',
        mountain1: '#0b1b2e', mountain2: '#183a54',
        scenery: 'building'
    }
];
let currentPalette = TRACK_PALETTES[0];

let selectedDifficultyIdx = 1;
let selectedVehicleIdx = 0;
let selectedTrackIdx = 0;
let MAX_SPEED = 198;         
let ACCEL = 182;             
let BRAKE = -330;            
let DECEL = -88;             
const OFF_ROAD_ACCEL_FACTOR = 0.4;
// Distancias (en unidades de mundo "z" y en X normalizado -1..1 de carril) para considerar que
// el auto del jugador se solapa con el de un rival y por lo tanto hay choque.
const OPPONENT_COLLISION_Z_RANGE = 200;
const OPPONENT_COLLISION_X_RANGE = 0.65;
let opponentCrashCooldown = 0; // legacy, ya no se usa globalmente

// Flash visual de choque: dura unos frames con overlay rojo/naranja
let crashFlashTimer = 0;
const CRASH_FLASH_DURATION = 0.35;

// Sistema de audio procedural (Web Audio API, sin archivos externos)
// Motor de sonido portado de Retro Rally 2: dientes de sierra + cuadrada por un filtro pasa-bajos,
// 5 marchas con caída de RPM al cambiar, y ruido de ruta que crece con la velocidad.
let _audioCtx = null;
let _eng = null;
let _engRpm = 1200;

// Perfiles de audio para cada vehículo (mismos valores que en Retro Rally 2)
const VEHICLE_AUDIO_PRESETS = {
    0: { rpmMax: 5600, pulses: 2, tone: 0.55 },   // VW Escarabajo
    1: { rpmMax: 7000, pulses: 2, tone: 0.80 },   // Coupé GT
    2: { rpmMax: 8500, pulses: 3, tone: 1.10 }    // V12 Hypercar
};

function getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
}

function playCrashSound() {
    try {
        const ac = getAudioCtx();
        // Ruido blanco filtrado = impacto metálico retro
        const bufferSize = ac.sampleRate * 0.25;
        const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(400, ac.currentTime);
        filter.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.2);
        filter.Q.value = 0.8;
        const gain = ac.createGain();
        gain.gain.setValueAtTime(0.9, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
        src.connect(filter); filter.connect(gain); gain.connect(ac.destination);
        src.start(ac.currentTime);
        src.stop(ac.currentTime + 0.25);
    } catch(e) {}
}

function makeNoiseBuffer(ac, secs) {
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * secs), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}

function initializeEngineSound() {
    try {
        const ac = getAudioCtx();
        if (ac.state === 'suspended') ac.resume();
        if (_eng) stopEngineSound();
        const master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
        const filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.connect(master);
        const o1 = ac.createOscillator(); o1.type = 'sawtooth';
        const o2 = ac.createOscillator(); o2.type = 'square';
        const g1 = ac.createGain(); g1.gain.value = 0.12;
        const g2 = ac.createGain(); g2.gain.value = 0.05;
        o1.connect(g1); o2.connect(g2); g1.connect(filt); g2.connect(filt);
        // Ruido de ruta (rodadura), filtrado
        const n1 = ac.createBufferSource(); n1.buffer = makeNoiseBuffer(ac, 1.5); n1.loop = true;
        const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 0.7;
        const ng = ac.createGain(); ng.gain.value = 0;
        n1.connect(nf); nf.connect(ng); ng.connect(master);
        const t = ac.currentTime;
        o1.start(t); o2.start(t); n1.start(t);
        _engRpm = 1200;
        _eng = { o1: o1, o2: o2, g1: g1, g2: g2, filt: filt, n1: n1, nf: nf, ng: ng, master: master,
                 preset: VEHICLE_AUDIO_PRESETS[selectedVehicleIdx] };
    } catch(e) { _eng = null; }
}

// Calcula las RPM de audio (5 marchas -> patrón de "sierra" al acelerar) y actualiza el sonido
function updateEngineSound(dt) {
    try {
        if (!_eng) return;
        const ac = getAudioCtx(), t = ac.currentTime, p = _eng.preset;
        const ratio = Math.max(0, Math.min(1.05, speed / MAX_SPEED));
        const g = Math.min(5, Math.floor(ratio * 5 * 0.98) + 1);
        engGear = g;
        const within = Math.max(0, Math.min(1, ratio * 5 * 0.98 - (g - 1)));
        let target = 1900 + within * (p.rpmMax - 1900);
        if (gameState === 'COUNTDOWN') target = keys.up ? p.rpmMax * 0.6 : 1200;
        else if (speed < 3 && !keys.up) target = 1200;
        else if (!keys.up) target = Math.max(1300, target * 0.85);
        _engRpm += (target - _engRpm) * Math.min(1, dt * 10);

        const f = _engRpm / 60 * p.pulses;
        _eng.o1.frequency.setTargetAtTime(f, t, 0.04);
        _eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        _eng.filt.frequency.setTargetAtTime(350 + _engRpm * 0.16 * p.tone, t, 0.05);
        _eng.g1.gain.setTargetAtTime(0.08 + 0.10 * (_engRpm / p.rpmMax), t, 0.05);
        const sr = Math.max(0, Math.min(1, speed / MAX_SPEED));
        const offroad = Math.abs(playerX) > 1.0;
        const ph = (findSegment(position) || {}).phys || SURFACES.asphalt;
        _eng.nf.frequency.setTargetAtTime(ph.noiseF, t, 0.1);
        _eng.ng.gain.setTargetAtTime(ph.noiseG * sr * (offroad ? 1.8 : 1), t, 0.08);
    } catch(e) {}
}

function stopEngineSound() {
    try {
        if (!_eng) return;
        const e = _eng; _eng = null;
        const ac = getAudioCtx(), t = ac.currentTime;
        e.master.gain.setTargetAtTime(0, t, 0.02);   // corte suave, sin "clic"
        e.o1.stop(t + 0.12); e.o2.stop(t + 0.12); e.n1.stop(t + 0.12);
    } catch(e) {}
}

// Estela: rango en Z (por delante del jugador) y en X (mismo carril) donde ir pegado a un rival
// da un pequeño extra de velocidad, hasta un tope por encima del máximo normal.
const DRAFT_MIN_Z = 20;
const DRAFT_MAX_Z = 140;
const DRAFT_X_RANGE = 0.4;
const DRAFT_SPEED_BONUS = 45;
const DRAFT_MAX_OVERSPEED = 1.08;
// Controla qué tan rápido el giro llega a su máximo (STEER_RAMP_RATE) y qué tan rápido se apaga al soltar (STEER_DECAY).
// Valores más bajos de RAMP y más altos de DECAY (más cerca de 1) = giro más suave/progresivo.
const STEER_RAMP_RATE = 4.5;
const STEER_DECAY = 0.88;
// Antes era 24: controla cuántas unidades de mundo se recorren por punto de "velocidad" por segundo.
// Bajarlo hace que el circuito se sienta más lento y legible sin tocar los números de velocidad en pantalla.
const WORLD_SCROLL_FACTOR = 20;

let gameState = 'START';
let totalTime = 0;
let timeLeft = 90;
let currentLap = 1;
let TOTAL_LAPS = 3;
let score = 0;
let damage = 0;
let crashCooldown = 0;

let playerX = 0;               
let position = 0;              
let speed = 0;
let playerRpm = 1000;
let steerInput = 0;

let camX = 0;
let camY = CAMERA_HEIGHT_DEFAULT;
let skyScrollX = 0;

let trackSegments = [];
let trackLength = 0;

let countdownTime = 3.5; 
let countdownText = "3";
let opponents = [];
const TOTAL_OPPONENTS = 4;

const MOUNTAIN_PEAKS_LAYER1 = [50, 35, 60, 40, 55, 30, 45, 60, 35, 50, 40, 55, 30, 60];
const MOUNTAIN_PEAKS_LAYER2 = [75, 50, 90, 60, 85, 45, 70, 95, 55, 80, 65, 90, 50, 85];

let particles = [];
const keys = { left: false, right: false, up: false, down: false };

// ============================================================================
// PORTADO DE RETRO RALLY 2: superficies, clima, daño, copiloto, pausa, música, récords
// (el juego sigue siendo carrera de circuito con rivales)
// ============================================================================
// grip = agarre | push = cuánto te empuja la curva hacia afuera | accel/brake/top = multiplicadores
const SURFACES = {
    asphalt: { name: 'ASFALTO', base: 'asphalt', grip: 1.00, push: 1.00, accel: 1.00, brake: 1.00, top: 1.00, noiseF: 1400, noiseG: 0.030 },
    wet:     { name: 'MOJADO',  base: 'asphalt', grip: 0.85, push: 1.25, accel: 0.95, brake: 0.82, top: 0.97, noiseF: 1800, noiseG: 0.050 },
    gravel:  { name: 'TIERRA',  base: 'gravel',  grip: 0.74, push: 1.25, accel: 0.93, brake: 0.78, top: 0.92, noiseF: 900,  noiseG: 0.090,
               road: ['#b58f5a', '#a9844f'], rumble: ['#8a6b3f', '#7a5c34'] },
    mud:     { name: 'BARRO',   base: 'gravel',  grip: 0.62, push: 1.40, accel: 0.88, brake: 0.65, top: 0.88, noiseF: 700,  noiseG: 0.080,
               road: ['#7a5c3a', '#6f5334'], rumble: ['#4d3a25', '#43321f'] },
    snow:    { name: 'NIEVE',   base: 'snow',    grip: 0.56, push: 1.50, accel: 0.85, brake: 0.55, top: 0.84, noiseF: 500,  noiseG: 0.040,
               road: ['#e2eaf3', '#d5e0ec'], rumble: ['#9db4cb', '#8aa5c0'] }
};
const SURFACE_LABEL_COLOR = { asphalt: '#c8d2e0', wet: '#7fb2ff', gravel: '#ffb800', mud: '#c98a4a', snow: '#ffffff' };

const WEATHER_PRESETS = [
    { name: 'Despejado', rain: false, snow: false },
    { name: 'Lluvia',    rain: true,  snow: false },   // asfalto mojado / tierra -> barro
    { name: 'Nieve',     rain: false, snow: true }     // todo el circuito con nieve
];
// Tramos de tierra por circuito, en segmentos del diseño original (se escalan con el largo de la pista). Mónaco es urbano: sin tierra.
const GRAVEL_RANGES = { 0: [[430, 560]], 1: [[280, 400]], 2: [] };

let selectedWeatherIdx = 0;
let musicEnabled = true;
let voiceMode = 0;            // 0 voz + texto, 1 solo texto, 2 apagado
let latVel = 0;               // velocidad lateral con inercia (se nota cuando hay poco agarre)
let trackLenF = 1;            // cuánto más larga es la pista cargada respecto del diseño original
let lapBonus = 30;            // segundos que suma completar una vuelta (escala con el largo de la pista)
// Curva en 'unidades del diseño original': así el empuje de las curvas, los rivales y el copiloto se sienten igual en pistas largas
function gCurve(seg) { return seg.curve * trackLenF; }
let engGear = 1;
let lapStartTime = 0, lapTimes = [], bestLapThisRace = null;
let pacenotes = [], noteAnnounced = {};
let hudToast = { t: 0, text: '', sub: '' };
let raindrops = [], flakes = [];
const RECORDS_KEY = 'retroRallyRecords_v4';   // v4: pistas más largas (los tiempos de la v3 no son comparables)
const M_PER_UNIT = 1 / (3.6 * WORLD_SCROLL_FACTOR);   // metros por unidad de mundo, coherente con el velocímetro

function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const sc = sec - m * 60;
    return m + ':' + (sc < 10 ? '0' : '') + sc.toFixed(2);
}

function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = function (sh) { return Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); };
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// Paleta efectiva = paleta de la pista + clima (lluvia apaga los colores; nieve cambia el paisaje)
function getEffectivePalette(type) {
    const base = TRACK_PALETTES[type] || TRACK_PALETTES[0];
    const p = Object.assign({}, base);
    const w = WEATHER_PRESETS[selectedWeatherIdx];
    if (w.snow) {
        p.grassA = '#f4f8fc'; p.grassB = '#e9f0f7';
        p.skyTop = '#0c1a33'; p.skyMid = '#465f85'; p.skyBottom = '#b9cde3';
        p.mountain1 = '#8ea3bf'; p.mountain2 = '#c3d2e4';
        if (p.scenery === 'tree') p.scenery = 'snowpine';
        p.fog = '#c9d8e8'; p.fogD = 3.6;
    } else if (w.rain) {
        const gray = '#56606d';
        ['skyTop', 'skyMid', 'skyBottom', 'mountain1', 'mountain2', 'grassA', 'grassB'].forEach(function (k) { p[k] = mixHex(base[k], gray, 0.45); });
        p.fog = mixHex(base.skyBottom, gray, 0.6); p.fogD = 3.0;
    } else {
        p.fog = base.skyBottom; p.fogD = 2.0;
    }
    return p;
}

// Asigna superficie y física a cada segmento según circuito + clima, y recolorea la pista
function applyWeatherAndSurfaces(type) {
    const w = WEATHER_PRESETS[selectedWeatherIdx];
    const ranges = GRAVEL_RANGES[type] || [];
    const P = currentPalette;
    for (let i = 0; i < trackSegments.length; i++) {
        const seg = trackSegments[i];
        let key = 'asphalt';
        for (let r = 0; r < ranges.length; r++) if (seg.index >= ranges[r][0] * trackLenF && seg.index < ranges[r][1] * trackLenF) key = 'gravel';
        if (w.snow) key = 'snow'; else if (w.rain) key = (key === 'gravel') ? 'mud' : 'wet';
        const sf = SURFACES[key];
        const alt = Math.floor(seg.index / 4) % 2;    // 1 -> colores A, 0 -> colores B (igual que el original)
        let road = alt ? P.roadA : P.roadB, rumble = alt ? P.rumbleA : P.rumbleB;
        if (key === 'wet') road = mixHex(road, '#1d2836', 0.35);
        if (sf.road) { road = sf.road[alt]; rumble = sf.rumble[alt]; }
        seg.surfaceKey = key;
        seg.phys = sf;
        seg.color = { grass: alt ? P.grassA : P.grassB, road: road, rumble: rumble };
        seg.rivalMul = sf.top;   // los rivales tienen el mismo tope de velocidad por superficie que el jugador
    }
}

// Carteles de curva (chevrones) en el lado exterior de las curvas cerradas
function placeChevrons() {
    for (let i = 0; i < trackSegments.length; i++) {
        const seg = trackSegments[i];
        seg.sign = null;
        if (Math.abs(gCurve(seg)) >= 1.7 && seg.index % Math.max(6, Math.round(6 * trackLenF)) === 0) {
            seg.sign = { dir: Math.sign(seg.curve), side: -Math.sign(seg.curve), down: false };
        }
    }
}

// ---- Copiloto: notas de pista (1 = la más cerrada ... 6 = abierta) ---------
const GRADE_WORDS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
function gradeFor(peak) {
    if (peak >= 4.0) return 1;
    if (peak >= 3.0) return 2;
    if (peak >= 2.5) return 3;
    if (peak >= 2.0) return 4;
    if (peak >= 1.4) return 5;
    return 6;
}
function detectPacenotes() {
    pacenotes = [];
    const N = trackSegments.length;
    let i = 0;
    while (i < N) {
        const c = gCurve(trackSegments[i]);
        if (Math.abs(c) >= 0.8) {
            // Un tramo = segmentos seguidos del mismo lado sin saltos de curvatura (el salto marca el cambio de sección)
            const sign = Math.sign(c);
            let j = i + 1;
            while (j < N && Math.sign(gCurve(trackSegments[j])) === sign && Math.abs(gCurve(trackSegments[j]) - gCurve(trackSegments[j - 1])) < 0.2 && Math.abs(gCurve(trackSegments[j])) >= 0.5) j++;
            let peak = 0;
            for (let q = i; q < j; q++) peak = Math.max(peak, Math.abs(gCurve(trackSegments[q])));
            const grade = gradeFor(peak), len = j - i;
            if (peak >= 1.0) {
                const n = { seg: i, end: j, dir: sign < 0 ? 'L' : 'R', grade: grade, len: len, long: len >= 100 * trackLenF, hairpin: grade === 1 };
                n.voice = (n.dir === 'L' ? 'izquierda ' : 'derecha ') + GRADE_WORDS[grade] + (n.hairpin ? ', horquilla' : '') + (n.long ? ', larga' : '');
                pacenotes.push(n);
            }
            i = j;
        } else {
            i++;
        }
    }
}
// Unidades de mundo hasta el inicio de la curva (0 si ya estás dentro). En la última vuelta no se anuncia lo que queda "después" de la meta.
function noteDistance(n) {
    const start = n.seg * SEGMENT_LENGTH, end = n.end * SEGMENT_LENGTH;
    if (position >= start && position < end) return 0;
    let d = start - position;
    if (d < 0) {
        if (currentLap >= TOTAL_LAPS) return Infinity;
        d += trackLength;
    }
    return d;
}
function upcomingNotes(maxN, maxM) {
    const out = [];
    for (let i = 0; i < pacenotes.length; i++) {
        const m = noteDistance(pacenotes[i]) * M_PER_UNIT;
        if (m <= maxM) out.push({ n: pacenotes[i], i: i, m: m });
    }
    out.sort(function (a, b) { return a.m - b.m; });
    return out.slice(0, maxN);
}
function speak(text) {
    if (voiceMode !== 0) return;
    try {
        if (!('speechSynthesis' in window)) return;
        if (window.speechSynthesis.pending) window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 1.25; u.volume = 1;
        window.speechSynthesis.speak(u);
    } catch (e) {}
}
function cancelSpeech() { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {} }
function updateCopilot() {
    if (voiceMode !== 0) return;
    const lead = 45 + (speed / 3.6) * 2.6;   // metros de anticipación
    for (let i = 0; i < pacenotes.length; i++) {
        const n = pacenotes[i];
        if (n.grade > 4 || noteAnnounced[i] === currentLap) continue;   // por voz solo las curvas importantes; el texto muestra todas
        const m = noteDistance(n) * M_PER_UNIT;
        if (m <= lead) {
            noteAnnounced[i] = currentLap;
            if (m > 0) { speak(n.voice); return; }
        }
    }
}
function cycleVoice() {
    voiceMode = (voiceMode + 1) % 3;
    hudToast = { t: 1.6, text: 'COPILOTO', sub: ['VOZ + TEXTO', 'SOLO TEXTO', 'APAGADO'][voiceMode] };
    if (voiceMode !== 0) cancelSpeech();
}

// ---- Récords y tiempos ------------------------------------------------------
function recordKey(trackIdx, weatherIdx, vehicleIdx) { return trackIdx + '_' + weatherIdx + '_' + vehicleIdx; }
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch (e) { return {}; } }
function saveRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); } catch (e) {} }
function updateMenuRecords() {
    const el = document.getElementById('menuRecords');
    if (!el) return;
    const v = function (id) { const e = document.getElementById(id); return e ? parseInt(e.value) : 0; };
    const r = loadRecords()[recordKey(v('selectTrack'), v('selectWeather'), v('selectVehicle'))] || {};
    el.textContent = 'RÉCORD  VUELTA ' + formatTime(r.bestLap) + '  |  CARRERA ' + formatTime(r.bestRace) + (r.bestRank ? '  |  MEJOR P' + r.bestRank : '');
}
window.updateMenuRecords = updateMenuRecords;

function registerLap() {
    const t = totalTime - lapStartTime;
    lapTimes.push(t);
    lapStartTime = totalTime;
    if (bestLapThisRace === null || t < bestLapThisRace) bestLapThisRace = t;
}
function buildRaceSummary(finalRank) {
    const recs = loadRecords();
    const key = recordKey(selectedTrackIdx, selectedWeatherIdx, selectedVehicleIdx);
    const r = recs[key] || {};
    const newRace = (r.bestRace == null || totalTime < r.bestRace);
    const newLap = (r.bestLap == null || bestLapThisRace < r.bestLap);
    const newRank = (r.bestRank == null || finalRank < r.bestRank);
    if (newRace) r.bestRace = totalTime;
    if (newLap) r.bestLap = bestLapThisRace;
    if (newRank) r.bestRank = finalRank;
    recs[key] = r;
    saveRecords(recs);
    const medal = finalRank === 1 ? 'ORO' : finalRank === 2 ? 'PLATA' : finalRank === 3 ? 'BRONCE' : 'SIN MEDALLA';
    const lines = [
        '¡CARRERA COMPLETADA!',
        'Clasificación: P' + finalRank + '  ·  Medalla: ' + medal + (newRank && r.bestRank === finalRank && finalRank <= 3 ? '  ★' : ''),
        'Tiempo total: ' + formatTime(totalTime) + (newRace ? '  ★ RÉCORD' : '')
    ];
    lapTimes.forEach(function (t, i) {
        lines.push('Vuelta ' + (i + 1) + ': ' + formatTime(t) + (t === bestLapThisRace ? '  ◄ mejor' : ''));
    });
    lines.push('Mejor vuelta: ' + formatTime(bestLapThisRace) + (newLap ? '  ★ RÉCORD' : ''));
    lines.push(TRACK_LABELS[selectedTrackIdx] + ' · ' + WEATHER_PRESETS[selectedWeatherIdx].name + ' · daño ' + damage + '%');
    lines.push('Score final: ' + (score + Math.floor(timeLeft * 100)));
    return lines.join('\n');
}
const TRACK_LABELS = ['Lazo Completo', 'Suzuka GP', 'Mónaco Street'];

// ---- Pausa (P / Esc / botón II) ---------------------------------------------
function togglePause() {
    if (gameState === 'RUNNING') {
        gameState = 'PAUSED';
        stopEngineSound(); stopMusic(); stopRain(); cancelSpeech();
    } else if (gameState === 'PAUSED') {
        gameState = 'RUNNING';
        initializeEngineSound(); startMusic(); startRain();
    }
}
window.togglePause = togglePause;
function toggleMusic() {
    musicEnabled = !musicEnabled;
    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN') { if (musicEnabled) startMusic(); else stopMusic(); }
}
window.addEventListener('blur', function () { if (gameState === 'RUNNING') togglePause(); });
document.addEventListener('visibilitychange', function () { if (document.hidden && gameState === 'RUNNING') togglePause(); });

// ---- Música chiptune de Retro Rally 2 (Dm - Bb - F - C) ----------------------
const MUSIC_BPM = 146;
const MUSIC_CHORDS = [
    { bass: 146.83, arp: [293.66, 349.23, 440.00, 349.23] },
    { bass: 116.54, arp: [233.08, 293.66, 349.23, 293.66] },
    { bass: 174.61, arp: [349.23, 440.00, 523.25, 440.00] },
    { bass: 130.81, arp: [329.63, 392.00, 523.25, 392.00] }
];
let _mTimer = null, _mGain = null, _mNext = 0, _mStep = 0, _mNoise = null;
function mTone(type, freq, t, len, vol) {
    const a = getAudioCtx(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + len + 0.02);
}
function mKick(t) {
    const a = getAudioCtx(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + 0.18);
}
function mSnare(t) {
    const a = getAudioCtx(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = _mNoise; f.type = 'highpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(_mGain); s.start(t); s.stop(t + 0.13);
}
function playMusicStep(step, t, dur) {
    const chord = MUSIC_CHORDS[Math.floor(step / 16) % MUSIC_CHORDS.length];
    if (step % 2 === 0) mTone('triangle', chord.bass, t, dur * 1.9, 0.9);
    mTone('square', chord.arp[step % 4], t, dur * 0.8, 0.20);
    const pos = step % 16;
    if (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 12) mTone('square', chord.arp[(pos >> 2) % 4] * 2, t, dur * 1.4, 0.16);
    if (step % 4 === 0) mKick(t);
    if (step % 8 === 4) mSnare(t);
}
function scheduleMusic() {
    try {
        const a = getAudioCtx(), stepDur = 60 / MUSIC_BPM / 4;
        while (_mNext < a.currentTime + 0.15) {
            playMusicStep(_mStep, _mNext, stepDur);
            _mNext += stepDur;
            _mStep = (_mStep + 1) % (MUSIC_CHORDS.length * 16);
        }
    } catch (e) {}
}
function startMusic() {
    try {
        if (!musicEnabled || _mTimer) return;
        const a = getAudioCtx();
        if (a.state === 'suspended') a.resume();
        _mGain = a.createGain(); _mGain.gain.value = 0.10; _mGain.connect(a.destination);
        _mNoise = makeNoiseBuffer(a, 0.2);
        _mNext = a.currentTime + 0.05; _mStep = 0;
        _mTimer = setInterval(scheduleMusic, 25);
    } catch (e) {}
}
function stopMusic() {
    if (_mTimer) { clearInterval(_mTimer); _mTimer = null; }
    try { if (_mGain) _mGain.disconnect(); } catch (e) {}
    _mGain = null;
}

// ---- Lluvia (sonido) / efectos de clima (dibujo) ------------------------------
let _rainSrc = null;
function startRain() {
    try {
        if (!WEATHER_PRESETS[selectedWeatherIdx].rain || _rainSrc) return;
        const ac = getAudioCtx();
        _rainSrc = ac.createBufferSource();
        _rainSrc.buffer = makeNoiseBuffer(ac, 2);
        _rainSrc.loop = true;
        const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
        const g = ac.createGain(); g.gain.value = 0.06;
        _rainSrc.connect(hp); hp.connect(g); g.connect(ac.destination);
        _rainSrc.start(ac.currentTime);
    } catch (e) {}
}
function stopRain() {
    try { if (_rainSrc) _rainSrc.stop(); } catch (e) {}
    _rainSrc = null;
}
function stopAllAudio() { stopEngineSound(); stopMusic(); stopRain(); cancelSpeech(); }

function initWeatherFx() {
    raindrops = []; flakes = [];
    for (let i = 0; i < 140; i++) raindrops.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, len: 8 + Math.random() * 10, spd: 14 + Math.random() * 10 });
    for (let i = 0; i < 130; i++) flakes.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 1 + Math.random() * 2, s: 40 + Math.random() * 60 });
}
function drawWeatherEffects() {
    if (gameState === 'START') return;
    const w = WEATHER_PRESETS[selectedWeatherIdx];
    const moving = (gameState !== 'PAUSED');
    if (w.rain) {
        ctx.fillStyle = 'rgba(10, 20, 45, 0.28)';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.strokeStyle = 'rgba(190, 215, 255, 0.45)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < raindrops.length; i++) {
            const d = raindrops[i];
            if (moving) {
                d.y += d.spd; d.x -= d.spd * 0.18;
                if (d.y > HEIGHT) { d.y = -d.len; d.x = Math.random() * WIDTH * 1.2; }
                if (d.x < 0) d.x += WIDTH;
            }
            ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
        }
        ctx.stroke();
    } else if (w.snow) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = 0; i < flakes.length; i++) {
            const f = flakes[i];
            if (moving) {
                f.y += f.s * STEP * (1 + speed / 260);
                f.x += Math.sin(f.y * 0.03 + f.r) * 0.4 - speed * 0.004;
                if (f.y > HEIGHT) { f.y = -4; f.x = Math.random() * WIDTH; }
                if (f.x < -4) f.x += WIDTH + 8;
            }
            ctx.fillRect(f.x, f.y, f.r, f.r);
        }
    }
}

// ---- Dibujo de superficie y niebla por segmento ---------------------------------
function quadFill(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function drawSurfaceMarks(seg, pt1, pt2, fogA) {
    const x1 = pt1.screen.x, y1 = pt1.screen.y + 1, w1 = pt1.screen.w;
    const x2 = pt2.screen.x, y2 = pt2.screen.y, w2 = pt2.screen.w;
    const l1 = w1 / 32, l2 = w2 / 32;
    const key = seg.surfaceKey;
    if (key === 'asphalt' || key === 'wet') {
        if (Math.floor(seg.index / 4) % 2 === 1) {
            const col = key === 'wet' ? 'rgba(225,235,250,0.85)' : '#f2f2f2';
            const lw1 = w1 * 2 / 3, lw2 = w2 * 2 / 3;
            let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
            for (let lane = 1; lane < 3; lane++, lx1 += lw1, lx2 += lw2) {
                quadFill(lx1 - l1 / 2, y1, lx1 + l1 / 2, y1, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, col);
            }
        }
    } else {
        const rut = key === 'snow' ? 'rgba(80,110,150,0.16)' : (key === 'mud' ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.13)');
        for (let sd = -1; sd <= 1; sd += 2) {
            const c1 = x1 + sd * w1 * 0.38, c2 = x2 + sd * w2 * 0.38;
            quadFill(c1 - l1 * 2.2, y1, c1 + l1 * 2.2, y1, c2 + l2 * 2.2, y2, c2 - l2 * 2.2, y2, rut);
        }
    }
    if (fogA > 0.02) {
        ctx.globalAlpha = fogA;
        ctx.fillStyle = currentPalette.fog;
        ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
        ctx.globalAlpha = 1;
    }
}

function drawPauseOverlay() {
    if (gameState !== 'PAUSED') return;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 52px monospace'; ctx.fillText('PAUSA', WIDTH / 2, HEIGHT / 2);
    ctx.fillStyle = '#ffffff'; ctx.font = '15px monospace';
    ctx.fillText('P / Esc: continuar  ·  M: música  ·  C: copiloto', WIDTH / 2, HEIGHT / 2 + 34);
    ctx.textAlign = 'left';
}

function startRaceFromMenuSelection() {
    const g = function (id, d) { const e = document.getElementById(id); return e ? parseInt(e.value) : d; };
    selectedTrackIdx = g('selectTrack', 0);
    selectedVehicleIdx = g('selectVehicle', 0);
    selectedDifficultyIdx = g('selectDifficulty', 1);
    selectedWeatherIdx = g('selectWeather', 0);
    voiceMode = g('selectVoice', 0);
    musicEnabled = g('selectMusic', 1) === 1;

    let vp = VEHICLE_PRESETS[selectedVehicleIdx];
    MAX_SPEED = vp.maxSpeed;
    ACCEL = vp.accel;
    BRAKE = vp.brake;
    DECEL = vp.decel;

    buildSelectedChampionshipTrack(selectedTrackIdx);
    invalidateMinimapCache();
    spawnOpponentsIA();
    startCountdownSequence();
}

function initInputSystem() {
    const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];

    window.addEventListener('keydown', (e) => {
        if (NAV_KEYS.includes(e.key)) e.preventDefault(); // evita que la página haga scroll con las flechas
        if (e.key === 'ArrowLeft'  || e.key.toLowerCase() === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = true;
        if (e.key === 'ArrowUp'    || e.key.toLowerCase() === 'w') keys.up = true;
        if (e.key === 'ArrowDown'  || e.key.toLowerCase() === 's') keys.down = true;
        if (!e.repeat && (e.key.toLowerCase() === 'p' || e.key === 'Escape')) togglePause();
        if (!e.repeat && e.key.toLowerCase() === 'm') toggleMusic();
        if (!e.repeat && e.key.toLowerCase() === 'c') cycleVoice();
    });

    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft'  || e.key.toLowerCase() === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = false;
        if (e.key === 'ArrowUp'    || e.key.toLowerCase() === 'w') keys.up = false;
        if (e.key === 'ArrowDown'  || e.key.toLowerCase() === 's') keys.down = false;
    });

    window.pressTouchKey = function(key) { if (keys.hasOwnProperty(key)) keys[key] = true; };
    window.releaseTouchKey = function(key) { if (keys.hasOwnProperty(key)) keys[key] = false; };

    const btnStart = document.getElementById('btnStartRace');
    if (btnStart) btnStart.onclick = startRaceFromMenuSelection;
}

// ============================================================================
// CONFIGURACIÓN ASIGNADA DE SEGMENTOS RECOPIADOS PARA LAS 3 PISTAS DEL MENÚ
// ============================================================================
// ============================================================================
// PISTAS
// Cada sección: [largo en segmentos del diseño original, curva, desnivel]. El largo real de la pista es
// ese diseño multiplicado por TRACK_LENGTH_FACTOR (la forma del circuito se conserva).
// ============================================================================
const TRACK_DEFS = [
    { name: 'Circuito del Lazo Completo', time: 110, lapBonus: 60, sections: [
        [90, 0.0, 0], [60, 1.8, 1], [120, 3.4, 2], [60, 1.8, -1], [100, -0.6, -2],
        [70, -2.0, 3], [130, -3.8, 1], [70, -2.0, -2], [80, 1.2, -3], [50, 0.0, 0]
    ] },
    { name: 'Suzuka GP', time: 120, lapBonus: 50, sections: [      // curvas en 'S', horquilla y rectas rápidas
        [80, 0.0, 0],     // Recta principal
        [40, 2.5, 1],     // Primera curva a la derecha
        [50, -2.0, 2],    // Curvas S izquierda
        [50, 2.0, -1],    // S derecha
        [60, -1.5, 0],    // Curva Dunlop
        [80, 0.0, -2],    // Recta trasera
        [40, -4.5, 3],    // Horquilla cerrada
        [70, 3.0, -1],    // Curva de la Cuchara
        [90, 0.0, 0],     // Recta del túnel
        [40, -2.0, 0]     // Chicane final
    ] },
    { name: 'Mónaco Street Circuit', time: 140, lapBonus: 40, sections: [   // urbano, trabado y exigente
        [50, 0.0, 0],     // Recta de Largada
        [35, 4.0, 4],     // Subida Sainte-Dévote
        [50, 1.5, 2],     // Tramo Beau Rivage
        [40, -3.5, -2],   // Curva de Massenet
        [30, 5.0, -4],    // Casino Square bajando
        [45, -7.0, -2],   // Horquilla súper cerrada de Loews (Grand Hotel)
        [60, 2.0, 0],     // Entrada al Túnel
        [40, -3.0, 1],    // Chicane del Puerto
        [40, 4.0, 0],     // Curva de la Piscina
        [40, -5.0, -1]    // La Rascasse
    ] }
];
// Cuánto más larga es cada pista que el diseño original (más largo = más tiempo por vuelta).
const TRACK_LENGTH_FACTOR = [2.6, 3.0, 3.5];   // Lazo, Suzuka, Mónaco

function buildSelectedChampionshipTrack(type) {
    trackSegments = [];
    TOTAL_LAPS = 3;
    currentPalette = getEffectivePalette(type);

    const def = TRACK_DEFS[type] || TRACK_DEFS[0];
    const t = TRACK_DEFS[type] ? type : 0;
    trackLenF = TRACK_LENGTH_FACTOR[t];
    timeLeft = def.time;
    lapBonus = def.lapBonus;
    for (const sec of def.sections) {
        const n = Math.max(1, Math.round(sec[0] * trackLenF));
        addRoadSegment(n, sec[1], sec[2], n / sec[0]);
    }
    closeCircuitGeometry(t);

    // El desnivel total de la vuelta también cierra en cero (sin escalón en la línea de meta)
    let hillSum = 0;
    for (const sg of trackSegments) hillSum += sg.hill;
    const hillBias = hillSum / trackSegments.length;
    for (const sg of trackSegments) sg.hill -= hillBias;

    trackLength = trackSegments.length * SEGMENT_LENGTH;

    let currentX = 0;
    let currentY = 0;
    for (let i = 0; i < trackSegments.length; i++) {
        let seg = trackSegments[i];
        seg.p1.world.x = currentX;
        seg.p1.world.y = currentY;
        currentX += seg.curve * 3.8;
        currentY += seg.hill * 2.2;
        seg.p2.world.x = currentX;
        seg.p2.world.y = currentY;
    }

    applyWeatherAndSurfaces(t);
    placeChevrons();
    detectPacenotes();
    rebuildSkyGradient();
}

// Suaviza la sharpness de todas las curvas de las 3 pistas en un solo punto (afecta física y minimapa por igual,
// ya que ambos leen seg.curve una vez que addRoadSegment ya lo guardó escalado).
const CURVE_SOFTEN_FACTOR = 0.6;

function addRoadSegment(num, curve, hill, lenRatio) {
    curve *= CURVE_SOFTEN_FACTOR;
    for (let i = 0; i < num; i++) {
        let segIndex = trackSegments.length;
        let isAlternate = Math.floor(segIndex / 4) % 2;
        // Decorado lateral cada 5 segmentos, alternando de lado, salvo cerca de la línea de largada
        let decorationGroup = Math.floor(segIndex / 5);
        let hasDecoration = (segIndex % 5 === 0) && segIndex > 10;
        trackSegments.push({
            index: segIndex,
            p1: { world: { x: 0, y: 0, z: segIndex * SEGMENT_LENGTH }, screen: { x: 0, y: 0, w: 0 } },
            p2: { world: { x: 0, y: 0, z: (segIndex + 1) * SEGMENT_LENGTH }, screen: { x: 0, y: 0, w: 0 } },
            curve: curve,            // se recalcula en closeCircuitGeometry
            rawCurve: curve,         // curva del diseño original
            lenRatio: lenRatio || 1, // cuánto se alargó esta sección
            hill: hill,
            color: isAlternate ? { grass: currentPalette.grassA, road: currentPalette.roadA, rumble: currentPalette.rumbleA }
                               : { grass: currentPalette.grassB, road: currentPalette.roadB, rumble: currentPalette.rumbleB },
            decoration: hasDecoration
                ? { side: (decorationGroup % 2 === 0) ? -1 : 1, type: currentPalette.scenery, sizeVar: 0.75 + Math.random() * 0.5 }
                : null
        });
    }
}

// ----------------------------------------------------------------------------
// GEOMETRÍA CERRADA
// El render hace girar el camino curva/SEGMENT_LENGTH radianes por segmento. El diseño original de las pistas no
// cerraba (giraba solo 21°-69° en total) y el minimapa lo disimulaba inventando curva. Acá se corrige en la pista
// real, de modo que minimapa y pista sean exactamente la misma geometría:
//   1) el giro total de cada sección se conserva al alargarla;
//   2) una curva uniforme lleva el giro total a ±360°;
//   3) una corrección suave y mínima (pocos armónicos, los más bruscos penalizados) hace que el punto final
//      coincida con el de partida. El resultado se guarda en cache por pista.
// ----------------------------------------------------------------------------
const GEO_HARMONICS = 8;
const _geoCache = {};
function closeCircuitGeometry(type) {
    const segs = trackSegments, N = segs.length;
    const cached = _geoCache[type];
    if (cached && cached.length === N) { for (let i = 0; i < N; i++) segs[i].curve = cached[i]; return; }

    const base = new Float64Array(N);
    let D = 0;
    for (let i = 0; i < N; i++) { base[i] = segs[i].rawCurve / SEGMENT_LENGTH / segs[i].lenRatio; D += base[i]; }
    const T = D <= 0 ? -2 * Math.PI : 2 * Math.PI;
    const bias = (T - D) / N;
    for (let i = 0; i < N; i++) base[i] += bias;

    const K = GEO_HARMONICS, P = 2 * K + 1;
    const cosT = [], sinT = [];
    for (let k = 1; k <= K; k++) {
        const c = new Float64Array(N), sn = new Float64Array(N);
        for (let i = 0; i < N; i++) { const a = 2 * Math.PI * k * i / N; c[i] = Math.cos(a); sn[i] = Math.sin(a); }
        cosT[k] = c; sinT[k] = sn;
    }
    const W = [];
    for (let j = 0; j < P; j++) W.push(j === 0 ? 1 : 1 + Math.pow(Math.ceil(j / 2), 3));
    const turnAt = function (p, i) {
        let d = base[i] + p[0];
        for (let k = 1; k <= K; k++) d += p[2 * k - 1] * cosT[k][i] + p[2 * k] * sinT[k][i];
        return d;
    };
    const residual = function (p) {
        let h = 0, x = 0, y = 0, H = 0;
        for (let i = 0; i < N; i++) { const d = turnAt(p, i); h += d; H += d; x += Math.cos(h); y += Math.sin(h); }
        return [H - T, x / N, y / N];
    };
    const norm = function (g) { return Math.hypot(g[0], g[1] * 100, g[2] * 100); };

    let p = new Array(P).fill(0), g = residual(p);
    for (let it = 0; it < 80 && norm(g) > 1e-11; it++) {
        const J = [];
        for (let j = 0; j < P; j++) {
            const q = p.slice(); q[j] += 1e-6;
            const gj = residual(q);
            J.push([(gj[0] - g[0]) / 1e-6, (gj[1] - g[1]) / 1e-6, (gj[2] - g[2]) / 1e-6]);
        }
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let j = 0; j < P; j++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += J[j][a] * J[j][b] / W[j];
        const A = [0, 1, 2].map(function (r) { return [M[r][0], M[r][1], M[r][2], -g[r]]; });
        for (let c = 0; c < 3; c++) {
            let piv = c;
            for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
            const tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
            for (let r = 0; r < 3; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= m * A[c][k]; }
        }
        const w = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
        const du = J.map(function (col, j) { return (col[0] * w[0] + col[1] * w[1] + col[2] * w[2]) / W[j]; });
        const n0 = norm(g);
        let step = 1, ok = false;
        for (let tries = 0; tries < 40; tries++) {
            const q = p.map(function (v, j) { return v + step * du[j]; });
            const gq = residual(q);
            if (norm(gq) < n0) { p = q; g = gq; ok = true; break; }
            step *= 0.5;
        }
        if (!ok) break;
    }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) { out[i] = turnAt(p, i) * SEGMENT_LENGTH; segs[i].curve = out[i]; }
    _geoCache[type] = out;
}


// Evita estirar/deformar las imágenes de los autos (cada PNG tiene su propio aspect ratio:
// coupe 500x500, escarabajo 433x577, hypercar 360x360). Ajusta dentro de la caja manteniendo proporción.
function computeFitDims(img, boxW, boxH) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return { w: boxW, h: boxH };
    const boxAspect = boxW / boxH;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    if (imgAspect > boxAspect) {
        return { w: boxW, h: boxW / imgAspect };
    }
    return { w: boxH * imgAspect, h: boxH };
}

function findSegment(z) {
    if (trackSegments.length === 0) return null;
    let index = Math.floor(z / SEGMENT_LENGTH) % trackSegments.length;
    if (index < 0) index += trackSegments.length;
    return trackSegments[index];
}

function spawnOpponentsIA() {
    opponents = [];
    let diff = DIFFICULTY_PRESETS[selectedDifficultyIdx];
    for (let i = 0; i < TOTAL_OPPONENTS; i++) {
        opponents.push({
            id: i,
            position: 700 + (i * 800), 
            lapsCompleted: 0, 
            playerX: (i % 2 === 0) ? -0.45 : 0.45,
            speed: diff.minSpeed + (Math.random() * diff.maxSpeedDelta),
            textureIndex: Math.floor(Math.random() * 3)
        });
    }
}

function startCountdownSequence() {
    gameState = 'COUNTDOWN';
    lapStartTime = 0; lapTimes = []; bestLapThisRace = null; noteAnnounced = {}; hudToast.t = 0;
    initWeatherFx();
    initializeEngineSound();
    startMusic();
    startRain();
    countdownTime = 3.5;
    countdownText = "3";
    document.getElementById('menuStart').classList.add('hidden');
    document.getElementById('menuGameOver').classList.add('hidden');
}

function updatePhysicsEngine(dt) {
    if (trackSegments.length === 0) return;

    if (gameState === 'COUNTDOWN') {
        countdownTime -= dt;
        if (countdownTime > 2.5) countdownText = "3";
        else if (countdownTime > 1.5) countdownText = "2";
        else if (countdownTime > 0.5) countdownText = "1";
        else if (countdownTime > -0.5) countdownText = "¡GO!";
        else {
            gameState = 'RUNNING';
        }
        
        updateEngineSound(dt);
        updateOpponentsIA(dt);
        return;
    }

    if (gameState !== 'RUNNING') return;

    totalTime += dt;
    timeLeft -= dt;
    if (crashFlashTimer > 0) crashFlashTimer -= dt;
    
    // Actualizar sonido del motor y copiloto
    updateEngineSound(dt);
    updateCopilot();

    if (timeLeft <= 0) {
        timeLeft = 0; gameState = 'GAME_OVER';
        stopAllAudio();
        showEndScreen("TIEMPO LÍMITE SUPERADO\nInténtalo de nuevo.", false);
        return;
    }

    updateOpponentsIA(dt);

    let currentSegment = findSegment(position);
    if (!currentSegment) return;
    
    let isOffRoad = Math.abs(playerX) > 1.0;

    // Física por superficie (asfalto / mojado / tierra / barro / nieve) y daño acumulado
    const phys = currentSegment.phys || SURFACES.asphalt;
    const vsm = VEHICLE_PRESETS[selectedVehicleIdx].surf[phys.base];
    const effGrip = phys.grip * vsm;
    const dmgFactor = 1 - 0.25 * (damage / 100);   // con 100% de daño perdés 25% de velocidad máxima y aceleración
    const surfTop = MAX_SPEED * phys.top * dmgFactor;

    if (keys.up) {
        let maxLimit = isOffRoad ? surfTop * 0.5 : surfTop;
        let accelRate = (isOffRoad ? ACCEL * OFF_ROAD_ACCEL_FACTOR : ACCEL) * phys.accel * dmgFactor;
        if (speed < maxLimit) speed += (accelRate * dt * 1.5);
        else speed += (DECEL * dt);
    } else if (keys.down) {
        speed += (BRAKE * phys.brake * dt);
    } else {
        speed += (DECEL * dt * 2.0);
    }

    speed = Math.max(0, Math.min(speed, MAX_SPEED));
    playerRpm = playerRpm * 0.8 + (1000 + (speed / MAX_SPEED) * 6500) * 0.2;

    // Estela/aspiración: ir pegado detrás de un rival, en su mismo carril, da un pequeño extra de
    // velocidad (permite superar el tope normal por un margen chico) para incentivar pelear posiciones.
    if (keys.up && !isOffRoad) {
        for (let cp of opponents) {
            let diffZ = cp.position - position;
            if (diffZ > trackLength / 2) diffZ -= trackLength;
            else if (diffZ < -trackLength / 2) diffZ += trackLength;
            if (diffZ > DRAFT_MIN_Z && diffZ < DRAFT_MAX_Z && Math.abs(playerX - cp.playerX) < DRAFT_X_RANGE) {
                let overSpeedCap = MAX_SPEED * DRAFT_MAX_OVERSPEED;
                if (speed < overSpeedCap) speed = Math.min(overSpeedCap, speed + DRAFT_SPEED_BONUS * dt);
                break;
            }
        }
    }

    if (speed > 0) {
        let steerSpeed = VEHICLE_PRESETS[selectedVehicleIdx].handling * (isOffRoad ? 0.6 : 1.0) * (speed / MAX_SPEED);
        // steerInput ahora maneja también el desplazamiento real (antes solo inclinaba el sprite),
        // por eso el auto acelera y frena su giro lateral de forma gradual en vez de saltar de golpe.
        if (keys.left) {
            steerInput = Math.max(-1, steerInput - dt * STEER_RAMP_RATE);
        } else if (keys.right) {
            steerInput = Math.min(1, steerInput + dt * STEER_RAMP_RATE);
        } else {
            steerInput *= STEER_DECAY;
        }
        // Con poco agarre el auto responde con retraso (inercia lateral) y gira menos
        const latTarget = steerInput * steerSpeed * 1.6 * effGrip;
        latVel += (latTarget - latVel) * Math.min(1, (5 + 45 * Math.pow(effGrip, 4)) * dt);
        playerX += latVel * dt;

        // Arrastre por curva cerrada a alta velocidad: da sensación de peso y agarre limitado
        // en vez de poder girar a fondo sin perder nada de velocidad.
        if (Math.abs(steerInput) > 0.5 && speed > MAX_SPEED * 0.5) {
            speed = Math.max(0, speed - Math.abs(steerInput) * 35 * dt);
        }
    }

    if (speed > 0) {
        playerX -= (dt * (speed / MAX_SPEED) * gCurve(currentSegment) * 0.5 * (phys.push / vsm));
        skyScrollX -= (gCurve(currentSegment) * (speed / MAX_SPEED) * 0.0025);
    }

    // Colisión con decorado lateral (árboles / edificios).
    // Se revisa una ventana de segmentos alrededor del jugador para no depender de que el
    // jugador esté exactamente en el único segmento que tiene el árbol (ocurren cada 5 segmentos).
    if (Math.abs(playerX) > 1.1) {
        const SCENERY_HIT_X = 1.22;
        const startSeg = Math.floor(position / SEGMENT_LENGTH);
        for (let di = -3; di <= 6; di++) {
            let idx = (startSeg + di + trackSegments.length) % trackSegments.length;
            let seg = trackSegments[idx];
            if (seg && seg.decoration && Math.abs(playerX) >= SCENERY_HIT_X && Math.sign(playerX) === seg.decoration.side) {
                crashCooldown -= dt;
                if (crashCooldown <= 0) {
                    speed = Math.max(speed * 0.55, 20);
                    damage = Math.min(100, damage + 6);
                    crashCooldown = 0.5;
                    crashFlashTimer = CRASH_FLASH_DURATION;
                    playCrashSound();
                    if (damage >= 100) {
                        gameState = 'GAME_OVER';
                        stopAllAudio();
                        showEndScreen("VEHÍCULO AVERIADO\nImpacto contra el decorado.", false);
                        return;
                    }
                }
                break;
            }
        }
    }

    if (Math.abs(playerX) >= 1.22) {
        const sgnX = Math.sign(playerX);
        const sStart = Math.floor(position / SEGMENT_LENGTH);
        for (let di = -3; di <= 6; di++) {
            const sg = trackSegments[(sStart + di + trackSegments.length) % trackSegments.length];
            if (sg && sg.sign && !sg.sign.down && sg.sign.side === sgnX) {
                sg.sign.down = true;   // el cartel se derriba: golpe leve, una sola vez
                speed = Math.max(speed * 0.82, 20);
                damage = Math.min(100, damage + 3);
                crashFlashTimer = CRASH_FLASH_DURATION * 0.6;
                playCrashSound();
                if (damage >= 100) {
                    gameState = 'GAME_OVER';
                    stopAllAudio();
                    showEndScreen("VEHÍCULO AVERIADO\nDaño acumulado al 100%.", false);
                    return;
                }
                break;
            }
        }
    }

    if (Math.abs(playerX) > 1.8) {
        playerX = Math.sign(playerX) * 1.8;
        crashCooldown -= dt;
        if (crashCooldown <= 0) {
            speed = Math.max(speed * 0.5, 25);
            damage = Math.min(100, damage + 8);
            crashCooldown = 0.5; // medio segundo entre golpes, evita perder 100% de daño en <1s
            crashFlashTimer = CRASH_FLASH_DURATION;
            playCrashSound();
            if (damage >= 100) {
                gameState = 'GAME_OVER';
                stopAllAudio();
                showEndScreen("VEHÍCULO AVERIADO\nDaño crítico en el motor.", false);
                return;
            }
        }
    }

    if (checkOpponentCollisions(dt)) return;

    position += (speed * WORLD_SCROLL_FACTOR * dt);
    
    if (position >= trackLength) {
        registerLap();
        if (currentLap < TOTAL_LAPS) {
            const lt = lapTimes[lapTimes.length - 1];
            hudToast = { t: 2.4, text: 'VUELTA ' + currentLap, sub: formatTime(lt) + (lt === bestLapThisRace ? '  ★ MEJOR' : '') };
            position = position % trackLength; 
            currentLap++; 
            timeLeft += lapBonus; 
            score += 3000;
        } else {
            let finalRank = calculateRealRacePosition(true); 
            gameState = 'GAME_OVER'; speed = 0;
            stopAllAudio();
            showEndScreen(buildRaceSummary(finalRank), finalRank <= 2);
            return;
        }
    }

    if (speed > 10) {
        score += Math.floor((speed / 90));
        const srp = speed / MAX_SPEED;
        if (!isOffRoad && phys.base === 'gravel' && Math.random() < 0.12 + 0.35 * srp) {
            particles.push({ x: (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25) + steerInput * 30, y: HEIGHT - 40 - Math.random() * 10, size: Math.random() * 4 + 3, alpha: 0.6, color: '#c9a56a' });
        } else if (!isOffRoad && phys.base === 'snow' && Math.random() < 0.12 + 0.35 * srp) {
            particles.push({ x: (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25) + steerInput * 30, y: HEIGHT - 40 - Math.random() * 10, size: Math.random() * 3.5 + 2.5, alpha: 0.6, color: '#ffffff' });
        }
        if (isOffRoad && Math.random() < 0.25) {
            particles.push({ x: playerX * (WIDTH * 0.25) + (Math.random() * 20 - 10), y: HEIGHT - 40, size: Math.random() * 3 + 2, alpha: 0.6, color: '#9e7a44' });
        } else if (!isOffRoad && Math.abs(steerInput) > 0.65 && speed > MAX_SPEED * 0.5 && Math.random() < 0.3) {
            particles.push({ x: (steerInput > 0 ? -1 : 1) * 55 + (Math.random() * 12 - 6), y: HEIGHT - 35, size: Math.random() * 2.5 + 1.5, alpha: 0.5, color: '#e8e8e8' });
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].y -= 2; particles[i].alpha -= 0.05;
        if (particles[i].alpha <= 0) particles.splice(i, 1);
    }
}

function updateOpponentsIA(dt) {
    let diff = DIFFICULTY_PRESETS[selectedDifficultyIdx];
    for (let cp of opponents) {
        let seg = findSegment(cp.position);
        if (!seg) continue;
        cp.position += (cp.speed * (1.0 - (Math.abs(gCurve(seg)) * diff.curveSlowdown)) * (seg.rivalMul || 1) * WORLD_SCROLL_FACTOR * dt);
        if (cp.position >= trackLength) { 
            cp.position = cp.position % trackLength; 
            cp.lapsCompleted++; 
        }
        cp.playerX += Math.sin(totalTime * 2.5 + cp.id) * 0.012;
    }
}

// Detecta choques usando el mismo criterio que el render: segmento del rival vs segmentos
// inmediatamente delante del jugador. Si el rival está en uno de esos segmentos Y su X
// se solapa con el jugador, hay choque real.
let lastOpponentCollisionTime = -1;
function checkOpponentCollisions(dt) {
    const playerSeg = Math.floor(position / SEGMENT_LENGTH) % trackSegments.length;
    // El jugador ocupa visualmente los 4 segmentos que tiene justo delante
    const COLLISION_SEG_AHEAD = 4;

    for (let cp of opponents) {
        const rivalSeg = Math.floor(cp.position / SEGMENT_LENGTH) % trackSegments.length;

        // Distancia en segmentos (circular)
        let segDiff = rivalSeg - playerSeg;
        if (segDiff > trackSegments.length / 2) segDiff -= trackSegments.length;
        else if (segDiff < -trackSegments.length / 2) segDiff += trackSegments.length;

        // Solo los rivales que están en los segmentos justo delante del jugador
        if (segDiff < 0 || segDiff > COLLISION_SEG_AHEAD) continue;

        const diffX = playerX - cp.playerX;
        if (Math.abs(diffX) >= OPPONENT_COLLISION_X_RANGE) continue;

        // Hay solapamiento visual: procesar choque
        // Cooldown global muy corto (0.1s) solo para evitar daño múltiple en el mismo frame
        if (totalTime - lastOpponentCollisionTime > 0.1) {
            speed = Math.max(speed * 0.55, 20);
            damage = Math.min(100, damage + 12);
            lastOpponentCollisionTime = totalTime;
            crashFlashTimer = CRASH_FLASH_DURATION;
            playCrashSound();

            let pushDir = diffX !== 0 ? Math.sign(diffX) : (Math.random() < 0.5 ? -1 : 1);
            playerX += pushDir * 0.4;
            cp.playerX -= pushDir * 0.15;

            if (damage >= 100) {
                gameState = 'GAME_OVER';
                stopAllAudio();
                showEndScreen("VEHÍCULO AVERIADO\nColisión fatal contra un rival.", false);
                return true;
            }
        }
    }
    return false;
}

let _cachedRank = 1;
let _rankFrameCount = 0;
const RANK_UPDATE_INTERVAL = 30; // recalcular posición cada 30 frames (~0.5s) en vez de cada frame

function calculateRealRacePosition(raceFinished = false) {
    let playerDist = raceFinished ? (TOTAL_LAPS * trackLength) : ((currentLap - 1) * trackLength + position);
    let rank = 1;
    for (let cp of opponents) {
        let cpDist = cp.lapsCompleted * trackLength + cp.position;
        if (cpDist > playerDist) rank++;
    }
    return rank;
}

function project3D(point, cameraX, cameraY, cameraZ, depth) {
    let transX = point.world.x - cameraX;
    let transY = point.world.y - cameraY;
    let transZ = point.world.z - cameraZ;
    if (transZ < 0) transZ += trackLength;
    let scale = depth / transZ;
    point.screen.x = Math.round((WIDTH / 2) + (scale * transX * WIDTH / 2));
    point.screen.y = Math.round((HEIGHT / 2) - (scale * transY * HEIGHT / 2));
    point.screen.w = Math.round(scale * ROAD_WIDTH * WIDTH / 2);
    return scale;
}

function drawChampionshipHorizon(horizonY) {
    ctx.fillStyle = currentPalette.mountain1; ctx.beginPath(); ctx.moveTo(0, HEIGHT); ctx.lineTo(0, horizonY);
    for (let i = 0; i <= WIDTH; i += 40) {
        let idx = Math.abs(Math.floor(i / 40 + skyScrollX * 10)) % MOUNTAIN_PEAKS_LAYER1.length;
        ctx.lineTo(i, horizonY - MOUNTAIN_PEAKS_LAYER1[idx]);
    }
    ctx.lineTo(WIDTH, HEIGHT); ctx.closePath(); ctx.fill();

    ctx.fillStyle = currentPalette.mountain2; ctx.beginPath(); ctx.moveTo(0, HEIGHT); ctx.lineTo(0, horizonY);
    for (let i = 0; i <= WIDTH; i += 50) {
        let idx = Math.abs(Math.floor(i / 50 + skyScrollX * 18)) % MOUNTAIN_PEAKS_LAYER2.length;
        ctx.lineTo(i, horizonY - MOUNTAIN_PEAKS_LAYER2[idx]);
    }
    ctx.lineTo(WIDTH, HEIGHT); ctx.closePath(); ctx.fill();
}

function showEndScreen(text, isVictory) {
    const titleElement = document.getElementById('goTitle');
    titleElement.innerText = isVictory ? "¡VICTORIA!" : (text.indexOf("¡CARRERA COMPLETADA!") === 0 ? "FIN DE CARRERA" : "FIN DE JUEGO");
    titleElement.style.color = isVictory ? "#00ffcc" : "#ff0055"; 
    document.getElementById('goReason').innerText = text;
    document.getElementById('menuGameOver').classList.remove('hidden');
}

// Gradiente de cielo: depende de la paleta de la pista activa, por eso se reconstruye una sola vez
// cada vez que se arma un circuito (buildSelectedChampionshipTrack) en vez de crearse cada frame.
let _skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
function rebuildSkyGradient() {
    _skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    _skyGrad.addColorStop(0, currentPalette.skyTop);
    _skyGrad.addColorStop(0.6, currentPalette.skyMid);
    _skyGrad.addColorStop(1, currentPalette.skyBottom);
}
rebuildSkyGradient();
// (2 objetos anidados x 200 segmentos x 60fps = ~24.000 objetos/seg antes de este cambio).
const _renderPt1 = { world: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0 } };
const _renderPt2 = { world: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0 } };

// Dibuja un elemento de decorado lateral (árbol o edificio) escalado por la perspectiva de la pista.
// x/y llegan en coordenadas de pantalla (igual que los sprites de rivales), scale viene de project3D.
function drawSceneryObject(type, x, y, scale, sizeVar, dir) {
    if (scale <= 0) return;
    if (type === 'chevron') {
        const ch = 260 * scale * (WIDTH / 2), cw = ch * 0.62;
        if (ch < 4 || ch > HEIGHT * 1.2) return;
        ctx.fillStyle = '#555555';
        ctx.fillRect(x - cw * 0.04, y - ch * 0.75, cw * 0.08, ch * 0.75);
        ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#111111'; ctx.lineWidth = Math.max(1, cw * 0.05);
        ctx.fillRect(x - cw / 2, y - ch, cw, ch * 0.5); ctx.strokeRect(x - cw / 2, y - ch, cw, ch * 0.5);
        ctx.lineWidth = Math.max(1.5, cw * 0.09);
        const cyy = y - ch * 0.75;
        ctx.beginPath();
        ctx.moveTo(x - dir * cw * 0.15, cyy - ch * 0.16); ctx.lineTo(x + dir * cw * 0.15, cyy); ctx.lineTo(x - dir * cw * 0.15, cyy + ch * 0.16);
        ctx.stroke();
        return;
    }
    const baseSize = 400 * (sizeVar || 1);
    let h = baseSize * scale * (WIDTH / 2);
    if (h < 2 || h > HEIGHT * 1.5) return;
    let w = h * 0.55;

    if (type === 'building') {
        ctx.fillStyle = '#3a4048';
        ctx.fillRect(x - w / 2, y - h, w, h);
        ctx.fillStyle = 'rgba(255, 221, 102, 0.85)';
        let rows = Math.max(1, Math.floor(h / 14));
        let cols = Math.max(1, Math.floor(w / 10));
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if ((r + c) % 3 !== 0) continue;
                ctx.fillRect(x - w / 2 + 3 + c * (w / cols), y - h + 3 + r * (h / rows), 3, 3);
            }
        }
    } else {
        // Tronco y follaje con tonos más saturados + contorno oscuro: el pasto de fondo es un verde
        // apagado, así que sin contraste extra el árbol casi desaparecía sobre él.
        ctx.fillStyle = '#3b2712';
        ctx.fillRect(x - w * 0.08, y - h * 0.35, w * 0.16, h * 0.35);

        ctx.fillStyle = (type === 'snowpine') ? '#1f5a3a' : '#2f8a42';
        ctx.strokeStyle = '#0a2410';
        ctx.lineWidth = Math.max(1, w * 0.04);
        ctx.beginPath();
        ctx.moveTo(x, y - h); ctx.lineTo(x - w * 0.5, y - h * 0.32); ctx.lineTo(x + w * 0.5, y - h * 0.32);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y - h * 0.72); ctx.lineTo(x - w * 0.4, y - h * 0.12); ctx.lineTo(x + w * 0.4, y - h * 0.12);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        if (type === 'snowpine') {
            ctx.fillStyle = '#f4f8fc';
            ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x - w * 0.2, y - h * 0.72); ctx.lineTo(x + w * 0.2, y - h * 0.72); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x, y - h * 0.72); ctx.lineTo(x - w * 0.17, y - h * 0.5); ctx.lineTo(x + w * 0.17, y - h * 0.5); ctx.closePath(); ctx.fill();
        }
    }
}

// Rastro de neumáticos al derrapar en curva cerrada (distinto del polvo de tierra fuera de pista)
function drawSpeedEffects(speedRatio) {
    if (speedRatio < 0.55) return;
    const intensity = (speedRatio - 0.55) / 0.45;
    ctx.strokeStyle = `rgba(255,255,255,${(0.14 * intensity).toFixed(3)})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        let y = Math.random() * HEIGHT * 0.85;
        let len = 30 + Math.random() * 90 * intensity;
        let fromLeft = Math.random() < 0.5;
        let xStart = fromLeft ? 0 : WIDTH;
        let dir = fromLeft ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(xStart, y);
        ctx.lineTo(xStart + dir * len, y);
        ctx.stroke();
    }
}

function executeGraphicsRender() {
    if (trackSegments.length === 0) return;
    ctx.imageSmoothingEnabled = false;
    if (hudToast.t > 0) hudToast.t -= STEP;

    let shakeX = 0, shakeY = 0;
    if (gameState === 'RUNNING' && speed > 20) {
        let shk = (speed / MAX_SPEED) * (Math.abs(playerX) > 1.0 ? 2.5 : (0.5 + (((findSegment(position) || {}).phys || SURFACES.asphalt).noiseG - 0.03) * 12));
        shakeX = (Math.random() - 0.5) * shk; shakeY = (Math.random() - 0.5) * shk;
    }

    ctx.fillStyle = _skyGrad; ctx.fillRect(0, 0, WIDTH, HEIGHT);

    let horizonY = Math.round(HEIGHT / 2);
    drawChampionshipHorizon(horizonY);

    let playerSegment = findSegment(position);
    let playerPercent = (position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    camY = camY * 0.8 + ((playerSegment.p1.world.y + (playerSegment.p2.world.y - playerSegment.p1.world.y) * playerPercent) + CAMERA_HEIGHT_DEFAULT) * 0.2;
    // camX ya no suma playerSegment.p1/p2.world.x: ese término era el mismo valor absoluto que
    // acabamos de sacar del render por causar el desfasaje. En coordenadas locales, el segmento
    // de la cámara siempre es la referencia "0", así que solo queda el offset lateral por dirección.
    camX = camX * 0.8 + (playerX * ROAD_WIDTH) * 0.2;

    let maxy = HEIGHT;
    let startIdx = Math.floor(position / SEGMENT_LENGTH);
    let spritesToRender = [];
    let sceneryToRender = [];
    let dx = -(playerSegment.curve * playerPercent), xAccum = 0;

    for (let i = 0; i < DRAW_DISTANCE; i++) {
        let currentIdx = (startIdx + i) % trackSegments.length;
        let seg = trackSegments[currentIdx];
        let camZOffset = position - (startIdx + i >= trackSegments.length ? trackLength : 0);

        let pt1 = _renderPt1, pt2 = _renderPt2;
        // Antes: "seg.p1.world.x + xAccum" sumaba un valor absoluto (acumulado sin cerrar el lazo
        // desde el segmento 0 hasta el último) con uno local (reiniciado en 0 cada frame). Al cruzar
        // del último segmento al primero (justo en la línea de llegada) los dos no coincidían y
        // generaban un salto visible en el ancho/posición de la pista. Usando solo la acumulación
        // local, el resultado es continuo sin importar en qué punto de la vuelta esté la cámara.
        pt1.world.x = xAccum; pt1.world.y = seg.p1.world.y; pt1.world.z = seg.p1.world.z;
        pt2.world.x = xAccum + dx + seg.curve; pt2.world.y = seg.p2.world.y; pt2.world.z = seg.p2.world.z;

        let scale = project3D(pt1, camX + shakeX * 3, camY + shakeY * 3, camZOffset, BASE_CAMERA_DEPTH);
        project3D(pt2, camX + shakeX * 3, camY + shakeY * 3, camZOffset, BASE_CAMERA_DEPTH);

        xAccum += dx; dx += seg.curve;
        if (pt1.screen.y >= maxy || pt2.screen.y >= maxy || scale <= 0) continue;

        ctx.fillStyle = seg.color.grass; ctx.fillRect(0, pt2.screen.y, WIDTH, (pt1.screen.y + 1) - pt2.screen.y);
        
        let r1 = pt1.screen.w * 0.12, r2 = pt2.screen.w * 0.12;
        ctx.fillStyle = seg.color.rumble;
        ctx.beginPath(); ctx.moveTo(pt1.screen.x - pt1.screen.w - r1, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x - pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x - pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x - pt2.screen.w - r2, pt2.screen.y); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(pt1.screen.x + pt1.screen.w + r1, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x + pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x + pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x + pt2.screen.w + r2, pt2.screen.y); ctx.closePath(); ctx.fill();
        
        ctx.fillStyle = seg.color.road;
        ctx.beginPath(); ctx.moveTo(pt1.screen.x - pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt1.screen.x + pt1.screen.w, pt1.screen.y + 1); ctx.lineTo(pt2.screen.x + pt2.screen.w, pt2.screen.y); ctx.lineTo(pt2.screen.x - pt2.screen.w, pt2.screen.y); ctx.closePath(); ctx.fill();
        
        if (seg.index === 0) { 
            ctx.fillStyle = '#ffffff'; ctx.fillRect(pt1.screen.x - pt1.screen.w, pt2.screen.y, pt1.screen.w * 2, (pt1.screen.y - pt2.screen.y) * 0.4);
        }

        const fogA = 1 - 1 / Math.exp(Math.pow(i / DRAW_DISTANCE, 2) * currentPalette.fogD);
        drawSurfaceMarks(seg, pt1, pt2, fogA);

        maxy = pt1.screen.y;

        if (seg.decoration) {
            // Mismo sistema de posicionamiento lateral que los autos rivales (offset normalizado tipo
            // playerX × ROAD_WIDTH), en vez de sumar sobre el ancho de pista ya proyectado en pantalla:
            // ese ancho es enorme en los segmentos cercanos y empujaba el decorado fuera de la pantalla.
            let lateralOffset = seg.decoration.side * 1.3; // justo pasado el borde transitable (offroad > 1.0)
            let sx = pt1.screen.x + (scale * lateralOffset * ROAD_WIDTH * WIDTH / 2);
            sceneryToRender.push({
                type: seg.decoration.type,
                x: sx,
                y: pt1.screen.y,
                scale: scale,
                sizeVar: seg.decoration.sizeVar,
                fog: fogA
            });
        }

        if (seg.sign && !seg.sign.down) {
            let sgx = pt1.screen.x + (scale * (seg.sign.side * 1.3) * ROAD_WIDTH * WIDTH / 2);
            sceneryToRender.push({ type: 'chevron', x: sgx, y: pt1.screen.y, scale: scale, sizeVar: 1, dir: seg.sign.dir, fog: fogA });
        }

        for (let cp of opponents) {
            if ((Math.floor(cp.position / SEGMENT_LENGTH) % trackSegments.length) === seg.index) {
                spritesToRender.push({ sx: pt1.screen.x + shakeX, sy: pt1.screen.y + shakeY, cp: cp, scale: scale, fog: fogA });
            }
        }
    }

    // De más lejos a más cerca, igual que los sprites de rivales, para que el decorado cercano
    // tape al lejano en vez de al revés.
    for (let i = sceneryToRender.length - 1; i >= 0; i--) {
        let s = sceneryToRender[i];
        ctx.globalAlpha = Math.max(0.05, 1 - s.fog);
        drawSceneryObject(s.type, s.x + shakeX, s.y + shakeY, s.scale, s.sizeVar, s.dir);
        ctx.globalAlpha = 1;
    }

    for (let p of particles) {
        ctx.fillStyle = p.color; ctx.globalAlpha = p.alpha; ctx.beginPath();
        ctx.arc(WIDTH / 2 + p.x + shakeX, p.y + shakeY, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    for (let i = spritesToRender.length - 1; i >= 0; i--) {
        let s = spritesToRender[i];
        let spriteX = Math.round(s.sx + (s.scale * s.cp.playerX * ROAD_WIDTH * WIDTH / 2));
        ctx.globalAlpha = Math.max(0.2, 1 - s.fog);
        let sizeMultiplier = 3.75; // 75% del tamaño duplicado anterior (5)
        let w = Math.round(190 * s.scale * (WIDTH / 2) * sizeMultiplier);
        let h = Math.round(130 * s.scale * (WIDTH / 2) * sizeMultiplier);
        
        if (spriteX + w/2 > 0 && spriteX - w/2 < WIDTH) {
            let rivalImg = carTextures[s.cp.textureIndex];
            if (rivalImg && rivalImg.complete && rivalImg.naturalWidth !== 0) {
                const dims = computeFitDims(rivalImg, w, h);
                ctx.drawImage(rivalImg, spriteX - dims.w / 2, s.sy - dims.h, dims.w, dims.h);
            } else {
                ctx.fillStyle = (s.cp.textureIndex === 0) ? '#ff2a00' : (s.cp.textureIndex === 1) ? '#0066ff' : '#ccaa00';
                ctx.fillRect(spriteX - w / 2, s.sy - h + (25 * sizeMultiplier), w, h - (40 * sizeMultiplier));
            }
        }
    }

    ctx.globalAlpha = 1;
    if (gameState === 'RUNNING') {
        drawSpeedEffects(speed / MAX_SPEED);
    }

    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN' || gameState === 'PAUSED') {
        const cW = 285, cH = 195; // 75% del tamaño duplicado anterior (380x260)
        // Rebote sutil ligado a la velocidad e inclinación al girar: le da peso al auto en vez de
        // que se deslice como un sprite plano pegado al piso.
        const bounce = (gameState === 'RUNNING' && speed > 5) ? Math.sin(totalTime * 14) * (speed / MAX_SPEED) * 2.2 : 0;
        const leanAngle = steerInput * 0.09;
        const cX = (WIDTH / 2) - (cW / 2) + (steerInput * 35) + shakeX;
        const cY = HEIGHT - cH - 20 + shakeY + bounce;
        let currentImg = carTextures[selectedVehicleIdx];

        ctx.save();
        ctx.translate(cX + cW / 2, cY + cH);
        ctx.rotate(leanAngle);
        ctx.translate(-(cX + cW / 2), -(cY + cH));

        if (currentImg && currentImg.complete && currentImg.naturalWidth !== 0) {
            const dims = computeFitDims(currentImg, cW, cH);
            const dx = cX + (cW - dims.w) / 2;
            const dy = cY + (cH - dims.h);
            ctx.drawImage(currentImg, dx, dy, dims.w, dims.h);
        } else {
            let colBody = (selectedVehicleIdx === 0) ? '#ff2a00' : (selectedVehicleIdx === 1) ? '#0066ff' : '#ccaa00';
            ctx.fillStyle = '#0f0f14'; ctx.fillRect(cX + 6, cY + cH - 35, 24, 35); ctx.fillRect(cX + cW - 30, cY + cH - 35, 24, 35);
            ctx.fillStyle = colBody; ctx.fillRect(cX, cY + 25, cW, cH - 40);
            ctx.fillStyle = '#14161f'; ctx.fillRect(cX + 16, cY + 35, cW - 32, 25);
            ctx.fillStyle = keys.down ? '#ff1111' : '#660000'; ctx.fillRect(cX + 8, cY + cH - 28, 22, 10); ctx.fillRect(cX + cW - 30, cY + cH - 28, 22, 10);
        }

        ctx.restore();
    }

    drawWeatherEffects();

    // Flash rojo de choque: se dibuja sobre todo excepto el HUD
    if (crashFlashTimer > 0) {
        let flashAlpha = (crashFlashTimer / CRASH_FLASH_DURATION) * 0.55;
        ctx.fillStyle = `rgba(255, 30, 0, ${flashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    drawHUD();
    
    const trackSelect = document.getElementById('selectTrack');
    let activeTrack = trackSelect ? parseInt(trackSelect.value) : selectedTrackIdx;
    drawAbsoluteMathematicalMinimap(ctx, WIDTH - 115, 20, 95, true, activeTrack);
    drawPauseOverlay();
}

// Cache del minimapa: el trazado geométrico es fijo por pista, no tiene sentido recalcularlo 60 veces/seg.
// Se invalida solo cuando cambia selectedTrackIdx (al presionar Empezar o al volver al menú).
let _minimapCache = null; // { trackType, coords, minX, maxX, minY, maxY }

function _buildMinimapCoords(segmentsToDraw) {
    // Geometría REAL de la pista: cada segmento gira curva/SEGMENT_LENGTH radianes, la misma relación que usa el render.
    // El circuito ya cierra por construcción (ver closeCircuitGeometry), así que no se fuerza ni se corrige nada:
    // lo que muestra el minimapa es exactamente lo que se maneja.
    let coords = [];
    let heading = 0, cx = 0, cz = 0;
    for (let i = 0; i < segmentsToDraw.length; i++) {
        heading += segmentsToDraw[i].curve / SEGMENT_LENGTH;
        cx += Math.cos(heading) * SEGMENT_LENGTH * 0.1;
        cz += Math.sin(heading) * SEGMENT_LENGTH * 0.1;
        coords.push({ x: cx, y: cz });
    }

    // Bounding box precalculado (evita 4 spreads de array en cada frame)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of coords) {
        if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
    }
    return { coords, minX, maxX, minY, maxY };
}

function invalidateMinimapCache() { _minimapCache = null; }
// ============================================================================
// DIBUJO GEOMÉTRICO 100% SINCRO DINÁMICO BASADO EN SEGMENTOS REALES (CORREGIDO)
// ============================================================================
function drawAbsoluteMathematicalMinimap(targetCtx, x, y, size, renderActors, trackType) {
    targetCtx.fillStyle = 'rgba(12, 6, 22, 0.9)';
    targetCtx.strokeStyle = '#5c2e91';
    targetCtx.lineWidth = 3;
    targetCtx.beginPath();
    targetCtx.roundRect(x, y, size, size, 8);
    targetCtx.fill();
    targetCtx.stroke();

    let segmentsToDraw = trackSegments;
    if (!renderActors || trackSegments.length === 0) {
        let backupSegments = trackSegments;
        let backupLength = trackLength;
        let backupTimeLeft = timeLeft;
        let backupTotalLaps = TOTAL_LAPS;
        // buildSelectedChampionshipTrack también fija currentPalette y reconstruye el gradiente del
        // cielo; como esto es solo una previsualización del trazado, hay que restaurar ambos también
        // para no pisarle los colores de cielo/horizonte a la carrera real que sigue detrás del menú.
        let backupPalette = currentPalette;
        let backupSkyGrad = _skyGrad;
        let backupLenF = trackLenF, backupNotes = pacenotes, backupLapBonus = lapBonus;
        buildSelectedChampionshipTrack(trackType);
        segmentsToDraw = trackSegments;
        trackSegments = backupSegments;
        trackLength = backupLength;
        timeLeft = backupTimeLeft;
        TOTAL_LAPS = backupTotalLaps;
        currentPalette = backupPalette;
        _skyGrad = backupSkyGrad;
        trackLenF = backupLenF;
        pacenotes = backupNotes;
        lapBonus = backupLapBonus;
    }

    if (segmentsToDraw.length === 0) return;

    // Usar cache del trazado; recalcular solo si cambió la pista
    if (!_minimapCache || _minimapCache.trackType !== trackType) {
        _minimapCache = { trackType, ..._buildMinimapCoords(segmentsToDraw) };
    }
    const { coords, minX, maxX, minY, maxY } = _minimapCache;

    const trackW = maxX - minX;
    const trackH = maxY - minY;
    const scale = Math.min((size - 24) / (trackW || 1), (size - 24) / (trackH || 1));
    const offsetX = x + (size - trackW * scale) / 2 - minX * scale;
    const offsetY = y + (size - trackH * scale) / 2 - minY * scale;

    targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    targetCtx.lineWidth = 4;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    targetCtx.beginPath();
    for (let i = 0; i < coords.length; i++) {
        const scX = offsetX + coords[i].x * scale;
        const scY = offsetY + coords[i].y * scale;
        if (i === 0) targetCtx.moveTo(scX, scY);
        else targetCtx.lineTo(scX, scY);
    }
    targetCtx.closePath();
    targetCtx.stroke();

    if (!renderActors || trackSegments.length === 0) return;

    // Enemigos en el mapa
    targetCtx.fillStyle = '#ff3355';
    for (let cp of opponents) {
        let idx = Math.floor((cp.position / trackLength) * coords.length) % coords.length;
        if (coords[idx]) {
            targetCtx.beginPath();
            targetCtx.arc(offsetX + coords[idx].x * scale, offsetY + coords[idx].y * scale, 3.5, 0, Math.PI * 2);
            targetCtx.fill();
        }
    }

    // Jugador en el mapa
    let pIdx = Math.floor((position / trackLength) * coords.length) % coords.length;
    if (coords[pIdx]) {
        targetCtx.fillStyle = '#00ffcc';
        targetCtx.strokeStyle = '#ffffff';
        targetCtx.lineWidth = 1.5;
        targetCtx.beginPath();
        targetCtx.arc(offsetX + coords[pIdx].x * scale, offsetY + coords[pIdx].y * scale, 5.5, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.stroke();
    }
}

window.updateMenuTrackPreview = function() {
    const pCanvas = document.getElementById('menuMapCanvas');
    const trackSelect = document.getElementById('selectTrack');
    if (pCanvas && trackSelect) {
        let trackType = parseInt(trackSelect.value);
        const pCtx = pCanvas.getContext('2d');
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        drawAbsoluteMathematicalMinimap(pCtx, 5, 5, 120, false, trackType);
    }
};

function hudPanel(x, y, w, h) { ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(x, y, w, h); }
function hudArrow(cx, cy, dir, sz, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + dir * sz, cy); ctx.lineTo(cx - dir * sz * 0.6, cy - sz * 0.9); ctx.lineTo(cx - dir * sz * 0.6, cy + sz * 0.9);
    ctx.closePath(); ctx.fill();
}

function drawPacenotesHUD() {
    if (voiceMode === 2) return;
    const rows = upcomingNotes(3, 450);
    if (!rows.length) return;
    const px = WIDTH - 215, py = 160, rh = 27;
    hudPanel(px, py, 205, rows.length * rh + 6);
    rows.forEach(function (r, i) {
        const y = py + 3 + i * rh + rh / 2, g = r.n.grade;
        const col = g <= 2 ? '#ff5252' : g <= 4 ? '#ffb800' : '#6bff8a';
        ctx.globalAlpha = i === 0 ? 1 : 0.65;
        hudArrow(px + 20, y, r.n.dir === 'R' ? 1 : -1, 9, col);
        ctx.font = 'bold 22px monospace'; ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.fillText(String(g), px + 46, y + 8);
        const tag = (r.n.hairpin ? 'HORQ ' : '') + (r.n.long ? 'LARGA' : '');
        if (tag) { ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#ffffff'; ctx.fillText(tag, px + 70, y + 5); }
        ctx.font = 'bold 16px monospace'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right';
        ctx.fillText(Math.round(r.m / 10) * 10 + 'm', px + 197, y + 6);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
    });
}

function drawHUD() {
    if (gameState === 'START') return;
    if (gameState === 'COUNTDOWN') {
        ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 55px monospace'; ctx.textAlign = 'center';
        ctx.fillText(countdownText, WIDTH / 2, HEIGHT / 2 - 30); ctx.textAlign = 'left';
        return;
    }
    const cs = findSegment(position);
    const phys = (cs && cs.phys) || SURFACES.asphalt;
    const surfKey = (cs && cs.surfaceKey) || 'asphalt';

    hudPanel(15, 16, 195, 178);
    hudPanel(WIDTH - 400, 22, 282, 138);

    ctx.fillStyle = timeLeft < 15 ? '#ff3333' : '#ffffff'; ctx.font = 'bold 24px monospace';
    ctx.fillText(`TIEMPO: ${Math.ceil(timeLeft)}s`, 25, 45);

    ctx.fillStyle = '#ffffff'; ctx.font = '22px monospace';
    ctx.fillText(`${Math.floor(speed)} KM/H`, 25, 75);

    ctx.fillStyle = '#222533'; ctx.fillRect(25, 88, 140, 6);
    ctx.fillStyle = playerRpm > 6000 ? '#ff3333' : '#00ffcc';
    ctx.fillRect(25, 88, (playerRpm / 7500) * 140, 6);

    ctx.fillStyle = '#c8d2e0'; ctx.font = '14px monospace';
    ctx.fillText(`MARCHA ${engGear}`, 25, 114);

    ctx.fillStyle = '#8a9ab0'; ctx.font = '15px monospace';
    ctx.fillText(`DAÑO: ${damage}%`, 25, 138);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(25, 145, 140, 6);
    ctx.fillStyle = damage > 66 ? '#ff4d4d' : damage > 33 ? '#ffb800' : '#6bff8a';
    ctx.fillRect(25, 145, 140 * damage / 100, 6);

    ctx.fillStyle = SURFACE_LABEL_COLOR[surfKey]; ctx.font = 'bold 15px monospace';
    ctx.fillText(phys.name, 25, 174);
    const weatherLabel = WEATHER_PRESETS[selectedWeatherIdx].name.toUpperCase();
    if (weatherLabel !== phys.name) {
        ctx.fillStyle = '#8a9ab0'; ctx.font = '12px monospace';
        ctx.fillText(weatherLabel, 25, 188);
    }

    ctx.fillStyle = '#ffff00'; ctx.font = 'bold 22px monospace';
    ctx.fillText(`PUNTOS: ${score}`, WIDTH - 390, 45);

    let kmRecorridos = ((currentLap - 1) * trackLength + position) * M_PER_UNIT / 1000;
    let kmTotales = (TOTAL_LAPS * trackLength) * M_PER_UNIT / 1000;
    ctx.fillStyle = '#ffffff'; ctx.font = '16px monospace';
    ctx.fillText(`TRK: ${kmRecorridos.toFixed(2)} / ${kmTotales.toFixed(2)} KM`, WIDTH - 390, 75);

    _rankFrameCount++;
    if (_rankFrameCount >= RANK_UPDATE_INTERVAL) {
        _cachedRank = calculateRealRacePosition(gameState === 'GAME_OVER');
        _rankFrameCount = 0;
    }
    let rank = _cachedRank;
    ctx.fillStyle = '#00ffcc'; ctx.font = 'bold 18px monospace';
    ctx.fillText(`POSICIÓN: P${rank} (VUELTA ${currentLap}/${TOTAL_LAPS})`, WIDTH - 390, 105);

    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px monospace';
    ctx.fillText(`VUELTA ${formatTime(totalTime - lapStartTime)}`, WIDTH - 390, 130);
    ctx.fillStyle = '#c8d2e0'; ctx.font = '13px monospace';
    ctx.fillText(`MEJOR ${formatTime(bestLapThisRace)}  ·  TOTAL ${formatTime(totalTime)}`, WIDTH - 390, 150);

    drawPacenotesHUD();

    if (hudToast.t > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px monospace';
        ctx.fillText(hudToast.text, WIDTH / 2, HEIGHT / 2 - 2);
        if (hudToast.sub) { ctx.fillStyle = '#ffcc00'; ctx.font = 'bold 26px monospace'; ctx.fillText(hudToast.sub, WIDTH / 2, HEIGHT / 2 + 30); }
        ctx.textAlign = 'left';
    }
}

// Antes se llamaba a updatePhysicsEngine(STEP) una vez por cada callback de requestAnimationFrame,
// asumiendo que ese callback siempre llega ~60 veces por segundo. Chrome cumple eso en la práctica,
// pero Firefox (según hardware/configuración) puede disparar rAF con menos frecuencia real, y como
// cada llamada seguía avanzando la física un solo paso fijo, el juego entero corría en cámara lenta.
// Con un acumulador de tiempo real se ejecutan tantos pasos fijos de STEP como hagan falta para
// ponerse al día, sin importar a qué frecuencia dispare rAF cada navegador.
let _lastFrameTime = null;
let _physicsAccumulator = 0;
const MAX_STEPS_PER_FRAME = 5; // evita "spiral of death" si la pestaña estuvo en segundo plano

function runMasterGameLoop(currentTime) {
    if (_lastFrameTime === null) _lastFrameTime = currentTime;
    let frameDelta = (currentTime - _lastFrameTime) / 1000;
    _lastFrameTime = currentTime;
    if (frameDelta > 0.25) frameDelta = 0.25; // clamp ante lag puntual o pestaña recién reactivada

    _physicsAccumulator += frameDelta;
    let steps = 0;
    while (_physicsAccumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
        updatePhysicsEngine(STEP);
        _physicsAccumulator -= STEP;
        steps++;
    }

    executeGraphicsRender();
    requestAnimationFrame(runMasterGameLoop);
}

function resetRaceCounters() {
    stopAllAudio();
    position = 0; speed = 0; totalTime = 0; currentLap = 1; score = 0; damage = 0; playerX = 0; crashCooldown = 0; opponentCrashCooldown = 0; crashFlashTimer = 0; lastOpponentCollisionTime = -1;
    particles = []; steerInput = 0; latVel = 0; camX = 0; camY = CAMERA_HEIGHT_DEFAULT; skyScrollX = 0;
    _cachedRank = 1; _rankFrameCount = 0;
    lapStartTime = 0; lapTimes = []; bestLapThisRace = null; noteAnnounced = {}; hudToast.t = 0;
    invalidateMinimapCache();
}

function resetRaceState() {
    resetRaceCounters();
    gameState = 'START';
    document.getElementById('menuGameOver').classList.add('hidden');
    document.getElementById('menuStart').classList.remove('hidden');
    setTimeout(window.updateMenuTrackPreview, 50);
    updateMenuRecords();
}

// Repite la misma carrera con la misma configuración (sin pasar por el menú)
function retryRace() {
    resetRaceCounters();
    document.getElementById('menuGameOver').classList.add('hidden');
    startRaceFromMenuSelection();
}
window.retryRace = retryRace;

window.resetRaceState = resetRaceState;
window.onload = function() {
    initInputSystem();
    buildSelectedChampionshipTrack(0);
    updateMenuRecords();
    setTimeout(window.updateMenuTrackPreview, 100);
    requestAnimationFrame(runMasterGameLoop);
};