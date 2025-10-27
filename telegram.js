const TelegramBot = require("node-telegram-bot-api");
const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = require("./config");

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

async function sendMessage(message) {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Telegram error:", err.message);
  }
}

module.exports = { sendMessage };
