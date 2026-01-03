import express from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const app = express();

// ==== CRITICAL: Define webhook endpoint FIRST ====
// ================================================

// Stripe webhook endpoint - MUST be defined BEFORE JSON parsers
app.post('/api/webhook', 
  // Use raw middleware for webhook endpoint
  express.raw({type: 'application/json'}),
  async (req, res) => {
    console.log('🔍 DEBUG - Webhook received, body type:', typeof req.body);
    console.log('🔍 DEBUG - Is Buffer?', Buffer.isBuffer(req.body));
    
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,  // This must be raw buffer
        sig, 
        process.env.STRIPE_WEBHOOK_SECRET
      );
      console.log(`✅ Webhook received: ${event.type}`);
    } catch (err) {
      console.error(`❌ Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        await handleSuccessfulPayment(session);
        break;
      case 'invoice.paid':
        const invoice = event.data.object;
        await handleInvoicePayment(invoice);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
      default:
        console.log(`ℹ️ Unhandled event type ${event.type}`);
    }

    res.json({received: true});
  }
);

// ==== NOW add regular middleware for all other routes ====
// =========================================================

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// JSON body parser for all other routes (AFTER webhook)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Mailgun
const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
}).then(() => {
  console.log('✅ Connected to MongoDB Atlas');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err.message);
});

// License Schema
const licenseSchema = new mongoose.Schema({
  licenseKey: { type: String, required: true, unique: true },
  customerEmail: { type: String, required: true },
  customerName: { type: String },
  stripeCustomerId: { type: String },
  stripeSubscriptionId: { type: String },
  stripeSessionId: { type: String },
  plan: { type: String, default: 'monthly' },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  deviceId: { type: String },
  deviceName: { type: String },
  lastValidated: { type: Date },
  validationCount: { type: Number, default: 0 }
});

const License = mongoose.model('License', licenseSchema);

// Store device mappings temporarily (in production, store in MongoDB)
const deviceMappings = new Map();

// Generate a license key
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const generatePart = () => {
    let part = '';
    for (let i = 0; i < 4; i++) {
      part += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return part;
  };
  
  // Create base key
  let key = 'SORV-' + generatePart() + '-' + generatePart() + '-' + generatePart() + '-' + generatePart();
  
  // Add type prefix
  const fullKey = 'MONTH-' + key;
  
  return fullKey;
}

async function handleSuccessfulPayment(session) {
  try {
    console.log('✅ Processing successful payment:', session.id);
    
    const customerEmail = session.customer_details.email;
    const customerName = session.customer_details.name || customerEmail.split('@')[0];
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    
    // Generate license key
    const licenseKey = generateLicenseKey();
    
    // Calculate expiration date (30 days from now for monthly)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Save to MongoDB
    const license = new License({
      licenseKey: licenseKey,
      customerEmail: customerEmail,
      customerName: customerName,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeSessionId: session.id,
      plan: 'monthly',
      expiresAt: expiresAt,
      isActive: true
    });
    
    await license.save();
    console.log(`✅ License saved to database: ${licenseKey}`);
    
    // Send license email via Mailgun
    await sendLicenseEmail(customerEmail, customerName, licenseKey);
    
    console.log(`✅ License key sent to ${customerEmail}: ${licenseKey}`);
    
  } catch (error) {
    console.error('❌ Error handling successful payment:', error);
  }
}

async function sendLicenseEmail(customerEmail, customerName, licenseKey) {
  try {
    const domain = process.env.MAILGUN_DOMAIN || 'email.sorvide.com';
    const fromEmail = process.env.FROM_EMAIL || `noreply@${domain}`;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Sorvide Pro</title>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      background: #f5f7fa;
      padding: 0;
      min-height: 100vh;
    }
    
    .email-container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      background: white;
    }
    
    /* HEADER */
    .header { 
      background: linear-gradient(135deg, #4a4fd8, #2a2d7d);
      color: white; 
      padding: 60px 40px;
      text-align: center;
      width: 100%;
    }
    
    .header h1 {
      font-size: 38px;
      font-weight: 700;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    
    .header p {
      font-size: 20px;
      opacity: 0.95;
      font-weight: 300;
    }
    
    /* MAIN CONTENT - ONE SINGLE BOX */
    .main-content { 
      padding: 60px 50px;
      background: white;
      width: 100%;
    }
    
    /* GREETING */
    .greeting-section {
      margin-bottom: 40px;
      padding-bottom: 40px;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .greeting {
      font-size: 22px;
      color: #2d3748;
      margin-bottom: 20px;
      font-weight: 500;
    }
    
    .intro {
      color: #4a5568;
      font-size: 17px;
      line-height: 1.7;
      max-width: 700px;
    }
    
    /* LICENSE KEY */
    .license-section {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 40px;
      margin: 40px 0;
      text-align: center;
      width: 100%;
    }
    
    .license-label {
      font-size: 15px;
      color: #718096;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 20px;
      font-weight: 600;
    }
    
    .license-key {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      font-size: 26px;
      font-weight: 700;
      color: #2d3748;
      letter-spacing: 0.5px;
      background: white;
      padding: 24px;
      border-radius: 8px;
      border: 2px solid #e2e8f0;
      margin: 0 auto;
      display: block;
      width: 100%;
      max-width: 600px;
      text-align: center;
    }
    
    /* SECTION TITLE */
    .section-title {
      font-size: 24px;
      color: #2d3748;
      margin: 50px 0 30px 0;
      font-weight: 600;
      padding-bottom: 15px;
      border-bottom: 2px solid #e2e8f0;
      width: 100%;
    }
    
    /* ACTIVATION STEPS - FIXED CENTERED NUMBERS */
    .steps-container {
      width: 100%;
      margin-bottom: 50px;
    }
    
    .step {
      display: flex;
      align-items: flex-start;
      margin-bottom: 30px;
      padding: 25px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      width: 100%;
    }
    
    .step-number-container {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 25px;
      flex-shrink: 0;
      width: 50px;
      height: 50px;
      position: relative;
    }
    
    .step-number {
      width: 100%;
      height: 100%;
      background: #4a4fd8;
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 700;
      box-shadow: 0 4px 8px rgba(74, 79, 216, 0.2);
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 0;
      margin: 0;
    }
    
    .step-content {
      flex: 1;
      padding-top: 4px; /* Adjust this to vertically align with number */
    }
    
    .step-title {
      font-size: 18px;
      color: #2d3748;
      margin-bottom: 8px;
      font-weight: 600;
    }
    
    .step-description {
      color: #718096;
      font-size: 16px;
      line-height: 1.6;
      max-width: 600px;
    }
    
    /* PURCHASE DETAILS */
    .purchase-details {
      margin: 50px 0;
      width: 100%;
    }
    
    .details-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 25px;
      width: 100%;
    }
    
    .detail-item {
      padding: 25px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      width: 100%;
    }
    
    .detail-label {
      color: #718096;
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    
    .detail-value {
      color: #2d3748;
      font-size: 18px;
      font-weight: 600;
    }
    
    /* SUBSCRIPTION MANAGEMENT */
    .subscription-section {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      padding: 40px;
      margin: 50px 0;
      width: 100%;
    }
    
    .subscription-title {
      font-size: 22px;
      color: #2d3748;
      margin-bottom: 20px;
      font-weight: 600;
    }
    
    .subscription-content {
      color: #4a5568;
      font-size: 16px;
      line-height: 1.7;
      margin-bottom: 25px;
      max-width: 700px;
    }
    
    .email-instructions {
      background: white;
      padding: 25px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      margin-top: 25px;
    }
    
    .email-instructions-title {
      color: #2d3748;
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 15px;
    }
    
    .email-instructions-list {
      color: #4a5568;
      font-size: 15px;
      line-height: 1.6;
      margin-left: 20px;
    }
    
    .email-instructions-list li {
      margin-bottom: 10px;
    }
    
    .email-address {
      color: #4a4fd8;
      font-weight: 600;
      font-size: 17px;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
    }
    
    /* FOOTER */
    .footer { 
      text-align: center; 
      padding: 40px 0 30px;
      color: #718096; 
      font-size: 15px;
      border-top: 1px solid #e2e8f0;
      margin-top: 60px;
      width: 100%;
    }
    
    .footer-links {
      margin-top: 20px;
      font-size: 14px;
    }
    
    .footer-links a {
      color: #4a4fd8;
      text-decoration: none;
      margin: 0 10px;
    }
    
    @media (max-width: 768px) {
      .main-content { padding: 40px 25px; }
      .header { padding: 40px 25px; }
      .header h1 { font-size: 30px; }
      .header p { font-size: 18px; }
      .license-key { 
        font-size: 22px; 
        padding: 20px;
      }
      .details-grid { grid-template-columns: 1fr; }
      .step { 
        padding: 20px;
        margin-bottom: 20px;
      }
      .step-number-container {
        width: 44px;
        height: 44px;
      }
      .step-number {
        font-size: 20px;
      }
      .step-number-container {
        margin-right: 20px;
      }
      .section-title {
        font-size: 22px;
        margin: 40px 0 25px 0;
      }
    }
    
    @media (max-width: 480px) {
      .main-content { padding: 30px 20px; }
      .header { padding: 30px 20px; }
      .header h1 { font-size: 26px; }
      .header p { font-size: 16px; }
      .license-key { 
        font-size: 20px; 
        padding: 18px;
      }
      .step { 
        flex-direction: column;
        align-items: flex-start;
      }
      .step-number-container { 
        margin-bottom: 15px;
        margin-right: 0;
        width: 40px;
        height: 40px;
      }
      .step-number {
        font-size: 18px;
      }
      .step-content {
        padding-top: 0;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- HEADER -->
    <div class="header">
      <h1>Welcome to Sorvide Pro</h1>
      <p>Your monthly subscription is now active</p>
    </div>
    
    <!-- MAIN CONTENT - ONE SINGLE CONTAINER -->
    <div class="main-content">
      <!-- GREETING -->
      <div class="greeting-section">
        <p class="greeting">Hi ${customerName || 'there'},</p>
        <p class="intro">
          Thank you for subscribing to Sorvide Pro. Your license key is ready and all Pro features are ready to be unlocked. 
        </p>
      </div>
      
      <!-- LICENSE KEY -->
      <div class="license-section">
        <div class="license-label">Your License Key</div>
        <div class="license-key">${licenseKey}</div>
      </div>
      
      <!-- ACTIVATION STEPS -->
      <h2 class="section-title">How to Activate Pro Features</h2>
      <div class="steps-container">
        <div class="step">
          <div class="step-number-container">
            <div class="step-number">1</div>
          </div>
          <div class="step-content">
            <div class="step-title">Open the Sorvide Chrome Extension</div>
            <div class="step-description">Click the Sorvide icon in your browser toolbar to open the extension</div>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number-container">
            <div class="step-number">2</div>
          </div>
          <div class="step-content">
            <div class="step-title">Click "Activate Pro"</div>
            <div class="step-description">Find and click the "Activate Pro" button in the bottom status bar of the extension</div>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number-container">
            <div class="step-number">3</div>
          </div>
          <div class="step-content">
            <div class="step-title">Enter Your License Key</div>
            <div class="step-description">Copy and paste the license key from above into the activation dialog</div>
          </div>
        </div>
        
        <div class="step">
          <div class="step-number-container">
            <div class="step-number">4</div>
          </div>
          <div class="step-content">
            <div class="step-title">Click "Activate License"</div>
            <div class="step-description">Your Pro features will be activated immediately after clicking this button</div>
          </div>
        </div>
      </div>
      
      <!-- PURCHASE DETAILS -->
      <h2 class="section-title">Purchase Details</h2>
      <div class="purchase-details">
        <div class="details-grid">
          <div class="detail-item">
            <div class="detail-label">Subscription Plan</div>
            <div class="detail-value">Sorvide Pro Monthly</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">Monthly Price</div>
            <div class="detail-value">$9.99 / month</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">Billing Cycle</div>
            <div class="detail-value">Monthly Recurring</div>
          </div>
          
          <div class="detail-item">
            <div class="detail-label">License Duration</div>
            <div class="detail-value">30 Days (Auto-Renews)</div>
          </div>
        </div>
        <p style="color: #718096; font-size: 15px; margin-top: 30px; text-align: center; width: 100%;">
          This email serves as your purchase confirmation and license activation receipt. Please save it for your records.
        </p>
      </div>
      
      <!-- SUBSCRIPTION MANAGEMENT -->
      <h2 class="section-title">Subscription Management</h2>
      <div class="subscription-section">
        <div class="subscription-title">Subscription Cancellations</div>
        <div class="subscription-content">
          <p>If you wish to cancel your Sorvide Pro subscription, please send an email to our subscription management team at license@sorvide.com. Cancellation requests are typically processed within 24 hours of receipt. You will receive a confirmation email once your cancellation has been processed.</p>
        </div>
      </div>
    </div>
    
    <!-- FOOTER -->
    <div class="footer">
      <div>© ${new Date().getFullYear()} Sorvide</div>
      <div class="footer-links">
        <a href="https://sorvide.com">Website</a> | 
        <a href="mailto:support@sorvide.com">Support</a> | 
        <a href="mailto:license@sorvide.com">Subscriptions</a>
      </div>
    </div>
  </div>
</body>
</html>
    `;
    
    const text = `
========================================================================
                         WELCOME TO SORVIDE PRO
========================================================================

Hi ${customerName || 'there'},

Thank you for subscribing to Sorvide Pro. Your license key is ready and all 
Pro features are ready to be unlocked.

========================================================================
                         YOUR LICENSE KEY
                         ${licenseKey}
========================================================================

HOW TO ACTIVATE PRO FEATURES
----------------------------
1. Open the Sorvide Chrome Extension
   Click the Sorvide icon in your browser toolbar to open the extension

2. Click "Activate Pro"
   Find and click the "Activate Pro" button in the bottom status bar of the extension

3. Enter Your License Key
   Copy and paste the license key from above into the activation dialog

4. Click "Activate License"
   Your Pro features will be activated immediately after clicking this button

PURCHASE DETAILS
----------------
• Subscription Plan: Sorvide Pro Monthly
• Monthly Price: $9.99 / month
• Billing Cycle: Monthly Recurring
• License Duration: 30 Days (Auto-Renews)

This email serves as your purchase confirmation and license activation receipt. 
Please save it for your records.

SUBSCRIPTION MANAGEMENT
-----------------------

Subscription Cancellations

If you wish to cancel your Sorvide Pro subscription, please send an email to our subscription management team at license@sorvide.com. Cancellation requests are typically processed within 24 hours of receipt. You will receive a confirmation email once your cancellation has been processed.

========================================================================
© ${new Date().getFullYear()} Sorvide
Website: https://sorvide.com
Support: support@sorvide.com
Subscriptions: license@sorvide.com
========================================================================
    `;
    
    await mg.messages.create(domain, {
      from: `Sorvide Pro <${fromEmail}>`,
      to: [customerEmail],
      subject: 'Your License Key & Activation Instructions',
      text: text,
      html: html
    });
    
    console.log(`✅ License email sent to ${customerEmail}`);
    
  } catch (error) {
    console.error('❌ Error sending license email:', error);
  }
}

