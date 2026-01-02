import mongoose from 'mongoose';

const licenseSchema = new mongoose.Schema({
  licenseKey: { 
    type: String, 
    required: true, 
    unique: true,
    index: true 
  },
  licenseType: { 
    type: String, 
    enum: ['monthly', 'yearly', 'lifetime'], 
    required: true 
  },
  durationMonths: { 
    type: Number, 
    required: true,
    default: 1 
  },
  customerEmail: { 
    type: String, 
    required: true,
    index: true 
  },
  customerName: { 
    type: String 
  },
  stripeCustomerId: { 
    type: String,
    index: true 
  },
  stripeSubscriptionId: { 
    type: String,
    index: true 
  },
  stripePaymentIntentId: { 
    type: String 
  },
  stripeInvoiceId: { 
    type: String 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  activatedAt: { 
    type: Date 
  },
  expiresAt: { 
    type: Date, 
    required: true 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  deviceId: { 
    type: String 
  },
  deviceName: { 
    type: String 
  },
  lastValidated: { 
    type: Date 
  },
  validationCount: { 
    type: Number, 
    default: 0 
  },
  notes: { 
    type: String 
  },
  isTrial: { 
    type: Boolean, 
    default: false 
  },
  trialEndsAt: { 
    type: Date 
  }
}, {
  timestamps: true
});

// Index for faster queries
licenseSchema.index({ expiresAt: 1 });
licenseSchema.index({ isActive: 1 });
licenseSchema.index({ licenseKey: 1, isActive: 1 });
licenseSchema.index({ customerEmail: 1, isActive: 1 });

const License = mongoose.model('License', licenseSchema);
export default License;