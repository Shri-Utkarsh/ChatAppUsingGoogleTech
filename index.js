require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000, 
});

// --- GOOGLE GEMINI SETUP ---
if (!process.env.GEMINI_API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing in .env file!");
}

const genAI = process.env.GEMINI_API_KEY 
    ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) 
    : null;

// FIX: Update to the current 2026 stable model
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-2.5-flash" }) : null;
app.use(express.static(path.join(__dirname, 'public')));

// --- SECURITY: IP LIMITER ---
const ipLimits = new Map();
const LIMITS = {
    create: { maxTokens: 3, refillRate: 60000 }, 
    message: { maxTokens: 10, refillRate: 1000 },
    ai: { maxTokens: 5, refillRate: 60000 }, 
    banDuration: 30000 
};

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipLimits) {
        if (now > data.blockedUntil && (now - data.lastRefill > 60000)) ipLimits.delete(ip);
    }
}, 300000);

const rooms = {};

function generateRoomId() { return crypto.randomBytes(4).toString('hex'); }

function getClientIp(socket) {
    const header = socket.handshake.headers['x-forwarded-for'];
    if (header) return header.split(',')[0].trim();
    return socket.handshake.address;
}

function checkSecurity(socket, clientIp, type) {
    const now = Date.now();
    const config = LIMITS[type] || LIMITS.message;
    let record = ipLimits.get(clientIp) || { tokens: config.maxTokens, lastRefill: now, blockedUntil: 0 };

    if (now < record.blockedUntil) {
        socket.disconnect(true);
        return true; 
    }
    const timePassed = now - record.lastRefill;
    if (timePassed > config.refillRate) {
        record.tokens = config.maxTokens;
        record.lastRefill = now;
    }
    if (record.tokens > 0) {
        record.tokens--;
        ipLimits.set(clientIp, record);
        return false; 
    } else {
        record.blockedUntil = now + LIMITS.banDuration;
        ipLimits.set(clientIp, record);
        socket.emit('error', `RATE LIMIT: Too many requests. Wait ${LIMITS.banDuration/1000}s.`);
        return true; 
    }
}

// --- HELPER: ROBUST JSON EXTRACTOR ---
function extractJSON(text) {
    try {
        const firstOpen = text.indexOf('{');
        const lastClose = text.lastIndexOf('}');
        if (firstOpen !== -1 && lastClose !== -1) {
            const jsonStr = text.substring(firstOpen, lastClose + 1);
            return JSON.parse(jsonStr);
        }
        return null;
    } catch (e) {
        return null;
    }
}

