// routes/admin.js - Admin routes for license management
const express = require('express');
const router = express.Router();
const LicenseKeyGenerator = require('../utils/generate-keys');
const License = require('../models/License');
const authMiddleware = require('../middleware/auth');

// Admin middleware (add your own authentication)
const adminAuth = (req, res, next) => {
  // Simple admin check - in production, use proper authentication
  const adminToken = req.headers['x-admin-token'];
  if (adminToken === process.env.ADMIN_TOKEN) {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};

// Generate license keys (admin only)
router.post('/generate-keys', adminAuth, async (req, res) => {
  try {
    const { count = 1, type = 'monthly', duration, customerEmail, notes } = req.body;
    
    const generator = new LicenseKeyGenerator();
    const keys = [];
    
    for (let i = 0; i < count; i++) {
      const keyData = generator.generateKey(type, duration || (type === 'yearly' ? 12 : 1), customerEmail, notes);
      
      // Save to database
      const license = new License({
        licenseKey: keyData.key,
        licenseType: keyData.type,
        durationMonths: keyData.durationMonths,
        customerEmail: keyData.customerEmail,
        notes: keyData.notes,
        createdAt: new Date(),
        expiresAt: new Date(keyData.expiresAt),
        isActive: true,
        isManual: true, // Flag as manually generated
        generatedBy: 'admin'
      });
      
      await license.save();
      keys.push({
        key: keyData.key,
        type: keyData.type,
        duration: keyData.durationMonths,
        expiresAt: keyData.expiresAt,
        customerEmail: keyData.customerEmail,
        notes: keyData.notes
      });
    }
    
    res.json({
      success: true,
      message: `Generated ${keys.length} license keys`,
      keys: keys
    });
    
  } catch (error) {
    console.error('Error generating keys:', error);
    res.status(500).json({ error: 'Failed to generate license keys' });
  }
});

// List all licenses (admin only)
router.get('/licenses', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, type, active } = req.query;
    const skip = (page - 1) * limit;
    
    const query = {};
    if (type) query.licenseType = type;
    if (active !== undefined) query.isActive = active === 'true';
    
    const licenses = await License.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await License.countDocuments(query);
    
    res.json({
      success: true,
      licenses: licenses,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Error fetching licenses:', error);
    res.status(500).json({ error: 'Failed to fetch licenses' });
  }
});

// Get license details (admin only)
router.get('/licenses/:key', adminAuth, async (req, res) => {
  try {
    const license = await License.findOne({ licenseKey: req.params.key });
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    res.json({
      success: true,
      license: license
    });
    
  } catch (error) {
    console.error('Error fetching license:', error);
    res.status(500).json({ error: 'Failed to fetch license' });
  }
});

// Update license (admin only)
router.put('/licenses/:key', adminAuth, async (req, res) => {
  try {
    const { isActive, expiresAt, notes, customerEmail } = req.body;
    
    const updates = {};
    if (isActive !== undefined) updates.isActive = isActive;
    if (expiresAt) updates.expiresAt = new Date(expiresAt);
    if (notes !== undefined) updates.notes = notes;
    if (customerEmail !== undefined) updates.customerEmail = customerEmail;
    
    const license = await License.findOneAndUpdate(
      { licenseKey: req.params.key },
      { $set: updates },
      { new: true }
    );
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    res.json({
      success: true,
      message: 'License updated successfully',
      license: license
    });
    
  } catch (error) {
    console.error('Error updating license:', error);
    res.status(500).json({ error: 'Failed to update license' });
  }
});

// Delete/revoke license (admin only)
router.delete('/licenses/:key', adminAuth, async (req, res) => {
  try {
    const license = await License.findOneAndDelete({ licenseKey: req.params.key });
    
    if (!license) {
      return res.status(404).json({ error: 'License not found' });
    }
    
    res.json({
      success: true,
      message: 'License deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting license:', error);
    res.status(500).json({ error: 'Failed to delete license' });
  }
});

// Simple web interface for generating keys
router.get('/admin/generate', adminAuth, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Generate License Keys - Sorvide Admin</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input, select, textarea { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background: #4a4fd8; color: white; border: none; padding: 10px 20px; cursor: pointer; }
        .result { margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px; }
        .key { font-family: monospace; background: white; padding: 10px; margin: 5px 0; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <h1>Generate Sorvide License Keys</h1>
      <form id="generateForm">
        <div class="form-group">
          <label>Number of Keys:</label>
          <input type="number" name="count" value="1" min="1" max="100">
        </div>
        <div class="form-group">
          <label>License Type:</label>
          <select name="type">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="lifetime">Lifetime</option>
          </select>
        </div>
        <div class="form-group">
          <label>Customer Email (optional):</label>
          <input type="email" name="customerEmail" placeholder="customer@example.com">
        </div>
        <div class="form-group">
          <label>Notes (optional):</label>
          <textarea name="notes" rows="3" placeholder="Giveaway, Promo, etc."></textarea>
        </div>
        <button type="submit">Generate Keys</button>
      </form>
      <div id="result" class="result" style="display: none;"></div>
      
      <script>
        document.getElementById('generateForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());
          
          const response = await fetch('/api/admin/generate-keys', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Token': '${process.env.ADMIN_TOKEN}' // This should be set server-side
            },
            body: JSON.stringify(data)
          });
          
          const result = await response.json();
          const resultDiv = document.getElementById('result');
          
          if (result.success) {
            let html = '<h3>Generated Keys:</h3>';
            result.keys.forEach(key => {
              html += \`
                <div class="key">
                  <strong>\${key.key}</strong><br>
                  Type: \${key.type} | Duration: \${key.duration} month(s)<br>
                  \${key.customerEmail ? 'Customer: ' + key.customerEmail + '<br>' : ''}
                  \${key.notes ? 'Notes: ' + key.notes + '<br>' : ''}
                  Expires: \${new Date(key.expiresAt).toLocaleDateString()}
                </div>
              \`;
            });
            html += \`<p><strong>Total: \${result.keys.length} keys generated</strong></p>\`;
            resultDiv.innerHTML = html;
            resultDiv.style.display = 'block';
            
            // Copy to clipboard functionality
            const keysText = result.keys.map(k => k.key).join('\\n');
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy All Keys to Clipboard';
            copyBtn.onclick = () => {
              navigator.clipboard.writeText(keysText).then(() => {
                alert('Keys copied to clipboard!');
              });
            };
            resultDiv.appendChild(copyBtn);
            
          } else {
            resultDiv.innerHTML = '<p style="color: red;">Error: ' + result.error + '</p>';
            resultDiv.style.display = 'block';
          }
        });
      </script>
    </body>
    </html>
  `);
});

module.exports = router;