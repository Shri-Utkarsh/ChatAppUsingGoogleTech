const socket = io();

// State
let myUsername = localStorage.getItem('anon_username');
let myDisplay = localStorage.getItem('anon_display');
let currentRoomId = null;
let roomKey = null; 
let timerInterval = null;
let typingTimeout = null; 

// --- AUDIO SYSTEM ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type, duration) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; 
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime); 
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}
const sfx = {
    message: () => playTone(1200, 'square', 0.1), 
    join: () => playTone(600, 'sine', 0.3),       
    leave: () => playTone(300, 'sawtooth', 0.3),  
    error: () => playTone(150, 'sawtooth', 0.5),  
};

// --- DOM ELEMENTS ---
const screens = {
    identity: document.getElementById('screen-identity'),
    lobby: document.getElementById('screen-lobby'),
    chat: document.getElementById('screen-chat')
};

if (myUsername) {
    showScreen('lobby');
    document.getElementById('display-user').innerText = `${myDisplay} (${myUsername})`;
} else {
    showScreen('identity');
}

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

// --- GEMINI: GENERATE ALIAS ---
function generateIdentity() {
    const btn = document.querySelector('button[onclick="generateIdentity()"]');
    const originalText = btn.innerText;
    btn.innerText = "⚡ COMPUTING...";
    btn.disabled = true;

    socket.emit('generateAlias');

    socket.once('aliasGenerated', (identity) => {
        document.getElementById('inp-display-name').value = identity.username;
        const backstory = document.getElementById('ai-backstory');
        backstory.innerText = `> IDENTITY: ${identity.backstory}`;
        backstory.classList.remove('hidden');
        btn.innerText = originalText;
        btn.disabled = false;
        sfx.message(); 
    });
}

// --- GEMINI: ROOM NAME GENERATOR ---
function generateRoomName() {
    const btn = document.querySelector('button[onclick="generateRoomName()"]');
    const input = document.getElementById('create-room-name');
    const originalText = btn.innerText;
    
    btn.innerText = "⚡ HACKING...";
    btn.disabled = true;

    socket.emit('generateRoomName');

    // Wait for response
    socket.once('roomNameGenerated', ({ name }) => {
        input.value = name;
        
        // Add a cool visual effect (pulse)
        input.style.borderColor = "var(--term-green)";
        setTimeout(() => input.style.borderColor = "", 500);

        btn.innerText = originalText;
        btn.disabled = false;
        
        sfx.message(); // Play sound
    });
}

// --- GEMINI: LINK SCANNING ---
// 1. Send URL to server
function scanLink(url, btnId) {
    const btn = document.getElementById(btnId);
    btn.innerText = "⏳ SCANNING...";
    socket.emit('scanUrl', { url });

    // 2. Wait for result
    const handler = ({ url: resUrl, status, reason }) => {
        if (resUrl !== url) return; // Ignore if not our link
        socket.off('scanResult', handler); // Clean up listener
        
        btn.classList.remove('btn-outline');
        if (status === 'SAFE') {
            btn.innerText = "✅ SAFE";
            btn.style.borderColor = "var(--term-green)";
            btn.style.color = "var(--term-green)";
        } else {
            btn.innerText = "⛔ UNSAFE";
            btn.style.borderColor = "var(--term-red)";
            btn.style.color = "var(--term-red)";
            btn.title = reason; // Tooltip reason
            showPopup(`⚠️ WARNING: Gemini AI flagged this link as ${status}.\nReason: ${reason}`);
        }
    };
    socket.on('scanResult', handler);
}

// --- POPUP SYSTEM ---
const modal = document.getElementById('custom-modal');
const modalText = document.getElementById('modal-text');

function getModalButtons() {
    return { ok: document.getElementById('btn-modal-ok'), cancel: document.getElementById('btn-modal-cancel') };
}

function showPopup(msg, onConnect = null) {
    if (!modal.classList.contains('hidden')) return; 
    sfx.error(); 
    modalText.textContent = msg; 
    const btns = getModalButtons();
    btns.cancel.classList.add('hidden'); 
    btns.ok.innerText = "ACKNOWLEDGE";
    
    let newBtn = btns.ok.cloneNode(true);
    btns.ok.parentNode.replaceChild(newBtn, btns.ok);
    newBtn.onclick = () => { closeModal(); if (onConnect) onConnect(); };
    modal.classList.remove('hidden');
}

function askConfirm(msg, onYes) {
    sfx.error(); 
    modalText.textContent = msg; 
    const btns = getModalButtons();
    btns.cancel.classList.remove('hidden'); 
    btns.ok.innerText = "CONFIRM";
    
    let newOk = btns.ok.cloneNode(true);
    let newCancel = btns.cancel.cloneNode(true);
    btns.ok.parentNode.replaceChild(newOk, btns.ok);
    btns.cancel.parentNode.replaceChild(newCancel, btns.cancel);
    
    newOk.onclick = () => { closeModal(); onYes(); };
    newCancel.onclick = () => { closeModal(); };
    modal.classList.remove('hidden');
}

function closeModal() { modal.classList.add('hidden'); }

// --- CORE FUNCTIONS (Crypto, Chat, etc) ---
function saveIdentity() {
    const disp = document.getElementById('inp-display-name').value.trim();
    const user = document.getElementById('inp-username').value.trim();
    if (!disp || !user) return showPopup('ERROR: Empty fields.');
    localStorage.setItem('anon_display', disp);
    localStorage.setItem('anon_username', user);
    myDisplay = disp; myUsername = user;
    document.getElementById('display-user').textContent = `${disp} (${user})`;
    showScreen('lobby');
}

