// FIFA Arcade & FUT Card Creator Game Engine

// --- Google Authentication Whitelist Configuration ---
const AUTH_CONFIG = {
    // Replace this with your Google Cloud Client ID (from Google Developer Console)
    clientId: "969197700169-su191805de8ad6tco43pe60nvfj1d2ln.apps.googleusercontent.com",
    
    // Serverless endpoints to verify token (tries Vercel first, falls back to Netlify)
    endpoints: {
        vercel: "/api/auth",
        netlify: "/.netlify/functions/auth"
    }
};

// --- Team Database ---
const TEAMS = {
    RMA: { name: "Real Madrid", short: "RMA", color: "#ffffff", textColor: "#080d1a", stats: { ATT: 91, MID: 90, DEF: 88, OVR: 90 } },
    MCI: { name: "Manchester City", short: "MCI", color: "#87ceeb", textColor: "#080d1a", stats: { ATT: 90, MID: 92, DEF: 89, OVR: 90 } },
    BAY: { name: "Bayern Munich", short: "BAY", color: "#dc2626", textColor: "#ffffff", stats: { ATT: 89, MID: 88, DEF: 86, OVR: 88 } },
    PSG: { name: "Paris SG", short: "PSG", color: "#1e3a8a", textColor: "#ffffff", stats: { ATT: 92, MID: 86, DEF: 85, OVR: 88 } },
    BAR: { name: "Barcelona", short: "BAR", color: "#991b1b", textColor: "#f59e0b", stats: { ATT: 87, MID: 89, DEF: 86, OVR: 87 } },
    LIV: { name: "Liverpool", short: "LIV", color: "#b91c1c", textColor: "#ffffff", stats: { ATT: 88, MID: 85, DEF: 87, OVR: 87 } },
    ARS: { name: "Arsenal", short: "ARS", color: "#e11d48", textColor: "#ffffff", stats: { ATT: 86, MID: 88, DEF: 87, OVR: 87 } },
    CHE: { name: "Chelsea", short: "CHE", color: "#2563eb", textColor: "#ffffff", stats: { ATT: 84, MID: 85, DEF: 83, OVR: 84 } }
};

// --- App State ---
const state = {
    currentTab: 'menu',
    audioInitialized: false,
    audioContext: null,
    audioEnabled: true,
    selectedTeam: 'RMA',
    opponentTeam: 'MCI',
    arcadeGame: null,
    shootoutGame: null,
    crowdSource: null,
    customAvatarUrl: null,
    userProfile: null // Populated by Google Sign-In
};

// --- Google Sign-In Authentication Handlers ---
function initGoogleAuth() {
    if (typeof google === 'undefined') {
        console.warn("Google Client SDK not loaded yet. Retrying in 1s...");
        setTimeout(initGoogleAuth, 1000);
        return;
    }

    // Check cached session in localStorage
    const cachedSession = localStorage.getItem('fc_agent_session');
    if (cachedSession) {
        try {
            const profile = JSON.parse(cachedSession);
            unlockApp(profile);
            return;
        } catch (e) {
            localStorage.removeItem('fc_agent_session');
        }
    }

    google.accounts.id.initialize({
        client_id: AUTH_CONFIG.clientId,
        callback: handleCredentialResponse,
        auto_select: false
    });

    google.accounts.id.renderButton(
        document.getElementById('google-login-btn'),
        { theme: 'filled_blue', size: 'large', width: '280' }
    );

    // One-Tap prompt overlay
    google.accounts.id.prompt();
}

async function handleCredentialResponse(response) {
    const errorEl = document.getElementById('login-error');
    const loadingEl = document.getElementById('login-loading');
    const lockIconEl = document.getElementById('lock-icon');

    errorEl.style.display = 'none';
    loadingEl.style.display = 'block';
    lockIconEl.textContent = '⏳';

    const token = response.credential;

    // Send JWT token to secure Serverless API endpoint
    try {
        let authResult = await verifyTokenWithBackend(token);
        
        if (authResult && authResult.success) {
            // Save local session
            localStorage.setItem('fc_agent_session', JSON.stringify(authResult));
            unlockApp(authResult);
        } else {
            throw new Error(authResult.error || "Authentication failed.");
        }
    } catch (err) {
        console.error("Auth Error:", err);
        loadingEl.style.display = 'none';
        errorEl.textContent = err.message || "Access Denied: Serverless function unreachable.";
        errorEl.style.display = 'block';
        lockIconEl.textContent = '❌';
    }
}

async function verifyTokenWithBackend(token) {
    // Try Vercel API endpoint first
    try {
        let response = await fetch(AUTH_CONFIG.endpoints.vercel, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        });
        
        // If 404, fallback to Netlify Functions endpoint
        if (response.status === 404) {
            console.log("Vercel route returned 404. Falling back to Netlify endpoint...");
            response = await fetch(AUTH_CONFIG.endpoints.netlify, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token })
            });
        }

        const data = await response.json();
        if (response.ok) {
            return data;
        } else {
            return { success: false, error: data.error || `HTTP ${response.status}` };
        }
    } catch (e) {
        // Direct fallback attempt if fetch completely throws network error
        console.log("Vercel fetch failed. Trying Netlify direct network call...");
        const response = await fetch(AUTH_CONFIG.endpoints.netlify, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token })
        });
        const data = await response.json();
        if (response.ok) {
            return data;
        } else {
            return { success: false, error: data.error || `HTTP ${response.status}` };
        }
    }
}

function unlockApp(profile) {
    state.userProfile = profile;
    
    // Hide overlay
    const overlay = document.getElementById('login-overlay');
    overlay.classList.add('hidden');
    
    // Unlock blur
    const appContainer = document.getElementById('app-container');
    appContainer.classList.remove('locked');

    // Customize game elements with Google Profile Info!
    if (profile.name) {
        // Update Creator forms name (Uppercase limit 12 chars)
        const nameField = document.getElementById('fut-input-name');
        const formattedName = profile.name.split(' ')[0].toUpperCase().substring(0, 10);
        if (nameField) nameField.value = formattedName;
    }
    
    if (profile.picture) {
        state.customAvatarUrl = profile.picture;
    }

    // Refresh OVR/Card previews
    renderCreatorPreview();
    
    // Trigger ambient crowd hum on first unlock
    initAudio();
}

