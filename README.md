# 🛒 Retail AI — Decision Intelligence Dashboard

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-6c63ff?style=for-the-badge)
![Node](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-00d4aa?style=for-the-badge)
![Groq](https://img.shields.io/badge/AI-Groq%20LLaMA%203.3-ff6b6b?style=for-the-badge)
![Supabase](https://img.shields.io/badge/DB-Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![n8n](https://img.shields.io/badge/Workflow-n8n-EA4B71?style=for-the-badge)

**An AI-powered retail analytics platform that turns raw sales data into actionable decisions — in seconds.**

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [Configuration](#-configuration) · [API Reference](#-api-reference)

</div>

---

## 📸 Overview

Upload any Excel or CSV sales file and get an end-to-end AI analysis pipeline:

- **Retail AI Agent** → trend analysis, category insights, monthly patterns
- **Risk AI Agent** → risk scoring, risk signals, mitigation plan
- **Report AI Agent** → executive-grade summary report
- **AI Chat** → ask follow-up questions about your data in natural language

All results are stored in Supabase and instantly queryable through the built-in chat assistant.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📂 **Drag & Drop Upload** | Upload `.xlsx`, `.xls`, or `.csv` retail data files |
| 🔄 **Live Pipeline Tracker** | Real-time 7-step visual pipeline status (Upload → Process → Retail AI → Risk AI → Report AI → Supabase → Done) |
| 📈 **Revenue by Category** | Auto-generated doughnut chart across all product categories |
| 📅 **Monthly Trend Chart** | Line chart showing revenue trajectory over time |
| 📐 **Key Metrics Panel** | Auto-computed totals, averages, and unit counts from your data |
| 🛒 **Retail Analysis Tab** | AI-generated trend analysis, category insights, monthly patterns, and recommendations |
| ⚠️ **Risk Analysis Tab** | Risk level badge (HIGH / MEDIUM / LOW), risk summary, signals, and mitigation plan |
| 📋 **Executive Report Tab** | Full markdown-formatted executive report with modal read-more |
| 💬 **AI Chat Assistant** | Conversational AI grounded in your live chart data + stored analysis |
| 🕐 **History Tab** | Browse all past analyses stored in Supabase |
| 💾 **Session Memory** | Chat sessions are saved to Supabase and resumable across page reloads |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Frontend)                    │
│                                                             │
│  index.html ──► script.js ──► Chart.js / XLSX.js           │
│                    │                                        │
│                chat.js ──► Live chart context builder       │
└────────────────────┬────────────────────────────────────────┘
                     │  HTTP
          ┌──────────▼──────────┐
          │   Express Server    │  server.js  (Node.js)
          │   localhost:3001    │
          └──────┬──────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
  ┌───────────┐    ┌─────────────┐
  │  Supabase │    │  Groq API   │
  │ (Storage) │    │ LLaMA 3.3   │
  │           │    │  70B model  │
  └───────────┘    └─────────────┘
        ▲
        │  Webhook (POST binary file)
  ┌─────┴──────────────────────────┐
  │          n8n Workflow           │
  │                                │
  │  ┌──────────┐  ┌────────────┐  │
  │  │ Retail   │  │  Risk AI   │  │
  │  │ AI Agent │  │   Agent    │  │
  │  └──────────┘  └────────────┘  │
  │        ┌──────────────┐        │
  │        │  Report AI   │        │
  │        │    Agent     │        │
  │        └──────────────┘        │
  └────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [n8n](https://n8n.io/) instance with a configured webhook workflow
- [Supabase](https://supabase.com/) project with the required tables
- [Groq API key](https://console.groq.com/) (free tier available)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/retail-ai-dashboard.git
cd retail-ai-dashboard
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration](#-configuration) below).

### 4. Set up Supabase tables

Run the SQL schema in your Supabase SQL editor:

```bash
# Contents of chat_history_schema.sql
```

Or paste the file contents directly in the Supabase dashboard → SQL Editor.

### 5. Start the server

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

### 6. Open the dashboard

```
http://localhost:3001
```

---

## ⚙️ Configuration

Create a `.env` file in the project root:

```env
# ── Server ───────────────────────────────────────────────
PORT=3001

# ── Supabase ─────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ── Groq AI ──────────────────────────────────────────────
GROQ_API_KEY=gsk_your_groq_api_key
```

> **Note:** Use `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) so the server can bypass Row Level Security when reading/writing chat history.

### In-dashboard config (saved to localStorage)

| Field | Description |
|---|---|
| **n8n Webhook URL** | The POST endpoint of your n8n workflow that receives the uploaded file |
| **Supabase URL** | Same as `SUPABASE_URL` above |
| **Supabase Anon Key** | Public anon key — used client-side for the History tab query |
| **Analysis Mode** | Comma-separated modes passed as `X-Analysis-Mode` header to n8n |

---

## 🗄️ Database Schema

### `retail_decisions`

Populated by your n8n workflow after each analysis run.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `risk_level` | `text` | `HIGH`, `MEDIUM`, or `LOW` |
| `trend_analysis` | `text` | AI-generated trend narrative |
| `category_insights` | `text` | Per-category revenue breakdown |
| `monthly_patterns` | `text` | Month-over-month patterns |
| `risk_summary` | `text` | Why the risk level was assigned |
| `risk_signals` | `text` | Specific warning indicators |
| `mitigation_plan` | `text` | Recommended risk mitigation steps |
| `recommendations` | `text` | Numbered action items |
| `executive_report` | `text` | Full markdown executive summary |
| `created_at` | `timestamptz` | Auto-set by Supabase |

### `chat_history`

Managed by the Express server.

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `session_id` | `text` | Conversation identifier |
| `role` | `text` | `user` or `assistant` |
| `message` | `text` | Combined transcript for the session |
| `created_at` | `timestamptz` | Auto-set by Supabase |

---

## 📡 API Reference

### `POST /chat`

Send a question and receive an AI-generated answer grounded in your retail data.

**Request body:**

```json
{
  "question": "Why is the risk level high this month?",
  "sessionId": "conversation_1",
  "chartContext": {
    "totalRows": 120,
    "grandTotal": "$16,400",
    "categoryBreakdown": "Electronics: $5,300 (32.3%) | Groceries: $4,400 (26.8%) | ...",
    "monthlyTrend": "2024-01: $4,500 | 2024-02: $5,400 | 2024-03: $6,500",
    "columns": ["Date", "Category", "Amount", "Quantity"]
  }
}
```

**Response:**

```json
{
  "answer": "The risk is HIGH due to Electronics concentration at 32.3%...",
  "sessionId": "conversation_1"
}
```

---

### `GET /chat/history/:sessionId`

Returns parsed chat history for a session.

```json
{
  "history": [
    { "role": "user",      "message": "Why is risk high?" },
    { "role": "assistant", "message": "Electronics at 32.3% concentration..." }
  ]
}
```

---

### `GET /chat/sessions`

Returns the 10 most recent chat sessions.

```json
{
  "sessions": [
    {
      "sessionId": "conversation_1",
      "firstMessage": "User: Why is risk high?...",
      "lastActivity": "2024-03-15T10:30:00Z",
      "messageCount": 3
    }
  ]
}
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla JS (ES2022), HTML5, CSS3 |
| **Charts** | [Chart.js 4.4](https://www.chartjs.org/) |
| **File Parsing** | [SheetJS / XLSX 0.18](https://sheetjs.com/) |
| **Backend** | [Express.js 4](https://expressjs.com/) + Node.js |
| **AI Model** | [Groq — LLaMA 3.3 70B Versatile](https://groq.com/) |
| **Workflow** | [n8n](https://n8n.io/) multi-agent pipeline |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL) |
| **Fonts** | [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) |

---

## 📁 Project Structure

```
retail-ai-dashboard/
├── index.html              # Main dashboard UI
├── styles.css              # Premium dark theme stylesheet
├── script.js               # Dashboard logic (upload, charts, analysis)
├── chat.js                 # AI chat manager class
├── server.js               # Express API server
├── chat_history_schema.sql # Supabase table definitions
├── package.json
└── .env                    # Environment variables (not committed)
```

---

## 🔑 Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `3001`) |
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | Service role key for server-side access |
| `SUPABASE_KEY` | Fallback | Anon key (used if service role key is absent) |
| `GROQ_API_KEY` | ✅ Yes | Groq API key for LLaMA inference |

---

## 📄 License

MIT © 2024 — see [LICENSE](LICENSE) for details.
