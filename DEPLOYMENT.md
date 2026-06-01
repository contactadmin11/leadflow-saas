# LeadFlow SaaS — Deployment Guide

## 🌐 Free Stack (Handles 500+ Users)

| Service | Provider | Cost | Limit |
|---------|---------|------|-------|
| Backend API | Render.com | Free | 750 hrs/month, sleeps after 15min |
| Database | MongoDB Atlas M0 | Free Forever | 512MB storage |
| Frontend | Vercel or Render | Free | Unlimited |

---

## Step 1: MongoDB Atlas (Free Database)

1. Go to **https://cloud.mongodb.com**
2. Create account → Create a **free M0 cluster**
3. Create database user (username + password)
4. Network Access → Add IP: **0.0.0.0/0** (allow from anywhere)
5. Connect → Drivers → Copy the connection string:
   ```
   mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/leadflow?retryWrites=true&w=majority
   ```

---

## Step 2: Deploy Backend to Render.com (Free)

1. Go to **https://render.com** → Sign up with GitHub
2. New → Web Service → Connect your GitHub repo
3. Settings:
   - **Root directory**: `server`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. Add Environment Variables:
   ```
   MONGODB_URI = (your Atlas connection string)
   JWT_ACCESS_SECRET = (random 64-char string)
   JWT_REFRESH_SECRET = (random 64-char string)
   ENCRYPTION_KEY = (random 32-char string)
   ADMIN_PASSWORD = (your secure admin password)
   ADMIN_JWT_SECRET = (random 64-char string)
   NODE_ENV = production
   CLIENT_URL = (your frontend URL, e.g. https://leadflow-app.vercel.app)
   ```
5. Deploy!

Your API will be at: `https://your-app.onrender.com`

### Generate random secrets (run in terminal):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Step 3: Deploy Frontend to Vercel (Free)

1. Go to **https://vercel.com** → Sign up
2. Import your GitHub repo
3. Set **Root directory** to `client`
4. Add environment variable:
   ```
   LEADFLOW_API_URL = https://your-app.onrender.com/api
   ```
5. Deploy!

Your app will be at: `https://your-app.vercel.app`

---

## Step 4: Migrate Your Old Data

1. Open `https://your-app.vercel.app/migrate.html`
2. Enter your API URL, email, and password
3. Paste your exported JSON from the old app
4. Click Import!

---

## 📧 Configure Email (Gmail)

1. Enable 2-Factor Authentication on Gmail
2. Go to Google Account → Security → App Passwords
3. Generate an App Password for "Mail"
4. In LeadFlow Settings → Email Integration:
   - Gmail: your@gmail.com
   - App Password: (the 16-char password)

---

## 📱 Configure WhatsApp

1. Go to Settings → WhatsApp
2. Click "Initialize WhatsApp"
3. Scan the QR code with your WhatsApp
4. Done! All invoice sends will auto-attach PDF

---

## ⚠️ Free Tier Limitations

- **Render free**: Server sleeps after 15 min inactivity (30s cold start). For always-on, use Railway ($5/mo credit) or Koyeb (free always-on).
- **MongoDB M0**: 512MB storage. With 500 users and ~50 leads each = ~500KB/user = fits perfectly.
- **WhatsApp**: One WA account per user session. Session persists on disk.

---

## 🚀 Upgrade Path (When You Grow)

- Backend: Render Starter ($7/mo) — no sleep, 512MB RAM
- Database: MongoDB M10 ($57/mo) — 2GB dedicated
- Or: Self-host on a VPS (Hetzner €4/mo, DigitalOcean $6/mo)
