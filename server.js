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
    
    // Create a simpler, more compact HTML email
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Sorvide Pro License Key</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <center>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f7fa">
      <tr>
        <td align="center" style="padding:20px 0;">
          <table width="650" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:650px;width:100%;border-radius:0;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
            <!-- HEADER -->
            <tr>
              <td bgcolor="#4a4fd8" style="padding:50px 30px;background:linear-gradient(135deg,#4a4fd8,#2a2d7d);color:#ffffff;text-align:center;">
                <h1 style="margin:0 0 15px 0;font-size:32px;font-weight:700;">Welcome to Sorvide Pro</h1>
                <p style="margin:0;font-size:18px;opacity:0.95;">Your monthly subscription is now active</p>
              </td>
            </tr>
            
            <!-- MAIN CONTENT -->
            <tr>
              <td style="padding:40px 40px 30px 40px;">
                <!-- GREETING -->
                <p style="font-size:18px;color:#2d3748;margin:0 0 20px 0;font-weight:500;">Hi ${customerName || 'there'},</p>
                <p style="color:#4a5568;font-size:16px;line-height:1.6;margin:0 0 30px 0;">Thank you for subscribing to Sorvide Pro. Your license key is ready and all Pro features are ready to be unlocked.</p>
                
                <!-- LICENSE KEY -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 40px 0;background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:30px;text-align:center;">
                      <div style="font-size:14px;color:#718096;text-transform:uppercase;letter-spacing:1px;margin:0 0 20px 0;font-weight:600;">Your License Key</div>
                      <div style="font-family:'SF Mono',Monaco,'Courier New',monospace;font-size:22px;font-weight:700;color:#2d3748;background:#ffffff;padding:20px;border-radius:6px;border:2px solid #e2e8f0;word-break:break-all;letter-spacing:0.5px;">${licenseKey}</div>
                    </td>
                  </tr>
                </table>
                
                <!-- ACTIVATION STEPS -->
                <h2 style="font-size:22px;color:#2d3748;margin:0 0 25px 0;padding-bottom:12px;border-bottom:2px solid #e2e8f0;font-weight:600;">How to Activate Pro Features</h2>
                
                <!-- Step 1 -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:20px;">
                      <div style="display:inline-block;width:32px;height:32px;background:#4a4fd8;color:#ffffff;border-radius:6px;font-size:16px;font-weight:700;text-align:center;line-height:32px;margin-right:15px;vertical-align:top;">1</div>
                      <div style="display:inline-block;width:calc(100% - 55px);">
                        <div style="font-size:16px;color:#2d3748;margin:0 0 5px 0;font-weight:600;">Open the Sorvide Chrome Extension</div>
                        <div style="color:#718096;font-size:14px;line-height:1.5;margin:0;">Click the Sorvide icon in your browser toolbar to open the extension</div>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- Step 2 -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:20px;">
                      <div style="display:inline-block;width:32px;height:32px;background:#4a4fd8;color:#ffffff;border-radius:6px;font-size:16px;font-weight:700;text-align:center;line-height:32px;margin-right:15px;vertical-align:top;">2</div>
                      <div style="display:inline-block;width:calc(100% - 55px);">
                        <div style="font-size:16px;color:#2d3748;margin:0 0 5px 0;font-weight:600;">Click "Activate Pro"</div>
                        <div style="color:#718096;font-size:14px;line-height:1.5;margin:0;">Find and click the "Activate Pro" button in the bottom status bar of the extension</div>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- Step 3 -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:20px;">
                      <div style="display:inline-block;width:32px;height:32px;background:#4a4fd8;color:#ffffff;border-radius:6px;font-size:16px;font-weight:700;text-align:center;line-height:32px;margin-right:15px;vertical-align:top;">3</div>
                      <div style="display:inline-block;width:calc(100% - 55px);">
                        <div style="font-size:16px;color:#2d3748;margin:0 0 5px 0;font-weight:600;">Enter Your License Key</div>
                        <div style="color:#718096;font-size:14px;line-height:1.5;margin:0;">Copy and paste the license key from above into the activation dialog</div>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- Step 4 -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 40px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:20px;">
                      <div style="display:inline-block;width:32px;height:32px;background:#4a4fd8;color:#ffffff;border-radius:6px;font-size:16px;font-weight:700;text-align:center;line-height:32px;margin-right:15px;vertical-align:top;">4</div>
                      <div style="display:inline-block;width:calc(100% - 55px);">
                        <div style="font-size:16px;color:#2d3748;margin:0 0 5px 0;font-weight:600;">Click "Activate License"</div>
                        <div style="color:#718096;font-size:14px;line-height:1.5;margin:0;">Your Pro features will be activated immediately after clicking this button</div>
                      </div>
                    </td>
                  </tr>
                </table>
                
                <!-- PURCHASE DETAILS -->
                <h2 style="font-size:22px;color:#2d3748;margin:0 0 25px 0;padding-bottom:12px;border-bottom:2px solid #e2e8f0;font-weight:600;">Purchase Details</h2>
                
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                  <tr>
                    <td width="50%" style="padding-right:10px;vertical-align:top;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                        <tr>
                          <td style="padding:20px;">
                            <div style="font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;font-weight:600;">Subscription Plan</div>
                            <div style="font-size:16px;color:#2d3748;font-weight:600;">Sorvide Pro Monthly</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td width="50%" style="padding-left:10px;vertical-align:top;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                        <tr>
                          <td style="padding:20px;">
                            <div style="font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;font-weight:600;">Monthly Price</div>
                            <div style="font-size:16px;color:#2d3748;font-weight:600;">$9.99 / month</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 30px 0;">
                  <tr>
                    <td width="50%" style="padding-right:10px;vertical-align:top;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                        <tr>
                          <td style="padding:20px;">
                            <div style="font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;font-weight:600;">Billing Cycle</div>
                            <div style="font-size:16px;color:#2d3748;font-weight:600;">Monthly Recurring</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td width="50%" style="padding-left:10px;vertical-align:top;">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                        <tr>
                          <td style="padding:20px;">
                            <div style="font-size:12px;color:#718096;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px 0;font-weight:600;">License Duration</div>
                            <div style="font-size:16px;color:#2d3748;font-weight:600;">30 Days (Auto-Renews)</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                
                <p style="color:#718096;font-size:14px;text-align:center;margin:0 0 40px 0;">This email serves as your purchase confirmation and license activation receipt. Please save it for your records.</p>
                
                <!-- SUBSCRIPTION MANAGEMENT -->
                <h2 style="font-size:22px;color:#2d3748;margin:0 0 25px 0;padding-bottom:12px;border-bottom:2px solid #e2e8f0;font-weight:600;">Subscription Management</h2>
                
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 40px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
                  <tr>
                    <td style="padding:20px;">
                      <div style="font-size:16px;color:#2d3748;margin:0 0 12px 0;font-weight:600;">Subscription Cancellations</div>
                      <div style="color:#4a5568;font-size:14px;line-height:1.6;margin:0;">If you wish to cancel your Sorvide Pro subscription, please send an email to our subscription management team at license@sorvide.com. Cancellation requests are typically processed within 24 hours of receipt. You will receive a confirmation email once your cancellation has been processed.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            
            <!-- FOOTER -->
            <tr>
              <td style="padding:30px 40px;text-align:center;border-top:1px solid #e2e8f0;">
                <div style="color:#718096;font-size:14px;margin:0 0 15px 0;">© ${new Date().getFullYear()} Sorvide</div>
                <div style="font-size:13px;">
                  <a href="https://sorvide.com" style="color:#4a4fd8;text-decoration:none;margin:0 10px;">Website</a> | 
                  <a href="mailto:support@sorvide.com" style="color:#4a4fd8;text-decoration:none;margin:0 10px;">Support</a> | 
                  <a href="mailto:license@sorvide.com" style="color:#4a4fd8;text-decoration:none;margin:0 10px;">Subscriptions</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
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
      subject: 'Your Sorvide Pro License Key & Activation Instructions',
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