// telegramConfig.js
// Configuration for Telegram notifications

export const telegramConfig = {
    // Telegram Bot API credentials
    token: '8336501364:AAFSK0ULulR-NHopqh_WnP3jhI6tg2Ait3E',
    chatIds: ['1228994409', '797562272' ], // Array of chat IDs - add more IDs here: ['1228994409', '987654321', '123456789']
    // chatIds: ['1228994409', '7209568450', '797562272' ], // Array of chat IDs - add more IDs here: ['1228994409', '987654321', '123456789']
    
    // Notification settings
    notifications: {
        //  Trade notifications
        tradeOpen: true,           // Notify when a trade is opened
        tradeClose: true,          // Notify when a trade is closed
        tradeSummary: true,        // Send trade summary at the end
        
        // Cascade notifications
        primarySignal: false,      // Notify on primary timeframe signals
        cascadeConfirmed: true,    // Notify when a cascade is confirmed
        cascadeFailed: false,      // Notify when a cascade fails
        
        // Performance notifications
        dailySummary: false,       // Send daily performance summary
        finalSummary: true         // Send final performance summary
    },
    
    // Message formatting
    formatting: {
        includeEmojis: true,       // Include emojis in messages
        includeTimestamp: true,    // Include timestamps in messages
        includePrice: true,        // Include price information
        includePnL: true           // Include profit/loss information
    }
};

// Validate Telegram configuration
export function validateTelegramConfig() {
    if (!telegramConfig.token || telegramConfig.token === '') {
        console.error('Error: Telegram bot token is missing in telegramConfig.js');
        return false;
    }
    
    if (!telegramConfig.chatIds || !Array.isArray(telegramConfig.chatIds) || telegramConfig.chatIds.length === 0) {
        console.error('Error: Telegram chat IDs array is missing or empty in telegramConfig.js');
        return false;
    }
    
    // Validate each chat ID
    for (const chatId of telegramConfig.chatIds) {
        if (!chatId || chatId === '') {
            console.error('Error: Empty chat ID found in telegramConfig.js chatIds array');
            return false;
        }
    }
    
    return true;
}
