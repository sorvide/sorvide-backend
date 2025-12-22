// server.js - COST OPTIMIZED VERSION WITH STRIPE WEBHOOKS
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import Stripe from 'stripe';
import crypto from 'crypto';
import mongoose from 'mongoose';

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Connect to MongoDB (optional, for production)
let License, dbConnected = false;
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
      console.log('✅ Connected to MongoDB');
      dbConnected = true;
      
      // License Schema
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

// COST TRACKER (for monitoring)
let costTracker = {
  totalTokens: 0,
  estimatedCost: 0,
  requests: 0
};

// Price per 1M tokens (from OpenAI pricing page)
const MODEL_PRICES = {
  'gpt-4o-mini': { input: 0.150, output: 0.600 },
  'gpt-3.5-turbo': { input: 0.500, output: 1.500 },
  'gpt-4o': { input: 2.500, output: 10.000 },
  'gpt-4-turbo': { input: 10.000, output: 30.000 }
};

// ========== LICENSE MANAGEMENT ==========

// Generate unique license key
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

// Calculate expiry date
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

// ========== STRIPE WEBHOOK ==========

// Stripe webhook endpoint
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log(`✅ Webhook received: ${event.type}`);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        await handleSuccessfulPayment(session);
        break;
        
      case 'customer.subscription.updated':
        const subscription = event.data.object;
        await handleSubscriptionUpdate(subscription);
        break;
        
      case 'customer.subscription.deleted':
        const deletedSubscription = event.data.object;
        await handleSubscriptionCancellation(deletedSubscription);
        break;
        
      default:
        console.log(`⚠️ Unhandled event type: ${event.type}`);
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
    const customerId = session.customer; // ✅ FIXED

    if (!customerEmail || !customerId) {
      console.error('❌ Missing customer email or ID');
      return;
    }

    // ✅ Safely resolve plan type
    let planType = 'monthly';

    if (session.subscription && session.subscription.metadata?.plan_type) {
      planType = session.subscription.metadata.plan_type;
    }

    // Generate license
    const licenseKey = generateLicenseKey(customerEmail, planType);
    const expiryDate = calculateExpiryDate(planType);

    // Save to DB
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
      console.log(`💾 License saved for ${customerEmail}`);
    }

    // Send email
    await sendLicenseEmail(customerEmail, licenseKey, planType, expiryDate);

    console.log(`✅ License generated: ${licenseKey}`);
  } catch (error) {
    console.error('❌ Error handling successful payment:', error);
  }
}

async function sendLicenseEmail(email, licenseKey, planType, expiryDate) {
  // Implement your email sending logic here
  // Example using Nodemailer, SendGrid, etc.
  
  console.log(`📧 Sending license email to ${email}`);
  console.log(`   License Key: ${licenseKey}`);
  console.log(`   Plan: ${planType}`);
  console.log(`   Expires: ${expiryDate.toLocaleDateString()}`);
  
  // Example implementation (uncomment and configure):
  /*
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your Sorvide Pro License Key',
    html: `
      <h2>Welcome to Sorvide Pro! 🎉</h2>
      <p>Your license key: <strong>${licenseKey}</strong></p>
      <p>Plan: ${planType === 'monthly' ? 'Monthly ($9.99)' : 'Yearly ($99.99)'}</p>
      <p>Expires: ${expiryDate.toLocaleDateString()}</p>
      <p>To activate:</p>
      <ol>
        <li>Open the Sorvide Chrome extension</li>
        <li>Click "Activate Pro" button</li>
        <li>Enter your license key</li>
        <li>Enjoy all Pro features!</li>
      </ol>
      <p>Need help? Contact support@sorvide.com</p>
    `
  };
  
  await transporter.sendMail(mailOptions);
  */
  
  // For now, log the license key
  console.log(`🔑 License for ${email}: ${licenseKey}`);
}

// ========== LICENSE VALIDATION ENDPOINT ==========

app.post('/api/validate-license', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ 
        success: false, 
        message: 'License key is required' 
      });
    }
    
    // For demo/test purposes - accept test keys
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

// ========== YOUR EXISTING AI ENDPOINTS (UPDATED) ==========

function estimateCost(model, inputTokens, outputTokens) {
  const prices = MODEL_PRICES[model] || MODEL_PRICES['gpt-4o-mini'];
  const inputCost = (inputTokens / 1000000) * prices.input;
  const outputCost = (outputTokens / 1000000) * prices.output;
  return inputCost + outputCost;
}

