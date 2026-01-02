import crypto from 'crypto';
import License from '../models/License.js';

class LicenseService {
  constructor() {
    this.chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  }

  generateLicenseKey(type = 'monthly', durationMonths = 1) {
    // Generate random key parts
    const generatePart = () => {
      let part = '';
      for (let i = 0; i < 4; i++) {
        part += this.chars.charAt(Math.floor(Math.random() * this.chars.length));
      }
      return part;
    };
    
    // Create base key
    let key = 'SORV-' + generatePart() + '-' + generatePart() + '-' + generatePart() + '-' + generatePart();
    
    // Add type prefix
    let prefix = 'MONTH';
    let actualDuration = durationMonths;
    
    if (type === 'yearly') {
      prefix = 'YEAR';
      actualDuration = 12;
    } else if (type === 'lifetime') {
      prefix = 'LIFE';
      actualDuration = 999;
    }
    
    const fullKey = prefix + '-' + key;
    
    return {
      key: fullKey,
      type: type,
      durationMonths: actualDuration
    };
  }

  async createLicenseForCustomer(customerEmail, customerName, type = 'monthly', stripeData = {}) {
    try {
      const keyData = this.generateLicenseKey(type, type === 'yearly' ? 12 : 1);
      
      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + keyData.durationMonths);
      
      const license = new License({
        licenseKey: keyData.key,
        licenseType: keyData.type,
        durationMonths: keyData.durationMonths,
        customerEmail: customerEmail,
        customerName: customerName,
        stripeCustomerId: stripeData.customerId,
        stripeSubscriptionId: stripeData.subscriptionId,
        stripePaymentIntentId: stripeData.paymentIntentId,
        stripeInvoiceId: stripeData.invoiceId,
        expiresAt: expiresAt,
        isActive: true
      });
      
      await license.save();
      
      return {
        success: true,
        license: license,
        key: keyData.key
      };
      
    } catch (error) {
      console.error('Error creating license:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async validateLicenseKey(licenseKey, deviceId = null, deviceName = null) {
    try {
      const license = await License.findOne({ 
        licenseKey: licenseKey,
        isActive: true 
      });
      
      if (!license) {
        return {
          valid: false,
          error: 'License key not found or inactive'
        };
      }
      
      // Check if license has expired
      if (new Date() > new Date(license.expiresAt)) {
        license.isActive = false;
        await license.save();
        
        return {
          valid: false,
          error: 'License has expired',
          expired: true
        };
      }
      
      // Check if already activated on another device (for single device licenses)
      if (license.deviceId && license.deviceId !== deviceId && deviceId) {
        return {
          valid: false,
          error: 'License already activated on another device',
          alreadyActivated: true
        };
      }
      
      // Update license with device info if not already set
      if (deviceId && !license.deviceId) {
        license.deviceId = deviceId;
        license.deviceName = deviceName || 'Unknown Device';
        license.activatedAt = new Date();
      }
      
      license.lastValidated = new Date();
      license.validationCount = (license.validationCount || 0) + 1;
      await license.save();
      
      // Calculate days left
      const now = new Date();
      const expiresAt = new Date(license.expiresAt);
      const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      
      return {
        valid: true,
        license: {
          key: license.licenseKey,
          type: license.licenseType,
          expiresAt: license.expiresAt,
          daysLeft: daysLeft,
          customerEmail: license.customerEmail,
          customerName: license.customerName
        }
      };
      
    } catch (error) {
      console.error('Error validating license:', error);
      return {
        valid: false,
        error: 'Server error validating license'
      };
    }
  }

  async getDeviceLicense(deviceId) {
    try {
      const license = await License.findOne({ 
        deviceId: deviceId,
        isActive: true 
      });
      
      if (!license) {
        return { hasLicense: false };
      }
      
      // Check if license has expired
      if (new Date() > new Date(license.expiresAt)) {
        license.isActive = false;
        await license.save();
        return { hasLicense: false };
      }
      
      // Calculate days left
      const now = new Date();
      const expiresAt = new Date(license.expiresAt);
      const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
      
      return {
        hasLicense: true,
        license: {
          key: license.licenseKey,
          type: license.licenseType,
          expiresAt: license.expiresAt,
          daysLeft: daysLeft,
          customerEmail: license.customerEmail,
          customerName: license.customerName
        }
      };
      
    } catch (error) {
      console.error('Error getting device license:', error);
      return { hasLicense: false };
    }
  }

  async deactivateLicense(licenseKey) {
    try {
      const license = await License.findOne({ licenseKey: licenseKey });
      
      if (!license) {
        return { success: false, error: 'License not found' };
      }
      
      license.isActive = false;
      license.deviceId = null;
      license.deviceName = null;
      await license.save();
      
      return { success: true };
      
    } catch (error) {
      console.error('Error deactivating license:', error);
      return { success: false, error: error.message };
    }
  }
}

export default LicenseService;