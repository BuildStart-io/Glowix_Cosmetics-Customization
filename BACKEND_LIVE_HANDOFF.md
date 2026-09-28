# Today's Updates Deployment Guide (28 Sep 2026)

**Target:** Live Production Environment  
**Files Modified Today:**
1. `supabase/functions/ai-chat-Glowix_cosmetics/index.ts` (Backend Edge Function)
2. `frontend/src/pages/Conversations.tsx` (Frontend UI)

> [!NOTE]
> **Database Migrations:** ZERO (0) SQL scripts required. Today's changes use existing tables and require no database modifications.

---

## 📌 Summary of Today's Changes:
1. **WhatsApp AI Bot (`ai-chat-Glowix_cosmetics`):**
   - **Input Mapping:** Customer typing `1` or `2` now works identically to typing words (`combo`, `separate`, `cod`, `bank transfer`).
   - **Combo Flow:** Bot now explains the 3 products inside each combo set (from description) and asks: *"Which combo set would you like to choose? (e.g. Set 1 or Set 2) 😊"*.
   - **Photos:** Auto-attaches combo photos when customer replies `"1"`.
2. **Dashboard UI (`Conversations.tsx`):**
   - Chat list now marks order-confirmed customers with green badges `[📦 Order Placed • LKR X,XXX]`.
   - Added filter tabs: `All`, `Orders 🛒`, `Queries 💬` to isolate buyers from general inquiries.
   - Added a mini order summary banner inside the chat header with a direct link to Orders.

---

## 🚀 Deployment Instructions for Backend Engineer:

### Step 1: Update the Backend Edge Function (On the Server)

SSH into the live server and run:
```bash
cd /path/to/Glowix_cosmetics
git pull origin master

# Restart Edge Functions container to load the new AI chat logic
docker compose restart supabase-edge-functions
```

*(Or if deploying via Supabase CLI: `supabase functions deploy ai-chat-Glowix_cosmetics --no-verify-jwt`)*

---

### Step 2: Push to Git (For Frontend Vercel Deploy)

Push today's committed code from your local machine:
```bash
git add supabase/functions/ai-chat-Glowix_cosmetics/index.ts frontend/src/pages/Conversations.tsx
git commit -m "feat: today updates - 1/2 intent mapping, combo details prompt, and chat tab order badges"
git push origin master
```
*Vercel will automatically build and deploy the updated Conversations UI.*

---

## ✅ Quick Verification:
1. **WhatsApp:** Send `"1"` to the bot -> It should list combo sets with 3 items each and ask which set you want.
2. **Dashboard:** Open `/dashboard/conversations` -> Confirm the new `Orders 🛒` / `Queries 💬` tabs and green order badges are visible.
