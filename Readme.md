<div align="center">

## Knight Bot Mini

[![Made with Baileys](https://img.shields.io/badge/Made%20with-Baileys-00bcd4?style=for-the-badge)](https://github.com/WhiskeySockets/Baileys)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

<img src="utils/bot_image.jpg" alt="Knight Bot" width="260">

</div>

Knight Bot Mini is a WhatsApp MD bot built on top of the **Baileys** library.  
It’s designed to be fast, lightweight, and easy to customize without touching the core code.  
This project is **fully open source** — you can modify it, rebrand it, and make your **own bot** from this codebase **free of cost**, without needing any permission from our side.  
All commands and the overall structure are written in a way that makes customization (bot image, prefix, name, features, etc.) as easy as possible.

---


## ✨ Features

- **Fully Open Source** – entire codebase is editable; host it anywhere (Heroku, panel, VPS, etc.).  
- **Easy Customization via Commands** – change **bot image**, **prefix**, **channel/newsletter**, **bot name**, etc. with simple commands.  
- **Modular Command System** – commands are organized in the `commands` folder for easy editing.  
- **Optimized for Stability** – RAM‑optimized media handling (streaming, temp cleanup), better session handling via `sessionID` in `config.js`.  
- **Owner Utilities** – restart, update from ZIP, and more owner‑only tools.

---

## 🛰️ Web Dashboard (v2) & DM Behaviour

### Dashboard
Open the bot's port (`PORT`, default `3000`) in a browser and log in with the dashboard password (`DASHBOARD_PASSWORD` env var, default `5656`).

- **💬 Chats** — full web chat: send text, media, documents and voice notes. Per-chat **👻 Ghost mode** (no blue ticks sent to that chat), a **Mark read** button (send blue ticks on purpose), **AI suggested replies** and an AI **vibe** selector.
- **🛡️ Groups** — every group setting as a **one-click switch** (antilink, antitag, welcome, chatbot, …), action dropdowns (delete/kick/warn) and welcome/goodbye message editors.
- **⚡ Commands** — every bot command as a clickable box; run it in your DM or into a selected group (replies land in your DM).
- **📢 Broadcast** — send to everyone, groups only, DMs only, or custom numbers.
- **📊 Analytics** — busiest chats and 24h message activity.
- **⚙️ Bot Control** — global switches (auto-read, auto-typing, self mode, …), AI provider status, restart.

### DM behaviour
- Any **group-settings command** (`.antilink`, `.welcome`, …) typed **inside a group** now answers in **your own DM** with the group name attached — the group stays quiet. Toggle any time with **`.dmreply on|off`** or the dashboard switch.
- **Anti-link / anti-group-status reports** (link deleted, member kicked) go to the **owner's DM** instead of being posted in the group. Deletion itself is still silent in the group.

### API keys (free models only)
Set these as environment variables on your hosting panel (or in a local `.env` file — see `.env.example`). **Never commit real keys.**

| Variable | Provider | Notes |
| --- | --- | --- |
| `GLM_API_KEY` | Zhipu GLM (open.bigmodel.cn) | `glm-4.5-flash` model is **free** (default) |
| `OPENROUTER_API_KEY` | OpenRouter | any model id ending in `:free` is free (default `google/gemma-4-31b-it:free`) |
| `DASHBOARD_PASSWORD` | — | dashboard login password (default `5656`) |

AI replies automatically fall back between GLM → OpenRouter → public endpoint, all on free models.

---

### 1. Fork the Repository

<div align="center">

<a href="https://github.com/mruniquehacker/Knightbot-MD/fork" target="_blank">
  <img src="https://img.shields.io/badge/Fork%20Repository-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="Fork on GitHub">
</a>

</div>

> This creates your own copy of `Knightbot-MD` under your GitHub account.

---

### 2. Get Pair Code

Deploy a small helper to generate a **pair code** and obtain your session string.

<div align="center">

<a href="https://knight-bot-paircode.onrender.com/" target="_blank">
  <img src="https://img.shields.io/badge/Generate-Pair%20Code-blueviolet?style=for-the-badge" alt="Generate Pair Code">
</a>

</div>

After scanning, you will receive a **session string** starting with:

```text
KnightBot!H4....
```

Copy that full string and paste it into `config.js`:

```js
sessionID: 'KnightBot!H4.....'
```

Or set it via the `SESSION_ID` environment variable when hosting.

---

### 3. Deploy on Panel (Katabump, etc.)

<div align="center">

<a href="https://dashboard.katabump.com/auth/login#d6b7d6" target="_blank">
  <img src="https://img.shields.io/badge/Deploy%20on-Katabump-orange?style=for-the-badge" alt="Deploy on Katabump">
</a>

</div>

For a full step‑by‑step deployment tutorial (panels / VPS / Heroku), add or update your YouTube guide here:

- **YouTube Tutorial:** *(coming soon)*

---

## 🛠 Local Setup

### 1️⃣ Clone the repository

```bash
git clone https://github.com/mruniquehacker/Knightbot-MD.git
cd Knightbot-MD
```

### 2️⃣ Install dependencies

```bash
npm install
```

### 3️⃣ Configure session

Edit `config.js`:

- **Option A: Use session string**

  ```js
  sessionID: 'KnightBot!H4.....'
  ```

- **Option B: Scan QR**

  ```js
  sessionID: ''
  ```

  Run the bot and scan the QR from the terminal.

### 4️⃣ Run the bot

```bash
node index.js
```

When the bot starts:

- If `sessionID` is empty, a **QR code** will appear in the terminal – scan it using **Linked Devices** in WhatsApp.  
- If `sessionID` is set, it will log in using that session string.

---

## 🌐 Community

<div align="center">

<a href="https://t.me/+3QhFUZHx-nhhZmY1" target="_blank">
  <img src="https://img.shields.io/badge/Join-Telegram-0088cc?style=for-the-badge&logo=telegram&logoColor=white" alt="Join Telegram">
</a>

<a href="https://whatsapp.com/channel/0029Va90zAnIHphOuO8Msp3A" target="_blank">
  <img src="https://img.shields.io/badge/Join-WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Join WhatsApp Channel">
</a>

</div>

---

## 🙏 Credits

- **Mr Unique Hacker** – Main developer & maintainer  
- **Baileys** – WhatsApp Web API library (`@whiskeysockets/baileys`)  
- Other open‑source libraries listed in `package.json`

---

## ⚠️ Important Warning

- This bot is created **for educational purposes only**.  
- This is **NOT** an official WhatsApp bot.  
- Using third‑party bots **may violate WhatsApp’s Terms of Service** and can lead to your account being **banned**.

> You use this bot **at your own risk**.  
> The developers are **not responsible** for any bans, issues, or damages resulting from its use.

---

## 📝 Legal

- This project is **not affiliated with, authorized, maintained, sponsored, or endorsed** by WhatsApp Inc. or any of its affiliates or subsidiaries.  
- This is **independent and unofficial software**.  
- **Do not spam** people using this bot.  
- **Do not** use this bot for bulk messaging, harassment, or any **illegal activities**.  
- The developers assume **no liability** and are **not responsible** for any misuse or damage caused by this program.

---

## 📄 License (MIT)

This project is licensed under the **MIT License**.

You must:

- Use this software in compliance with **all applicable laws and regulations**.  
- Keep the **original license and copyright** notices.  
- **Credit the original authors**.  
- **Not** use this for spam, abuse, or malicious purposes.

---

## 📜 Copyright Notice

Copyright (c) **2026 Professor**.  
All rights reserved.

This project contains code from various open‑source projects and AI tools, including but not limited to:

- **Baileys** – MIT License  
- Other libraries as listed in `package.json`

