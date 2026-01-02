import Stripe from 'stripe';

class StripeService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    // Price IDs from your Stripe dashboard
    this.priceIds = {
      monthly: process.env.STRIPE_MONTHLY_PRICE_ID || 'price_monthly_placeholder',
      yearly: process.env.STRIPE_YEARLY_PRICE_ID || 'price_yearly_placeholder'
    };
  }

  async createCheckoutSession(customerEmail, priceId, successUrl, cancelUrl) {
    try {
      const session = await this.stripe.checkout.sessions.create({
        customer_email: customerEmail,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          product: 'sorvide_pro'
        }
      });

      return {
        success: true,
        sessionId: session.id,
        url: session.url
      };
      
    } catch (error) {
      console.error('Error creating checkout session:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleWebhook(payload, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret
      );

      console.log('Stripe webhook event:', event.type);

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutSessionCompleted(event.data.object);
          break;
          
        case 'invoice.payment_succeeded':
          await this.handleInvoicePaymentSucceeded(event.data.object);
          break;
          
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;
          
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;
          
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return { success: true };
      
    } catch (error) {
      console.error('Error handling webhook:', error);
      return { success: false, error: error.message };
    }
  }

  async handleCheckoutSessionCompleted(session) {
    try {
      console.log('Checkout session completed:', session.id);
      
      // Get customer details
      const customer = await this.stripe.customers.retrieve(session.customer);
      const subscription = await this.stripe.subscriptions.retrieve(session.subscription);
      
      // Determine license type based on price
      let licenseType = 'monthly';
      if (subscription.items.data[0].price.id === this.priceIds.yearly) {
        licenseType = 'yearly';
      }
      
      return {
        customerEmail: customer.email,
        customerName: customer.name,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        licenseType: licenseType
      };
      
    } catch (error) {
      console.error('Error processing checkout session:', error);
      throw error;
    }
  }

  async handleInvoicePaymentSucceeded(invoice) {
    try {
      console.log('Invoice payment succeeded:', invoice.id);
      
      // This ensures we handle recurring payments
      const subscription = await this.stripe.subscriptions.retrieve(invoice.subscription);
      const customer = await this.stripe.customers.retrieve(invoice.customer);
      
      return {
        customerEmail: customer.email,
        stripeCustomerId: customer.id,
        stripeSubscriptionId: subscription.id,
        stripeInvoiceId: invoice.id,
        amountPaid: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency
      };
      
    } catch (error) {
      console.error('Error processing invoice payment:', error);
      throw error;
    }
  }

  async handleSubscriptionUpdated(subscription) {
    try {
      console.log('Subscription updated:', subscription.id);
      
      // Handle subscription changes (upgrade/downgrade)
      if (subscription.status === 'active') {
        // Subscription is active
        return { subscriptionId: subscription.id, status: 'active' };
      } else if (subscription.status === 'past_due') {
        // Subscription payment failed
        return { subscriptionId: subscription.id, status: 'past_due' };
      }
      
    } catch (error) {
      console.error('Error processing subscription update:', error);
      throw error;
    }
  }

  async handleSubscriptionDeleted(subscription) {
    try {
      console.log('Subscription deleted:', subscription.id);
      
      // Mark license as inactive in database
      return { subscriptionId: subscription.id, status: 'cancelled' };
      
    } catch (error) {
      console.error('Error processing subscription deletion:', error);
      throw error;
    }
  }
}

export default StripeService;