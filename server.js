// server.js - COMPLETE PRODUCTION VERSION WITH EMAIL
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';
import Mailgun from 'mailgun.js';
import formData from 'form-data';

const app = express();

// ========== MIDDLEWARE ==========
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== INITIALIZE SERVICES ==========
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Mailgun (email service)
const mailgun = new Mailgun(formData);
const mg = process.env.MAILGUN_API_KEY ? mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY
}) : null;

// ========== DATABASE SETUP ==========
let License, dbConnected = false;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('✅ Connected to MongoDB');
      dbConnected = true;
      
      const licenseSchema = new mongoose.Schema({
        email: String,
        licenseKey: String,
        planType: String,
        expiryDate: Date,
        stripeCustomerId: String,
        stripeSubscriptionId: String,
        active: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now }
      });
      
      License = mongoose.model('License', licenseSchema);
    })
    .catch(err => {
      console.error('❌ MongoDB connection error:', err.message);
    });
}

// ========== LICENSE MANAGEMENT ==========
function generateLicenseKey(customerEmail, planType) {
  const prefix = 'SORVIDE-PRO-';
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  
  if (planType === 'monthly') {
    return `${prefix}MONTHLY-${timestamp}-${random}`;
  } else if (planType === 'yearly') {
    return `${prefix}YEARLY-${timestamp}-${random}`;
  }
  return `${prefix}${timestamp}-${random}`;
}

function calculateExpiryDate(planType) {
  const now = new Date();
  const expiry = new Date(now);
  
  if (planType === 'monthly') {
    expiry.setMonth(expiry.getMonth() + 1);
  } else if (planType === 'yearly') {
    expiry.setFullYear(expiry.getFullYear() + 1);
  }
  
  return expiry;
}

// ========== EMAIL SERVICE ==========
async function sendLicenseEmail(email, licenseKey, planType, expiryDate) {
  // Log for testing (ALWAYS shows in Render logs)
  console.log('='.repeat(50));
  console.log(`🎉 LICENSE GENERATED SUCCESSFULLY`);
  console.log(`📧 For customer: ${email}`);
  console.log(`🔑 License Key: ${licenseKey}`);
  console.log(`📅 Plan: ${planType === 'monthly' ? 'Monthly ($9.99)' : 'Yearly ($99.99)'}`);
  console.log(`⏰ Expires: ${expiryDate.toLocaleDateString()}`);
  console.log(`📝 Days valid: ${planType === 'monthly' ? '30' : '365'} days`);
  console.log('='.repeat(50));
  
  // Send actual email if Mailgun is configured
  if (mg && process.env.MAILGUN_DOMAIN) {
    try {
      const data = {
        from: `Sorvide <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: email,
        subject: 'Your Sorvide Pro License Key',
        text: `
Welcome to Sorvide Pro! 🎉

Your License Key: ${licenseKey}
Plan: ${planType === 'monthly' ? 'Monthly ($9.99)' : 'Yearly ($99.99)'}
Expires: ${expiryDate.toLocaleDateString()}

To activate:
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" button
3. Enter your license key
4. Enjoy all Pro features!

Need help? Contact support@sorvide.com
        `,
        html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #4a4fd8, #2a2d7d); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
    .content { background: #f8f9ff; padding: 30px; border-radius: 0 0 10px 10px; }
    .license-box { background: white; border: 2px solid #4a4fd8; padding: 15px; border-radius: 8px; font-size: 18px; font-weight: bold; text-align: center; margin: 20px 0; }
    .steps { margin: 20px 0; }
    .step { display: flex; align-items: center; margin: 10px 0; }
    .step-number { background: #4a4fd8; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Welcome to Sorvide Pro! 🎉</h2>
    </div>
    <div class="content">
      <p>Thank you for upgrading to Sorvide Pro! Here's your license key:</p>
      
      <div class="license-box">${licenseKey}</div>
      
      <p><strong>Plan Details:</strong></p>
      <ul>
        <li>Plan: ${planType === 'monthly' ? 'Monthly ($9.99)' : 'Yearly ($99.99)'}</li>
        <li>Expires: ${expiryDate.toLocaleDateString()}</li>
        <li>Features: Unlimited AI summaries, plagiarism checks, research insights, citations, and export features</li>
      </ul>
      
      <div class="steps">
        <p><strong>To activate:</strong></p>
        <div class="step">
          <div class="step-number">1</div>
          <span>Open the Sorvide Chrome extension</span>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <span>Click "Activate Pro" button</span>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <span>Enter your license key above</span>
        </div>
        <div class="step">
          <div class="step-number">4</div>
          <span>Enjoy all Pro features immediately!</span>
        </div>
      </div>
      
      <p>Need help? Contact <a href="mailto:support@sorvide.com">support@sorvide.com</a></p>
      
      <p style="margin-top: 30px; font-size: 12px; color: #666;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  </div>
</body>
</html>
        `
      };
      
      await mg.messages.create(process.env.MAILGUN_DOMAIN, data);
      console.log(`✅ Email sent to ${email}`);
      
    } catch (error) {
      console.error('❌ Email sending failed:', error.message);
      console.log(`⚠️ Manual license for ${email}: ${licenseKey}`);
    }
  } else {
    console.log(`📧 Email service not configured. License: ${licenseKey}`);
    console.log(`⚠️ Configure MAILGUN_API_KEY and MAILGUN_DOMAIN for automatic emails`);
  }
}