async function handleInvoicePayment(invoice) {
  try {
    console.log('✅ Invoice payment succeeded:', invoice.id);
    
    // Find license by customer ID and extend expiration
    const license = await License.findOne({ 
      stripeCustomerId: invoice.customer,
      isActive: true 
    });
    
    if (license) {
      // Extend license by 30 days
      license.expiresAt = new Date();
      license.expiresAt.setDate(license.expiresAt.getDate() + 30);
      await license.save();
      console.log(`✅ Extended license for customer ${invoice.customer}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling invoice payment:', error);
  }
}

async function handleSubscriptionUpdate(subscription) {
  try {
    console.log('Subscription update:', subscription.status, subscription.id);
    
    // Find license by subscription ID
    const license = await License.findOne({ 
      stripeSubscriptionId: subscription.id 
    });
    
    if (license) {
      if (subscription.status === 'active') {
        license.isActive = true;
        // Update expiration date based on current period end
        license.expiresAt = new Date(subscription.current_period_end * 1000);
        console.log(`✅ Reactivated license ${license.licenseKey}`);
      } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
        license.isActive = false;
        console.log(`❌ Deactivated license ${license.licenseKey} due to ${subscription.status} status`);
      }
      
      await license.save();
    }
    
  } catch (error) {
    console.error('❌ Error handling subscription update:', error);
  }
}

// ==== ALL OTHER ROUTES GO HERE (after JSON parsers) ====
// ======================================================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Sorvide Backend',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Validate license key
app.post('/api/validate-license', async (req, res) => {
  try {
    const { licenseKey, deviceId, deviceName } = req.body;
    
    console.log('🔑 Validating license:', { licenseKey, deviceId, deviceName });
    
    if (!licenseKey || !deviceId) {
      return res.status(400).json({ 
        valid: false, 
        error: 'License key and device ID are required' 
      });
    }
    
    // Find license in database
    const license = await License.findOne({ licenseKey: licenseKey });
    
    if (!license) {
      return res.json({ 
        valid: false, 
        error: 'Invalid license key' 
      });
    }
    
    if (!license.isActive) {
      return res.json({ 
        valid: false, 
        error: 'License is inactive' 
      });
    }
    
    // Check if license has expired
    if (new Date() > new Date(license.expiresAt)) {
      license.isActive = false;
      await license.save();
      return res.json({ 
        valid: false, 
        error: 'License has expired',
        expired: true
      });
    }
    
    // Check if this device already has a different license
    const existingLicenseKey = deviceMappings.get(deviceId);
    if (existingLicenseKey && existingLicenseKey !== licenseKey) {
      // Device already has a different license, deactivate the old one
      const oldLicense = await License.findOne({ licenseKey: existingLicenseKey });
      if (oldLicense && oldLicense.deviceId === deviceId) {
        oldLicense.deviceId = null;
        oldLicense.deviceName = null;
        await oldLicense.save();
      }
    }
    
    // Check device limit (1 device per license)
    if (license.deviceId && license.deviceId !== deviceId) {
      return res.json({ 
        valid: false, 
        error: 'License already activated on another device',
        alreadyActivated: true
      });
    }
    
    // Update license with device info
    license.deviceId = deviceId;
    license.deviceName = deviceName || 'Chrome Extension';
    license.lastValidated = new Date();
    license.validationCount = (license.validationCount || 0) + 1;
    
    await license.save();
    
    // Update device mapping
    deviceMappings.set(deviceId, licenseKey);
    
    // Calculate days left
    const now = new Date();
    const expiresAt = new Date(license.expiresAt);
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    return res.json({
      valid: true,
      license: {
        key: license.licenseKey,
        plan: license.plan,
        expiresAt: license.expiresAt.toISOString(),
        daysLeft: daysLeft,
        customerEmail: license.customerEmail,
        customerName: license.customerName
      }
    });
    
  } catch (error) {
    console.error('❌ License validation error:', error);
    return res.status(500).json({ 
      valid: false, 
      error: 'Internal server error' 
    });
  }
});

// Get device-specific license info
app.post('/api/device-license', async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ 
        hasLicense: false,
        error: 'Device ID is required' 
      });
    }
    
    // Find license by device ID
    const license = await License.findOne({ 
      deviceId: deviceId,
      isActive: true 
    });
    
    if (!license) {
      return res.json({ hasLicense: false });
    }
    
    // Check if license has expired
    if (new Date() > new Date(license.expiresAt)) {
      license.isActive = false;
      await license.save();
      deviceMappings.delete(deviceId);
      return res.json({ hasLicense: false });
    }
    
    // Calculate days left
    const now = new Date();
    const expiresAt = new Date(license.expiresAt);
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    return res.json({
      hasLicense: true,
      license: {
        key: license.licenseKey,
        plan: license.plan,
        expiresAt: license.expiresAt.toISOString(),
        daysLeft: daysLeft,
        customerEmail: license.customerEmail,
        customerName: license.customerName
      }
    });
    
  } catch (error) {
    console.error('❌ Device license check error:', error);
    return res.status(500).json({ 
      hasLicense: false,
      error: 'Internal server error' 
    });
  }
});

// Create Stripe checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { email, successUrl, cancelUrl } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_MONTHLY_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.FRONTEND_URL || 'https://sorvide.com'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'https://sorvide.com'}/cancel`,
      customer_email: email,
      metadata: {
        product: 'sorvide_pro_monthly',
        source: 'chrome_extension'
      },
      subscription_data: {
        metadata: {
          customer_email: email,
          product: 'sorvide_pro'
        }
      }
    });

    res.json({ 
      success: true,
      sessionId: session.id, 
      url: session.url 
    });
    
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create checkout session' 
    });
  }
});