async function deriveKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    return window.crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode("salt"), iterations: 100000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function hashPassword(pw) {
    const hash = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function encryptMessage(text) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, roomKey, new TextEncoder().encode(text));
    return { data: Array.from(new Uint8Array(enc)), iv: Array.from(iv) };
}
async function decryptMessage(data, iv) {
    try {
        const dec = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) }, roomKey, new Uint8Array(data));
        return new TextDecoder().decode(dec);
    } catch (e) { return "[Decryption Failed]"; }
}

async function createRoom() {
    const name = document.getElementById('create-room-name').value;
    const pass = document.getElementById('create-room-pass').value;
    if (!name || !pass) return showPopup("Fields required");
    const passHash = await hashPassword(pass);
    socket.emit('createRoom', { username: myUsername, roomName: name, passwordHash: passHash });
    socket.once('roomCreated', async ({ roomId }) => {
        roomKey = await deriveKey(pass);
        socket.emit('joinRoom', { username: myUsername, roomId, passwordHash: passHash });
    });
}
async function joinRoom() {
    const id = document.getElementById('join-room-id').value;
    const pass = document.getElementById('join-room-pass').value;
    if (!id || !pass) return showPopup("Fields required");
    const passHash = await hashPassword(pass);
    roomKey = await deriveKey(pass);
    socket.emit('joinRoom', { username: myUsername, roomId: id, passwordHash: passHash });
}

socket.on('joined', ({ roomName, adminName, isAdmin, expiryTime, roomId }) => {
    currentRoomId = roomId;
    showScreen('chat');
    document.getElementById('room-title').textContent = `Node: ${roomName}`;
    document.getElementById('host-display').textContent = `HOST: ${adminName}` + (isAdmin ? " (YOU)" : "");
    document.getElementById('chat-box').innerHTML = '';
    
    document.getElementById('btn-delete').classList.toggle('hidden', !isAdmin);
    document.getElementById('btn-kick').classList.toggle('hidden', !isAdmin);
    
    startTimer(expiryTime);
    sfx.join();
});

socket.on('message', async ({ username, encryptedData, iv, isAdmin }) => {
    const text = await decryptMessage(encryptedData, iv);
    appendMessage(username, text, isAdmin);
    if (username !== myUsername) sfx.message();
});

socket.on('systemMessage', (msg) => {
    const div = document.createElement('div');
    div.classList.add('message', 'sys-msg');
    div.textContent = `> ${msg}`;
    document.getElementById('chat-box').appendChild(div);
});

socket.on('error', (msg) => showPopup(msg));
socket.on('roomDestroyed', (r) => showPopup(`Room Destroyed: ${r}`, () => location.reload()));
socket.on('kicked', (r) => showPopup(`Kicked: ${r}`, () => location.reload()));

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return;
    const { data, iv } = await encryptMessage(text);
    socket.emit('chatMessage', { encryptedData: data, iv });
    input.value = '';
}

function appendMessage(user, text, isAdmin) {
    const box = document.getElementById('chat-box');
    const div = document.createElement('div');
    div.classList.add('message');

    // Regex to find URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const hasUrl = urlRegex.test(text);

    let contentHtml = text;
    // If URL found, make it clickable AND add scan button
    if (hasUrl) {
        contentHtml = text.replace(urlRegex, (url) => {
            const btnId = `scan-${Math.floor(Math.random()*10000)}`;
            return `<a href="${url}" target="_blank" style="color:var(--term-green); text-decoration:underline;">${url}</a> 
                    <button id="${btnId}" class="btn-outline" style="font-size:0.7em; padding:2px 5px; margin-left:5px;" onclick="scanLink('${url}', '${btnId}')">🛡️ SCAN</button>`;
        });
    }

    const adminTag = isAdmin ? `<span class="admin-tag">ADMIN</span>` : '';
    div.innerHTML = `<span>${adminTag}<span class="user">[${user}]: </span></span><span class="text">${contentHtml}</span>`;
    
    box.appendChild(div);
    setTimeout(() => box.scrollTop = box.scrollHeight, 0);
}

function startTimer(expiryTime) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const diff = expiryTime - Date.now();
        if (diff <= 0) { clearInterval(timerInterval); document.getElementById('msg-input').disabled = true; document.getElementById('timer').innerText = "00:00:00"; return; }
        const h = Math.floor(diff/3600000), m = Math.floor((diff%3600000)/60000), s = Math.floor((diff%60000)/1000);
        document.getElementById('timer').innerText = `${h<10?'0'+h:h}:${m<10?'0'+m:m}:${s<10?'0'+s:s}`;
    }, 1000);
}

function logout() { localStorage.removeItem('anon_username'); location.reload(); }
function copyRoomId() {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId).then(() => {
        const btn = document.getElementById('btn-copy-id');
        const originalText = btn.innerText;
        btn.innerText = "✅ COPIED";
        setTimeout(() => btn.innerText = originalText, 1500);
    }).catch(err => showPopup("Failed to copy ID"));
}
function leaveRoom() { location.reload(); }
function adminDeleteRoom() { askConfirm("DESTROY ROOM?", () => socket.emit('deleteRoom')); }
function adminKickUser() { const u = prompt("Username:"); if(u) socket.emit('kickUser', {targetUsername:u}); }

// Key listeners
document.getElementById('msg-input').addEventListener("keypress", (e) => { if(e.key==="Enter") sendMessage(); });
document.getElementById('msg-input').addEventListener("input", () => { socket.emit('typing'); if(typingTimeout) clearTimeout(typingTimeout); typingTimeout = setTimeout(() => socket.emit('stopTyping'), 1000); });
socket.on('displayTyping', ({username}) => { document.getElementById('typing-indicator').textContent = `> ${username} typing...`; document.getElementById('typing-indicator').classList.remove('hidden'); });
socket.on('hideTyping', () => document.getElementById('typing-indicator').classList.add('hidden'));