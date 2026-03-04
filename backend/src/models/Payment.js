'use strict';

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    userEmail: {
      type: String,
      required: true,
      lowercase: true,
    },
    // Stripe or other processor identifiers
    stripePaymentIntentId: { type: String, default: null },
    stripeInvoiceId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },

    // Payment details
    amount: {
      type: Number, // in smallest currency unit (e.g. cents)
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'usd',
      lowercase: true,
    },
    plan: {
      type: String,
      enum: ['premium', 'family'],
      required: true,
    },
    billingInterval: {
      type: String,
      enum: ['monthly', 'annual', 'lifetime'],
      default: 'monthly',
    },

    // Status lifecycle: pending → succeeded | failed | refunded | disputed
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded', 'disputed', 'canceled'],
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status: { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        reason: { type: String, default: null },
        _id: false,
      },
    ],

    // Subscription period covered by this payment
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    // Refund info
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, default: null },

    // Raw processor event for audit
    rawEvent: { type: mongoose.Schema.Types.Mixed, default: null, select: false },

    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────────────────────────
paymentSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });
paymentSchema.index({ stripeInvoiceId: 1 }, { sparse: true });
paymentSchema.index({ userEmail: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });

// ── Instance method: transition status with history ────────────────────────────
paymentSchema.methods.setStatus = function (newStatus, reason = null) {
  if (this.status === newStatus) return;
  this.statusHistory.push({ status: newStatus, changedAt: new Date(), reason });
  this.status = newStatus;
  if (newStatus === 'refunded') {
    this.refundedAt = new Date();
    this.refundReason = reason;
  }
};

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
