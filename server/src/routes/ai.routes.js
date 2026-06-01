const express    = require('express');
const axios      = require('axios');
const Settings   = require('../models/Settings');
const { protect }= require('../middleware/auth');
const { decrypt }= require('../services/crypto.service');
const Lead       = require('../models/Lead');
const Invoice    = require('../models/Invoice');
const router     = express.Router();

router.use(protect);

/**
 * POST /api/ai/chat
 * Proxy AI requests server-side. User API keys never exposed to browser.
 */
router.post('/chat', async (req, res, next) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const settings = await Settings.findOne({ userId: req.user.id });
    const provider  = settings?.aiProvider || 'local';

    // Build CRM context summary
    let crmContext = '';
    if (context) {
      crmContext = `\nCRM Context:\n${JSON.stringify(context).substring(0, 2000)}`;
    } else {
      const [leads, invoices] = await Promise.all([
        Lead.find({ userId: req.user.id, deletedAt: null }).sort('-createdAt').limit(20).lean(),
        Invoice.find({ userId: req.user.id, deletedAt: null }).sort('-createdAt').limit(10).lean()
      ]);
      const stats = {
        totalLeads: leads.length,
        wonLeads: leads.filter(l=>l.stage==='Won').length,
        activeLeads: leads.filter(l=>!['Won','Lost'].includes(l.stage)).length,
        pipelineValue: leads.filter(l=>!['Won','Lost'].includes(l.stage)).reduce((s,l)=>s+(l.value||0),0),
        overdueFollowups: leads.filter(l=>l.nextFollowUp && new Date(l.nextFollowUp)<new Date() && !['Won','Lost'].includes(l.stage)).length
      };
      crmContext = `\nYour CRM Stats: ${JSON.stringify(stats)}`;
    }

    const systemPrompt = `You are a smart CRM AI assistant for a business using LeadFlow CRM. You help with sales strategy, lead analysis, follow-up recommendations, email drafting, and business insights. Be concise and actionable.${crmContext}`;

    let reply = '';

    if (provider === 'claude' && settings?.claudeKeyEnc) {
      const apiKey = decrypt(settings.claudeKeyEnc);
      const resp = await axios.post('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-haiku-20241022', max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }]
      }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
      reply = resp.data.content[0]?.text || '';

    } else if (provider === 'openai' && settings?.openaiKeyEnc) {
      const apiKey = decrypt(settings.openaiKeyEnc);
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini', max_tokens: 1024,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }]
      }, { headers: { Authorization: `Bearer ${apiKey}` } });
      reply = resp.data.choices[0]?.message?.content || '';

    } else if (provider === 'gemini' && settings?.geminiKeyEnc) {
      const apiKey = decrypt(settings.geminiKeyEnc);
      const resp = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        contents: [{ parts: [{ text: systemPrompt + '\n\nUser: ' + message }] }]
      });
      reply = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    } else {
      // Built-in smart AI (no API key needed) — rule-based CRM intelligence
      reply = builtinAI(message, crmContext);
    }

    res.json({ reply });
  } catch (err) {
    if (err.response?.data) {
      return res.status(400).json({ error: `AI API Error: ${JSON.stringify(err.response.data).substring(0, 200)}` });
    }
    next(err);
  }
});

function builtinAI(message, context) {
  const m = message.toLowerCase();
  if (m.includes('follow') || m.includes('overdue')) return `Based on your CRM data${context ? ' ('+context.substring(0,100)+')' : ''}, prioritize overdue follow-ups first. Call leads that have gone silent for 7+ days. Use a friendly check-in template.`;
  if (m.includes('pipeline') || m.includes('summary')) return `Your pipeline summary: Focus on Proposal Sent and Negotiation stage leads first — they are closest to closing. Leads in New/Contacted stages need qualification calls.`;
  if (m.includes('email') || m.includes('draft')) return `Here is a professional follow-up email template:\n\nSubject: Following up on our conversation\n\nDear {{name}},\n\nI hope you are doing well. I wanted to follow up regarding the proposal we shared. Please let me know if you have any questions.\n\nLooking forward to hearing from you.\n\nBest regards,\n{{your_name}}`;
  if (m.includes('whatsapp') || m.includes('reminder')) return `WhatsApp reminder template:\n\nNamaste {{name}} ji 🙏\n\nYour invoice {{invoice_no}} of {{amount}} is due on {{due_date}}.\n\nPlease make the payment at your earliest convenience.\n\nUPI: {{upi_id}}\n\nThank you! 🙏`;
  if (m.includes('win') || m.includes('conversion')) return `To improve win rate:\n1. Follow up within 24hrs of proposal\n2. Address objections early\n3. Offer a trial or demo\n4. Keep communication regular (WA+Email)\n5. Track close dates and follow up before expiry`;
  return `I am your LeadFlow AI assistant! I can help you with:\n• Pipeline analysis\n• Follow-up strategies\n• Email/WhatsApp drafts\n• Payment reminders\n• Sales coaching\n\nAsk me anything about your CRM or sales strategy!`;
}

module.exports = router;
