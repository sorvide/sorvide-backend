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
    this.fromEmail = process.env.FROM_EMAIL || 'noreply@email.sorvide.com';
  }

  async sendLicenseEmail(customerEmail, customerName, licenseKey, licenseType = 'monthly') {
    try {
      const subject = `Your Sorvide Pro License Key`;
      const duration = '30 days (renews monthly)';
      const planName = 'Sorvide Pro Monthly';
      const price = '$9.99/month';
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Sorvide Pro License</title>
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
    
    .plan-details {
      background: #f8f9ff;
      border-radius: 12px;
      padding: 20px;
      margin: 24px 0;
    }
    
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .detail-row:last-child {
      border-bottom: none;
    }
    
    .detail-label {
      color: #4a5568;
      font-weight: 500;
    }
    
    .detail-value {
      color: #2d3748;
      font-weight: 600;
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
      background: #fff8f0;
      border: 1px solid #fed7aa;
      border-radius: 12px;
      padding: 20px;
      margin: 32px 0;
    }
    
    .support-title {
      color: #9c4221;
      font-weight: 700;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .support-note {
      color: #7b341e;
      font-size: 14px;
      margin-top: 8px;
      font-style: italic;
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
      <p class="greeting">Hi ${customerName || 'there'},</p>
      
      <p class="intro">Thank you for subscribing to <strong>Sorvide Pro Monthly</strong>! Your license key is ready and your Pro features are now unlocked.</p>
      
      <div class="license-box">
        ${licenseKey}
      </div>
      
      <div class="plan-details">
        <div class="detail-row">
          <span class="detail-label">Plan</span>
          <span class="detail-value">Sorvide Pro Monthly</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Price</span>
          <span class="detail-value">$9.99/month</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Duration</span>
          <span class="detail-value">30 days (auto-renews)</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Next billing</span>
          <span class="detail-value">In 30 days</span>
        </div>
      </div>
      
      <div class="steps-container">
        <h3 class="steps-title">How to Activate Pro Features:</h3>
        
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
      
      <div class="support-section">
        <h4 class="support-title">
          <span style="font-size: 18px;">❗</span> Need Help or Have Questions?
        </h4>
        <p>If you encounter any issues activating your license or have questions about your subscription:</p>
        <p><strong>📧 Contact our support team:</strong> <span class="highlight">support@sorvide.com</span></p>
        <p><strong>⏰ Response time:</strong> We typically respond within 24 hours</p>
        <p class="support-note">Please do not reply to this automated email. Use the support email above for assistance.</p>
      </div>
      
      <p style="margin-top: 24px; color: #4a5568;">
        <strong>Pro Features You Now Have Access To:</strong><br>
        • Unlimited AI summaries (vs. 5 daily free limit)<br>
        • Advanced plagiarism detection<br>
        • AI-powered research insights<br>
        • Export to PDF/Markdown<br>
        • Priority support<br>
        • And more!
      </p>
      
      <p style="margin-top: 24px; color: #4a5568;">
        Best regards,<br>
        <strong>The Sorvide Team</strong>
      </p>
    </div>
    
    <div class="footer">
      <p>© ${new Date().getFullYear()} Sorvide AI. All rights reserved.</p>
      <p>This email was sent to ${customerEmail}</p>
      <div class="contact-info">
        <p>Sorvide AI • support@sorvide.com</p>
        <p>This is an automated message, please do not reply directly.</p>
      </div>
    </div>
  </div>
</body>
</html>
      `;
      
      const text = `
WELCOME TO SORVIDE PRO!

Hi ${customerName || 'there'},

Thank you for subscribing to Sorvide Pro Monthly! Your license key is ready to use.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LICENSE KEY: ${licenseKey}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PLAN DETAILS:
• Plan: Sorvide Pro Monthly
• Price: $9.99/month
• Duration: 30 days (auto-renews)
• Next billing: In 30 days

HOW TO ACTIVATE:
1. Open the Sorvide Chrome extension
2. Click "Activate Pro" in the bottom status bar
3. Enter your license key: ${licenseKey}
4. Click "Activate License"

PRO FEATURES YOU NOW HAVE:
• Unlimited AI summaries (vs. 5 daily free limit)
• Advanced plagiarism detection
• AI-powered research insights
• Export to PDF/Markdown
• Priority support
• And more!

NEED HELP?
If you have any issues activating your license or questions about your subscription:
📧 Contact our support team: support@sorvide.com
⏰ Response time: Within 24 hours

Please do not reply to this automated email.

Best regards,
The Sorvide Team

© ${new Date().getFullYear()} Sorvide AI. All rights reserved.
This email was sent to ${customerEmail}
      `;
      
      const messageData = {
        from: `Sorvide Pro <${this.fromEmail}>`,
        to: customerEmail,
        subject: subject,
        text: text,
        html: html
      };
      
      const response = await this.client.messages.create(this.domain, messageData);
      console.log('✅ License email sent:', response.id);
      
      return { success: true, messageId: response.id };
      
    } catch (error) {
      console.error('❌ Error sending license email:', error);
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Sorvide</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      line-height: 1.6; 
      color: #333; 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px;
    }
    .header { 
      background: linear-gradient(135deg, #4a4fd8, #2a2d7d); 
      color: white; 
      padding: 40px 30px; 
      text-align: center; 
      border-radius: 12px 12px 0 0;
    }
    .content { 
      background: #f8f9ff; 
      padding: 30px; 
      border-radius: 0 0 12px 12px; 
      border: 1px solid #e2e8f0; 
    }
    .feature-list {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .cta {
      background: linear-gradient(135deg, #4a4fd8, #2a2d7d);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
      margin: 20px 0;
    }
    .footer { 
      text-align: center; 
      margin-top: 30px; 
      color: #6b7280; 
      font-size: 12px; 
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Welcome to Sorvide AI! 🎉</h1>
    <p>Your AI research assistant is ready</p>
  </div>
  
  <div class="content">
    <p>Hi ${customerName || 'there'},</p>
    
    <p>Thank you for joining Sorvide AI! We're excited to help you with your research and writing.</p>
    
    <div class="feature-list">
      <h3>✨ With your free account, you get:</h3>
      <ul style="line-height: 1.8;">
        <li><strong>5 daily AI summaries</strong> - Get concise summaries of any content</li>
        <li><strong>Free citation generation</strong> - APA & MLA formats</li>
        <li><strong>Text highlighting and capture</strong> - Save important passages</li>
        <li><strong>Research library</strong> - Organize all your saved content</li>
        <li><strong>Basic plagiarism checks</strong> - For peace of mind</li>
      </ul>
    </div>
    
    <div class="cta">
      <h3>🚀 Ready for Unlimited Power?</h3>
      <p>Upgrade to <strong>Sorvide Pro</strong> for just $9.99/month and get:</p>
      <p>• Unlimited AI summaries • Advanced plagiarism detection •<br>
         • AI research insights • Export to PDF/Markdown •<br>
         • Priority support • And much more!</p>
    </div>
    
    <p><strong>Need help?</strong> Our support team is here for you:<br>
    📧 <strong>support@sorvide.com</strong></p>
    
    <p>Happy researching!<br>
    <strong>The Sorvide Team</strong></p>
  </div>
  
  <div class="footer">
    <p>© ${new Date().getFullYear()} Sorvide AI. All rights reserved.</p>
    <p>This is an automated message, please do not reply directly.</p>
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
      console.log('✅ Welcome email sent to:', customerEmail);
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error sending welcome email:', error);
      return { success: false, error: error.message };
    }
  }
}

export default EmailService;