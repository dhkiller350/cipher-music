# Cipher Music 🎵

> A Spotify-inspired music platform test app built with pure HTML, CSS, and JavaScript.  
> **This is a standalone test build** — separate from the main Cipher app.

![Cipher Music Screenshot](screenshot.png)

---

## Features

- 🔐 **Login / Auth** — Client-side login with localStorage persistence, remember me, and form validation
- 🎵 **Music Player** — YouTube-powered search and playback with play/pause, next track, and volume controls
- 👤 **Profile Page** — User avatar (initials), stats, and member information
- 💳 **Upgrade / Payments** — Plan selection (Free / Pro / Premium) with a payment form and success state
- ⚙️ **Settings** — Dark mode toggle, autoplay, audio quality, notifications, language selector, sign-out and account deletion
- 🕐 **Live Clock & Greeting** — Dynamic time-of-day greeting and HH:MM:SS clock in the header
- 🌙 **Dark Theme** — Deep blacks, electric cyan (#00d4ff) and neon purple (#7c3aed) accent colours
- 💎 **Glassmorphism UI** — Frosted glass cards, gradient glows, smooth hover transitions
- 📱 **Mobile Responsive** — Works on all screen sizes

---

## Tech Stack

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Markup      | HTML5 (Single Page Application)         |
| Styles      | CSS3 (custom properties, glassmorphism) |
| Logic       | Vanilla JavaScript (ES2020+)            |
| Music API   | YouTube Data API v3                     |
| Playback    | YouTube IFrame Player API               |
| Fonts       | Google Fonts — Poppins                  |

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/dhkiller350/cipher-music-test.git
cd cipher-music-test
```

### 2. Add your YouTube API Key

Open `app.js` and replace the placeholder key at the top of the file:

```js
const CONFIG = {
  YOUTUBE_API_KEY: "YOUR_API_KEY_HERE",
  ...
};
```

You can get a free key from the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).  
Make sure the **YouTube Data API v3** is enabled for your project.

### 3. (Optional) Set up Email Verification — EmailJS

To make the sign-up verification email actually send, create a free account at [emailjs.com](https://www.emailjs.com):

1. Create an **Email Service** (Gmail, Outlook, etc.) in the EmailJS dashboard → note the **Service ID**
2. Create an **Email Template** with the following variables:
   - `{{to_name}}` — recipient's username
   - `{{to_email}}` — recipient's email address  
   - `{{verification_code}}` — the 6-digit code
3. Copy your **Public Key** from Account → General
4. Update `app.js`:

```js
const CONFIG = {
  YOUTUBE_API_KEY:     "your-yt-key",
  EMAILJS_SERVICE_ID:  "service_xxxxxxx",   // from EmailJS dashboard
  EMAILJS_TEMPLATE_ID: "template_xxxxxxx",  // from EmailJS dashboard
  EMAILJS_PUBLIC_KEY:  "xxxxxxxxxxxxxxx"    // from EmailJS Account > General
};
```

> **Without EmailJS configured:** The app still works. A demo code is shown on-screen in the verification view so you can complete sign-up without real email.

### 4. Open in a browser

No build step required. Simply open `index.html` in your browser:

```bash
open index.html   # macOS
xdg-open index.html  # Linux
# or just double-click index.html in your file manager
```

---

## File Structure

```
cipher-music-test/
├── index.html       # Main HTML — all views in one SPA
├── style.css        # All styles (dark theme, glassmorphism)
├── app.js           # All JavaScript (auth, search, player, settings)
├── .env.example     # Environment variable template
├── .gitignore       # Ignores .env and build artifacts
└── README.md        # This file
```

---

## Usage

1. Open `index.html` — you'll land on the **Login** screen.
2. Enter any username, a valid email, and a password (6+ chars), then click **Sign In to Cipher**.
3. Use the **search bar** to find music on YouTube and click **Play** on any result.
4. Navigate using the **sidebar** to visit Profile, Upgrade, or Settings.
5. Toggle **Dark Mode** in Settings, or **Sign Out** to return to the login screen.

---

## Notes

- This is a **test/demo build** — no real payment processing occurs.
- Login data is stored in `localStorage` only; there is no backend.
- The YouTube API key in `app.js` is a placeholder; replace it with your own key.
- This project is separate from the main Cipher app and intended purely for UI/UX testing.
