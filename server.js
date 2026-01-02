import express from 'express';
import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import Mailgun from 'mailgun.js';
import formData from 'form-data';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const app = express();

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Sorvide Backend',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Stripe webhook endpoint - MUST use raw body parser
app.post('/api/webhook', 
  // Use express.raw() for Stripe webhooks
  express.raw({type: 'application/json'}),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,  // This is now raw body buffer
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
    
    await mg.messages.create(domain, {
      from: `Sorvide AI <${fromEmail}>`,
      to: [customerEmail],
      subject: 'Your Sorvide Pro License Key',
      text: `
Thank you for your purchase!

Your Sorvide Pro license key is: ${licenseKey}

How to activate:
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" in the status bar
3. Enter your license key
4. Click "Activate License"
5. Enjoy all Pro features!

This license is valid for 30 days and renews automatically.

If you have any questions, please contact support@sorvide.com

Best regards,
The Sorvide Team
      `,
      html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #2a2d7d, #4a4fd8); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f8f9ff; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0; }
    .license-box { background: white; border: 2px solid #4a4fd8; border-radius: 8px; padding: 20px; margin: 20px 0; font-family: monospace; font-size: 18px; font-weight: bold; text-align: center; }
    .steps { background: white; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .step { display: flex; align-items: flex-start; margin-bottom: 15px; }
    .step-number { background: #4a4fd8; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 10px; flex-shrink: 0; }
    .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🎉 Welcome to Sorvide Pro!</h1>
    <p>Your monthly subscription is now active</p>
  </div>
  
  <div class="content">
    <p>Hi ${customerName},</p>
    
    <p>Thank you for subscribing to Sorvide Pro! Your license key is ready to use.</p>
    
    <div class="license-box">
      ${licenseKey}
    </div>
    
    <p><strong>License Type:</strong> Monthly Subscription</p>
    <p><strong>Duration:</strong> 30 days (renews automatically)</p>
    
    <div class="steps">
      <h3>How to Activate:</h3>
      
      <div class="step">
        <div class="step-number">1</div>
        <div>Open the Sorvide Chrome extension</div>
      </div>
      
      <div class="step">
        <div class="step-number">2</div>
        <div>Click "Activate Pro" in the bottom status bar</div>
      </div>
      
      <div class="step">
        <div class="step-number">3</div>
        <div>Enter your license key shown above</div>
      </div>
      
      <div class="step">
        <div class="step-number">4</div>
        <div>Click "Activate License" and enjoy Pro features!</div>
      </div>
    </div>
    
    <p><strong>Need Help?</strong></p>
    <p>If you have any issues activating your license, please reply to this email.</p>
    
    <p>Best regards,<br>The Sorvide Team</p>
  </div>
  
  <div class="footer">
    <p>© ${new Date().getFullYear()} Sorvide AI. All rights reserved.</p>
    <p>This email was sent to ${customerEmail}</p>
  </div>
</body>
</html>
      `
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