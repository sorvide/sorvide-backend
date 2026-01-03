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
  <title>Welcome to Sorvide Pro!</title>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
      line-height: 1.6; 
      color: #1a202c; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .email-wrapper {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }
    
    /* HEADER - Full width design */
    .header { 
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white; 
      padding: 60px 40px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    
    .header::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px);
      background-size: 50px 50px;
      opacity: 0.1;
    }
    
    .header h1 {
      font-size: 42px;
      font-weight: 800;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
      position: relative;
    }
    
    .header p {
      font-size: 20px;
      opacity: 0.95;
      font-weight: 300;
      position: relative;
    }
    
    .welcome-icon {
      font-size: 64px;
      margin-bottom: 24px;
      display: block;
      position: relative;
    }
    
    /* CONTENT */
    .content { 
      padding: 50px 40px; 
    }
    
    .greeting {
      font-size: 22px;
      color: #2d3748;
      margin-bottom: 32px;
      font-weight: 600;
    }
    
    .intro {
      color: #4a5568;
      font-size: 17px;
      margin-bottom: 40px;
      line-height: 1.7;
    }
    
    /* LICENSE KEY - Prominent design */
    .license-section {
      text-align: center;
      margin-bottom: 48px;
    }
    
    .license-label {
      font-size: 14px;
      color: #718096;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      font-weight: 600;
    }
    
    .license-box { 
      background: linear-gradient(135deg, #f7fafc, #edf2f7);
      border: 3px solid #e2e8f0;
      border-radius: 16px; 
      padding: 28px 20px;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace; 
      font-size: 24px; 
      font-weight: 700; 
      letter-spacing: 1px;
      color: #2d3748;
      box-shadow: 0 8px 32px rgba(102, 126, 234, 0.1);
      transition: all 0.3s ease;
    }
    
    .license-box:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 40px rgba(102, 126, 234, 0.15);
      border-color: #4f46e5;
    }
    
    /* RECEIPT - Clean card design */
    .receipt-card {
      background: white;
      border-radius: 20px;
      padding: 32px;
      margin: 40px 0;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
    }
    
    .receipt-title {
      font-size: 24px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 32px;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    
    .receipt-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-bottom: 32px;
    }
    
    .receipt-item {
      padding: 20px;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }
    
    .receipt-label {
      color: #718096;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .receipt-value {
      color: #2d3748;
      font-size: 18px;
      font-weight: 700;
    }
    
    .receipt-note {
      background: linear-gradient(135deg, #fff7ed, #fed7aa);
      border-left: 4px solid #ed8936;
      padding: 20px;
      border-radius: 12px;
      margin-top: 24px;
      font-size: 15px;
      color: #9c4221;
    }
    
    /* STEPS - Perfectly centered numbers */
    .steps-section {
      background: #f8fafc;
      border-radius: 20px;
      padding: 40px;
      margin: 40px 0;
    }
    
    .steps-title {
      font-size: 24px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 32px;
      text-align: center;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    
    .steps-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 32px;
    }
    
    .step-card {
      background: white;
      border-radius: 16px;
      padding: 28px;
      text-align: center;
      border: 1px solid #e2e8f0;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .step-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
    }
    
    .step-number {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: 700;
      margin: 0 auto 20px;
      position: relative;
      z-index: 2;
    }
    
    .step-content h4 {
      font-size: 18px;
      color: #2d3748;
      margin-bottom: 12px;
      font-weight: 700;
    }
    
    .step-content p {
      color: #718096;
      font-size: 15px;
      line-height: 1.6;
    }
    
    /* FEATURES - Beautiful grid */
    .features-section {
      margin: 48px 0;
    }
    
    .features-title {
      font-size: 24px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 32px;
      text-align: center;
    }
    
    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 24px;
    }
    
    .feature-card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      border: 1px solid #e2e8f0;
      transition: all 0.3s ease;
    }
    
    .feature-card:hover {
      border-color: #4f46e5;
      transform: translateY(-2px);
    }
    
    .feature-icon {
      font-size: 32px;
      margin-bottom: 16px;
      color: #4f46e5;
    }
    
    .feature-card h4 {
      font-size: 16px;
      color: #2d3748;
      margin-bottom: 8px;
      font-weight: 700;
    }
    
    .feature-card p {
      color: #718096;
      font-size: 14px;
      line-height: 1.5;
    }
    
    /* SUPPORT SECTION */
    .support-section {
      background: linear-gradient(135deg, #dcfce7, #bbf7d0);
      border-radius: 20px;
      padding: 40px;
      margin: 48px 0;
      text-align: center;
      border: 1px solid #86efac;
    }
    
    .support-title {
      font-size: 24px;
      color: #166534;
      margin-bottom: 24px;
      font-weight: 700;
    }
    
    .support-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 24px;
      margin: 32px 0;
    }
    
    .support-item {
      background: white;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid #86efac;
    }
    
    .support-label {
      color: #166534;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .support-value {
      color: #1a202c;
      font-size: 18px;
      font-weight: 700;
    }
    
    .support-note {
      color: #166534;
      font-size: 14px;
      font-style: italic;
      margin-top: 20px;
    }
    
    /* CANCELLATION INFO */
    .cancellation-card {
      background: linear-gradient(135deg, #fef3c7, #fde68a);
      border-radius: 20px;
      padding: 32px;
      margin: 40px 0;
      border: 1px solid #fbbf24;
    }
    
    .cancellation-title {
      color: #92400e;
      font-size: 22px;
      margin-bottom: 24px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    
    .policy-box {
      background: #fef3c7;
      border: 2px solid #f59e0b;
      border-radius: 12px;
      padding: 24px;
      margin-top: 24px;
    }
    
    .policy-title {
      color: #92400e;
      font-size: 16px;
      margin-bottom: 12px;
      font-weight: 700;
    }
    
    .policy-text {
      color: #78350f;
      font-size: 15px;
      line-height: 1.6;
    }
    
    /* SIGNATURE */
    .signature {
      text-align: center;
      margin: 48px 0 32px;
      padding-top: 32px;
      border-top: 1px solid #e2e8f0;
    }
    
    .signature h3 {
      font-size: 20px;
      color: #2d3748;
      margin-bottom: 8px;
      font-weight: 700;
    }
    
    .signature p {
      color: #718096;
      font-size: 16px;
    }
    
    /* FOOTER - Minimal */
    .footer { 
      text-align: center; 
      padding: 32px 40px;
      color: #a0aec0; 
      font-size: 13px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
    
    .copyright {
      margin-top: 16px;
      font-size: 12px;
      opacity: 0.7;
    }
    
    @media (max-width: 640px) {
      .header { padding: 40px 24px; }
      .header h1 { font-size: 32px; }
      .header p { font-size: 18px; }
      .content { padding: 32px 24px; }
      .receipt-grid { grid-template-columns: 1fr; }
      .steps-grid { grid-template-columns: 1fr; }
      .features-grid { grid-template-columns: 1fr; }
      .support-grid { grid-template-columns: 1fr; }
      .license-box { font-size: 20px; padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <!-- HEADER - Full width welcome banner -->
    <div class="header">
      <div class="welcome-icon">✨</div>
      <h1>Welcome to Sorvide Pro!</h1>
      <p>Your AI research assistant just got superpowers</p>
    </div>
    
    <!-- CONTENT -->
    <div class="content">
      <!-- Greeting -->
      <p class="greeting">Hi ${customerName || 'there'},</p>
      <p class="intro">
        Thank you for joining Sorvide Pro! You've just unlocked premium AI research capabilities. 
        Below is everything you need to get started with your new Pro subscription.
      </p>
      
      <!-- LICENSE KEY -->
      <div class="license-section">
        <div class="license-label">Your License Key</div>
        <div class="license-box">${licenseKey}</div>
        <p style="color: #718096; font-size: 14px; margin-top: 12px;">
          Copy this key to activate your Pro features
        </p>
      </div>
      
      <!-- PURCHASE RECEIPT -->
      <div class="receipt-card">
        <div class="receipt-title">
          <span>📋</span>
          <span>Purchase Details</span>
        </div>
        
        <div class="receipt-grid">
          <div class="receipt-item">
            <div class="receipt-label">Subscription Plan</div>
            <div class="receipt-value">Sorvide Pro Monthly</div>
          </div>
          
          <div class="receipt-item">
            <div class="receipt-label">Monthly Price</div>
            <div class="receipt-value">$9.99 / month</div>
          </div>
          
          <div class="receipt-item">
            <div class="receipt-label">Billing Cycle</div>
            <div class="receipt-value">Recurring Monthly</div>
          </div>
          
          <div class="receipt-item">
            <div class="receipt-label">License Duration</div>
            <div class="receipt-value">30 Days (Auto-Renews)</div>
          </div>
        </div>
        
        <div class="receipt-note">
          <strong>Important:</strong> This email serves as your purchase confirmation and license activation receipt. 
          Please keep it for your records. Your subscription will automatically renew every 30 days unless cancelled.
        </div>
      </div>
      
      <!-- ACTIVATION STEPS - Perfectly centered -->
      <div class="steps-section">
        <div class="steps-title">
          <span>🔑</span>
          <span>Activate Your Pro Features</span>
        </div>
        
        <div class="steps-grid">
          <div class="step-card">
            <div class="step-number">1</div>
            <div class="step-content">
              <h4>Open Extension</h4>
              <p>Click the Sorvide icon in your Chrome toolbar to open the extension</p>
            </div>
          </div>
          
          <div class="step-card">
            <div class="step-number">2</div>
            <div class="step-content">
              <h4>Activate Pro</h4>
              <p>Click "Activate Pro" in the bottom status bar of the extension</p>
            </div>
          </div>
          
          <div class="step-card">
            <div class="step-number">3</div>
            <div class="step-content">
              <h4>Enter License Key</h4>
              <p>Paste your license key from above into the activation dialog</p>
            </div>
          </div>
          
          <div class="step-card">
            <div class="step-number">4</div>
            <div class="step-content">
              <h4>Enjoy Pro Features</h4>
              <p>Click "Activate License" and immediately access all Pro capabilities</p>
            </div>
          </div>
        </div>
      </div>
      
      <!-- PRO FEATURES -->
      <div class="features-section">
        <div class="features-title">✨ Pro Features You Now Have Access To</div>
        
        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">🤖</div>
            <h4>Unlimited AI Summaries</h4>
            <p>No daily limits - summarize as much content as you need for your research</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">🔍</div>
            <h4>Advanced Plagiarism Check</h4>
            <p>Detailed similarity reports with highlighted matching content</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">💡</div>
            <h4>AI Research Insights</h4>
            <p>Get intelligent analysis and key takeaways from your research materials</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">📤</div>
            <h4>Export to PDF/Markdown</h4>
            <p>Save your research with perfect formatting for reports and documentation</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">🏷️</div>
            <h4>Advanced Organization</h4>
            <p>Tag, categorize, and search through your entire research library</p>
          </div>
          
          <div class="feature-card">
            <div class="feature-icon">⚡</div>
            <h4>Priority Support</h4>
            <p>Faster response times and dedicated help for Pro members</p>
          </div>
        </div>
      </div>
      
      <!-- SUPPORT SECTION -->
      <div class="support-section">
        <div class="support-title">💬 Need Help?</div>
        <p style="color: #166534; font-size: 16px; margin-bottom: 24px;">
          Our support team is here to help you get the most out of Sorvide Pro
        </p>
        
        <div class="support-grid">
          <div class="support-item">
            <div class="support-label">General Support</div>
            <div class="support-value">support@sorvide.com</div>
          </div>
          
          <div class="support-item">
            <div class="support-label">Subscription Questions</div>
            <div class="support-value">license@sorvide.com</div>
          </div>
        </div>
        
        <p class="support-note">
          Typical response time: Within 24 hours<br>
          Please use these emails instead of replying to this automated message
        </p>
      </div>
      
      <!-- CANCELLATION POLICY -->
      <div class="cancellation-card">
        <div class="cancellation-title">
          <span>⚙️</span>
          <span>Subscription Management</span>
        </div>
        
        <p style="color: #78350f; font-size: 16px; margin-bottom: 20px; line-height: 1.6;">
          To cancel your subscription, please email us directly at <strong>license@sorvide.com</strong>. 
          Include your registered email address and request to cancel. 
          Cancellations are processed within 24 hours of receiving your request.
        </p>
        
        <div class="policy-box">
          <div class="policy-title">Refund Policy</div>
          <div class="policy-text">
            We do not offer refunds for subscriptions. Our AI infrastructure requires significant computational resources, 
            which are allocated immediately upon subscription. You may cancel at any time to stop future billing cycles.
          </div>
        </div>
      </div>
      
      <!-- SIGNATURE -->
      <div class="signature">
        <h3>Happy researching!</h3>
        <p>The Sorvide Team</p>
      </div>
    </div>
    
    <!-- MINIMAL FOOTER -->
    <div class="footer">
      <div>© ${new Date().getFullYear()} Sorvide Pro</div>
      <div class="copyright">All rights reserved</div>
    </div>
  </div>
</body>
</html>
      `;
      
      const text = `
╔════════════════════════════════════════╗
           WELCOME TO SORVIDE PRO
╚════════════════════════════════════════╝

Hi ${customerName || 'there'},

Thank you for subscribing to Sorvide Pro! You've just unlocked premium AI research capabilities.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
           YOUR LICENSE KEY
           ${licenseKey}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PURCHASE DETAILS
──────────────────
• Subscription: Sorvide Pro Monthly
• Price: $9.99 / month
• Billing: Recurring monthly
• License Duration: 30 days (auto-renews)
• Next Renewal: In 30 days

This email serves as your purchase confirmation and license activation receipt.

🔑 HOW TO ACTIVATE PRO FEATURES
──────────────────────────────
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" in the bottom status bar
3. Enter your license key: ${licenseKey}
4. Click "Activate License"

✨ PRO FEATURES
──────────────
• Unlimited AI summaries (no daily limits)
• Advanced plagiarism detection with detailed reports
• AI-powered research insights and analysis
• Export to PDF/Markdown with formatting preserved
• Advanced research library with tagging and organization
• Priority support with faster response times

💬 NEED HELP?
────────────
General Support: support@sorvide.com
Subscription Questions: license@sorvide.com

Typical response time: Within 24 hours

⚙️ SUBSCRIPTION MANAGEMENT
────────────────────────
To cancel your subscription, email us at license@sorvide.com
Include your registered email address and request to cancel.

⚠️ REFUND POLICY
───────────────
We do not offer refunds for subscriptions. Our AI infrastructure requires significant 
computational resources, which are allocated immediately upon subscription. 
You may cancel at any time to stop future billing cycles.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Happy researching!

The Sorvide Team
© ${new Date().getFullYear()} Sorvide Pro
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `;
      
      await mg.messages.create(domain, {
        from: `Sorvide Pro <${fromEmail}>`,
        to: [customerEmail],
        subject: '✨ Welcome to Sorvide Pro! Your License Key & Activation Guide',
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