# Retail AI Dashboard - Backend Setup

## 🚀 Quick Start

### 1. Get API Keys

**Groq API Key:**
- Go to https://console.groq.com
- Sign up/Login
- Create API key in Settings
- Copy the key (starts with `gsk_`)

**Supabase Credentials:**
- Go to your Supabase project
- Settings → API
- Copy `Project URL` and `anon` key

### 2. Environment Setup

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
```
GROQ_API_KEY=gsk_your_actual_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_key_here
PORT=3000
```

### 3. Install Dependencies

```bash
npm install
```

This installs:
- **express** - Web framework
- **cors** - Cross-origin support for frontend
- **dotenv** - Environment variable loading
- **groq-sdk** - Groq API client
- **@supabase/supabase-js** - Supabase client

### 4. Run Server

```bash
npm start
```

Or with auto-reload during development:
```bash
npm run dev
```

Server starts on: `http://localhost:3000`

### 5. Test the `/chat` Endpoint

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What are the top retail trends?"}'
```

Should return:
```json
{
  "answer": "Based on recent retail data..."
}
```

## 📝 Frontend Configuration

Update the dashboard to use your backend URL. In `chat.js`, change:
```javascript
const response = await fetch('/chat', {
```

To:
```javascript
const response = await fetch('http://localhost:3000/chat', {
```

Or deploy backend and use the deployed URL.

## 🗄️ Supabase Table Setup

The backend expects a `retail_decisions` table with columns:
- `id` (UUID)
- `created_at` (timestamp)
- `risk_level` (text)
- `trend_analysis` (text)
- `category_insights` (text)
- `monthly_patterns` (text)
- `executive_report` (text)

This is automatically created if you're using the existing dashboard's Supabase setup.

## 🔐 Security

✅ API keys stored in `.env` (server-side only)
✅ `.gitignore` prevents committing secrets
✅ Frontend only sees the answer, never the API key
✅ CORS enabled for frontend integration

## 📚 Model Options

The server uses `mixtral-8x7b-32768`. Other Groq models available:
- `llama2-70b-4096` - Meta's Llama 2
- `mixtral-8x7b-32768` - Mixture of Experts (recommended)

Change in `server.js`:
```javascript
model: 'your-chosen-model',
```

## ✅ Troubleshooting

**405 Error** - Server not running or endpoint not reached
- Check `npm start` is running
- Verify URL in `chat.js`

**Missing GROQ_API_KEY** - .env not loaded
- Ensure `.env` file exists in project root
- Restart server after creating `.env`

**Supabase connection failed** - Wrong credentials
- Double-check URL and key in `.env`
- Test Supabase connection manually

**CORS errors** - Frontend/Backend mismatch
- Frontend URL should match backend `CORS` settings
- Check frontend fetch URL

## 📞 API Reference

### POST /chat
Send a chat question to the AI

**Request:**
```json
{
  "question": "What are the trends in category X?"
}
```

**Response:**
```json
{
  "answer": "Based on recent data..."
}
```

**Error Response:**
```json
{
  "error": "Error message",
  "details": "Additional context"
}
```

### GET /health
Health check endpoint

**Response:**
```json
{
  "status": "ok",
  "message": "Server is running"
}
```

---

Happy chatting! 🎉
