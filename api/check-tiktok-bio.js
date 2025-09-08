// TikTok Bio Verification Script für Vercel
// api/check-tiktok-bio.js

export default async function handler(req, res) {
  // CORS Headers für FlutterFlow
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { username, code } = req.body;
    
    // Input validation
    if (!username || !code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username and code required' 
      });
    }

    // Clean username (remove @)
    const cleanUsername = username.replace('@', '').trim();
    
    console.log(`Checking TikTok bio for @${cleanUsername} with code: ${code}`);

    // Check TikTok bio
    const bioContainsCode = await checkTikTokBio(cleanUsername, code);
    
    return res.status(200).json({
      success: true,
      found: bioContainsCode,
      username: cleanUsername,
      code: code,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Bio check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}

// Main bio checking function
async function checkTikTokBio(username, code) {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${maxRetries} for @${username}`);
      
      const bioText = await scrapeTikTokBio(username);
      
      if (bioText) {
        const found = bioText.toLowerCase().includes(code.toLowerCase());
        console.log(`Bio text found: "${bioText.substring(0, 100)}..."`);
        console.log(`Code "${code}" ${found ? 'FOUND' : 'NOT FOUND'} in bio`);
        return found;
      }
      
      // Wait before retry
      if (attempt < maxRetries) {
        await sleep(2000 * attempt); // Exponential backoff
      }
      
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      await sleep(1000 * attempt);
    }
  }
  
  return false;
}

// Scrape TikTok profile bio
async function scrapeTikTokBio(username) {
  const url = `https://www.tiktok.com/@${username}`;
  
  // Realistic browser headers
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
    'DNT': '1'
  };

  console.log(`Fetching: ${url}`);
  
  const response = await fetch(url, { 
    headers,
    method: 'GET'
  });

  console.log(`Response status: ${response.status}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`TikTok user @${username} not found`);
    } else if (response.status === 403) {
      throw new Error('TikTok blocked request (403 Forbidden)');
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  }

  const html = await response.text();
  console.log(`HTML length: ${html.length} characters`);
  
  // Extract bio using multiple patterns
  const bioText = extractBioFromHtml(html);
  
  return bioText;
}

// Extract bio text from HTML using multiple patterns
function extractBioFromHtml(html) {
  // Pattern 1: JSON-LD structured data
  const jsonLdPattern = /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs;
  let match = jsonLdPattern.exec(html);
  
  if (match) {
    try {
      const jsonData = JSON.parse(match[1]);
      if (jsonData.description) {
        console.log('Bio found via JSON-LD');
        return jsonData.description;
      }
    } catch (e) {
      console.log('JSON-LD parsing failed');
    }
  }

  // Pattern 2: Meta description
  const metaDescPattern = /<meta\s+name="description"\s+content="([^"]*)"[^>]*>/i;
  match = metaDescPattern.exec(html);
  
  if (match && match[1]) {
    console.log('Bio found via meta description');
    return match[1];
  }

  // Pattern 3: SIGI_STATE (TikTok's state object)
  const sigiPattern = /window\['SIGI_STATE'\]\s*=\s*({.*?});/s;
  match = sigiPattern.exec(html);
  
  if (match) {
    try {
      const sigiState = JSON.parse(match[1]);
      // Navigate through SIGI_STATE to find user bio
      const userDetails = findUserInSigiState(sigiState);
      if (userDetails && userDetails.signature) {
        console.log('Bio found via SIGI_STATE');
        return userDetails.signature;
      }
    } catch (e) {
      console.log('SIGI_STATE parsing failed');
    }
  }

  // Pattern 4: Direct bio element (less reliable)
  const bioElementPattern = /<div[^>]*data-e2e="user-bio"[^>]*>(.*?)<\/div>/s;
  match = bioElementPattern.exec(html);
  
  if (match && match[1]) {
    // Clean HTML tags
    const bioText = match[1].replace(/<[^>]*>/g, '').trim();
    if (bioText) {
      console.log('Bio found via bio element');
      return bioText;
    }
  }

  console.log('No bio pattern matched');
  return null;
}

// Find user data in TikTok's SIGI_STATE
function findUserInSigiState(sigiState) {
  try {
    // TikTok stores user data in various places in SIGI_STATE
    if (sigiState.UserModule && sigiState.UserModule.users) {
      const users = sigiState.UserModule.users;
      const userKeys = Object.keys(users);
      
      if (userKeys.length > 0) {
        return users[userKeys[0]];
      }
    }
    
    // Alternative path
    if (sigiState.UserPage && sigiState.UserPage.user) {
      return sigiState.UserPage.user;
    }
    
    return null;
  } catch (e) {
    console.log('Error navigating SIGI_STATE:', e.message);
    return null;
  }
}

// Helper function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
