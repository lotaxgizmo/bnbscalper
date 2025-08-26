import { signedRequest } from './bybitClient.js';

async function testBalance() {
  try {
    console.log('Testing balance API...');
    
    // Test CONTRACT account type
    const contractRes = await signedRequest('/v5/account/wallet-balance', 'GET', { 
      accountType: 'CONTRACT'
    });
    console.log('CONTRACT Response:', JSON.stringify(contractRes, null, 2));
    
  } catch (error) {
    console.error('CONTRACT Error:', error.message);
    
    try {
      // Test UNIFIED account type
      const unifiedRes = await signedRequest('/v5/account/wallet-balance', 'GET', { 
        accountType: 'UNIFIED'
      });
      console.log('UNIFIED Response:', JSON.stringify(unifiedRes, null, 2));
      
    } catch (unifiedError) {
      console.error('UNIFIED Error:', unifiedError.message);
    }
  }
}

testBalance();
