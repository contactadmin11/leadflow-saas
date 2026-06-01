const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  plan:          { type: String, enum: ['trial','monthly','quarterly','yearly','lifetime','suspended'], default: 'trial' },
  status:        { type: String, enum: ['active','expired','cancelled','suspended'], default: 'active' },
  // Device locking
  maxDevices:    { type: Number, default: 1 },  // Admin sets this: 1=single device, 0=unlimited
  trialStartAt:  { type: Date, default: Date.now },
  trialEndsAt:   { type: Date },       // set on register
  currentPeriodStart: { type: Date },
  currentPeriodEnd:   { type: Date },
  // Razorpay
  rzpSubscriptionId:  { type: String },
  rzpCustomerId:      { type: String },
  rzpPaymentId:       { type: String },
  rzpOrderId:         { type: String },
  // Billing history
  payments: [{
    amount:    Number,
    currency:  { type: String, default: 'INR' },
    plan:      String,
    paidAt:    Date,
    rzpPaymentId: String,
    rzpOrderId:   String,
    months:    Number  // 1, 3, 12
  }],
  cancelledAt: { type: Date },
  notes:       { type: String }
}, { timestamps: true });

subscriptionSchema.index({ userId: 1 });
subscriptionSchema.index({ status: 1 });

// Virtual: is subscription currently active?
subscriptionSchema.virtual('isActive').get(function () {
  if (this.status !== 'active') return false;
  const now = new Date();
  if (this.plan === 'trial') return now <= this.trialEndsAt;
  if (this.plan === 'lifetime') return true;
  return now <= this.currentPeriodEnd;
});

// Virtual: days remaining
subscriptionSchema.virtual('daysRemaining').get(function () {
  const end = this.plan === 'trial' ? this.trialEndsAt : this.currentPeriodEnd;
  if (!end) return 0;
  const diff = Math.ceil((new Date(end) - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
