import { signedRequest } from './bybitClient.js';

async function getPositionInfo() {
  try {
    const res = await signedRequest('/v5/position/list', 'GET', { 
      category: 'linear',
      settleCoin: 'USDT'
    });
    
    if (res.retCode !== 0) {
      throw new Error(`Position API Error: ${res.retMsg}`);
    }
    
    return res.result.list || [];
  } catch (error) {
    console.error('❌ Position API Error:', error.message);
    return [];
  }
}

async function getAccountInfo() {
  try {
    const res = await signedRequest('/v5/account/info', 'GET');
    
    if (res.retCode !== 0) {
      throw new Error(`Account Info API Error: ${res.retMsg}`);
    }
    
    return res.result;
  } catch (error) {
    console.error('❌ Account Info API Error:', error.message);
    return null;
  }
}

async function getAccountBalance() {
  try {
    console.log('🔍 Fetching account balance...');
    
    const res = await signedRequest('/v5/account/wallet-balance', 'GET', { 
      accountType: 'UNIFIED'
    });
    
    console.log('📡 Raw API Response:', JSON.stringify(res, null, 2));
    
    // Handle different response structures
    if (res.retCode !== 0) {
      throw new Error(`API Error: ${res.retMsg} (Code: ${res.retCode})`);
    }
    
    if (!res.result || !res.result.list) {
      throw new Error('No account data in response');
    }
    
    if (res.result.list.length === 0) {
      throw new Error('No accounts found in response');
    }
    
    const account = res.result.list[0];
    console.log('🏦 Account structure:', JSON.stringify(account, null, 2));
    
    const usdtCoin = account.coin.find(coin => coin.coin === 'USDT');
    
    if (!usdtCoin) {
      console.log('💰 Available coins:', account.coin.map(c => c.coin));
      throw new Error('USDT coin not found in account');
    }
    
    console.log('💵 USDT Coin Data:', JSON.stringify(usdtCoin, null, 2));
    
    // Calculate available balance for new positions
    // Available = Equity - Initial Margin (used for existing positions)
    const equity = parseFloat(usdtCoin.equity || usdtCoin.walletBalance);
    const totalPositionIM = parseFloat(usdtCoin.totalPositionIM || 0);
    const totalOrderIM = parseFloat(usdtCoin.totalOrderIM || 0);
    const calculatedAvailable = equity - totalPositionIM - totalOrderIM;
    
    // Use totalAvailableBalance if provided, otherwise calculate
    const totalAvailable = account.totalAvailableBalance ? 
      parseFloat(account.totalAvailableBalance) : calculatedAvailable;
    
    const balance = {
      // Account level data
      totalEquity: parseFloat(account.totalEquity || 0),
      totalWalletBalance: parseFloat(account.totalWalletBalance || 0),
      totalPerpUPL: parseFloat(account.totalPerpUPL || 0),
      totalAvailableBalance: totalAvailable,
      calculatedAvailable: calculatedAvailable,
      
      // USDT specific data
      walletBalance: parseFloat(usdtCoin.walletBalance),
      equity: equity,
      unrealisedPnl: parseFloat(usdtCoin.unrealisedPnl || 0),
      totalPositionIM: totalPositionIM,
      totalOrderIM: totalOrderIM,
      totalPositionMM: parseFloat(usdtCoin.totalPositionMM || 0),
      cumRealisedPnl: parseFloat(usdtCoin.cumRealisedPnl || 0),
      locked: parseFloat(usdtCoin.locked || 0),
      
      // For trading
      availableBalance: Math.max(totalAvailable, calculatedAvailable, 0)
    };
    
    return balance;
  } catch (error) {
    console.error('❌ Balance API Error:', error.message);
    throw error;
  }
}