// Manual license creation (admin only)
app.post('/api/admin/create-license', async (req, res) => {
  try {
    const { email, name } = req.body;
    const adminToken = req.headers['x-admin-token'];
    
    // Simple admin check
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Generate license key
    const licenseKey = generateLicenseKey();
    
    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    
    // Save to database
    const license = new License({
      licenseKey: licenseKey,
      customerEmail: email,
      customerName: name || email.split('@')[0],
      plan: 'monthly',
      expiresAt: expiresAt,
      isActive: true,
      isManual: true
    });
    
    await license.save();
    
    // Send email
    await sendLicenseEmail(email, name || email.split('@')[0], licenseKey);
    
    res.json({
      success: true,
      license: {
        key: licenseKey,
        email: email,
        expiresAt: expiresAt.toISOString()
      },
      message: 'License created and email sent'
    });
    
  } catch (error) {
    console.error('❌ Admin license creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get license info (admin only)
app.get('/api/admin/license/:key', async (req, res) => {
  try {
    const adminToken = req.headers['x-admin-token'];
    
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const license = await License.findOne({ licenseKey: req.params.key });
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    // Calculate days left
    const now = new Date();
    const expiresAt = new Date(license.expiresAt);
    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    
    res.json({
      license: {
        key: license.licenseKey,
        customerEmail: license.customerEmail,
        customerName: license.customerName,
        plan: license.plan,
        isActive: license.isActive,
        createdAt: license.createdAt,
        expiresAt: license.expiresAt,
        daysLeft: daysLeft,
        deviceId: license.deviceId,
        deviceName: license.deviceName,
        lastValidated: license.lastValidated,
        validationCount: license.validationCount,
        stripeCustomerId: license.stripeCustomerId,
        stripeSubscriptionId: license.stripeSubscriptionId
      }
    });
    
  } catch (error) {
    console.error('❌ Admin license lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📧 Mailgun domain: ${process.env.MAILGUN_DOMAIN}`);
  console.log(`💳 Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'Test' : 'Live'}`);
  console.log(`🌐 CORS origins: ${process.env.CORS_ORIGINS}`);
});