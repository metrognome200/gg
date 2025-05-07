const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const moment = require('moment');
const fs = require('fs').promises;
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static('public'));
const activeBots = new Map();
const runningScripts = new Map();
const userPayloads = new Map();
const userAuthorization = new Map();
const DICE_CONFIG = {
    url: "https://api-dice.goatsbot.xyz/dice/action",
    headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,fa;q=0.8",
        "authorization": "Bearer YOUR_AUTHORIZATION_TOKEN_HERE", 
        "content-type": "application/json",
        "origin": "https://dev.goatsbot.xyz",
        "referer": "https://dev.goatsbot.xyz/",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    },
    payloads: [
        {
            point_milestone: 99,
            is_upper: false,
            bet_amount: 0.025,
            currency: "ton"
        }
    ]
};
async function writeAnalysis(responseData) {
    const timestamp = moment().format("YYYY-MM-DD HH:mm:ss");
    const realBalanceTon = responseData.user.balance_ton;
    const realBalanceGoat = responseData.user.real_balance; // Assuming real_balance is in the response
    const isWin = responseData.dice.is_win;
    const analysisText = `[${timestamp}] Balance (TON): ${realBalanceTon.toFixed(10)} | Balance (GOAT): ${realBalanceGoat.toFixed(2)} | Win: ${isWin}\n`;
    await fs.appendFile("analysis.txt", analysisText);
}
async function runDiceScript(bot, chatId, scriptId) {
    let requestCounter = 0;
    let isRunning = true;
    runningScripts.set(scriptId, { isRunning });
    try {
        while (isRunning) {
            const payload = userPayloads.get(chatId) || DICE_CONFIG.payloads[0];
            const authcode = userAuthorization.get(chatId);
            const headers = {
                ...DICE_CONFIG.headers,
                ...(authcode ? { "authorization": authcode } : {})
            };
            const response = await axios.post(DICE_CONFIG.url, payload, { headers });
            const responseData = response.data;
            requestCounter++;
            if (requestCounter % 5 === 0) {
                const statusMessage = `Requests sent: ${requestCounter} \n Balance (TON): ${responseData.user.balance_ton.toFixed(11)} \n Balance (GOAT): ${responseData.user.real_balance.toFixed(2)} \n Win: ${responseData.dice.is_win}`;
                console.log(statusMessage);
                await bot.sendMessage(chatId, statusMessage);
            }
            await fs.appendFile("response.txt", JSON.stringify(response.data) + "\n");
            await writeAnalysis(responseData);
            const scriptState = runningScripts.get(scriptId);
            if (!scriptState || !scriptState.isRunning) {
                isRunning = false;
                break;
            }
        }
    } catch (error) {
        console.error("Error in dice script:", error);
        await bot.sendMessage(chatId, `Script stopped due to an error. Please try again later.`);
    } finally {
        runningScripts.delete(scriptId);
    }
}
function createBot(token) {
    const bot = new TelegramBot(token, { polling: true });
    const scriptId = `bot_${token}`;
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        await bot.sendMessage(chatId, 'Use\n/run to start the dice game script,\n/stop to stop the script,\n/setpayload to set a custom payload,\n/showpayload to see the current payload,\n/resetpayload to reset the payload to the default,\n/setauthcode "Bearer your_custom_token_here",\n/showauthcode to view the current authorization code,\n/resetauthcode to reset the authorization code.');
             })
    bot.onText(/\/run/, async (msg) => {
        const chatId = msg.chat.id;
        const scriptState = runningScripts.get(scriptId);
        if (scriptState && scriptState.isRunning) {
            await bot.sendMessage(chatId, 'Script is already running!');
            return;
        }
        await bot.sendMessage(chatId, 'Starting the dice game script...');
        await runDiceScript(bot, chatId, scriptId); 
    });
    bot.onText(/\/stop/, async (msg) => {
        const chatId = msg.chat.id;
        const scriptState = runningScripts.get(scriptId);
        if (scriptState && scriptState.isRunning) {
            scriptState.isRunning = false;
            await bot.sendMessage(chatId, 'Stopping the dice game script...');
        } else {
            await bot.sendMessage(chatId, 'No script is currently running.');
        }
    });
    bot.onText(/\/setpayload (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        try {
            const payload = JSON.parse(match[1]);
            userPayloads.set(chatId, payload);
            await bot.sendMessage(chatId, 'Custom payload set successfully!');
        } catch (error) {
            await bot.sendMessage(chatId, 'Invalid payload format. Please provide a valid JSON object.');
        }
    });
    bot.onText(/\/showpayload/, async (msg) => {
        const chatId = msg.chat.id;
        const payload = userPayloads.get(chatId) || "Default payload is in use.";
        await bot.sendMessage(chatId, `Current payload: ${JSON.stringify(payload, null, 2)}`);
    });
    bot.onText(/\/resetpayload/, async (msg) => {
        const chatId = msg.chat.id;
        userPayloads.delete(chatId);
        await bot.sendMessage(chatId, 'Payload has been reset to the default.');
    });
    bot.onText(/\/setauthcode (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const authcode = match[1];
        userAuthorization.set(chatId, authcode);
        await bot.sendMessage(chatId, `Custom authorization code set to: ${authcode}`);
    });
    bot.onText(/\/showauthcode/, async (msg) => {
        const chatId = msg.chat.id;
        const authcode = userAuthorization.get(chatId) || "No custom authorization code set.";
        await bot.sendMessage(chatId, `Current authorization code: ${authcode}`);
    });
    bot.onText(/\/resetauthcode/, async (msg) => {
        const chatId = msg.chat.id;
        userAuthorization.delete(chatId);
        await bot.sendMessage(chatId, 'Authorization code has been reset to default.');
    });
    return bot;
}
async function disconnectBot(token) {
    const bot = activeBots.get(token);
    if (bot) {
        const scriptId = `bot_${token}`;
        const scriptState = runningScripts.get(scriptId);
        if (scriptState && scriptState.isRunning) {
            scriptState.isRunning = false;
        }
        await bot.stopPolling();
        activeBots.delete(token);
        return true;
    }
    return false;
}
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.post('/start_bot', async (req, res) => {
    const { bot_token } = req.body;
    if (!bot_token) {
        return res.status(400).json({ error: 'Bot token is required' });
    }
    try {
        if (activeBots.has(bot_token)) {
            await disconnectBot(bot_token);
        }
        const bot = createBot(bot_token);
        activeBots.set(bot_token, bot);
        res.json({ message: 'Bot started successfully!' });
    } catch (error) {
        res.status(500).json({ error: 'An error occurred while starting the bot.\n Please try again later.' });
    }
});
app.post('/disconnect_bot', async (req, res) => {
    const { bot_token } = req.body;
    if (!bot_token) {
        return res.status(400).json({ error: 'Bot token is required' });
    }
    try {
        const disconnected = await disconnectBot(bot_token);
        if (disconnected) {
            res.json({ message: 'Bot disconnected successfully!' });
        } else {
            res.status(404).json({ error: 'No active bot found with this token' });
        }
    } catch (error) {
        res.status(500).json({ error: 'An error occurred while disconnecting the bot.\n Please try again later.' });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});