async function displayBalance() {
  try {
    console.log('🔄 Fetching comprehensive account data...');
    const [balance, positions, accountInfo] = await Promise.all([
      getAccountBalance(),
      getPositionInfo(),
      getAccountInfo()
    ]);
    
    console.log('\n' + '='.repeat(70));
    console.log('💰 COMPREHENSIVE ACCOUNT BALANCE ANALYSIS');
    console.log('='.repeat(70));
    
    // Account Level Summary
    console.log('🏛️  ACCOUNT LEVEL (Cross Margin):');
    console.log(`   Total Equity:           ${balance.totalEquity.toFixed(2)} USDT`);
    console.log(`   Total Wallet Balance:   ${balance.totalWalletBalance.toFixed(2)} USDT`);
    console.log(`   Total Unrealized P&L:   ${balance.totalPerpUPL.toFixed(2)} USDT`);
    console.log(`   Total Available:        ${balance.totalAvailableBalance.toFixed(2)} USDT`);
    console.log(`   Calculated Available:   ${balance.calculatedAvailable.toFixed(2)} USDT`);
    
    console.log('\n💵 USDT SPECIFIC DATA:');
    console.log(`   Wallet Balance:         ${balance.walletBalance.toFixed(2)} USDT`);
    console.log(`   Equity:                 ${balance.equity.toFixed(2)} USDT`);
    console.log(`   Unrealized P&L:         ${balance.unrealisedPnl.toFixed(2)} USDT`);
    console.log(`   Cumulative Realized:    ${balance.cumRealisedPnl.toFixed(2)} USDT`);
    console.log(`   Locked Amount:          ${balance.locked.toFixed(2)} USDT`);
    
    console.log('\n📊 MARGIN USAGE:');
    console.log(`   Position Initial Margin: ${balance.totalPositionIM.toFixed(2)} USDT`);
    console.log(`   Order Initial Margin:    ${balance.totalOrderIM.toFixed(2)} USDT`);
    console.log(`   Position Maintenance:    ${balance.totalPositionMM.toFixed(2)} USDT`);
    console.log(`   Total Margin Used:       ${(balance.totalPositionIM + balance.totalOrderIM).toFixed(2)} USDT`);
    
    console.log('\n🎯 TRADING CAPACITY:');
    console.log(`   Available for New Trades: ${balance.availableBalance.toFixed(2)} USDT`);
    const marginUtilization = ((balance.totalPositionIM + balance.totalOrderIM) / balance.equity * 100);
    console.log(`   Margin Utilization:       ${marginUtilization.toFixed(1)}%`);
    const freeMargin = balance.equity - balance.totalPositionIM - balance.totalOrderIM;
    console.log(`   Free Margin:              ${freeMargin.toFixed(2)} USDT`);
    
    // Show active positions details
    if (positions && positions.length > 0) {
      console.log('\n🔄 ACTIVE POSITIONS:');
      console.log('-'.repeat(70));
      let totalPositionValue = 0;
      let totalUnrealizedPnl = 0;
      
      positions.forEach((pos, index) => {
        if (parseFloat(pos.size) !== 0) {
          const posValue = parseFloat(pos.positionValue || 0);
          const unrealizedPnl = parseFloat(pos.unrealisedPnl || 0);
          const markPrice = parseFloat(pos.markPrice || 0);
          const avgPrice = parseFloat(pos.avgPrice || 0);
          const leverage = parseFloat(pos.leverage || 0);
          const positionIM = parseFloat(pos.positionIM || 0);
          
          totalPositionValue += posValue;
          totalUnrealizedPnl += unrealizedPnl;
          
          console.log(`   Position ${index + 1}: ${pos.symbol}`);
          console.log(`      Side: ${pos.side} | Size: ${pos.size}`);
          console.log(`      Entry Price: $${avgPrice.toFixed(2)} | Mark Price: $${markPrice.toFixed(2)}`);
          console.log(`      Position Value: ${posValue.toFixed(2)} USDT | Leverage: ${leverage}x`);
          console.log(`      Margin Used: ${positionIM.toFixed(2)} USDT`);
          console.log(`      Unrealized P&L: ${unrealizedPnl.toFixed(2)} USDT`);
          console.log('');
        }
      });
      
      console.log(`   📊 Total Position Value: ${totalPositionValue.toFixed(2)} USDT`);
      console.log(`   📈 Total Unrealized P&L: ${totalUnrealizedPnl.toFixed(2)} USDT`);
      console.log('-'.repeat(70));
    }
    
    // Account info details
    if (accountInfo) {
      console.log('\n🏦 ACCOUNT DETAILS:');
      console.log(`   Account Type: ${accountInfo.unifiedMarginStatus || 'UNIFIED'}`);
      console.log(`   Margin Mode: ${accountInfo.marginMode || 'CROSS_MARGIN'}`);
      if (accountInfo.dcpStatus) {
        console.log(`   DCP Status: ${accountInfo.dcpStatus}`);
      }
    }
    
    console.log('='.repeat(70));
    
    // Calculate potential position sizes at different leverages
    console.log('\n📈 POTENTIAL POSITION SIZES (New Trades):');
    console.log('-'.repeat(50));
    const leverages = [1, 2, 5, 10, 20, 50, 100];
    leverages.forEach(lev => {
      const positionSize = balance.availableBalance * lev;
      const marginRequired = positionSize / lev;
      console.log(`${lev.toString().padStart(3)}x leverage: ${positionSize.toFixed(2).padStart(12)} USDT position (margin: ${marginRequired.toFixed(2)} USDT)`);
    });
    console.log('-'.repeat(50));
    
    // Risk analysis
    console.log('\n⚠️  RISK ANALYSIS:');
    if (balance.totalPositionIM > 0) {
      console.log(`   🔴 You have open positions using ${balance.totalPositionIM.toFixed(2)} USDT margin`);
      console.log(`   📉 Current unrealized P&L: ${balance.unrealisedPnl.toFixed(2)} USDT`);
    } else {
      console.log(`   ✅ No open positions - full balance available`);
    }
    
    if (marginUtilization > 80) {
      console.log(`   🚨 HIGH MARGIN USAGE: ${marginUtilization.toFixed(1)}% - Consider reducing positions`);
    } else if (marginUtilization > 50) {
      console.log(`   ⚠️  MODERATE MARGIN USAGE: ${marginUtilization.toFixed(1)}% - Monitor closely`);
    } else {
      console.log(`   ✅ SAFE MARGIN USAGE: ${marginUtilization.toFixed(1)}%`);
    }
    
    console.log('\n' + '='.repeat(70));
    
  } catch (error) {
    console.error('❌ Error displaying balance:', error);
  }
}

// Run the balance check
displayBalance().catch(error => {
  console.error('❌ Main error:', error);
  process.exit(1);
});