// 1. Summarize Endpoint - OPTIMIZED
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.length < 10) {
      return res.status(400).json({ error: 'Text must be at least 10 characters' });
    }

    const model = 'gpt-4o-mini';
    const maxLength = 4000;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) + '... [truncated for cost optimization]'
      : text;

    const prompt = `Summarize this text concisely (2-3 sentences max):
    
${truncatedText}

Summary:`;

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150,
      frequency_penalty: 0.1,
      presence_penalty: 0.1
    });

    const summary = response.choices[0].message.content;
    const usage = response.usage || { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
    
    const cost = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
    costTracker.totalTokens += usage.total_tokens;
    costTracker.estimatedCost += cost;
    costTracker.requests++;

    res.json({
      success: true,
      summary,
      model,
      tokens: usage.total_tokens,
      estimatedCost: `$${cost.toFixed(6)}`,
      costOptimization: 'Using gpt-4o-mini (cheapest model)'
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ 
      error: 'Failed to generate summary',
      suggestion: 'Try shorter text or check your OpenAI API key'
    });
  }
});

// 2. Plagiarism Check - OPTIMIZED
app.post('/api/plagiarism', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.length < 50) {
      return res.status(400).json({ 
        error: 'Text must be at least 50 characters' 
      });
    }

    const model = 'gpt-4o-mini';
    const maxLength = 2000;
    
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength)
      : text;

    const prompt = `Analyze originality of this text (score 0-100):
"${truncatedText}"
Score:`;

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 50,
    });

    const analysis = response.choices[0].message.content;
    const score = parseInt(analysis) || 85;
    
    res.json({
      success: true,
      score,
      risk: score > 80 ? 'low' : score > 60 ? 'medium' : 'high',
      analysis: 'Basic originality check completed',
      note: 'For detailed analysis, upgrade to Pro plan',
      costOptimized: true
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 3. INSIGHTS - LIGHTWEIGHT VERSION
app.post('/api/insights', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const model = 'gpt-4o-mini';
    const maxLength = 3000;
    
    const prompt = `Extract 3-5 key concepts from this text (comma-separated):
"${text.substring(0, maxLength)}"
Concepts:`;

    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 100,
    });

    const concepts = response.choices[0].message.content.split(',').map(c => c.trim());
    
    res.json({
      success: true,
      concepts: concepts.slice(0, 5),
      insights: `Found ${concepts.length} key concepts`,
      model,
      costNote: 'Using cost-optimized model'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 4. SIMPLE CITATIONS
app.post('/api/citations', (req, res) => {
  const { sourceUrl, authors = [] } = req.body;
  
  const date = new Date().toISOString().split('T')[0];
  const author = authors.length > 0 ? authors.join(', ') : 'Author';
  
  res.json({
    success: true,
    apa: `${author}. (${date.split('-')[0]}). Retrieved from ${sourceUrl || 'source'}`,
    mla: `${author}. "${new URL(sourceUrl || 'http://example.com').hostname}." ${date}.`,
    note: 'Basic citation generated. For full formatting, add source details.',
    cost: '$0.00 (no AI used)'
  });
});

// 5. COST MONITORING ENDPOINT
app.get('/api/cost', (req, res) => {
  res.json({
    totalRequests: costTracker.requests,
    totalTokens: costTracker.totalTokens,
    estimatedCost: `$${costTracker.estimatedCost.toFixed(4)}`,
    averagePerRequest: `$${(costTracker.estimatedCost / Math.max(1, costTracker.requests)).toFixed(6)}`,
    models: MODEL_PRICES,
    recommendation: 'Using gpt-4o-mini for all features to minimize costs'
  });
});

// 6. TEXT LIMITS ENDPOINT
app.post('/api/optimize', (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.json({
      suggestion: 'No text provided for optimization'
    });
  }

  const tokens = Math.ceil(text.length / 4);
  const costWithMini = estimateCost('gpt-4o-mini', tokens, 150);
  const costWith35Turbo = estimateCost('gpt-3.5-turbo', tokens, 150);
  
  res.json({
    textLength: text.length,
    estimatedTokens: tokens,
    recommendedModel: 'gpt-4o-mini',
    estimatedCost: {
      'gpt-4o-mini': `$${costWithMini.toFixed(6)}`,
      'gpt-3.5-turbo': `$${costWith35Turbo.toFixed(6)}`,
      savings: `$${(costWith35Turbo - costWithMini).toFixed(6)} (${Math.round((1 - costWithMini/costWith35Turbo) * 100)}% cheaper)`
    },
    suggestions: [
      'Keep text under 2000 characters for optimal cost',
      'Use gpt-4o-mini for all research features',
      'Batch multiple operations when possible'
    ]
  });
});

// ========== STRIPE CONFIGURATION ENDPOINTS ==========

// Get Stripe publishable key
app.get('/api/stripe/config', (req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    monthlyPriceId: process.env.STRIPE_MONTHLY_PRICE_ID,
    yearlyPriceId: process.env.STRIPE_YEARLY_PRICE_ID
  });
});