// ========== STRIPE WEBHOOK ==========
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('='.repeat(50));
  console.log('🔄 WEBHOOK RECEIVED');
  console.log(`📅 Time: ${new Date().toISOString()}`);
  
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`✅ Event type: ${event.type}`);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log(`💰 Payment from: ${session.customer_details?.email || 'Unknown'}`);
        await handleSuccessfulPayment(session);
        break;
        
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        console.log(`📝 Subscription updated: ${subscription.id}`);
        break;
        
      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        console.log(`🗑️ Subscription deleted: ${deletedSubscription.id}`);
        break;
        
      default:
        console.log(`⚠️ Unhandled event: ${event.type}`);
    }
    
    res.json({ received: true, event: event.type });
    
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function handleSuccessfulPayment(session) {
  try {
    const customerEmail = session.customer_details?.email;
    const customerId = session.customer;
    
    if (!customerEmail || !customerId) {
      console.error('❌ Missing customer email or ID in session');
      return;
    }
    
    // ========== CRITICAL FIX ==========
    // Get plan type from Payment Link metadata
    let planType = 'monthly'; // default
    
    // Method 1: Check session metadata (Payment Links store it here)
    if (session.metadata?.plan_type) {
      planType = session.metadata.plan_type;
      console.log(`📋 Plan type from session metadata: ${planType}`);
    }
    // Method 2: Check line items metadata
    else if (session.line_items?.data?.[0]?.price?.metadata?.plan_type) {
      planType = session.line_items.data[0].price.metadata.plan_type;
      console.log(`📋 Plan type from price metadata: ${planType}`);
    }
    // Method 3: Check subscription metadata
    else if (session.subscription && session.subscription.metadata?.plan_type) {
      planType = session.subscription.metadata.plan_type;
      console.log(`📋 Plan type from subscription metadata: ${planType}`);
    }
    else {
      console.log(`⚠️ No plan metadata found, using default: ${planType}`);
    }
    
    // Generate license
    const licenseKey = generateLicenseKey(customerEmail, planType);
    const expiryDate = calculateExpiryDate(planType);
    
    // Save to database if connected
    if (dbConnected && License) {
      const license = new License({
        email: customerEmail,
        licenseKey,
        planType,
        expiryDate,
        stripeCustomerId: customerId,
        stripeSubscriptionId: session.subscription,
        active: true
      });
      
      await license.save();
      console.log(`💾 License saved to database`);
    }
    
    // Send email with license
    await sendLicenseEmail(customerEmail, licenseKey, planType, expiryDate);
    
    console.log(`✅ License process completed for ${customerEmail}`);
    
  } catch (error) {
    console.error('❌ Error handling payment:', error);
  }
}

// ========== LICENSE VALIDATION ==========
app.post('/api/validate-license', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'License key is required' 
      });
    }
    
    // Accept demo/test keys
    const validTestKeys = ['SORVIDE-PRO-MONTHLY-ABC123', 'SORVIDE-PRO-YEARLY-XYZ789'];
    
    if (validTestKeys.includes(licenseKey.toUpperCase())) {
      const planType = licenseKey.toUpperCase().includes('YEARLY') ? 'yearly' : 'monthly';
      const expiryDate = calculateExpiryDate(planType);
      
      return res.json({
        success: true,
        license: {
          key: licenseKey,
          planType: planType,
          expiryDate: expiryDate.toISOString(),
          valid: true
        },
        note: 'Demo license activated'
      });
    }
    
    // Check database if connected
    if (dbConnected && License) {
      const license = await License.findOne({ 
        licenseKey: licenseKey,
        active: true,
        expiryDate: { $gt: new Date() }
      });
      
      if (license) {
        return res.json({
          success: true,
          license: {
            key: license.licenseKey,
            planType: license.planType,
            expiryDate: license.expiryDate.toISOString(),
            valid: true
          },
          note: 'Valid license found in database'
        });
      }
    }
    
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid or expired license key' 
    });
    
  } catch (error) {
    console.error('License validation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error during license validation' 
    });
  }
});

// ========== YOUR AI ENDPOINTS ==========
// [Keep all your existing AI endpoints: /api/summarize, /api/plagiarism, etc.]
// ... (Include all your AI endpoints exactly as they are)

// ========== HEALTH ENDPOINTS ==========
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dbConnected,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    emailConfigured: !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN),
    version: '2.1.0'
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'Sorvide Backend',
    version: '2.1.0',
    status: 'running',
    endpoints: {
      webhook: 'POST /api/stripe-webhook',
      license: 'POST /api/validate-license',
      health: 'GET /api/health',
      ai: ['/api/summarize', '/api/plagiarism', '/api/insights', '/api/citations']
    }
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`
  🚀 Sorvide Backend v2.1.0
  ⚡ Port: ${PORT}
  🔗 URL: http://localhost:${PORT}
  
  ✅ FEATURES:
  • Stripe webhook processing
  • License key generation
  • Email delivery (Mailgun)
  • AI research endpoints
  • MongoDB storage (optional)
  
  📧 EMAIL STATUS: ${process.env.MAILGUN_API_KEY ? '✅ Configured' : '❌ Not configured'}
  💾 DATABASE: ${dbConnected ? '✅ Connected' : '❌ Not connected'}
  💳 STRIPE: ${process.env.STRIPE_SECRET_KEY ? '✅ Configured' : '❌ Not configured'}
  
  📝 NEXT STEPS:
  1. Configure Mailgun for email delivery
  2. Add metadata to Payment Links
  3. Test payment flow
  4. Check Render logs for license generation
  `);
});