# SECURE_CHAT_V1 // ANONYMOUS UPLINK

## 📡 What is this App?

**SECURE_CHAT_V1** is a web-based, anonymous, end-to-end encrypted chat application designed for ephemeral communication. It mimics the aesthetic of a "dark web" terminal or hacker uplink.

The core philosophy of this application is **Zero Knowledge** and **Zero Trace**:
1.  **Zero Knowledge:** The server never sees your messages, your images, or your encryption keys. It only relays encrypted data packets.
2.  **Zero Trace:** No database is used. All room data exists only in the server's RAM (Random Access Memory). Once a room expires or the server restarts, all data is permanently obliterated.

---

## 🎯 Purpose & Use Cases

This tool is built for scenarios requiring high privacy and temporary communication channels:

* **Whistleblowing:** Sharing sensitive information without leaving a digital footprint.
* **Private Coordination:** Quick, secure coordination between teams without setting up accounts.
* **CTF / Hackathons:** A thematic communication tool for cybersecurity events.
* **Privacy Enthusiasts:** For those who want to chat without their metadata being harvested.

---

## 🔐 How the Encryption Works (Technical Deep Dive)

This application uses **Client-Side End-to-End Encryption (E2EE)** via the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API).

### 1. Key Derivation (PBKDF2)
When you create or join a room, you enter a **Room Password**.
* The app does **not** send this password to the server in plain text.
* It uses **PBKDF2** (Password-Based Key Derivation Function 2) with SHA-256 to convert your password into a cryptographic **AES-GCM Key**.
* This key lives **only in your browser's memory**.

### 2. Authentication vs. Encryption
* **Authentication:** The client hashes the password (SHA-256) and sends the *hash* to the server. The server compares this hash to let you in. The server *cannot* reverse this hash to get the password.
* **Encryption:** The client uses the *derived key* (from step 1) to encrypt messages. The server never receives this key.

### 3. AES-GCM Encryption
* **Algorithm:** AES-GCM (Advanced Encryption Standard - Galois/Counter Mode) with a 256-bit key.
* **IV (Initialization Vector):** Every single message generates a unique, random 12-byte IV. This ensures that if you type "Hello" twice, the encrypted output looks completely different each time.
* **Transmission:** The client sends `{ iv, encryptedData }` to the server.
* **Decryption:** The recipient's browser takes the IV and Data, uses their local key, and decrypts the text.

---

## ⚙️ App Processes & Features

### 1. Ephemeral Room Lifecycle
* **Creation:** A user generates a room. The server allocates a slot in RAM.
* **Countdown:** A strict **2-hour timer** begins immediately.
* **Destruction:** When the timer hits `00:00:00`, the server forcibly disconnects all sockets and `delete`s the room object from memory. No recovery is possible.

### 2. Admin Privileges
The creator of the room is assigned **ADMIN** status.
* **Kick/Boot:** The Admin can ban a specific username from the room. The server adds the username to a session blacklist.
* **Destroy:** The Admin can trigger a "Kill Switch," immediately wiping the room and disconnecting all users before the timer expires.

### 3. User Experience Features
* **Hacker UI:** A CRT-style terminal interface with scanlines, neon glows, and glitch effects.
* **Sound Effects (Web Audio API):** Generated beeps, chirps, and static for incoming messages, joins, and errors.
* **Typing Indicators:** Real-time feedback when other users are inputting data.
* **Markdown Support:** (Optional capability) for code blocks and formatting.
* **Responsive:** Works on desktop and mobile uplinks.

---

## 🛠 Tech Stack

* **Runtime:** [Node.js](https://nodejs.org/)
* **Backend Framework:** [Express.js](https://expressjs.com/)
* **Real-time Communication:** [Socket.io](https://socket.io/) (WebSockets)
* **Frontend:** HTML5, CSS3 (Flexbox/Grid), Vanilla JavaScript (ES6+)
* **Encryption:** Native Browser Web Crypto API (No external libraries used for crypto).

---

## 📂 Project Structure

```text
/
├── index.js            # The Backend Server (Node/Express/Socket)
├── package.json        # Dependencies configuration
└── public/             # Frontend Client Files
    ├── index.html      # The UI Structure
    ├── style.css       # The Tactical HUD Styling
    └── script.js       # Client Logic & Encryption