// --- Web Audio Synthesis Engine ---
function initAudio() {
    if (state.audioInitialized) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContext();
        state.audioInitialized = true;
        
        // Start atmospheric crowd hum
        startCrowdAmbient();
    } catch(e) {
        console.warn("Web Audio API not supported", e);
    }
}

function playWhistle() {
    if (!state.audioEnabled || !state.audioContext) return;
    const ctx = state.audioContext;
    
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1000, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.1);
    osc1.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.4);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1020, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(1520, ctx.currentTime + 0.1);
    osc2.frequency.exponentialRampToValueAtTime(1420, ctx.currentTime + 0.4);
    
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    
    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.5);
    osc2.stop(ctx.currentTime + 0.5);
}

function playKick() {
    if (!state.audioEnabled || !state.audioContext) return;
    const ctx = state.audioContext;
    
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.12);
    
    oscGain.gain.setValueAtTime(0.4, ctx.currentTime);
    oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    
    const bufferSize = ctx.sampleRate * 0.02;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.04);
    
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    noise.start();
    noise.stop(ctx.currentTime + 0.05);
}

function playGoalHorn() {
    if (!state.audioEnabled || !state.audioContext) return;
    const ctx = state.audioContext;
    
    const baseFreqs = [180, 220, 270];
    const duration = 1.8;
    
    baseFreqs.forEach(freq => {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(freq + 5, ctx.currentTime + 0.2);
        osc.frequency.linearRampToValueAtTime(freq - 5, ctx.currentTime + 0.8);
        
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.1);
        gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 1.2);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1000, ctx.currentTime);
        
        osc.connect(lp);
        lp.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + duration);
    });
    
    // Crowd surge
    const bufferSize = ctx.sampleRate * 2.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
    }
    
    const crowdSource = ctx.createBufferSource();
    crowdSource.buffer = buffer;
    
    const crowdGain = ctx.createGain();
    crowdGain.gain.setValueAtTime(0, ctx.currentTime);
    crowdGain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.3);
    crowdGain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 1.2);
    crowdGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.2);
    
    const crowdLP = ctx.createBiquadFilter();
    crowdLP.type = 'lowpass';
    crowdLP.frequency.value = 600;
    
    crowdSource.connect(crowdLP);
    crowdLP.connect(crowdGain);
    crowdGain.connect(ctx.destination);
    
    crowdSource.start();
    crowdSource.stop(ctx.currentTime + 2.2);
}

function startCrowdAmbient() {
    if (!state.audioEnabled || !state.audioContext) return;
    const ctx = state.audioContext;
    
    if (state.crowdSource) {
        try { state.crowdSource.stop(); } catch(e){}
    }
    
    const bufferSize = ctx.sampleRate * 4.0;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0.0;
    
    for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.015 * white)) / 1.015;
        lastOut = data[i];
        data[i] *= 2.0;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.06, ctx.currentTime);
    
    source.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    source.start();
    state.crowdSource = source;
}

function stopCrowdAmbient() {
    if (state.crowdSource) {
        try {
            state.crowdSource.stop();
        } catch(e) {}
        state.crowdSource = null;
    }
}

// --- Menu Tab Switching ---
function showTab(tabId) {
    state.currentTab = tabId;
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.toggle('active', screen.id === `${tabId}-screen`);
    });
    
    if (state.arcadeGame) {
        state.arcadeGame.stop();
        state.arcadeGame = null;
    }
    if (state.shootoutGame) {
        state.shootoutGame.stop();
        state.shootoutGame = null;
    }
    
    if (tabId === 'arcade') {
        initArcadePreSelection();
    } else if (tabId === 'penalty') {
        initShootoutPreSelection();
    } else if (tabId === 'creator') {
        renderCreatorPreview();
    }
}

// --- UI Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initiate Google Sign-in on load
    initGoogleAuth();

    // Nav Tab Buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            initAudio();
            showTab(btn.dataset.tab);
        });
    });
    
    // Menu Dashboard Cards
    document.querySelectorAll('.menu-card').forEach(card => {
        card.addEventListener('click', () => {
            initAudio();
            showTab(card.dataset.tab);
        });
    });
    
    // Audio Toggle
    const soundToggle = document.getElementById('sound-toggle');
    soundToggle.addEventListener('click', () => {
        state.audioEnabled = !state.audioEnabled;
        soundToggle.classList.toggle('active', state.audioEnabled);
        
        const icon = soundToggle.querySelector('.sound-icon');
        const text = soundToggle.querySelector('.sound-text');
        if (state.audioEnabled) {
            icon.textContent = '🔊';
            text.textContent = 'SOUNDS ON';
            initAudio();
            startCrowdAmbient();
        } else {
            icon.textContent = '🔇';
            text.textContent = 'SOUNDS OFF';
            stopCrowdAmbient();
        }
    });
    
    updateSidebarStats();
    setupFUTFormListeners();
});

function updateSidebarStats() {
    const userTeam = TEAMS[state.selectedTeam];
    const oppTeam = TEAMS[state.opponentTeam];
    
    document.getElementById('sidebar-user-name').textContent = userTeam.name;
    document.getElementById('sidebar-user-ovr').textContent = `OVR: ${userTeam.stats.OVR}`;
    document.getElementById('sidebar-user-att').textContent = userTeam.stats.ATT;
    document.getElementById('sidebar-user-mid').textContent = userTeam.stats.MID;
    document.getElementById('sidebar-user-def').textContent = userTeam.stats.DEF;
    
    document.getElementById('sidebar-opp-name').textContent = oppTeam.name;
    document.getElementById('sidebar-opp-ovr').textContent = `OVR: ${oppTeam.stats.OVR}`;
    document.getElementById('sidebar-opp-att').textContent = oppTeam.stats.ATT;
    document.getElementById('sidebar-opp-mid').textContent = oppTeam.stats.MID;
    document.getElementById('sidebar-opp-def').textContent = oppTeam.stats.DEF;
}

// --- FUT 3D Parallax Tilt Effect ---
const futCard = document.querySelector('.fut-card');
if (futCard) {
    futCard.addEventListener('mousemove', (e) => {
        const rect = futCard.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const deltaX = (x - centerX) / centerX;
        const deltaY = (y - centerY) / centerY;
        
        const rotateX = deltaY * -15;
        const rotateY = deltaX * 15;
        
        futCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
    });
    
    futCard.addEventListener('mouseleave', () => {
        futCard.style.transform = `rotateX(0deg) rotateY(0deg) scale(1)`;
    });
}