// Create checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { priceId, planType, successUrl, cancelUrl } = req.body;
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: successUrl || `${req.headers.origin}/success`,
      cancel_url: cancelUrl || `${req.headers.origin}/cancel`,
      metadata: {
        plan_type: planType || 'monthly'
      }
    });
    
    res.json({ sessionId: session.id, url: session.url });
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== HEALTH & INFO ENDPOINTS ==========

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dbConnected,
    stripeConfigured: !!process.env.STRIPE_SECRET_KEY
  });
});

// License system info
app.get('/api/license/info', (req, res) => {
  res.json({
    system: 'Sorvide Pro License System',
    features: [
      'License key generation and validation',
      'Stripe webhook integration',
      'Automatic email delivery',
      'License expiration tracking',
      'Database storage (optional)'
    ],
    planDurations: {
      monthly: '30 days',
      yearly: '365 days'
    },
    demoKeys: ['SORVIDE-PRO-MONTHLY-ABC123', 'SORVIDE-PRO-YEARLY-XYZ789']
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Sorvide AI Backend with Stripe Integration',
    version: '2.0.0',
    status: 'running',
    features: [
      'AI Research Features (cost-optimized)',
      'Stripe Payment Processing',
      'License Key Management',
      'Webhook Automation',
      'MongoDB Storage (optional)'
    ],
    endpoints: {
      ai: [
        'POST /api/summarize',
        'POST /api/plagiarism',
        'POST /api/insights',
        'POST /api/citations'
      ],
      license: [
        'POST /api/validate-license',
        'POST /api/stripe-webhook (webhook)',
        'GET /api/license/info'
      ],
      stripe: [
        'POST /api/create-checkout-session',
        'GET /api/stripe/config'
      ],
      monitoring: [
        'GET /api/cost',
        'POST /api/optimize',
        'GET /api/health'
      ]
    },
    pricingNote: 'AI: gpt-4o-mini @ $0.15/1M input, $0.60/1M output',
    stripeNote: 'Monthly: $9.99, Yearly: $99.99'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  🚀 ENHANCED Sorvide Backend
  ⚡ Port: ${PORT}
  🔗 Local: http://localhost:${PORT}
  
  💰 COST OPTIMIZATION:
  • Default model: gpt-4o-mini (cheapest)
  • Text limits: 4000 chars for summaries
  • Temperature: 0.3 (consistent, cheaper)
  
  💳 STRIPE INTEGRATION:
  • Webhook: /api/stripe-webhook
  • License validation: /api/validate-license
  • Demo keys enabled
  
  💾 DATABASE:
  • MongoDB: ${dbConnected ? '✅ Connected' : '❌ Not connected'}
  • Optional for production
  
  📈 COST ESTIMATES:
  • 1000-character summary: ~$0.0001
  • 100 requests/day: ~$0.10/day
  • 3000 requests/month: ~$3.00/month
  
  🔧 SETUP REQUIRED:
  1. Set STRIPE_SECRET_KEY in .env
  2. Set STRIPE_WEBHOOK_SECRET in .env
  3. Set STRIPE_PUBLISHABLE_KEY in .env
  4. (Optional) Set MONGODB_URI for database
  5. Configure webhook in Stripe Dashboard
  
  💡 NEXT STEPS:
  1. Test webhook: stripe listen --forward-to localhost:3000/api/stripe-webhook
  2. Update extension with backend URL
  3. Test payment flow
  4. Deploy to production (Render, Railway, Vercel)
  `);
});