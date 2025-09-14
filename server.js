/**
 * server.js
 * Simple Express backend that stores per-user usage in a local JSON file (db.json).
 * Endpoints:
 *  - POST /api/usage  { userId, usage }
 *  - GET  /api/dashboard?userId=<id>
 *  - GET  /dashboard  (serves the visual dashboard)
 *
 * Note: For production, replace file-based storage with a real DB (Mongo/Postgres).
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
function readDB(){
  try {
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch(e){
    return { users: [], usage: [] }; // usage: [{userId,date,domain,seconds}]
  }
}
function writeDB(db){
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const app = express();
app.use(cors());
app.use(bodyParser.json({limit: '1mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/usage', (req, res) => {
  const payload = req.body;
  if(!payload || !payload.userId || !payload.usage){
    return res.status(400).json({error: 'userId and usage required'});
  }
  const db = readDB();
  if(!db.users.includes(payload.userId)) db.users.push(payload.userId);
  // payload.usage -> { dateKey: { domain: seconds, ... }, ... }
  for(const date of Object.keys(payload.usage)){
    const domains = payload.usage[date];
    for(const domain of Object.keys(domains)){
      const seconds = Number(domains[domain]) || 0;
      const existing = db.usage.find(u => u.userId === payload.userId && u.date === date && u.domain === domain);
      if(existing){
        existing.seconds = (existing.seconds || 0) + seconds;
      } else {
        db.usage.push({ userId: payload.userId, date, domain, seconds });
      }
    }
  }
  writeDB(db);
  res.json({status: 'ok'});
});

app.get('/api/dashboard', (req, res) => {
  const userId = req.query.userId;
  if(!userId) return res.status(400).json({error:'userId required'});
  const db = readDB();
  // simple classification lists (same defaults as extension)
  const productiveList = ["github.com","stackoverflow.com","gitlab.com","replit.com","stackblitz.com"];
  const unproductiveList = ["facebook.com","instagram.com","twitter.com","reddit.com","youtube.com","tiktok.com"];
  // prepare last 7 days
  const now = new Date();
  const days = {};
  for(let i = 6; i >= 0; i--){
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0,10);
    days[key] = { productive: 0, unproductive: 0, neutral: 0 };
  }
  const usage = db.usage.filter(u => u.userId === userId);
  for(const u of usage){
    if(days[u.date]){
      const domain = (u.domain || '').replace(/^www\./,'');
      let cat = 'neutral';
      if(productiveList.includes(domain)) cat = 'productive';
      else if(unproductiveList.includes(domain)) cat = 'unproductive';
      days[u.date][cat] += (u.seconds || 0);
    }
  }
  res.json({data: days});
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server started at http://localhost:${PORT}`);
});