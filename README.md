# DevPool - Bounties Directory

## For Bounty Hunters

- All available bounties are viewable in the [issues section](https://github.com/ubiquity/devpool/issues).
- You can subscribe to notifications for this repository to automatically see new available bounties.
- You can not assign yourself to the issues inside of this repository. Instead, you must navigate to the linked issue, and write `/start` there in order to take a bounty. 

## For Partners

You can add your repository automatically by adding our [UbiquiBot](https://github.com/marketplace/ubiquibot) to your public repository.
1. The bot will automatically open up a pull request, requesting to be added. 
2. When the pull request is merged your bounties will appear [here](https://github.com/ubiquity/devpool/issues).

## Maintaining This Repository

When maintaining this repository (e.g. when working on [its bounties](https://github.com/ubiquity/devpool-directory-bounties/issues)) please do not enable the `issues` tab on your fork, or else all of our partner issues will have spam from your fork (e.g. "x user mentioned this issue x days ago") on all of the issues of every repository in this directory. 

<img width="862" alt="image" src="https://github.com/ubiquity/devpool-directory/assets/4975670/c3db8f81-19ac-4aa4-9351-06c9a5fda77f">

## Setting Up the Bot

1. Create the bot using BotFather on Telegram.
    - Start a chat with [@BotFather](https://t.me/BotFather) on Telegram.
    - Use the `/newbot` command to create a new bot.
    - Choose a unique name for your bot that ends with "bot."
    - After creation, BotFather will provide you with a token crucial for interacting with the Telegram Bot API.

2. Set Up the Environment
    - Set environment variables for API_ID, API_KEY, BOT_TOKEN, and ALLOWED_USER_IDS.
    ```bash
    export API_ID='1234567'
    export API_KEY='abcdefg2hijk5lmnopq8rstuvwxyz9'
    export BOT_TOKEN='123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'
    export ALLOWED_USER_IDS='112113115,567568569'
    ```

3. Start the Bot
    - Run the main script of the bot.
    ```bash
    python PyroEdgeGptBot.py
    ```

4. Set Bot Commands (Optional)
    - Send `/mybots` to BotFather, select your bot, and click Edit Bot -> Edit Commands.
    - Example bot commands:
      - start - Start the bot!
      - help - Get help
      - reset - Reset the bot
      - new - Create new conversation
      - switch - Switch the conversation style
      - interval - Set edit interval
      - suggest_mode - Set the suggest mode
      - image_gen - Generate images
      - update - Update the EdgeGPT dependence
      - cookie - Set your cookie
      - bot_name - Set the bot name display to you