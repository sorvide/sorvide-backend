import Mailgun from 'mailgun.js';
import formData from 'form-data';

class EmailService {
  constructor() {
    this.mailgun = new Mailgun(formData);
    this.client = this.mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY
    });
    this.domain = process.env.MAILGUN_DOMAIN || 'email.sorvide.com';
    this.fromEmail = process.env.FROM_EMAIL || 'postmaster@email.sorvide.com';
  }

  async sendLicenseEmail(customerEmail, customerName, licenseKey, licenseType) {
    try {
      const subject = `Your Sorvide Pro License Key`;
      const duration = licenseType === 'yearly' ? '1 year' : licenseType === 'lifetime' ? 'Lifetime' : '1 month';
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Your Sorvide Pro License</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #4a4fd8, #2a2d7d); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
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
            <p>Your ${duration} subscription is now active</p>
          </div>
          
          <div class="content">
            <p>Hi ${customerName || 'there'},</p>
            
            <p>Thank you for subscribing to Sorvide Pro! Your license key is ready to use.</p>
            
            <div class="license-box">
              ${licenseKey}
            </div>
            
            <p><strong>License Type:</strong> ${licenseType.charAt(0).toUpperCase() + licenseType.slice(1)} Subscription</p>
            <p><strong>Duration:</strong> ${duration}</p>
            
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
      `;
      
      const text = `
Welcome to Sorvide Pro!

Hi ${customerName || 'there'},

Thank you for subscribing to Sorvide Pro! Your license key is ready to use.

License Key: ${licenseKey}
License Type: ${licenseType.charAt(0).toUpperCase() + licenseType.slice(1)} Subscription
Duration: ${duration}

How to Activate:
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" in the bottom status bar
3. Enter your license key: ${licenseKey}
4. Click "Activate License" and enjoy Pro features!

Need Help?
If you have any issues activating your license, please reply to this email.

Best regards,
The Sorvide Team
      `;
      
      const messageData = {
        from: `Sorvide AI <${this.fromEmail}>`,
        to: customerEmail,
        subject: subject,
        text: text,
        html: html
      };
      
      const response = await this.client.messages.create(this.domain, messageData);
      console.log('License email sent:', response.id);
      
      return { success: true, messageId: response.id };
      
    } catch (error) {
      console.error('Error sending license email:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeEmail(customerEmail, customerName) {
    try {
      const subject = `Welcome to Sorvide AI!`;
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Welcome to Sorvide</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #4a4fd8, #2a2d7d); color: white; padding: 30px; text-align: center; border-radius: 10px;">
                <h1>Welcome to Sorvide AI! 🎉</h1>
            </div>
            
            <div style="background: #f8f9ff; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0;">
                <p>Hi ${customerName || 'there'},</p>
                
                <p>Thank you for joining Sorvide AI! We're excited to help you with your research.</p>
                
                <p>With your free account, you get:</p>
                <ul>
                    <li>5 daily AI summaries</li>
                    <li>Free citation generation</li>
                    <li>Text highlighting and capture</li>
                    <li>Research library</li>
                </ul>
                
                <p>Ready for more? Upgrade to Sorvide Pro for unlimited summaries, plagiarism checks, AI insights, and export features!</p>
                
                <p>If you have any questions, just reply to this email.</p>
                
                <p>Happy researching!<br>The Sorvide Team</p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px;">
                <p>© ${new Date().getFullYear()} Sorvide AI. All rights reserved.</p>
            </div>
        </body>
        </html>
      `;
      
      const messageData = {
        from: `Sorvide AI <${this.fromEmail}>`,
        to: customerEmail,
        subject: subject,
        html: html
      };
      
      await this.client.messages.create(this.domain, messageData);
      console.log('Welcome email sent to:', customerEmail);
      
      return { success: true };
      
    } catch (error) {
      console.error('Error sending welcome email:', error);
      return { success: false, error: error.message };
    }
  }
}

export default EmailService;