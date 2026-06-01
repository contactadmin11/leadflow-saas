const express    = require('express');
const Lead       = require('../models/Lead');
const Invoice    = require('../models/Invoice');
const Payment    = require('../models/Payment');
const Client     = require('../models/Client');
const { protect }= require('../middleware/auth');
const router     = express.Router();
router.use(protect);

router.get('/', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [leads, invoices, payments, clients] = await Promise.all([
      Lead.find({ userId: uid, deletedAt: null }).lean(),
      Invoice.find({ userId: uid, deletedAt: null }).lean(),
      Payment.find({ userId: uid, deletedAt: null }).lean(),
      Client.find({ userId: uid, deletedAt: null }).lean()
    ]);

    const totalLeads    = leads.length;
    const wonLeads      = leads.filter(l => l.stage === 'Won').length;
    const activeLeads   = leads.filter(l => !['Won','Lost'].includes(l.stage)).length;
    const convRate      = totalLeads ? Math.round(wonLeads / totalLeads * 100) : 0;
    const pipelineVal   = leads.filter(l => !['Won','Lost'].includes(l.stage)).reduce((s,l)=>s+(l.value||0),0);

    const totalRevenue  = payments.reduce((s,p)=>s+(p.amount||0),0);
    const monthRevenue  = payments.filter(p => new Date(p.date) >= startOfMonth).reduce((s,p)=>s+(p.amount||0),0);
    const outstanding   = invoices.filter(i=>!['Paid','Cancelled'].includes(i.status)).reduce((s,i)=>s+(i.total-(i.paidAmount||0)),0);
    const overdueAmt    = invoices.filter(i=>i.status==='Overdue').reduce((s,i)=>s+(i.total-(i.paidAmount||0)),0);

    // Source breakdown
    const sourceMap = {};
    leads.forEach(l => { const s = l.source || 'Other'; if (!sourceMap[s]) sourceMap[s] = { leads:0, won:0, value:0 }; sourceMap[s].leads++; if(l.stage==='Won'){sourceMap[s].won++;sourceMap[s].value+=(l.value||0);} });

    // Stage breakdown
    const stageMap = {};
    leads.forEach(l => { stageMap[l.stage]=(stageMap[l.stage]||0)+1; });

    // Monthly lead trend (last 6 months)
    const trend = Array(6).fill(0).map((_,i) => {
      const d = new Date(now); d.setMonth(d.getMonth()-5+i);
      const m = d.getMonth(), y = d.getFullYear();
      return { label: d.toLocaleDateString('en-IN',{month:'short'}), count: leads.filter(l=>{ const c=new Date(l.createdAt); return c.getMonth()===m&&c.getFullYear()===y; }).length };
    });

    res.json({
      leads:    { total: totalLeads, won: wonLeads, active: activeLeads, convRate, pipelineVal },
      billing:  { totalRevenue, monthRevenue, outstanding, overdueAmt, invoiceCount: invoices.length },
      clients:  { total: clients.length },
      sourceBreakdown: sourceMap,
      stageBreakdown:  stageMap,
      trend
    });
  } catch (err) { next(err); }
});

module.exports = router;
