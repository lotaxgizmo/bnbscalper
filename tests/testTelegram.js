// testTelegram.js
// Test file for Telegram notifications
// Note: Messages will be sent to ALL chat IDs configured in telegramConfig.js

import telegramNotifier from '../utils/telegramNotifier.js';

async function testTelegramNotifications() {
    console.log('Testing Telegram notifications...');
    
    // Test cascade notification
    const testCascade = {
        signal: 'long',
        strength: 0.75,
        price: 45678.50,
        time: Date.now()
    };
    
    await telegramNotifier.notifyCascadeConfirmed(testCascade);
    console.log('Sent cascade notification');
    
    // Test trade open notification
    const testTradeOpen = {
        id: 1,
        direction: 'long',
        entryTime: Date.now(),
        entryPrice: 45678.50,
        positionSize: 10000,
        leverage: 10,
        stopLossPrice: 45500.00,
        takeProfitPrice: 46000.00
    };
    
    await telegramNotifier.notifyTradeOpened(testTradeOpen);
    console.log('Sent trade open notification');
    
    // Test trade close notification
    const testTradeClose = {
        id: 1,
        direction: 'long',
        entryTime: Date.now() - 3600000, // 1 hour ago
        entryPrice: 45678.50,
        exitTime: Date.now(),
        exitPrice: 46000.00,
        pnl: 1321.50,
        pnlPercent: 13.21,
        exitReason: 'take_profit',
        finalCapital: 111321.50
    };
    
    await telegramNotifier.notifyTradeClosed(testTradeClose);
    console.log('Sent trade close notification');
    
    // Test trading summary
    const testTradingStats = {
        totalTrades: 1000,
        winningTrades: 700,
        losingTrades: 300,
        initialCapital: 100000,
        totalPnL: 13215.50,
        finalCapital: 113215.50,
        winRate: 70,
        totalReturn: 13.21
    };
    
    await telegramNotifier.sendTradingSummary(testTradingStats);
    console.log('Sent trading summary');
    
    console.log('All test notifications sent. Check your Telegram!');
}

testTelegramNotifications().catch(error => {
    console.error('Error testing Telegram notifications:', error);
});