// --- Team Select Screen (Pre-game setups) ---
function initArcadePreSelection() {
    renderTeamSelectionGrid('arcade');
}

function initShootoutPreSelection() {
    renderTeamSelectionGrid('penalty');
}

function renderTeamSelectionGrid(mode) {
    const parentContainer = document.getElementById(`${mode}-screen`);
    parentContainer.innerHTML = `
        <h2 class="logo-text text-center mb-4">Select Teams</h2>
        <div class="team-select-grid"></div>
        <div class="team-select-controls">
            <button class="btn-secondary" id="team-select-back">Back to Menu</button>
            <button class="btn-primary" id="team-select-start">Start Match</button>
        </div>
    `;
    
    const grid = parentContainer.querySelector('.team-select-grid');
    
    Object.keys(TEAMS).forEach(key => {
        const team = TEAMS[key];
        const userSelected = state.selectedTeam === key;
        
        const card = document.createElement('div');
        card.className = `team-card ${userSelected ? 'selected' : ''}`;
        card.dataset.id = key;
        card.innerHTML = `
            <div class="team-emblem" style="background-color: ${team.color}; border: 1px solid ${team.textColor}">
                ${team.short}
            </div>
            <h4>${team.name}</h4>
            <div class="team-rating">OVR: ${team.stats.OVR}</div>
        `;
        
        card.addEventListener('click', () => {
            grid.querySelectorAll('.team-card').forEach(c => c.classList.remove('selected'));
            state.selectedTeam = key;
            card.classList.add('selected');
            
            const keys = Object.keys(TEAMS).filter(k => k !== key);
            state.opponentTeam = keys[Math.floor(Math.random() * keys.length)];
            
            updateSidebarStats();
        });
        
        grid.appendChild(card);
    });
    
    parentContainer.querySelector('#team-select-back').addEventListener('click', () => {
        showTab('menu');
    });
    
    parentContainer.querySelector('#team-select-start').addEventListener('click', () => {
        playWhistle();
        if (mode === 'arcade') {
            startArcadeMatch();
        } else {
            startShootout();
        }
    });
}

// --- 2D Arcade Match Code ---
function startArcadeMatch() {
    const parent = document.getElementById('arcade-screen');
    parent.innerHTML = `
        <div class="game-container">
            <div class="game-hud">
                <div class="team-score-card">
                    <div class="team-hud-logo" style="background-color: ${TEAMS[state.selectedTeam].color}; border: 1px solid ${TEAMS[state.selectedTeam].textColor}">
                        ${TEAMS[state.selectedTeam].short}
                    </div>
                    <span class="hud-team-name">${TEAMS[state.selectedTeam].name}</span>
                    <span class="score-display" id="hud-score-user">0</span>
                </div>
                <div class="match-clock" id="hud-clock">00:00</div>
                <div class="team-score-card" style="flex-direction: row-reverse">
                    <div class="team-hud-logo" style="background-color: ${TEAMS[state.opponentTeam].color}; border: 1px solid ${TEAMS[state.opponentTeam].textColor}">
                        ${TEAMS[state.opponentTeam].short}
                    </div>
                    <span class="hud-team-name">${TEAMS[state.opponentTeam].name}</span>
                    <span class="score-display" id="hud-score-opp">0</span>
                </div>
            </div>
            <div class="match-canvas-wrapper">
                <canvas id="arcade-canvas" width="800" height="480"></canvas>
                <div class="overlay-msg" id="arcade-overlay" style="display:none">
                    <h1 id="arcade-overlay-title">GOAL!</h1>
                    <p id="arcade-overlay-sub">Stunning finish!</p>
                </div>
            </div>
            <div class="mt-4">
                <button class="btn-secondary" id="btn-end-match">Forfeit Match</button>
            </div>
        </div>
    `;
    
    parent.querySelector('#btn-end-match').addEventListener('click', () => {
        showTab('menu');
    });
    
    state.arcadeGame = new ArcadeMatchEngine('arcade-canvas');
    state.arcadeGame.start();
}

class ArcadeMatchEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.active = false;
        
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        this.scoreUser = 0;
        this.scoreOpp = 0;
        this.gameTime = 0;
        this.realTimeElapsed = 0;
        
        this.ball = {
            x: this.width / 2,
            y: this.height / 2,
            vx: 0,
            vy: 0,
            radius: 9,
            friction: 0.985,
            kickMaxVel: 16
        };
        
        this.keys = {};
        
        this.players = [];
        this.initPlayers();
        
        this.keydownHandler = (e) => { this.keys[e.key] = true; };
        this.keyupHandler = (e) => { this.keys[e.key] = false; };
        
        window.addEventListener('keydown', this.keydownHandler);
        window.addEventListener('keyup', this.keyupHandler);
        
        this.overlay = document.getElementById('arcade-overlay');
        this.overlayTitle = document.getElementById('arcade-overlay-title');
        this.overlaySub = document.getElementById('arcade-overlay-sub');
        
        this.lastTime = 0;
        this.kickoffState = true;
    }
    
    initPlayers() {
        this.players = [];
        const userTeam = TEAMS[state.selectedTeam];
        const oppTeam = TEAMS[state.opponentTeam];
        
        this.players.push({
            x: this.width * 0.3, y: this.height * 0.5,
            vx: 0, vy: 0, radius: 14, speed: 3.4,
            team: 'A', name: "Player 1", color: userTeam.color, textColor: userTeam.textColor,
            isUser: true, hasBall: false
        });
        this.players.push({
            x: this.width * 0.15, y: this.height * 0.3,
            vx: 0, vy: 0, radius: 14, speed: 2.8,
            team: 'A', name: "Defender A", color: userTeam.color, textColor: userTeam.textColor,
            isUser: false, hasBall: false
        });
        this.players.push({
            x: this.width * 0.15, y: this.height * 0.7,
            vx: 0, vy: 0, radius: 14, speed: 2.8,
            team: 'A', name: "Defender B", color: userTeam.color, textColor: userTeam.textColor,
            isUser: false, hasBall: false
        });
        
        this.players.push({
            x: this.width * 0.7, y: this.height * 0.5,
            vx: 0, vy: 0, radius: 14, speed: 3.0,
            team: 'B', name: "Striker B", color: oppTeam.color, textColor: oppTeam.textColor,
            isUser: false, hasBall: false
        });
        this.players.push({
            x: this.width * 0.85, y: this.height * 0.3,
            vx: 0, vy: 0, radius: 14, speed: 2.8,
            team: 'B', name: "Defender C", color: oppTeam.color, textColor: oppTeam.textColor,
            isUser: false, hasBall: false
        });
        this.players.push({
            x: this.width * 0.85, y: this.height * 0.7,
            vx: 0, vy: 0, radius: 14, speed: 2.8,
            team: 'B', name: "Defender D", color: oppTeam.color, textColor: oppTeam.textColor,
            isUser: false, hasBall: false
        });
    }
    
    resetPositions() {
        this.ball.x = this.width / 2;
        this.ball.y = this.height / 2;
        this.ball.vx = 0;
        this.ball.vy = 0;
        
        this.players[0].x = this.width * 0.3;  this.players[0].y = this.height * 0.5;
        this.players[1].x = this.width * 0.15; this.players[1].y = this.height * 0.3;
        this.players[2].x = this.width * 0.15; this.players[2].y = this.height * 0.7;
        
        this.players[3].x = this.width * 0.7;  this.players[3].y = this.height * 0.5;
        this.players[4].x = this.width * 0.85; this.players[4].y = this.height * 0.3;
        this.players[5].x = this.width * 0.85; this.players[5].y = this.height * 0.7;
        
        this.players.forEach(p => {
            p.vx = 0; p.vy = 0;
            p.hasBall = false;
        });
        
        this.kickoffState = true;
    }
    
    start() {
        this.active = true;
        this.resetPositions();
        requestAnimationFrame((time) => this.loop(time));
    }
    
    stop() {
        this.active = false;
        window.removeEventListener('keydown', this.keydownHandler);
        window.removeEventListener('keyup', this.keyupHandler);
    }
    
    showGoalOverlay(title, sub) {
        if (!this.overlay) return;
        this.overlayTitle.textContent = title;
        this.overlaySub.textContent = sub;
        this.overlay.style.display = 'block';
        setTimeout(() => {
            if (this.overlay) this.overlay.style.display = 'none';
        }, 2000);
    }
    
    loop(time) {
        if (!this.active) return;
        
        const dt = (time - this.lastTime) / 1000;
        this.lastTime = time;
        
        this.update(dt || 0.016);
        this.draw();
        
        requestAnimationFrame((t) => this.loop(t));
    }
    
    update(dt) {
        this.realTimeElapsed += dt;
        this.gameTime = Math.floor((this.realTimeElapsed / 120) * 90);
        
        if (this.gameTime >= 90) {
            this.gameTime = 90;
            this.active = false;
            playWhistle();
            setTimeout(() => playWhistle(), 250);
            this.showGoalOverlay("FULL TIME!", `Final Score: ${this.scoreUser} - ${this.scoreOpp}`);
            return;
        }
        
        document.getElementById('hud-clock').textContent = `${this.gameTime.toString().padStart(2, '0')}:00`;
        document.getElementById('hud-score-user').textContent = this.scoreUser;
        document.getElementById('hud-score-opp').textContent = this.scoreOpp;
        
        const user = this.players[0];
        let moveX = 0;
        let moveY = 0;
        
        if (this.keys['ArrowUp'] || this.keys['w'] || this.keys['W']) moveY = -1;
        if (this.keys['ArrowDown'] || this.keys['s'] || this.keys['S']) moveY = 1;
        if (this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A']) moveX = -1;
        if (this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) moveX = 1;
        
        if (moveX !== 0 && moveY !== 0) {
            moveX *= 0.707;
            moveY *= 0.707;
        }
        
        user.vx = moveX * user.speed;
        user.vy = moveY * user.speed;
        
        if (this.keys['Shift']) {
            user.vx *= 1.4;
            user.vy *= 1.4;
        }
        
        if ((this.keys[' '] || this.keys['z'] || this.keys['Z']) && user.hasBall) {
            this.shootBall(user, 'B');
        }
        
        this.players.forEach((p, idx) => {
            if (p.isUser) return;
            
            const distToBall = Math.hypot(this.ball.x - p.x, this.ball.y - p.y);
            
            if (p.team === 'B') {
                if (p.hasBall) {
                    const targetX = 0;
                    const targetY = this.height / 2;
                    const angle = Math.atan2(targetY - p.y, targetX - p.x);
                    p.vx = Math.cos(angle) * p.speed;
                    p.vy = Math.sin(angle) * p.speed;
                    
                    if (p.x < this.width * 0.25) {
                        this.shootBall(p, 'A');
                    }
                } else {
                    const teammateHasBall = this.players[3].hasBall || this.players[4].hasBall || this.players[5].hasBall;
                    if (teammateHasBall) {
                        const targetX = this.width * 0.5;
                        p.vx += (targetX - p.x) * 0.02;
                    } else {
                        const angle = Math.atan2(this.ball.y - p.y, this.ball.x - p.x);
                        p.vx = Math.cos(angle) * p.speed * 0.9;
                        p.vy = Math.sin(angle) * p.speed * 0.9;
                    }
                }
            } else {
                if (p.hasBall) {
                    const targetX = this.width;
                    const targetY = this.height / 2;
                    const angle = Math.atan2(targetY - p.y, targetX - p.x);
                    p.vx = Math.cos(angle) * p.speed;
                    p.vy = Math.sin(angle) * p.speed;
                    
                    if (p.x > this.width * 0.75) {
                        this.shootBall(p, 'B');
                    }
                } else {
                    const targetX = this.width * (idx === 1 ? 0.35 : 0.45);
                    const targetY = this.height * (idx === 1 ? 0.25 : 0.75);
                    
                    p.vx = (targetX - p.x) * 0.05;
                    p.vy = (targetY - p.y) * 0.05;
                }
            }
        });
        
        this.players.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.x < p.radius) p.x = p.radius;
            if (p.x > this.width - p.radius) p.x = this.width - p.radius;
            if (p.y < p.radius) p.y = p.radius;
            if (p.y > this.height - p.radius) p.y = this.height - p.radius;
        });
        
        if (!this.kickoffState) {
            this.ball.x += this.ball.vx;
            this.ball.y += this.ball.vy;
            this.ball.vx *= this.ball.friction;
            this.ball.vy *= this.ball.friction;
        }
        
        const pitchPadding = 20;
        
        if (this.ball.y < pitchPadding + this.ball.radius) {
            this.ball.y = pitchPadding + this.ball.radius;
            this.ball.vy = -this.ball.vy * 0.6;
        }
        if (this.ball.y > this.height - pitchPadding - this.ball.radius) {
            this.ball.y = this.height - pitchPadding - this.ball.radius;
            this.ball.vy = -this.ball.vy * 0.6;
        }
        
        const goalTop = this.height * 0.35;
        const goalBottom = this.height * 0.65;
        
        if (this.ball.x < pitchPadding + this.ball.radius) {
            if (this.ball.y > goalTop && this.ball.y < goalBottom) {
                this.scoreGoal('B');
            } else {
                this.ball.x = pitchPadding + this.ball.radius;
                this.ball.vx = -this.ball.vx * 0.6;
            }
        }
        
        if (this.ball.x > this.width - pitchPadding - this.ball.radius) {
            if (this.ball.y > goalTop && this.ball.y < goalBottom) {
                this.scoreGoal('A');
            } else {
                this.ball.x = this.width - pitchPadding - this.ball.radius;
                this.ball.vx = -this.ball.vx * 0.6;
            }
        }
        
        this.players.forEach(p => {
            const dist = Math.hypot(p.x - this.ball.x, p.y - this.ball.y);
            
            if (dist < p.radius + this.ball.radius + 6) {
                if (this.kickoffState) {
                    this.kickoffState = false;
                }
                
                this.players.forEach(other => other.hasBall = false);
                p.hasBall = true;
                
                const angle = Math.atan2(p.vy, p.vx) || 0;
                this.ball.x = p.x + Math.cos(angle) * (p.radius + 2);
                this.ball.y = p.y + Math.sin(angle) * (p.radius + 2);
                
                this.ball.vx = p.vx;
                this.ball.vy = p.vy;
            }
        });
    }
    
    shootBall(player, targetTeam) {
        player.hasBall = false;
        playKick();
        
        const targetX = (targetTeam === 'B') ? this.width - 20 : 20;
        const targetY = this.height / 2 + (Math.random() * 60 - 30);
        
        const angle = Math.atan2(targetY - this.ball.y, targetX - this.ball.x);
        
        this.ball.vx = Math.cos(angle) * this.ball.kickMaxVel;
        this.ball.vy = Math.sin(angle) * this.ball.kickMaxVel;
    }
    
    scoreGoal(team) {
        playWhistle();
        playGoalHorn();
        
        if (team === 'A') {
            this.scoreUser++;
            this.showGoalOverlay("GOAL!", `${TEAMS[state.selectedTeam].name} scores!`);
        } else {
            this.scoreOpp++;
            this.showGoalOverlay("CONCEDED!", `${TEAMS[state.opponentTeam].name} scores!`);
        }
        
        this.resetPositions();
    }
    
    draw() {
        const ctx = this.ctx;
        
        ctx.fillStyle = '#1b5e20';
        ctx.fillRect(0, 0, this.width, this.height);
        
        ctx.fillStyle = '#2e7d32';
        const stripWidth = this.width / 12;
        for (let i = 0; i < 12; i += 2) {
            ctx.fillRect(i * stripWidth, 0, stripWidth, this.height);
        }
        
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 3;
        
        const pad = 20;
        ctx.strokeRect(pad, pad, this.width - pad*2, this.height - pad*2);
        
        ctx.beginPath();
        ctx.arc(this.width / 2, this.height / 2, 70, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(this.width / 2, this.height / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(this.width / 2, pad);
        ctx.lineTo(this.width / 2, this.height - pad);
        ctx.stroke();
        
        const goalTop = this.height * 0.35;
        const goalHeight = this.height * 0.3;
        
        ctx.strokeRect(pad, this.height * 0.22, 100, this.height * 0.56);
        ctx.strokeRect(this.width - pad - 100, this.height * 0.22, 100, this.height * 0.56);
        
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(5, goalTop, 15, goalHeight);
        ctx.fillRect(this.width - 20, goalTop, 15, goalHeight);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(5, goalTop, 15, goalHeight);
        ctx.strokeRect(this.width - 20, goalTop, 15, goalHeight);
        
        this.players.forEach(p => {
            ctx.shadowBlur = p.isUser ? 15 : 0;
            ctx.shadowColor = p.isUser ? varColor('--neon-green') : '';
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = p.textColor;
            ctx.font = `bold 10px ${varColor('--font-stats')}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.isUser ? "★" : p.name[0], p.x, p.y);
            
            if (p.hasBall) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2);
                ctx.strokeStyle = varColor('--neon-green');
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });
        ctx.shadowBlur = 0;
        
        ctx.beginPath();
        ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(this.ball.x, this.ball.y - 3, 2, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(this.ball.x - 3, this.ball.y + 2, 2, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(this.ball.x + 3, this.ball.y + 2, 2, 0, Math.PI*2);
        ctx.fill();
    }
}

function varColor(variableName) {
    if (variableName.startsWith('--')) {
        return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
    }
    return variableName;
}

// --- Penalty Shootout Code ---
function startShootout() {
    const parent = document.getElementById('penalty-screen');
    parent.innerHTML = `
        <div class="game-container">
            <div class="shootout-hud">
                <div class="team-score-card">
                    <span class="hud-team-name">${TEAMS[state.selectedTeam].name}</span>
                    <div class="shootout-scorecard" id="shootout-user-pegs"></div>
                </div>
                <div class="score-display" id="shootout-display-score">0 - 0</div>
                <div class="team-score-card" style="flex-direction: row-reverse">
                    <span class="hud-team-name">${TEAMS[state.opponentTeam].name}</span>
                    <div class="shootout-scorecard" id="shootout-opp-pegs"></div>
                </div>
            </div>
            
            <div class="match-canvas-wrapper">
                <canvas id="penalty-canvas" width="800" height="480"></canvas>
                <div class="overlay-msg" id="shootout-overlay" style="display:none">
                    <h1 id="shootout-overlay-title">GOAL!</h1>
                    <p id="shootout-overlay-sub">Top corner beauty!</p>
                </div>
            </div>
            
            <div class="penalty-controls">
                <div class="penalty-meters">
                    <div class="meter-box">
                        <span class="meter-title">Aim Direction</span>
                        <input type="range" id="shootout-aim" min="-1.5" max="1.5" step="0.05" value="0">
                    </div>
                    <div class="meter-box">
                        <span class="meter-title">Power Gauge</span>
                        <input type="range" id="shootout-power" min="0.2" max="1.0" step="0.05" value="0.6">
                    </div>
                    <div class="meter-box">
                        <span class="meter-title">Curve Effect</span>
                        <input type="range" id="shootout-curve" min="-1" max="1" step="0.1" value="0">
                    </div>
                </div>
                <div class="text-center mt-4">
                    <button class="btn-primary" id="btn-shoot-penalty" style="width: 200px">SHOOT!</button>
                </div>
            </div>
        </div>
    `;
    
    const userPegs = parent.querySelector('#shootout-user-pegs');
    const oppPegs = parent.querySelector('#shootout-opp-pegs');
    for (let i = 0; i < 5; i++) {
        userPegs.innerHTML += `<div class="shootout-peg"></div>`;
        oppPegs.innerHTML += `<div class="shootout-peg"></div>`;
    }
    
    state.shootoutGame = new ShootoutEngine('penalty-canvas');
    state.shootoutGame.start();
}

class ShootoutEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.active = false;
        
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        
        this.userScore = 0;
        this.oppScore = 0;
        this.round = 0;
        this.userAttempts = [];
        this.oppAttempts = [];
        
        this.state = 'aiming';
        this.ball = { x: 400, y: 390, z: 1, vx: 0, vy: 0, vz: 0, radius: 16 };
        
        this.gk = { x: 400, y: 190, vx: 0, vy: 0, targetX: 400, targetY: 190, width: 60, height: 90 };
        
        this.setupButtons();
        
        this.overlay = document.getElementById('shootout-overlay');
        this.overlayTitle = document.getElementById('shootout-overlay-title');
        this.overlaySub = document.getElementById('shootout-overlay-sub');
    }
    
    setupButtons() {
        const btn = document.getElementById('btn-shoot-penalty');
        if (btn) {
            btn.addEventListener('click', () => {
                if (this.state === 'aiming') {
                    this.shoot();
                } else if (this.state === 'ai-aiming') {
                    this.aiShoot();
                }
            });
        }
    }
    
    start() {
        this.active = true;
        this.resetBall();
        this.loop();
    }
    
    stop() {
        this.active = false;
    }
    
    resetBall() {
        this.ball.x = 400;
        this.ball.y = 390;
        this.ball.z = 1.0;
        this.ball.vx = 0;
        this.ball.vy = 0;
        this.ball.vz = 0;
        
        this.gk.x = 400;
        this.gk.y = 190;
        this.gk.vx = 0;
        this.gk.vy = 0;
        
        if (this.round >= 5 && this.userAttempts.length === this.oppAttempts.length) {
            this.handleEndGame();
            return;
        }
        
        if (this.userAttempts.length === this.oppAttempts.length) {
            this.state = 'aiming';
            const btn = document.getElementById('btn-shoot-penalty');
            if (btn) btn.textContent = 'TAKE PENALTY!';
            this.showOverlay("YOUR SHOT", "Aim, adjust curve, and score!");
        } else {
            this.state = 'ai-aiming';
            const btn = document.getElementById('btn-shoot-penalty');
            if (btn) btn.textContent = 'DEFEND SHOT!';
            this.showOverlay("OPPONENT SHOT", "Prepare to dive!");
        }
    }
    
    showOverlay(title, sub) {
        if (!this.overlay) return;
        this.overlayTitle.textContent = title;
        this.overlaySub.textContent = sub;
        this.overlay.style.display = 'block';
        setTimeout(() => {
            if (this.overlay) this.overlay.style.display = 'none';
        }, 1500);
    }
    
    shoot() {
        playKick();
        
        const aim = parseFloat(document.getElementById('shootout-aim').value);
        const power = parseFloat(document.getElementById('shootout-power').value);
        const curve = parseFloat(document.getElementById('shootout-curve').value);
        
        this.ball.vx = aim * 8;
        this.ball.vy = -power * 9;
        this.ball.vz = 0.024;
        this.ball.curve = curve * 4;
        
        const gkTargetOptions = [
            400 + aim * 200 + (Math.random()*60 - 30),
            400,
            400 + (Math.random() > 0.5 ? 180 : -180)
        ];
        
        this.gk.targetX = gkTargetOptions[Math.floor(Math.random() * gkTargetOptions.length)];
        this.gk.targetY = 190 + this.ball.vy * 4;
        
        this.state = 'flying';
    }
    
    aiShoot() {
        playKick();
        
        const aim = (Math.random() * 2.4 - 1.2);
        const power = 0.5 + Math.random() * 0.5;
        const curve = (Math.random() * 1.6 - 0.8);
        
        this.ball.vx = aim * 8;
        this.ball.vy = -power * 9;
        this.ball.vz = 0.024;
        this.ball.curve = curve * 4;
        
        const userAim = parseFloat(document.getElementById('shootout-aim').value);
        this.gk.targetX = 400 + userAim * 220;
        this.gk.targetY = 190 + (Math.random()*80 - 40);
        
        this.state = 'flying';
    }
    
    loop() {
        if (!this.active) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
    
    update() {
        if (this.state === 'flying') {
            const dx = this.gk.targetX - this.gk.x;
            const dy = this.gk.targetY - this.gk.y;
            this.gk.x += dx * 0.15;
            this.gk.y += dy * 0.15;
            
            this.ball.x += this.ball.vx;
            this.ball.y += this.ball.vy;
            this.ball.vx += this.ball.curve * 0.1;
            this.ball.z -= this.ball.vz;
            
            if (this.ball.z <= 0.46) {
                this.checkOutcome();
            }
        }
    }
    
    checkOutcome() {
        this.state = 'finished';
        
        const goalLeft = 240;
        const goalRight = 560;
        const goalTop = 130;
        const goalBottom = 250;
        
        const isWithinGoal = 
            this.ball.x >= goalLeft && 
            this.ball.x <= goalRight && 
            this.ball.y >= goalTop && 
            this.ball.y <= goalBottom;
            
        const gkDist = Math.hypot(this.ball.x - this.gk.x, this.ball.y - (this.gk.y - 10));
        const saved = gkDist < 52 && isWithinGoal;
        
        const userTurn = this.userAttempts.length === this.oppAttempts.length;
        
        if (userTurn) {
            if (isWithinGoal && !saved) {
                this.userAttempts.push(true);
                this.userScore++;
                playGoalHorn();
                this.showOverlay("GOAL!", "Fantastic shot!");
            } else {
                this.userAttempts.push(false);
                playWhistle();
                this.showOverlay("SAVED / MISSED", saved ? "Outstanding goalkeeper save!" : "Wasted shot!");
            }
        } else {
            if (isWithinGoal && !saved) {
                this.oppAttempts.push(true);
                this.oppScore++;
                playGoalHorn();
                this.showOverlay("CONCEDED", "The AI scores a bullet!");
            } else {
                this.oppAttempts.push(false);
                playWhistle();
                this.showOverlay("BLOCKED / SAVE", saved ? "Sensational save by you!" : "Opponent missed!");
            }
            this.round++;
        }
        
        this.syncScorePegs();
        
        setTimeout(() => {
            this.resetBall();
        }, 2200);
    }
    
    syncScorePegs() {
        document.getElementById('shootout-display-score').textContent = `${this.userScore} - ${this.oppScore}`;
        
        const uPegs = document.getElementById('shootout-user-pegs').querySelectorAll('.shootout-peg');
        const oPegs = document.getElementById('shootout-opp-pegs').querySelectorAll('.shootout-peg');
        
        this.userAttempts.forEach((attempt, idx) => {
            if (uPegs[idx]) uPegs[idx].className = `shootout-peg ${attempt ? 'success' : 'fail'}`;
        });
        
        this.oppAttempts.forEach((attempt, idx) => {
            if (oPegs[idx]) oPegs[idx].className = `shootout-peg ${attempt ? 'success' : 'fail'}`;
        });
    }
    
    handleEndGame() {
        this.active = false;
        playWhistle();
        setTimeout(() => playWhistle(), 200);
        
        const winnerText = this.userScore > this.oppScore ? "YOU WON!" : "OPPONENT WON!";
        this.showOverlay(winnerText, `Final Score: ${this.userScore} - ${this.oppScore}`);
        
        setTimeout(() => {
            showTab('menu');
        }, 3000);
    }
    
    draw() {
        const ctx = this.ctx;
        
        ctx.fillStyle = '#1e3a24';
        ctx.fillRect(0, 0, this.width, this.height);
        
        ctx.fillStyle = '#2d5a37';
        ctx.beginPath();
        ctx.moveTo(400, 100);
        ctx.lineTo(0, 480);
        ctx.lineTo(150, 480);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(400, 100);
        ctx.lineTo(350, 480);
        ctx.lineTo(450, 480);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(400, 100);
        ctx.lineTo(650, 480);
        ctx.lineTo(800, 480);
        ctx.fill();
        
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#ffffff';
        ctx.lineCap = 'square';
        ctx.strokeRect(235, 125, 330, 130);
        
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        const meshSize = 10;
        for (let i = 240; i < 560; i += meshSize) {
            ctx.beginPath();
            ctx.moveTo(i, 130);
            ctx.lineTo(i + 20, 250);
            ctx.stroke();
        }
        for (let i = 130; i < 250; i += meshSize) {
            ctx.beginPath();
            ctx.moveTo(240, i);
            ctx.lineTo(560, i);
            ctx.stroke();
        }
        
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(120, 250);
        ctx.lineTo(680, 250);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(400, 390, 8, 0, Math.PI*2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        
        const teamColor = TEAMS[state.opponentTeam].color;
        ctx.fillStyle = teamColor;
        ctx.fillRect(this.gk.x - this.gk.width/2, this.gk.y - this.gk.height + 15, this.gk.width, this.gk.height - 20);
        
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(this.gk.x - this.gk.width/2, this.gk.y - 5, this.gk.width, 20);
        
        ctx.fillStyle = '#ffedd5';
        ctx.beginPath();
        ctx.arc(this.gk.x, this.gk.y - 95, 12, 0, Math.PI*2);
        ctx.fill();
        
        ctx.strokeStyle = '#ffedd5';
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(this.gk.x - this.gk.width/2, this.gk.y - 65);
        ctx.lineTo(this.gk.x - this.gk.width/2 - 24, this.gk.y - 85);
        ctx.moveTo(this.gk.x + this.gk.width/2, this.gk.y - 65);
        ctx.lineTo(this.gk.x + this.gk.width/2 + 24, this.gk.y - 85);
        ctx.stroke();
        
        const scaleRadius = this.ball.radius * this.ball.z;
        ctx.beginPath();
        ctx.arc(this.ball.x, this.ball.y, scaleRadius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(this.ball.x, 430, scaleRadius*1.5, scaleRadius*0.4, 0, 0, Math.PI*2);
        ctx.fill();
    }
}

// --- FUT Card Creator Forms & Code ---
function setupFUTFormListeners() {
    const inputs = [
        'fut-input-name', 'fut-input-pos', 'fut-input-nation', 'fut-input-club',
        'fut-input-ovr', 'fut-input-pac', 'fut-input-sho', 'fut-input-pas',
        'fut-input-dri', 'fut-input-def', 'fut-input-phy', 'fut-input-theme'
    ];
    
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                renderCreatorPreview();
            });
        }
    });
    
    const fileInput = document.getElementById('fut-input-avatar');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    state.customAvatarUrl = event.target.result;
                    renderCreatorPreview();
                };
                reader.readAsDataURL(file);
            }
        });
    }
    
    const btnDownload = document.getElementById('btn-download-card');
    if (btnDownload) {
        btnDownload.addEventListener('click', () => {
            downloadFUTCardCanvas();
        });
    }
}

function renderCreatorPreview() {
    const name = document.getElementById('fut-input-name').value || "SOBIA";
    const pos = document.getElementById('fut-input-pos').value || "ST";
    const nation = document.getElementById('fut-input-nation').value || "ENG";
    const club = document.getElementById('fut-input-club').value || "RMA";
    
    const ovr = document.getElementById('fut-input-ovr').value;
    const pac = document.getElementById('fut-input-pac').value;
    const sho = document.getElementById('fut-input-sho').value;
    const pas = document.getElementById('fut-input-pas').value;
    const dri = document.getElementById('fut-input-dri').value;
    const def = document.getElementById('fut-input-def').value;
    const phy = document.getElementById('fut-input-phy').value;
    const theme = document.getElementById('fut-input-theme').value;
    
    document.getElementById('val-ovr').textContent = ovr;
    document.getElementById('val-pac').textContent = pac;
    document.getElementById('val-sho').textContent = sho;
    document.getElementById('val-pas').textContent = pas;
    document.getElementById('val-dri').textContent = dri;
    document.getElementById('val-def').textContent = def;
    document.getElementById('val-phy').textContent = phy;
    
    const card = document.querySelector('.fut-card');
    if (card) {
        card.className = `fut-card theme-${theme}`;
        
        card.querySelector('.card-ovr').textContent = ovr;
        card.querySelector('.card-pos').textContent = pos;
        card.querySelector('.card-name').textContent = name;
        card.querySelector('.card-flag').textContent = nation.substring(0,3);
        card.querySelector('.card-club').textContent = club.substring(0,3);
        
        const lines = card.querySelectorAll('.card-stat-line');
        lines[0].innerHTML = `PAC <span class="card-stat-num">${pac}</span>`;
        lines[1].innerHTML = `SHO <span class="card-stat-num">${sho}</span>`;
        lines[2].innerHTML = `PAS <span class="card-stat-num">${pas}</span>`;
        lines[3].innerHTML = `DRI <span class="card-stat-num">${dri}</span>`;
        lines[4].innerHTML = `DEF <span class="card-stat-num">${def}</span>`;
        lines[5].innerHTML = `PHY <span class="card-stat-num">${phy}</span>`;
        
        const avatarWrapper = card.querySelector('.card-avatar-wrapper');
        if (state.customAvatarUrl) {
            avatarWrapper.innerHTML = `<img class="card-avatar" src="${state.customAvatarUrl}" alt="Avatar">`;
        } else {
            avatarWrapper.innerHTML = `<span class="card-avatar-placeholder">👤</span>`;
        }
    }
}

function downloadFUTCardCanvas() {
    const name = (document.getElementById('fut-input-name').value || "SOBIA").toUpperCase();
    const pos = (document.getElementById('fut-input-pos').value || "ST").toUpperCase();
    const nation = (document.getElementById('fut-input-nation').value || "ENG").toUpperCase();
    const club = (document.getElementById('fut-input-club').value || "RMA").toUpperCase();
    
    const ovr = document.getElementById('fut-input-ovr').value;
    const pac = document.getElementById('fut-input-pac').value;
    const sho = document.getElementById('fut-input-sho').value;
    const pas = document.getElementById('fut-input-pas').value;
    const dri = document.getElementById('fut-input-dri').value;
    const def = document.getElementById('fut-input-def').value;
    const phy = document.getElementById('fut-input-phy').value;
    const theme = document.getElementById('fut-input-theme').value;
    
    const canvas = document.createElement('canvas');
    canvas.width = 580;
    canvas.height = 880;
    const ctx = canvas.getContext('2d');
    
    let gradient = ctx.createLinearGradient(0, 0, 580, 880);
    let borderStyle = '#f59e0b';
    
    if (theme === 'gold') {
        gradient.addColorStop(0, '#1e1b10');
        gradient.addColorStop(0.5, '#3a331a');
        gradient.addColorStop(1, '#1e1b10');
        borderStyle = '#ffe066';
    } else if (theme === 'toty') {
        gradient.addColorStop(0, '#050d26');
        gradient.addColorStop(0.5, '#0a1f5c');
        gradient.addColorStop(1, '#04091a');
        borderStyle = '#3b82f6';
    } else if (theme === 'tots') {
        gradient.addColorStop(0, '#052618');
        gradient.addColorStop(0.5, '#0d5436');
        gradient.addColorStop(1, '#04140e');
        borderStyle = '#10b981';
    } else if (theme === 'future') {
        gradient.addColorStop(0, '#2a082c');
        gradient.addColorStop(0.5, '#5b1160');
        gradient.addColorStop(1, '#19051a');
        borderStyle = '#ec4899';
    }
    
    ctx.fillStyle = gradient;
    ctx.strokeStyle = borderStyle;
    ctx.lineWidth = 8;
    
    ctx.beginPath();
    ctx.moveTo(290, 40);
    ctx.lineTo(510, 100);
    ctx.lineTo(510, 560);
    ctx.quadraticCurveTo(510, 780, 290, 840);
    ctx.quadraticCurveTo(70, 780, 70, 560);
    ctx.lineTo(70, 100);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    const radial = ctx.createRadialGradient(290, 300, 20, 290, 300, 400);
    radial.addColorStop(0, 'rgba(255,255,255,0.06)');
    radial.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = radial;
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px Rajdhani';
    ctx.textAlign = 'center';
    ctx.fillText(name, 290, 510);
    
    ctx.fillStyle = borderStyle;
    ctx.font = 'bold 74px Rajdhani';
    ctx.textAlign = 'left';
    ctx.fillText(ovr, 110, 180);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 32px Rajdhani';
    ctx.fillText(pos, 110, 230);
    
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.font = 'bold 22px Rajdhani';
    ctx.fillRect(110, 260, 50, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(nation.substring(0,3), 116, 284);
    
    ctx.beginPath();
    ctx.arc(135, 340, 22, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Rajdhani';
    ctx.fillText(club.substring(0,3), 123, 345);
    
    ctx.font = 'bold 34px Rajdhani';
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("PAC", 110, 600);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pac, 200, 600);
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("SHO", 110, 660);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(sho, 200, 660);
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("PAS", 110, 720);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pas, 200, 720);
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("DRI", 310, 600);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(dri, 400, 600);
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("DEF", 310, 660);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(def, 400, 660);
    
    ctx.fillStyle = '#94a3b8';
    ctx.fillText("PHY", 310, 720);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(phy, 400, 720);
    
    if (state.customAvatarUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous"; // Bypass potential CORS issue for external Google profile photos
        img.onload = () => {
            ctx.save();
            ctx.beginPath();
            ctx.arc(330, 270, 110, 0, Math.PI*2);
            ctx.clip();
            ctx.drawImage(img, 220, 160, 220, 220);
            ctx.restore();
            
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(330, 270, 110, 0, Math.PI*2);
            ctx.stroke();
            
            triggerDownload(canvas, name);
        };
        // Handlers for CORS canvas download failure
        img.onerror = () => {
            drawFallbackAvatarAndDownload(ctx, canvas, name);
        };
        img.src = state.customAvatarUrl;
    } else {
        drawFallbackAvatarAndDownload(ctx, canvas, name);
    }
}

function drawFallbackAvatarAndDownload(ctx, canvas, name) {
    ctx.beginPath();
    ctx.arc(330, 270, 110, 0, Math.PI*2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 4;
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '78px Arial';
    ctx.textAlign = 'center';
    ctx.fillText("👤", 330, 295);
    
    triggerDownload(canvas, name);
}

function triggerDownload(canvas, name) {
    const link = document.createElement('a');
    link.download = `${name}_FUT_CARD.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}
