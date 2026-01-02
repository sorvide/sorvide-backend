import express from 'express';
import LicenseService from '../services/LicenseService.js';
import StripeService from '../services/StripeService.js';
import EmailService from '../services/EmailService.js';

const router = express.Router();
const licenseService = new LicenseService();
const stripeService = new StripeService();
const emailService = new EmailService();

// Validate license key
router.post('/validate-license', async (req, res) => {
  try {
    const { licenseKey, deviceId, deviceName } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({ 
        valid: false, 
        error: 'License key is required' 
      });
    }
    
    const result = await licenseService.validateLicenseKey(licenseKey, deviceId, deviceName);
    
    if (result.valid) {
      res.json({
        valid: true,
        license: result.license,
        message: 'License validated successfully'
      });
    } else {
      res.status(400).json({
        valid: false,
        error: result.error,
        expired: result.expired
      });
    }
    
  } catch (error) {
    console.error('License validation error:', error);
    res.status(500).json({ 
      valid: false, 
      error: 'Server error validating license' 
    });
  }
});

// Check existing license for device
router.post('/device-license', async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ 
        error: 'Device ID is required' 
      });
    }
    
    const result = await licenseService.getDeviceLicense(deviceId);
    
    if (result.hasLicense) {
      res.json({
        hasLicense: true,
        license: result.license,
        message: 'Device has active license'
      });
    } else {
      res.json({
        hasLicense: false,
        message: 'No active license found for this device'
      });
    }
    
  } catch (error) {
    console.error('Device license check error:', error);
    res.status(500).json({ 
      error: 'Server error checking device license' 
    });
  }
});

// Create Stripe checkout session
router.post('/create-checkout', async (req, res) => {
  try {
    const { email, plan } = req.body;
    
    if (!email || !plan) {
      return res.status(400).json({ 
        error: 'Email and plan are required' 
      });
    }
    
    if (!['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ 
        error: 'Invalid plan type' 
      });
    }
    
    const priceId = plan === 'yearly' 
      ? stripeService.priceIds.yearly 
      : stripeService.priceIds.monthly;
    
    const successUrl = `${process.env.FRONTEND_URL || 'https://sorvide.com'}/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.FRONTEND_URL || 'https://sorvide.com'}/cancel`;
    
    const result = await stripeService.createCheckoutSession(
      email, 
      priceId, 
      successUrl, 
      cancelUrl
    );
    
    if (result.success) {
      res.json({
        success: true,
        sessionId: result.sessionId,
        url: result.url
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error creating checkout session' 
    });
  }
});

// Webhook endpoint for Stripe
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe signature' });
    }
    
    const result = await stripeService.handleWebhook(req.body, signature);
    
    if (result.success) {
      // Get event data
      const event = stripeService.stripe.webhooks.constructEvent(
        req.body,
        signature,
        stripeService.webhookSecret
      );
      
      // Handle successful payment
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Get customer and subscription details
        const customer = await stripeService.stripe.customers.retrieve(session.customer);
        const subscription = await stripeService.stripe.subscriptions.retrieve(session.subscription);
        
        // Determine license type
        let licenseType = 'monthly';
        if (subscription.items.data[0].price.id === stripeService.priceIds.yearly) {
          licenseType = 'yearly';
        }
        
        // Create license for customer
        const stripeData = {
          customerId: customer.id,
          subscriptionId: subscription.id,
          paymentIntentId: session.payment_intent,
          invoiceId: session.invoice
        };
        
        const licenseResult = await licenseService.createLicenseForCustomer(
          customer.email,
          customer.name,
          licenseType,
          stripeData
        );
        
        if (licenseResult.success) {
          // Send license email to customer
          await emailService.sendLicenseEmail(
            customer.email,
            customer.name,
            licenseResult.key,
            licenseType
          );
          
          console.log(`License created and email sent to ${customer.email}`);
        }
      }
      
      res.json({ received: true });
    } else {
      res.status(400).json({ error: result.error });
    }
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual license creation (admin only)
router.post('/create-license', async (req, res) => {
  try {
    // Simple admin check - in production use proper auth
    const adminToken = req.headers['x-admin-token'];
    if (adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { email, name, type } = req.body;
    
    if (!email || !type) {
      return res.status(400).json({ 
        error: 'Email and type are required' 
      });
    }
    
    const licenseResult = await licenseService.createLicenseForCustomer(
      email,
      name,
      type,
      {}
    );
    
    if (licenseResult.success) {
      // Send email
      await emailService.sendLicenseEmail(
        email,
        name,
        licenseResult.key,
        type
      );
      
      res.json({
        success: true,
        license: licenseResult.license,
        key: licenseResult.key,
        message: 'License created and email sent'
      });
    } else {
      res.status(500).json({
        success: false,
        error: licenseResult.error
      });
    }
    
  } catch (error) {
    console.error('Create license error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error creating license' 
    });
  }
});

export default router;