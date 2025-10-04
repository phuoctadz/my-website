// server.js
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// In-memory storage: { mailboxId: { email, createdAt, messages: [...] } }
const mailboxes = new Map();
const MESSAGE_TTL_MS = 1000 * 60 * 60; // 1 hour

function generateId(len = 10) {
  return crypto.randomBytes(Math.ceil(len/2)).toString('hex').slice(0, len);
}

// Create new mailbox
app.post('/api/create', (req, res) => {
  const id = generateId(8);
  // mailbox local part: id, domain must be your configured domain
  const domain = process.env.TEMPMAIL_DOMAIN || 'example.com';
  const address = `${id}@${domain}`;
  const box = { id, address, createdAt: Date.now(), messages: [] };
  mailboxes.set(id, box);
  res.json({ id, address, expiresInMs: MESSAGE_TTL_MS });
});

// Get inbox
app.get('/api/inbox/:id', (req, res) => {
  const id = req.params.id;
  const box = mailboxes.get(id);
  if (!box) return res.status(404).json({ error: 'Not found' });
  res.json({ id: box.id, address: box.address, messages: box.messages });
});

// Get single message
app.get('/api/message/:id/:msgId', (req, res) => {
  const box = mailboxes.get(req.params.id);
  if (!box) return res.status(404).json({ error: 'Not found' });
  const msg = box.messages.find(m => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: 'message not found' });
  res.json(msg);
});

// Example webhook endpoint (for inbound email provider).
// Providers supply different fields. Example expects JSON with `to`, `from`, `subject`, `html`/`text`.
app.post('/api/webhook/inbound', (req, res) => {
  // req.body will depend on the provider (Mailgun, SendGrid, etc.)
  const { to, from, subject, text, html } = req.body;

  if (!to) {
    return res.status(400).json({ error: 'missing to field' });
  }

  // support `to` being e.g. "id@example.com" or "Name <id@example.com>"
  const toAddr = String(to).match(/[\w\d._%+-]+@[\w\d.-]+\.[\w]{2,}/)?.[0];
  if (!toAddr) return res.status(400).json({ error: 'invalid to address' });

  const local = toAddr.split('@')[0];
  const box = mailboxes.get(local);
  if (!box) {
    // optionally create mailbox on first email
    return res.status(404).json({ error: 'mailbox not found' });
  }

  const msg = {
    id: generateId(12),
    from,
    to: toAddr,
    subject: subject || '(no subject)',
    text: text || '',
    html: html || '',
    receivedAt: Date.now()
  };

  box.messages.unshift(msg);
  // Keep messages list bounded
  if (box.messages.length > 50) box.messages.pop();

  res.json({ ok: true });
});

// cleanup expired boxes periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, box] of mailboxes.entries()) {
    if (now - box.createdAt > MESSAGE_TTL_MS) mailboxes.delete(k);
  }
}, 60_000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on', PORT));