io.on('connection', (socket) => {
    const clientIp = getClientIp(socket);
    socket.data = { username: null, roomId: null, isAdmin: false, ip: clientIp };

    // --- GEMINI: IDENTITY GENERATOR ---
    socket.on('generateAlias', async () => {
        if (checkSecurity(socket, clientIp, 'ai')) return;

        if (!model) {
            console.log("⚠️ Gemini Model not initialized (Check API Key)");
            socket.emit('aliasGenerated', { username: "Offline_User", backstory: "AI module disconnected." });
            return;
        }

        try {
            const prompt = "Generate a cool, cryptic hacker username (max 15 chars, no spaces) and a short 1-sentence sci-fi backstory. Return ONLY JSON: { \"username\": \"...\", \"backstory\": \"...\" }";
            const result = await model.generateContent(prompt);
            const text = (await result.response).text();
            
            const data = extractJSON(text);
            
            if (data) {
                socket.emit('aliasGenerated', data);
            } else {
                throw new Error("Failed to parse JSON");
            }
        } catch (e) {
            console.error("❌ Gemini Identity Error:", e.message);
            socket.emit('aliasGenerated', { username: `Ghost_${Math.floor(Math.random()*100)}`, backstory: "Encrypted signal found." });
        }
    });


    // --- GEMINI: ROOM NAME GENERATOR ---
    socket.on('generateRoomName', async () => {
        // Rate limit check (using the 'ai' bucket)
        if (checkSecurity(socket, getClientIp(socket), 'ai')) return;

        if (!model) {
            socket.emit('roomNameGenerated', { name: `Node_${Math.floor(Math.random()*1000)}` });
            return;
        }

        try {
            const prompt = "Generate a single cool, secure-sounding chat room name (max 20 chars, no spaces, use underscores). Examples: 'Shadow_Ops', 'Neon_Grid', 'Sector_4'. Return ONLY the name as a raw string.";
            
            const result = await model.generateContent(prompt);
            const text = (await result.response).text();
            
            // Cleanup: Remove quotes, newlines, or markdown code blocks
            const cleanName = text.replace(/["`\n]/g, '').trim();
            
            socket.emit('roomNameGenerated', { name: cleanName });
        } catch (e) {
            console.error("❌ Gemini Room Name Error:", e.message);
            // Fallback
            socket.emit('roomNameGenerated', { name: `Uplink_${Math.floor(Math.random()*999)}` });
        }
    });

    // --- GEMINI: PHISHING DETECTOR ---
    socket.on('scanUrl', async ({ url }) => {
        if (checkSecurity(socket, clientIp, 'ai')) return;

        if (!model) {
            socket.emit('scanResult', { url, status: 'UNKNOWN', reason: 'AI unavailable' });
            return;
        }

        try {
            const prompt = `Analyze this URL: "${url}". 
            Is it safe? Return ONLY JSON: { "status": "SAFE" or "UNSAFE", "reason": "Short reason" }`;
            
            const result = await model.generateContent(prompt);
            const text = (await result.response).text();
            
            const data = extractJSON(text);

            if (data) {
                socket.emit('scanResult', { url, ...data });
            } else {
                throw new Error("Failed to parse JSON");
            }
        } catch (e) {
            console.error("❌ Gemini Scan Error:", e.message);
            socket.emit('scanResult', { url, status: 'ERROR', reason: 'AI Analysis Failed' });
        }
    });

    // --- STANDARD CHAT LOGIC ---
    socket.on('createRoom', ({ username, roomName, passwordHash }) => {
        if (checkSecurity(socket, clientIp, 'create')) return;
        if (!username || !roomName || !passwordHash) return;
        
        const roomId = generateRoomId();
        rooms[roomId] = {
            name: roomName, passwordHash, admin: username, adminSocket: socket.id,
            expiryTime: Date.now() + (120 * 60 * 1000), users: [], blacklist: []
        };

        setTimeout(() => { if (rooms[roomId]) deleteRoom(roomId, 'Expired'); }, 120 * 60 * 1000);
        socket.emit('roomCreated', { roomId });
    });

    socket.on('joinRoom', ({ username, roomId, passwordHash }) => {
        if (checkSecurity(socket, clientIp, 'message')) return;
        const room = rooms[roomId];
        if (!room) return socket.emit('error', 'Room not found');
        if (room.passwordHash !== passwordHash) return socket.emit('error', 'Bad Password');
        if (room.blacklist.includes(username)) return socket.emit('error', 'Banned');
        if (room.users.find(u => u.username === username)) return socket.emit('error', 'Username taken');

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.username = username;
        socket.data.isAdmin = (room.admin === username);
        room.users.push({ id: socket.id, username });

        socket.emit('joined', { roomId, roomName: room.name, adminName: room.admin, isAdmin: socket.data.isAdmin, expiryTime: room.expiryTime });
        socket.to(roomId).emit('systemMessage', `${username} joined.`);
    });

    socket.on('chatMessage', ({ encryptedData, iv }) => {
        if (!socket.data.roomId || !rooms[socket.data.roomId]) return;
        if (checkSecurity(socket, clientIp, 'message')) return;
        io.to(socket.data.roomId).emit('message', { username: socket.data.username, encryptedData, iv, isAdmin: socket.data.isAdmin });
    });

    socket.on('typing', () => { if (socket.data.roomId) socket.to(socket.data.roomId).emit('displayTyping', { username: socket.data.username }); });
    socket.on('stopTyping', () => { if (socket.data.roomId) socket.to(socket.data.roomId).emit('hideTyping'); });

    socket.on('deleteRoom', () => {
        if (rooms[socket.data.roomId] && socket.data.isAdmin) deleteRoom(socket.data.roomId, 'Admin Destroyed');
    });

    // KICK LOGIC
    socket.on('kickUser', ({ targetUsername }) => {
        const roomId = socket.data.roomId;
        const room = rooms[roomId];

        // Security Checks
        if (!room) return;
        if (!socket.data.isAdmin) return socket.emit('error', 'ACCESS DENIED: You are not the Host.');
        if (targetUsername === socket.data.username) return socket.emit('error', 'You cannot kick yourself.');

        // Find the user object
        const targetUser = room.users.find(u => u.username === targetUsername);

        if (targetUser) {
            // 1. Add to blacklist
            room.blacklist.push(targetUsername);
            
            // 2. Announce to room
            io.to(roomId).emit('systemMessage', `"${targetUsername}" was forcibly disconnected by Admin.`);
            
            // 3. Force disconnect the specific socket
            const targetSocket = io.sockets.sockets.get(targetUser.id);
            if (targetSocket) {
                targetSocket.emit('kicked', 'You have been removed by the administrator.');
                targetSocket.leave(roomId);
                targetSocket.data.roomId = null;
                targetSocket.disconnect(true); // Force close connection
            }

            // 4. Remove from user list
            room.users = room.users.filter(u => u.username !== targetUsername);
            
            // 5. Tell Admin it worked
            socket.emit('systemMessage', `Success: ${targetUsername} has been booted.`);
        } else {
            // ERROR FEEDBACK (New)
            socket.emit('error', `User '${targetUsername}' not found. Check exact spelling.`);
        }
    });

    // ... rest of the code ...

    socket.on('disconnect', () => {
        const room = rooms[socket.data.roomId];
        if (room) {
            room.users = room.users.filter(u => u.id !== socket.id);
            io.to(socket.data.roomId).emit('systemMessage', `${socket.data.username} left.`);
        }
    });

    function deleteRoom(roomId, reason) {
        if (!rooms[roomId]) return;
        io.to(roomId).emit('roomDestroyed', reason);
        io.socketsLeave(roomId);
        delete rooms[roomId];
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Secure Uplink Active on ${PORT}`));