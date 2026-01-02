// generate-keys.mjs - ES Module version
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory (ES modules don't have __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class LicenseKeyGenerator {
  constructor() {
    this.chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  }
  
  generateKey(type = 'monthly', durationMonths = 1, customerEmail = null, notes = '') {
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
      actualDuration = 999; // Lifetime
    }
    
    const fullKey = prefix + '-' + key;
    
    // Calculate expiration date
    const createdAt = new Date();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + actualDuration);
    
    return {
      key: fullKey,
      type: type,
      durationMonths: actualDuration,
      customerEmail: customerEmail,
      notes: notes,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      isActive: true,
      usedByDeviceId: null, // Will be set when activated
      activatedAt: null
    };
  }
  
  generateBatch(count, type = 'monthly', durationMonths = 1) {
    const keys = [];
    for (let i = 0; i < count; i++) {
      keys.push(this.generateKey(type, durationMonths));
    }
    return keys;
  }
  
  async saveToFile(keys, filename = 'generated-keys.json') {
    const filePath = path.join(__dirname, filename);
    const data = {
      generatedAt: new Date().toISOString(),
      count: keys.length,
      keys: keys
    };
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Saved ${keys.length} keys to ${filePath}`);
    
    // Also save as CSV for easy copying
    const csvPath = path.join(__dirname, 'generated-keys.csv');
    let csvContent = 'Key,Type,Duration (Months),Expires At,Notes\n';
    keys.forEach(key => {
      csvContent += `"${key.key}",${key.type},${key.durationMonths},"${key.expiresAt}","${key.notes || ''}"\n`;
    });
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`✅ Saved CSV to ${csvPath}`);
    
    return { jsonPath: filePath, csvPath: csvPath };
  }
  
  displayKeys(keys) {
    console.log('\n🎉 === GENERATED LICENSE KEYS === 🎉\n');
    keys.forEach((key, index) => {
      console.log(`${index + 1}. ${key.key}`);
      console.log(`   📝 Type: ${key.type.toUpperCase()}`);
      console.log(`   ⏱️  Duration: ${key.durationMonths} month(s)`);
      console.log(`   📅 Expires: ${new Date(key.expiresAt).toLocaleDateString()}`);
      if (key.customerEmail) console.log(`   📧 Customer: ${key.customerEmail}`);
      if (key.notes) console.log(`   📋 Notes: ${key.notes}`);
      console.log('');
    });
    console.log(`✅ Total: ${keys.length} keys generated\n`);
    
    // Show copy instructions
    if (keys.length === 1) {
      console.log('📋 To copy the key to clipboard:');
      console.log(`   pbcopy <<< '${keys[0].key}'`);
      console.log('');
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const generator = new LicenseKeyGenerator();
  
  if (args.length === 0) {
    console.log(`
🔑 License Key Generator for Sorvide 🔑

Usage:
  node generate-keys.mjs [options]

Options:
  --count=N           Number of keys to generate (default: 1)
  --type=TYPE         License type: monthly, yearly, lifetime (default: monthly)
  --duration=N        Duration in months (default: 1 for monthly, 12 for yearly)
  --email=EMAIL       Customer email address
  --notes="NOTES"     Notes about this license
  --save-to-file      Save to JSON/CSV file (default: true)
  --no-save           Don't save to file
  --show              Display generated keys (default: true)

Examples:
  node generate-keys.mjs --count=5 --type=monthly
  node generate-keys.mjs --type=lifetime --email="winner@example.com" --notes="Giveaway prize"
  node generate-keys.mjs --count=10 --type=yearly --no-save
    `);
    return;
  }
  
  // Parse arguments
  const options = {
    count: 1,
    type: 'monthly',
    duration: null,
    email: null,
    notes: '',
    saveToFile: !args.includes('--no-save'),
    show: !args.includes('--no-show')
  };
  
  args.forEach(arg => {
    if (arg.startsWith('--count=')) {
      options.count = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--type=')) {
      options.type = arg.split('=')[1];
    } else if (arg.startsWith('--duration=')) {
      options.duration = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--email=')) {
      options.email = arg.split('=')[1];
    } else if (arg.startsWith('--notes=')) {
      options.notes = arg.split('=')[1].replace(/"/g, '');
    }
  });
  
  // Set default duration based on type
  if (!options.duration) {
    if (options.type === 'yearly') {
      options.duration = 12;
    } else if (options.type === 'lifetime') {
      options.duration = 999;
    } else {
      options.duration = 1;
    }
  }
  
  // Generate keys
  console.log(`⚙️  Generating ${options.count} ${options.type} license key(s)...\n`);
  const keys = [];
  
  for (let i = 0; i < options.count; i++) {
    const key = generator.generateKey(
      options.type,
      options.duration,
      options.email,
      options.notes
    );
    keys.push(key);
  }
  
  // Save to file if requested
  if (options.saveToFile) {
    try {
      const filePaths = await generator.saveToFile(keys);
      console.log(`📁 Files created:`);
      console.log(`   📄 JSON: ${filePaths.jsonPath}`);
      console.log(`   📊 CSV: ${filePaths.csvPath}\n`);
    } catch (error) {
      console.error(`❌ Failed to save files:`, error.message);
    }
  }
  
  // Display keys
  if (options.show) {
    generator.displayKeys(keys);
    
    // Also show how to use them
    console.log('🚀 === HOW TO DISTRIBUTE KEYS ===');
    console.log('1. Send the key to the customer');
    console.log('2. Customer activates it in the Sorvide extension');
    console.log('3. System will validate against database\n');
    
    if (keys.length > 0) {
      console.log('📋 Sample activation instructions:');
      console.log('-------------------------------------');
      console.log('1. Open Sorvide Chrome extension');
      console.log('2. Click "Activate Pro" in bottom status bar');
      console.log('3. Enter license key:');
      console.log(`\n   ${keys[0].key}\n`);
      console.log('4. Click "Activate License"');
      console.log('-------------------------------------\n');
    }
  }
  
  return keys;
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}

export default LicenseKeyGenerator;