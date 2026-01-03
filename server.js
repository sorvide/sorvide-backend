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
  <title>Your Sorvide Pro License Key</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px;
      background-color: #f5f7fa;
    }
    
    .container {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }
    
    .header { 
      background: linear-gradient(135deg, #4a4fd8, #2a2d7d); 
      color: white; 
      padding: 40px 30px; 
      text-align: center; 
    }
    
    .header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    
    .header p {
      font-size: 16px;
      opacity: 0.9;
    }
    
    .content { 
      padding: 40px 30px; 
    }
    
    .greeting {
      font-size: 18px;
      color: #2d3748;
      margin-bottom: 24px;
    }
    
    .intro {
      color: #4a5568;
      margin-bottom: 32px;
      line-height: 1.7;
    }
    
    .license-box { 
      background: linear-gradient(135deg, #f8f9ff, #eef2ff); 
      border: 2px solid #4a4fd8; 
      border-radius: 12px; 
      padding: 24px; 
      margin: 24px 0; 
      font-family: 'SF Mono', Monaco, 'Courier New', monospace; 
      font-size: 20px; 
      font-weight: 700; 
      text-align: center;
      letter-spacing: 0.5px;
      color: #2d3748;
      box-shadow: 0 2px 8px rgba(74, 79, 216, 0.1);
    }
    
    .receipt-section {
      background: #f8f9ff;
      border-radius: 12px;
      padding: 24px;
      margin: 24px 0;
      border: 1px solid #e2e8f0;
    }
    
    .receipt-title {
      font-size: 20px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 20px;
      text-align: center;
    }
    
    .receipt-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .receipt-row:last-child {
      border-bottom: none;
    }
    
    .receipt-label {
      color: #4a5568;
      font-weight: 500;
    }
    
    .receipt-value {
      color: #2d3748;
      font-weight: 600;
    }
    
    .important-note {
      background: #fff8f0;
      border-left: 4px solid #ed8936;
      padding: 16px;
      margin: 20px 0;
      border-radius: 8px;
    }
    
    .cancellation-info {
      background: #ebf8ff;
      border: 1px solid #90cdf4;
      border-radius: 12px;
      padding: 20px;
      margin: 24px 0;
    }
    
    .cancellation-title {
      color: #2c5282;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .no-refunds {
      background: #fed7d7;
      border: 1px solid #fc8181;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      font-size: 14px;
      color: #9b2c2c;
    }
    
    .steps-container {
      margin: 32px 0;
    }
    
    .steps-title {
      font-size: 20px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 20px;
    }
    
    .step { 
      display: flex; 
      align-items: flex-start; 
      margin-bottom: 20px; 
    }
    
    .step-number { 
      background: #4a4fd8; 
      color: white; 
      width: 32px; 
      height: 32px; 
      border-radius: 50%; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      margin-right: 16px; 
      flex-shrink: 0;
      font-weight: 700;
      font-size: 16px;
    }
    
    .step-content {
      padding-top: 4px;
      color: #4a5568;
      line-height: 1.6;
    }
    
    .support-section {
      background: #f0fff4;
      border: 1px solid #9ae6b4;
      border-radius: 12px;
      padding: 20px;
      margin: 32px 0;
    }
    
    .footer { 
      text-align: center; 
      margin-top: 40px; 
      color: #718096; 
      font-size: 13px;
      border-top: 1px solid #e2e8f0;
      padding-top: 24px;
    }
    
    .contact-info {
      margin-top: 16px;
      font-size: 13px;
    }
    
    .highlight {
      color: #4a4fd8;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to Sorvide Pro!</h1>
      <p>Your monthly subscription is now active</p>
    </div>
    
    <div class="content">
      <p class="greeting">Hi ${customerName || 'Valued Customer'},</p>
      
      <p class="intro">Thank you for subscribing to <strong>Sorvide Pro Monthly</strong>! Your license key is ready and your Pro features are now unlocked.</p>
      
      <div class="license-box">
        ${licenseKey}
      </div>
      
      <div class="receipt-section">
        <h3 class="receipt-title">📋 Purchase Receipt</h3>
        
        <div class="receipt-row">
          <span class="receipt-label">Plan</span>
          <span class="receipt-value">Sorvide Pro Monthly</span>
        </div>
        
        <div class="receipt-row">
          <span class="receipt-label">Price</span>
          <span class="receipt-value">$9.99/month</span>
        </div>
        
        <div class="receipt-row">
          <span class="receipt-label">Billing Cycle</span>
          <span class="receipt-value">Monthly</span>
        </div>
        
        <div class="receipt-row">
          <span class="receipt-label">License Duration</span>
          <span class="receipt-value">30 days (auto-renews)</span>
        </div>
        
        <div class="receipt-row">
          <span class="receipt-label">Next Billing Date</span>
          <span class="receipt-value">In 30 days</span>
        </div>
        
        <div class="important-note">
          <strong>Important:</strong> This is your license confirmation email. Please save this email for your records.
        </div>
      </div>
      
      <div class="cancellation-info">
        <h4 class="cancellation-title">
          <span>🔒 Subscription Management</span>
        </h4>
        <p><strong>To cancel your subscription:</strong></p>
        <p>Since Stripe doesn't allow self-service cancellation through payment links, please contact us directly to cancel your subscription.</p>
        <p><strong>📧 Email:</strong> <span class="highlight">license@sorvide.com</span></p>
        <p><strong>📝 Include in your email:</strong> Your email address and request to cancel</p>
        <p><strong>⏰ Processing time:</strong> Cancellation requests are processed within 24 hours</p>
        
        <div class="no-refunds">
          <strong>⚠️ No Refunds Policy:</strong> Unfortunately, we do not offer refunds at this time. Our AI models are resource-intensive and costly to run. However, you can cancel your subscription at any time to avoid future charges after the current billing period.
        </div>
      </div>
      
      <div class="steps-container">
        <h3 class="steps-title">🔑 How to Activate Pro Features:</h3>
        
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-content">
            <strong>Open the Sorvide Chrome extension</strong><br>
            Click the Sorvide icon in your browser toolbar
          </div>
        </div>
        
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-content">
            <strong>Click "Activate Pro"</strong><br>
            Find this button in the bottom status bar of the extension
          </div>
        </div>
        
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-content">
            <strong>Enter your license key</strong><br>
            Copy and paste the license key shown above
          </div>
        </div>
        
        <div class="step">
          <div class="step-number">4</div>
          <div class="step-content">
            <strong>Click "Activate License"</strong><br>
            You'll immediately gain access to all Pro features!
          </div>
        </div>
      </div>
      
      <p style="margin-top: 24px; color: #4a5568;">
        <strong>🚀 Pro Features You Now Have Access To:</strong><br>
        • <strong>Unlimited AI summaries</strong> (vs. 5 daily free limit)<br>
        • <strong>Advanced plagiarism detection</strong> with detailed reports<br>
        • <strong>AI-powered research insights</strong> and analysis<br>
        • <strong>Export to PDF/Markdown</strong> with formatting preserved<br>
        • <strong>Priority email support</strong> with faster response times<br>
        • <strong>Advanced research library</strong> with tagging and organization<br>
        • <strong>Custom citation styles</strong> beyond APA/MLA<br>
        • <strong>And much more!</strong>
      </p>
      
      <div class="support-section">
        <h4 style="color: #22543d; margin-bottom: 16px;">💬 Need Help or Have Questions?</h4>
        <p>If you encounter any issues activating your license or have questions about your subscription:</p>
        <p><strong>📧 General Support:</strong> <span class="highlight">support@sorvide.com</span></p>
        <p><strong>📧 Subscription/Cancellation:</strong> <span class="highlight">license@sorvide.com</span></p>
        <p><strong>⏰ Response Time:</strong> We typically respond within 24 hours</p>
        <p><em>Please do not reply to this automated email. Use the support emails above for assistance.</em></p>
      </div>
      
      <p style="margin-top: 32px; color: #4a5568; text-align: center;">
        Thank you for supporting Sorvide!<br>
        <strong>The Sorvide Team</strong>
      </p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Sorvide</p>
      <p>This email was sent to ${customerEmail}</p>
      <div class="contact-info">
        <p>Sorvide • support@sorvide.com</p>
        <p>This is an automated message, please do not reply directly.</p>
        <p>By using Sorvide Pro, you agree to our Terms of Service and Privacy Policy.</p>
      </div>
    </div>
  </div>
</body>
</html>
      `;
      
      const text = `
==========================================
            SORVIDE PRO - RECEIPT
==========================================

Hi ${customerName || 'Valued Customer'},

Thank you for subscribing to Sorvide Pro Monthly! Your license key is ready to use.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          YOUR LICENSE KEY:
          ${licenseKey}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PURCHASE RECEIPT:
• Plan: Sorvide Pro Monthly
• Price: $9.99/month
• Billing Cycle: Monthly
• License Duration: 30 days (auto-renews)
• Next Billing Date: In 30 days

Important: This is your license confirmation email. Please save this email for your records.

🔒 SUBSCRIPTION MANAGEMENT:
To cancel your subscription:
Since Stripe doesn't allow self-service cancellation through payment links, please contact us directly to cancel your subscription.

📧 Email: license@sorvide.com
📝 Include in your email: Your email address and request to cancel
⏰ Processing time: Cancellation requests are processed within 24 hours

⚠️ NO REFUNDS POLICY:
Unfortunately, we do not offer refunds at this time. Our AI models are resource-intensive and costly to run. However, you can cancel your subscription at any time to avoid future charges after the current billing period.

🔑 HOW TO ACTIVATE PRO FEATURES:
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" in the bottom status bar
3. Enter your license key: ${licenseKey}
4. Click "Activate License"

🚀 PRO FEATURES YOU NOW HAVE ACCESS TO:
• Unlimited AI summaries (vs. 5 daily free limit)
• Advanced plagiarism detection with detailed reports
• AI-powered research insights and analysis
• Export to PDF/Markdown with formatting preserved
• Priority email support with faster response times
• Advanced research library with tagging and organization
• Custom citation styles beyond APA/MLA
• And much more!

💬 NEED HELP OR HAVE QUESTIONS?
If you encounter any issues activating your license or have questions:
📧 General Support: support@sorvide.com
📧 Subscription/Cancellation: license@sorvide.com
⏰ Response Time: Within 24 hours

Please do not reply to this automated email.

==========================================
Thank you for supporting Sorvide!
The Sorvide Team

© ${new Date().getFullYear()} Sorvide
This email was sent to ${customerEmail}
By using Sorvide Pro, you agree to our Terms of Service and Privacy Policy.
==========================================
      `;
      
      await mg.messages.create(domain, {
        from: `Sorvide Pro <${fromEmail}>`,
        to: [customerEmail],
        subject: 'Your Sorvide Pro License Key & Purchase Receipt',
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